import type { TransitionContext } from "./command.js";
import { ORDER_OPS } from "./compare.js";
import { hurt } from "./harm.js";
import { pending, withCause, withSchedule } from "./pending.js";
import { spendEntity } from "../resolvers/physical.js";
import { removeEntity } from "./verbs/edit.js";
import type { Entity, Id, ScheduledCause, Snapshot } from "../model.js";
import type { ProcessDecl, TemplateRegistry } from "../templates.js";

type ProcessCause = Extract<ScheduledCause, { kind: "process" }>;

function declsOf(registry: TemplateRegistry, entity: Entity): readonly ProcessDecl[] {
  return registry[entity.template]?.processes ?? [];
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

// The condition under which a process runs, read from the entity's props as they are now. `eq` and
// `ne` compare any primitive strictly (an absent prop is equal to nothing); the ordering ops need
// numbers on both sides, and an absent or non-numeric prop satisfies none of them.
function whileHolds(decl: ProcessDecl, props: Record<string, unknown>): boolean {
  if (decl.while === undefined) {
    return true;
  }
  const actual = props[decl.while.prop];
  const wanted = decl.while.value;
  switch (decl.while.op) {
    case "eq":
      return actual === wanted;
    case "ne":
      return actual !== wanted;
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      if (typeof actual !== "number" || typeof wanted !== "number") {
        return false;
      }
      return ORDER_OPS[decl.while.op](actual, wanted);
    default: {
      const exhaustive: never = decl.while.op;
      throw new TypeError(`Unknown while op ${String(exhaustive)}`);
    }
  }
}

// A process can run when its condition holds and the prop it adjusts is an integer not yet at the
// bound it is moving toward, on something not destroyed. A prop at its bound is where the process
// ends, not something to poll.
function runnable(decl: ProcessDecl, entity: Entity): boolean {
  const props = entity.props;
  const adjust = decl.effect.adjust_prop;
  const value = props[adjust.prop];
  if (entity.status === "destroyed" || !isInt(value) || !whileHolds(decl, props)) {
    return false;
  }
  if (adjust.by < 0 && adjust.min !== undefined && value <= adjust.min) {
    return false;
  }
  if (adjust.by > 0 && adjust.max !== undefined && value >= adjust.max) {
    return false;
  }
  return true;
}

// How long the next run waits: the entity's prop named by `every_ticks_prop` when it is a positive
// integer, else `every_ticks`. Read when the run is scheduled, so a run already pending keeps the
// delay it was given.
function delayOf(decl: ProcessDecl, entity: Entity): number {
  const rate = decl.every_ticks_prop === undefined ? undefined : entity.props[decl.every_ticks_prop];
  return isInt(rate) && rate >= 1 ? rate : decl.every_ticks;
}

function isPendingFor(cause: ScheduledCause, entity: Id, process: string): boolean {
  return cause.kind === "process" && cause.entity === entity && cause.process === process;
}

// Brings one entity's schedule in line with its props: a process that can run and has nothing pending
// is scheduled `every_ticks` from now, naming the event that made it so; a pending one that can no
// longer run is withdrawn, recording nothing. Called wherever props can change, never on a timer.
export function reconcile(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  entityId: Id,
  causeId: Id | null,
): Snapshot {
  const entity = snapshot.entities[entityId];
  if (entity === undefined) {
    return snapshot;
  }
  let result = reconcileClose(snapshot, entity, causeId);
  for (const decl of declsOf(registry, entity)) {
    const waiting = pending(result).some((cause) => isPendingFor(cause, entityId, decl.id));
    const can = runnable(decl, entity);
    if (can && !waiting) {
      const due = snapshot.tick + delayOf(decl, entity);
      if (Number.isSafeInteger(due)) {
        result = withCause(result, { due_tick: due, kind: "process", entity: entityId, cause_id: causeId, process: decl.id });
      }
    } else if (!can && waiting) {
      result = withSchedule(
        result,
        pending(result).filter((cause) => !isPendingFor(cause, entityId, decl.id)),
      );
    }
  }
  return result;
}

// A self-closing openable that is open, however it came to be, closes `closes_after` ticks from now:
// placed open, spawned, edited or refined into one. The `open` verb schedules its own first, so one
// already pending is left as it is.
function reconcileClose(snapshot: Snapshot, entity: Entity, causeId: Id | null): Snapshot {
  const after = entity.props.closes_after;
  if (
    entity.props.openable !== true ||
    entity.props.open !== true ||
    !isInt(after) ||
    after <= 0 ||
    pending(snapshot).some((cause) => cause.kind === "close" && cause.entity === entity.id)
  ) {
    return snapshot;
  }
  const due = snapshot.tick + after;
  return Number.isSafeInteger(due)
    ? withCause(snapshot, { due_tick: due, kind: "close", entity: entity.id, cause_id: causeId })
    : snapshot;
}

// A world built from a scenario has no event behind it, so what its templates set going starts
// with no cause: the first `changed` of such a process is a root.
export function startProcesses(snapshot: Snapshot, registry: TemplateRegistry): Snapshot {
  let result = snapshot;
  for (const id of Object.keys(snapshot.entities).sort()) {
    result = reconcile(result, registry, id, null);
  }
  return result;
}

// After a stretch of a command's own changes (or after one cause has run), reconcile every entity
// whose props changed, that was spawned or that became another preset in it, each naming the last
// event that touched it. A refinement may change no prop, so its template is the only trace.
export function reconcileSince(context: TransitionContext, mark: number): void {
  const touched = new Map<Id, Id>();
  for (const delta of context.deltas.slice(mark)) {
    if ((delta.field === "props" || delta.field === "entity" || delta.field === "template") && delta.to !== null) {
      touched.set(delta.entity, delta.event_id);
    }
  }
  for (const [entity, eventId] of touched) {
    context.snapshot = reconcile(context.snapshot, context.registry, entity, eventId);
  }
}

// One run: adjust the prop, clamped to its bounds, under a `changed` that names the event that set
// the process going. A cause the world has overtaken does nothing. The next run is scheduled by the
// reconcile that follows the write, so a process that reached its bound is not scheduled again.
export function runProcess(context: TransitionContext, cause: ProcessCause): void {
  const entity = context.snapshot.entities[cause.entity];
  const decl = entity === undefined ? undefined : declsOf(context.registry, entity).find((d) => d.id === cause.process);
  if (entity === undefined || decl === undefined || !runnable(decl, entity)) {
    return;
  }
  // A chance process rolls each run: a miss does nothing and says nothing, and the next run is
  // scheduled as though this one had happened, since no write will do it.
  if (decl.chance_pct !== undefined && context.random() * 100 >= decl.chance_pct) {
    context.snapshot = reconcile(context.snapshot, context.registry, entity.id, cause.cause_id);
    return;
  }
  const adjust = decl.effect.adjust_prop;
  const from = entity.props[adjust.prop] as number;
  const moved = from + adjust.by;
  const to =
    adjust.by < 0
      ? Math.max(moved, adjust.min ?? -Infinity)
      : Math.min(moved, adjust.max ?? Infinity);
  if (to === from || !Number.isSafeInteger(to)) {
    return;
  }
  const eventId = context.emit("changed", entity.id, { prop: adjust.prop, from, to, process: decl.id }, cause.cause_id);
  context.set(entity.id, "props", { ...entity.props, [adjust.prop]: to }, eventId);
  const reached = adjust.by < 0 ? to === adjust.min : to === adjust.max;
  if (reached && decl.then !== undefined) {
    runThen(context, entity.id, decl, eventId);
  }
}

// What a process does once, on reaching its bound, under the `changed` that reached it: write a prop
// (a second `changed`), take integrity (the same chain a bleed makes), take the entity out of the
// world, or use it up (`spent`, which leaves what its template says it leaves). Each can start or stop other processes through the reconcile that follows.
function runThen(context: TransitionContext, entityId: Id, decl: ProcessDecl, causeId: Id): void {
  const then = decl.then!;
  const entity = context.snapshot.entities[entityId];
  if (entity === undefined) {
    return;
  }
  if ("set_prop" in then) {
    const { prop, value } = then.set_prop;
    if (entity.props[prop] !== value) {
      const eventId = context.emit("changed", entityId, { prop, from: entity.props[prop] ?? null, to: value, process: decl.id }, causeId);
      context.set(entityId, "props", { ...entity.props, [prop]: value }, eventId);
    }
  } else if ("damage" in then) {
    hurt(context, entityId, then.damage.amount, causeId);
  } else if ("spent" in then) {
    spendEntity(context, entityId, causeId);
  } else {
    removeEntity(context, entityId, causeId);
  }
}
