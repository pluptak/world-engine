import type { Id, ScheduledCause, Snapshot, WorldEvent } from "../model.js";
import { ORDER_OPS } from "./compare.js";
import {
  WORLD_AUTHOR,
  type BeatAction,
  type BeatChild,
  type BeatCondition,
  type BeatRepeat,
  type Command,
  type InCondition,
  type OccupiedCondition,
  type PropCondition,
  type ScheduleBeatEdit,
  type SingleCondition,
  type TransitionContext,
} from "./command.js";
import { pruneSchedule, withCause } from "./pending.js";
import { resolveTarget } from "./resolve.js";
import { isAgent } from "./verbs/address.js";
import { editVerb, parseEdit } from "./verbs/edit.js";

// An authored beat is the architect's intention, kept in the snapshot's schedule as a cause of kind
// `beat`. When it falls due it becomes ordinary events, so every observer senses it as it would any
// others. A beat is data: the action is one of a closed set, never code (`docs/beats.md`).

export const MAX_BEATS = 256;
// Levels of nesting, the beat itself counted: a beat, its `then`, theirs, and theirs.
export const MAX_DEPTH = 4;
// Runs a repeating beat may have after its first.
export const MAX_REPEATS = 1000;
// Single conditions one `all` holds: from one to this many.
export const MAX_ALL = 16;

type BeatCause = Extract<ScheduledCause, { kind: "beat" }>;

const BEAT_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const OPS: readonly string[] = ["eq", "ne", "lt", "lte", "gt", "gte"];
const ACTION_EDITS: readonly string[] = ["spawn", "remove", "place", "set_props", "set_part"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function isBeatId(value: unknown): value is string {
  return typeof value === "string" && BEAT_ID.test(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// `{ all: [...] }` holds when each of its one to `MAX_ALL` single conditions does; the singles are not
// nested. Otherwise one of three forms, told apart by their keys; a mix of forms, or none, is malformed.
function parseCondition(value: unknown): BeatCondition | null {
  if (isRecord(value) && "all" in value) {
    if (!onlyKeys(value, ["all"]) || !Array.isArray(value.all) || value.all.length === 0 || value.all.length > MAX_ALL) {
      return null;
    }
    const all: SingleCondition[] = [];
    for (const entry of value.all as unknown[]) {
      const single = parseSingleCondition(entry);
      if (single === null) {
        return null;
      }
      all.push(single);
    }
    return { all };
  }
  return parseSingleCondition(value);
}

function parseSingleCondition(value: unknown): SingleCondition | null {
  if (!isRecord(value)) {
    return null;
  }
  if ("in" in value) {
    return onlyKeys(value, ["entity", "in"]) && nonEmpty(value.entity) && nonEmpty(value.in)
      ? (value as unknown as InCondition)
      : null;
  }
  if ("room" in value || "occupied" in value) {
    return onlyKeys(value, ["room", "occupied"]) && nonEmpty(value.room) && typeof value.occupied === "boolean"
      ? (value as unknown as OccupiedCondition)
      : null;
  }
  return parsePropCondition(value);
}

function parsePropCondition(value: Record<string, unknown>): PropCondition | null {
  if (
    !onlyKeys(value, ["entity", "prop", "op", "value"]) ||
    typeof value.entity !== "string" ||
    value.entity.length === 0 ||
    typeof value.prop !== "string" ||
    value.prop.length === 0 ||
    typeof value.op !== "string" ||
    !OPS.includes(value.op)
  ) {
    return null;
  }
  const operand = value.value;
  const ordered = value.op !== "eq" && value.op !== "ne";
  if (
    (typeof operand !== "string" && typeof operand !== "boolean" && !Number.isFinite(operand)) ||
    (ordered && typeof operand !== "number")
  ) {
    return null;
  }
  return value as unknown as PropCondition;
}

function parseRepeat(value: unknown): BeatRepeat | null {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ["every_ticks", "times", "until_ran"]) ||
    !Number.isSafeInteger(value.every_ticks) ||
    (value.every_ticks as number) < 1 ||
    !Number.isSafeInteger(value.times) ||
    (value.times as number) < 1 ||
    (value.times as number) > MAX_REPEATS ||
    (value.until_ran !== undefined && value.until_ran !== true)
  ) {
    return null;
  }
  return {
    every_ticks: value.every_ticks as number,
    times: value.times as number,
    ...(value.until_ran === true && { until_ran: true as const }),
  };
}

function parseAction(value: unknown): BeatAction | null {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return null;
  }
  if (value.kind === "sound") {
    if (
      !onlyKeys(value, ["kind", "entity", "loud"]) ||
      typeof value.entity !== "string" ||
      value.entity.length === 0 ||
      (value.loud !== undefined && typeof value.loud !== "boolean")
    ) {
      return null;
    }
    return value as unknown as BeatAction;
  }
  if (!ACTION_EDITS.includes(value.kind)) {
    return null;
  }
  const edit = parseEdit(value);
  if (edit === null || actionSubject(edit as BeatAction) === null) {
    return null;
  }
  return edit as BeatAction;
}

