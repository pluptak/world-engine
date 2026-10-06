import type { TransitionContext } from "./command.js";
import { inSpacePart } from "./carry.js";
import { pushOccupantsAside } from "./verbs/gate.js";
import { dropCarriedItem } from "./verbs/drop.js";
import type { Id, ScheduledCause, Snapshot } from "../model.js";

export const CAUSE_KINDS: readonly ScheduledCause["kind"][] = ["close", "bleed"];

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

// Runs one due cause, already taken off the schedule, at the current tick. A cause the world has
// overtaken (the door already shut, the body already destroyed) does nothing and says nothing.
export function runCause(context: TransitionContext, cause: ScheduledCause): void {
  const entity = context.snapshot.entities[cause.entity];
  if (entity === undefined) {
    return;
  }
  if (cause.kind === "close") {
    if (entity.props.openable !== true || entity.props.open !== true) {
      return;
    }
    const eventId = context.emit("closed", entity.id, {}, cause.cause_id);
    context.set(entity.id, "props", { ...entity.props, open: false }, eventId);
    pushOccupantsAside(context, entity.id, eventId);
    return;
  }
  const rule = bleeding(entity.props);
  if (rule === null || entity.status === "destroyed") {
    return;
  }
  // Each bleed names the one before it, back to the `detached` that opened the wound.
  const integrity = Math.max(0, entity.integrity - rule.damage);
  const eventId = context.emit(integrity === 0 ? "destroyed" : "damaged", entity.id, { integrity }, cause.cause_id);
  context.set(entity.id, "integrity", integrity, eventId);
  if (integrity === 0) {
    context.set(entity.id, "status", "destroyed", eventId);
    // A body that has bled out holds nothing: what its grips and mouth held falls where it stands,
    // and what is pocketed stays with it.
    const body = context.snapshot.entities[entity.id]!;
    const held = Object.keys(context.snapshot.entities)
      .sort()
      .filter((id) => {
        const item = context.snapshot.entities[id]!;
        return item.contained_in === body.id && !inSpacePart(context.snapshot, context.registry, body, item);
      });
    for (const itemId of held) {
      dropCarriedItem(context, body.id, itemId, eventId);
    }
    return;
  }
  scheduleBleed(context, entity.id, eventId, cause.remaining - 1);
}
