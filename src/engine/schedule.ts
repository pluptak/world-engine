import type { TransitionContext } from "./command.js";
import { pushOccupantsAside } from "./verbs/gate.js";
import { hurt } from "./harm.js";
import type { Id, ScheduledCause } from "../model.js";
import { pending, withCause, withSchedule } from "./pending.js";
import { runProcess } from "./process.js";
import { beatInvalid, runBeat } from "./beats.js";

export { pending, withSchedule };

export function schedule(context: TransitionContext, cause: ScheduledCause): void {
  context.snapshot = withCause(context.snapshot, cause);
}

// Withdrawn at the source, recording nothing: a door shut by hand has no close left to come.
export function cancel(context: TransitionContext, kind: ScheduledCause["kind"], entity: Id): void {
  const list = pending(context.snapshot);
  const kept = list.filter((entry) => entry.kind !== kind || entry.entity !== entity);
  if (kept.length !== list.length) {
    context.snapshot = withSchedule(context.snapshot, kept);
  }
}

// A cause whose entity is gone has nothing left to act on; it goes with the entity.
export function pruneSchedule(context: TransitionContext): void {
  const list = pending(context.snapshot);
  const kept = list.filter((entry) => context.snapshot.entities[entry.entity] !== undefined);
  if (kept.length !== list.length) {
    context.snapshot = withSchedule(context.snapshot, kept);
  }
}

// A body's bleeding, read from its props when each bleed runs: so much integrity every so many
// ticks, so many times. Any of the three missing or not a positive integer, and it does not bleed.
function bleeding(props: Record<string, unknown>): { damage: number; every: number; times: number } | null {
  const read = (name: string): number | null => {
    const value = props[name];
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  const damage = read("bleed_damage");
  const every = read("bleed_every_ticks");
  const times = read("bleed_times");
  return damage === null || every === null || times === null ? null : { damage, every, times };
}

function scheduleBleed(context: TransitionContext, entity: Id, causeId: Id, remaining: number): void {
  const rule = bleeding(context.snapshot.entities[entity]?.props ?? {});
  const due = context.snapshot.tick + (rule?.every ?? 0);
  if (rule !== null && remaining > 0 && Number.isSafeInteger(due)) {
    schedule(context, { due_tick: due, kind: "bleed", entity, cause_id: causeId, remaining });
  }
}

// A lost part starts a wound of its own: the first bleed falls due `bleed_every_ticks` after the
// `detached` that opened it, and two wounds bleed side by side.
export function startBleeding(context: TransitionContext, entity: Id, detachedEvent: Id): void {
  const rule = bleeding(context.snapshot.entities[entity]?.props ?? {});
  if (rule !== null) {
    scheduleBleed(context, entity, detachedEvent, rule.times);
  }
}

type CauseKindName = ScheduledCause["kind"];
type CauseOf<K extends CauseKindName> = Extract<ScheduledCause, { kind: K }>;

// What a kind owes the engine: how its due cause runs, and what makes a stored one invalid beyond
// the fields every cause shares. The table below is the one place a kind lives, and it must name
// every member of `ScheduledCause`, so a new kind that is not in it does not compile.
interface CauseKind<K extends CauseKindName> {
  // Runs one due cause, already taken off the schedule, at the current tick. A cause the world has
  // overtaken (the door already shut, the body already destroyed) does nothing and says nothing.
  run(context: TransitionContext, cause: CauseOf<K>): void;
  // A rule a stored cause of this kind breaks, as a `validateSnapshot` code and its detail; null if none.
  invalid(cause: CauseOf<K>): { code: string; detail: string } | null;
}

function runClose(context: TransitionContext, cause: CauseOf<"close">): void {
  const entity = context.snapshot.entities[cause.entity];
  if (entity === undefined || entity.props.openable !== true || entity.props.open !== true) {
    return;
  }
  const eventId = context.emit("closed", entity.id, {}, cause.cause_id);
  context.set(entity.id, "props", { ...entity.props, open: false }, eventId);
  pushOccupantsAside(context, entity.id, eventId);
}

function runBleed(context: TransitionContext, cause: CauseOf<"bleed">): void {
  const entity = context.snapshot.entities[cause.entity];
  const rule = entity === undefined ? null : bleeding(entity.props);
  if (entity === undefined || rule === null) {
    return;
  }
  // Each bleed names the one before it, back to the `detached` that opened the wound.
  const harm = hurt(context, entity.id, rule.damage, cause.cause_id);
  if (harm !== null && !harm.destroyed) {
    scheduleBleed(context, entity.id, harm.eventId, cause.remaining - 1);
  }
}

function runProcessCause(context: TransitionContext, cause: CauseOf<"process">): void {
  runProcess(context, cause);
}

function runBeatCause(context: TransitionContext, cause: CauseOf<"beat">): void {
  runBeat(context, cause);
}

const CAUSE_TABLE: { [K in CauseKindName]: CauseKind<K> } = {
  close: { run: runClose, invalid: () => null },
  bleed: {
    run: runBleed,
    invalid: (cause) =>
      Number.isSafeInteger(cause.remaining) && cause.remaining > 0
        ? null
        : { code: "bleed_not_remaining", detail: `remaining ${cause.remaining}` },
  },
  process: {
    run: runProcessCause,
    invalid: (cause) =>
      typeof cause.process === "string" && cause.process.length > 0
        ? null
        : { code: "invalid_process", detail: String(cause.process) },
  },
  beat: {
    run: runBeatCause,
    invalid: (cause) => {
      const broken = beatInvalid(cause);
      return broken === null ? null : { code: "invalid_beat", detail: broken };
    },
  },
};

export const CAUSE_KINDS: readonly CauseKindName[] = Object.keys(CAUSE_TABLE) as CauseKindName[];

// The kind's own rule for a stored cause, or null; a kind the table does not know has none, which
// `validateSnapshot` reports as `unknown_cause_kind` before it asks.
export function causeInvalid(cause: ScheduledCause): { code: string; detail: string } | null {
  const kind = CAUSE_TABLE[cause.kind] as CauseKind<CauseKindName> | undefined;
  return kind === undefined ? null : kind.invalid(cause as never);
}

export function runCause(context: TransitionContext, cause: ScheduledCause): void {
  const kind = CAUSE_TABLE[cause.kind] as CauseKind<CauseKindName> | undefined;
  if (kind !== undefined) {
    kind.run(context, cause as never);
  }
}
