import type { TransitionContext } from "./command.js";
import type { Id, ScheduledCause, Snapshot } from "../model.js";

export const CAUSE_KINDS: readonly ScheduledCause["kind"][] = ["close"];

export function pending(snapshot: Snapshot): readonly ScheduledCause[] {
  return snapshot.schedule ?? [];
}

// The one way the schedule is written: an empty schedule is stored as no field at all.
export function withSchedule(snapshot: Snapshot, schedule: ScheduledCause[]): Snapshot {
  const { schedule: _dropped, ...rest } = snapshot;
  return schedule.length === 0 ? rest : { ...rest, schedule };
}

// A new cause goes after every cause due at or before its tick, so two due together run in the
// order they were scheduled.
export function schedule(context: TransitionContext, cause: ScheduledCause): void {
  const list = [...pending(context.snapshot)];
  const at = list.findIndex((entry) => entry.due_tick > cause.due_tick);
  list.splice(at === -1 ? list.length : at, 0, cause);
  context.snapshot = withSchedule(context.snapshot, list);
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

// Runs one due cause, already taken off the schedule, at the current tick. A cause the world has
// overtaken (the door already shut) does nothing and says nothing.
export function runCause(context: TransitionContext, cause: ScheduledCause): void {
  const entity = context.snapshot.entities[cause.entity];
  if (cause.kind === "close") {
    if (entity === undefined || entity.props.openable !== true || entity.props.open !== true) {
      return;
    }
    const eventId = context.emit("closed", entity.id, {}, cause.cause_id);
    context.set(entity.id, "props", { ...entity.props, open: false }, eventId);
  }
}
