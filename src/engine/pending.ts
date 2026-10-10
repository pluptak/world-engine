import type { Id, ScheduledCause, Snapshot } from "../model.js";

export function pending(snapshot: Snapshot): readonly ScheduledCause[] {
  return snapshot.schedule ?? [];
}

// What the world will do by itself that matches a filter, in run order, as a copy: a caller reads the
// schedule and changes nothing. `until_tick` keeps the causes due at or before that tick.
export interface ScheduleFilter {
  kind?: ScheduledCause["kind"];
  entity?: Id;
  until_tick?: number;
}

export function scheduled(snapshot: Snapshot, filter: ScheduleFilter = {}): ScheduledCause[] {
  return pending(snapshot)
    .filter((cause) => filter.kind === undefined || cause.kind === filter.kind)
    .filter((cause) => filter.entity === undefined || cause.entity === filter.entity)
    .filter((cause) => filter.until_tick === undefined || cause.due_tick <= filter.until_tick)
    .map((cause) => structuredClone(cause));
}

// The one way the schedule is written: an empty schedule is stored as no field at all.
export function withSchedule(snapshot: Snapshot, schedule: ScheduledCause[]): Snapshot {
  const { schedule: _dropped, ...rest } = snapshot;
  return schedule.length === 0 ? rest : { ...rest, schedule };
}

// A new cause goes after every cause due at or before its tick, so two due together run in the
// order they were scheduled.
export function withCause(snapshot: Snapshot, cause: ScheduledCause): Snapshot {
  const list = [...pending(snapshot)];
  const at = list.findIndex((entry) => entry.due_tick > cause.due_tick);
  list.splice(at === -1 ? list.length : at, 0, cause);
  return withSchedule(snapshot, list);
}