// The entity a beat is about: a sound's source, an edit's target, a spawn's location. It is the
// entity the beat goes with if it is removed first.
export function actionSubject(action: BeatAction): Id | null {
  switch (action.kind) {
    case "sound":
      return action.entity;
    case "spawn": {
      const location = action.overrides?.location;
      return typeof location === "string" ? location : null;
    }
    default:
      return action.target;
  }
}

function parseChildren(value: unknown, depth: number): BeatChild[] | null {
  if (!Array.isArray(value) || value.length === 0 || depth > MAX_DEPTH) {
    return null;
  }
  const children: BeatChild[] = [];
  for (const raw of value as unknown[]) {
    if (
      !isRecord(raw) ||
      !onlyKeys(raw, ["id", "delay_ticks", "action", "only_if", "then"]) ||
      !isBeatId(raw.id) ||
      !Number.isSafeInteger(raw.delay_ticks) ||
      (raw.delay_ticks as number) <= 0
    ) {
      return null;
    }
    const action = parseAction(raw.action);
    if (action === null) {
      return null;
    }
    const child: BeatChild = { id: raw.id, delay_ticks: raw.delay_ticks as number, action };
    if (raw.only_if !== undefined) {
      const only = parseCondition(raw.only_if);
      if (only === null) {
        return null;
      }
      child.only_if = only;
    }
    if (raw.then !== undefined) {
      const then = parseChildren(raw.then, depth + 1);
      if (then === null) {
        return null;
      }
      child.then = then;
    }
    children.push(child);
  }
  return children;
}

// The body of a `schedule_beat` edit, or null for one that is malformed.
export function parseScheduleBeat(value: Record<string, unknown>): ScheduleBeatEdit | null {
  if (
    !onlyKeys(value, ["kind", "id", "at_tick", "action", "only_if", "then", "repeat"]) ||
    !isBeatId(value.id) ||
    !Number.isSafeInteger(value.at_tick)
  ) {
    return null;
  }
  const action = parseAction(value.action);
  if (action === null) {
    return null;
  }
  const edit: ScheduleBeatEdit = { kind: "schedule_beat", id: value.id, at_tick: value.at_tick as number, action };
  if (value.only_if !== undefined) {
    const only = parseCondition(value.only_if);
    if (only === null) {
      return null;
    }
    edit.only_if = only;
  }
  if (value.then !== undefined) {
    const then = parseChildren(value.then, 2);
    if (then === null) {
      return null;
    }
    edit.then = then;
  }
  if (value.repeat !== undefined) {
    const repeat = parseRepeat(value.repeat);
    if (repeat === null || edit.then !== undefined) {
      return null;
    }
    edit.repeat = repeat;
  }
  return edit;
}

// What is wrong with a stored beat cause, or null: the same shape a `schedule_beat` carries, the
// subject being the cause's own entity.
export function beatInvalid(cause: BeatCause): string | null {
  const shaped = parseScheduleBeat({
    kind: "schedule_beat",
    id: cause.id,
    at_tick: cause.due_tick,
    action: cause.action,
    only_if: cause.only_if,
    then: cause.then,
    repeat: cause.repeat,
  });
  if (shaped === null) {
    return `beat ${String(cause.id)} is malformed`;
  }
  return actionSubject(shaped.action) === cause.entity ? null : `beat ${cause.id} is not about ${cause.entity}`;
}

