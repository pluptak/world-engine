import type { TransitionContext } from "./command.js";
import { pending, withCause, withSchedule } from "./pending.js";
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
  }
  if (typeof actual !== "number" || typeof wanted !== "number") {
    return false;
  }
  switch (decl.while.op) {
    case "lt":
      return actual < wanted;
    case "lte":
      return actual <= wanted;
    case "gt":
      return actual > wanted;
    case "gte":
      return actual >= wanted;
  }
}

// A process can run when its condition holds and the prop it adjusts is an integer not yet at the
// bound it is moving toward. A prop at its bound is where the process ends, not something to poll.
function runnable(decl: ProcessDecl, props: Record<string, unknown>): boolean {
  const adjust = decl.effect.adjust_prop;
  const value = props[adjust.prop];
  if (!isInt(value) || !whileHolds(decl, props)) {
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
  let result = snapshot;
  for (const decl of declsOf(registry, entity)) {
    const waiting = pending(result).some((cause) => isPendingFor(cause, entityId, decl.id));
    const can = runnable(decl, entity.props);
    if (can && !waiting) {
      const due = snapshot.tick + decl.every_ticks;
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
// whose props changed or that was spawned in it, each naming the last event that touched it.
export function reconcileSince(context: TransitionContext, mark: number): void {
  const touched = new Map<Id, Id>();
  for (const delta of context.deltas.slice(mark)) {
    if ((delta.field === "props" || delta.field === "entity") && delta.to !== null) {
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
  if (entity === undefined || decl === undefined || !runnable(decl, entity.props)) {
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
}