function nodeIds(id: string, then: BeatChild[] | undefined): string[] {
  const ids = [id];
  for (const child of then ?? []) {
    ids.push(...nodeIds(child.id, child.then));
  }
  return ids;
}

// Every id in the pending beats and the chains they will schedule, in schedule order.
export function pendingBeatIds(list: readonly ScheduledCause[]): string[] {
  const ids: string[] = [];
  for (const cause of list) {
    if (cause.kind === "beat") {
      ids.push(...nodeIds(cause.id, cause.then));
    }
  }
  return ids;
}

export function editBeatIds(edit: ScheduleBeatEdit): string[] {
  return nodeIds(edit.id, edit.then);
}

// Whether a live agent stands in the room: a destroyed body, a bled-out one and a severed part do not.
function occupied(snapshot: Snapshot, room: Id): boolean {
  return Object.values(snapshot.entities).some((entity) => entity.location === room && isAgent(snapshot, entity.id));
}

// The entities the conditions of a beat read: each single condition's entity, or its room.
export function conditionSubjects(condition: BeatCondition): Id[] {
  const singles = "all" in condition ? condition.all : [condition];
  return singles.map((single) => ("room" in single ? single.room : single.entity));
}

// Every condition a `schedule_beat` carries, its followers' included, in the order they are written.
export function editConditions(edit: ScheduleBeatEdit): BeatCondition[] {
  const found: BeatCondition[] = edit.only_if === undefined ? [] : [edit.only_if];
  const visit = (children: BeatChild[] | undefined): void => {
    for (const child of children ?? []) {
      if (child.only_if !== undefined) {
        found.push(child.only_if);
      }
      visit(child.then);
    }
  };
  visit(edit.then);
  return found;
}

function holds(condition: BeatCondition, snapshot: Snapshot): boolean {
  if ("all" in condition) {
    return condition.all.every((single) => holds(single, snapshot));
  }
  if ("in" in condition) {
    // A room that is not there holds nothing, so asking after it needs no check of its own.
    return snapshot.entities[condition.entity]?.location === condition.in;
  }
  if ("room" in condition) {
    return snapshot.entities[condition.room] !== undefined && occupied(snapshot, condition.room) === condition.occupied;
  }
  const have = snapshot.entities[condition.entity]?.props[condition.prop];
  if (have === undefined) {
    return false;
  }
  const want = condition.value;
  switch (condition.op) {
    case "eq":
      return have === want;
    case "ne":
      return have !== want;
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      if (typeof have !== "number" || typeof want !== "number") {
        return false;
      }
      return ORDER_OPS[condition.op](have, want);
    default: {
      const exhaustive: never = condition.op;
      throw new TypeError(`Unknown condition op ${String(exhaustive)}`);
    }
  }
}

// The first event the action wrote, or the failure that stopped it with nothing written.
type Fired = { ok: true; eventId: Id } | { ok: false; code: string };

// An edit runs under the beat's own cause, in a context that is the command's but for the edit's
// verb, command and root event, and a failure puts everything back: the snapshot, the events and the
// deltas. The edit's own checks are the ones the author's `edit` is held to, and so is the
// snapshot-wide guard after it.
function fireEdit(context: TransitionContext, cause: BeatCause, action: Exclude<BeatAction, { kind: "sound" }>): Fired {
  const command: Command = {
    command_id: context.command.command_id,
    actor: WORLD_AUTHOR,
    verb: "edit",
    args: { edit: action },
  };
  let target = null;
  if ("target" in action) {
    command.target = action.target;
    const resolution = resolveTarget(context.snapshot, context.registry, WORLD_AUTHOR, action.target);
    if (resolution.status !== "resolved") {
      return { ok: false, code: resolution.status };
    }
    target = resolution.target;
  }
  const fire = Object.create(context) as TransitionContext;
  Object.defineProperties(fire, {
    command: { value: command },
    target: { value: target },
    verb: { value: editVerb },
    root_event_id: { value: cause.cause_id },
  });
  const checked = editVerb.preconditions(fire);
  if (checked.status !== "ok") {
    return { ok: false, code: "reason_code" in checked ? checked.reason_code : checked.status };
  }
  const snapshot = context.snapshot;
  const events = context.events as WorldEvent[];
  const deltas = context.deltas as unknown[];
  const eventMark = events.length;
  const deltaMark = deltas.length;
  editVerb.transition(fire);
  // The removal of a subject takes its other pending causes with it before the result is checked, as it
  // does for an edit the author sends.
  pruneSchedule(fire);
  const guard = editVerb.validateResult?.(fire) ?? { status: "ok" as const };
  if (guard.status !== "ok") {
    context.snapshot = snapshot;
    events.length = eventMark;
    deltas.length = deltaMark;
    return { ok: false, code: "reason_code" in guard ? guard.reason_code : guard.status };
  }
  return { ok: true, eventId: events[eventMark]?.event_id ?? cause.cause_id };
}

function fire(context: TransitionContext, cause: BeatCause): Fired {
  const action = cause.action;
  if (action.kind === "sound") {
    return { ok: true, eventId: context.emit("sounded", action.entity, { loud: action.loud === true }, cause.cause_id) };
  }
  return fireEdit(context, cause, action);
}

function skipped(context: TransitionContext, cause: BeatCause, data: Record<string, unknown>): void {
  context.emit("beat_skipped", cause.entity, { id: cause.id, ...data }, cause.cause_id);
}

// Each follower is scheduled `delay_ticks` after its parent ran, with the parent's event as its
// cause. One whose subject is gone, or whose due tick is out of range, is not scheduled.
function scheduleFollowers(context: TransitionContext, children: BeatChild[] | undefined, parentEvent: Id): void {
  for (const child of children ?? []) {
    const due = context.snapshot.tick + child.delay_ticks;
    const subject = actionSubject(child.action);
    if (subject === null || context.snapshot.entities[subject] === undefined || !Number.isSafeInteger(due)) {
      continue;
    }
    const beat: BeatCause = {
      due_tick: due,
      kind: "beat",
      entity: subject,
      cause_id: parentEvent,
      id: child.id,
      action: child.action,
    };
    if (child.only_if !== undefined) {
      beat.only_if = child.only_if;
    }
    if (child.then !== undefined) {
      beat.then = child.then;
    }
    context.snapshot = withCause(context.snapshot, beat);
  }
}

// The next run of a repeating beat, whatever this one did: it ran, was skipped by its condition, or
// was refused. It keeps the id (this run is off the schedule) and the cause of the run before.
function scheduleNextRun(context: TransitionContext, cause: BeatCause): void {
  const repeat = cause.repeat;
  const due = context.snapshot.tick + (repeat?.every_ticks ?? 0);
  if (repeat === undefined || context.snapshot.entities[cause.entity] === undefined || !Number.isSafeInteger(due)) {
    return;
  }
  const { repeat: _spent, ...rest } = cause;
  const next: BeatCause = { ...rest, due_tick: due };
  if (repeat.times > 1) {
    next.repeat = { ...repeat, times: repeat.times - 1 };
  }
  context.snapshot = withCause(context.snapshot, next);
}

// A watch (a repeating beat with `until_ran`) records nothing while its condition is false, and ends
// after the first run whose action ran; a failed run is still recorded and the watch goes on.
export function runBeat(context: TransitionContext, cause: BeatCause): void {
  const watch = cause.repeat?.until_ran === true;
  if (cause.only_if !== undefined && !holds(cause.only_if, context.snapshot)) {
    if (!watch) {
      skipped(context, cause, { reason: "condition" });
    }
  } else {
    const fired = fire(context, cause);
    if (!fired.ok) {
      skipped(context, cause, { reason: "failed", code: fired.code });
    } else {
      scheduleFollowers(context, cause.then, fired.eventId);
      if (watch) {
        return;
      }
    }
  }
  scheduleNextRun(context, cause);
}
