import { capacities } from "./capacity.js";
import type { Command, TransitionContext, Verb, VerbDuration } from "./command.js";
import type { Id, Modifier, Snapshot } from "../model.js";
import { sensedBy } from "./query.js";
import { pending, withSchedule } from "./pending.js";
import { reconcileSince } from "./process.js";
import { pruneSchedule, runCause } from "./schedule.js";
import type { StopBeat } from "./command.js";

// Every verb declares how many ticks it takes: a fixed count, or the value of one of its int args.
// Only an ok command takes time; a refused or invalid one leaves `tick` where it was.
export function commandDuration(verb: Verb, command: Command): number | null {
  const duration: VerbDuration = verb.duration;
  if ("ticks" in duration) {
    return duration.ticks;
  }
  const value = command.args?.[duration.arg];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

interface ExpiringModifier {
  entity: string;
  modifier: Modifier;
  order: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nextDue(snapshot: Snapshot, after: number, until: number): number | null {
  let next: number | null = null;
  const consider = (tick: number | null): void => {
    if (tick !== null && tick > after && tick <= until && (next === null || tick < next)) {
      next = tick;
    }
  };
  for (const entity of Object.values(snapshot.entities)) {
    for (const modifier of entity.modifiers) {
      consider(modifier.expires_at_tick);
    }
  }
  consider(pending(snapshot)[0]?.due_tick ?? null);
  return next;
}

// Runs after the verb's own consequences: the clock steps from the command's tick through every
// tick that has something due, ending at tick + ticks. At each such tick the modifiers due expire
// first, in (entity, capacity, cause, order) order, each `capability_changed` naming the event that
// made the modifier; then the scheduled causes due run in schedule order, each naming the event
// that scheduled it. A cause may schedule another, which runs in turn if it falls due in the span.
//
// With `wake` (agent ids), the clock ends early at the first tick whose events one of them could
// sense, after everything due at that tick has run, so a tick's events are never split. The span is
// then only an upper bound. With `stop`, the clock never reaches the stop beat's tick while that beat is
// still pending there: it ends one tick short, and the beat runs in a later span. Returns the ticks that passed.
export function advanceClock(context: TransitionContext, ticks: number, wake: readonly Id[] = [], stop: StopBeat | null = null): number {
  const startTick = context.snapshot.tick;
  const endTick = startTick + ticks;
  const limit = (): number => Math.min(endTick, stopLimit(context.snapshot, stop));
  for (;;) {
    const tick = nextDue(context.snapshot, context.snapshot.tick, limit());
    if (tick === null) {
      break;
    }
    const before = context.snapshot;
    const firstNew = context.events.length;
    context.snapshot = { ...context.snapshot, tick };
    expireAt(context, tick);
    for (let due = pending(context.snapshot)[0]; due?.due_tick === tick; due = pending(context.snapshot)[0]) {
      context.snapshot = withSchedule(context.snapshot, pending(context.snapshot).slice(1));
      const mark = context.deltas.length;
      runCause(context, due);
      reconcileSince(context, mark);
      pruneSchedule(context);
    }
    if (wake.length > 0 && context.events.length > firstNew) {
      const fresh = context.events.slice(firstNew);
      if (sensedBy(before, context.snapshot, context.registry, context.events, fresh, wake)) {
        return tick - startTick;
      }
    }
  }
  const reached = limit();
  context.snapshot = { ...context.snapshot, tick: reached };
  return reached - startTick;
}

// One tick short of the stop beat's tick while that same run is still pending there. Once it has run, or
// has been cancelled or pruned, nothing stops the clock; a repeat's later run is a different tick, so it does not.
function stopLimit(snapshot: Snapshot, stop: StopBeat | null): number {
  if (stop === null) {
    return Infinity;
  }
  const waiting = pending(snapshot).some(
    (cause) => cause.kind === "beat" && cause.id === stop.id && cause.due_tick === stop.due_tick,
  );
  return waiting ? stop.due_tick - 1 : Infinity;
}

function expireAt(context: TransitionContext, expirationTick: number): void {
  const expiringAtTick: ExpiringModifier[] = [];
  for (const entityId of Object.keys(context.snapshot.entities).sort()) {
    context.snapshot.entities[entityId]!.modifiers.forEach((modifier, order) => {
      if (modifier.expires_at_tick === expirationTick) {
        expiringAtTick.push({ entity: entityId, modifier, order });
      }
    });
  }
  if (expiringAtTick.length === 0) {
    return;
  }
  expiringAtTick.sort(
    (left, right) =>
      compareText(left.entity, right.entity) ||
      compareText(left.modifier.capacity, right.modifier.capacity) ||
      compareText(left.modifier.cause_id, right.modifier.cause_id) ||
      left.order - right.order,
  );
  const affectedEntities = [...new Set(expiringAtTick.map((entry) => entry.entity))].sort();
  // A modifier counts while its expiry is still ahead, so the tick before reads it in force.
  const lastTick = { ...context.snapshot, tick: expirationTick - 1 };
  const before = new Map(
    affectedEntities.map((entityId) => [entityId, capacities(lastTick, context.registry, entityId)]),
  );
  const remaining = new Map(
    affectedEntities.map((entityId) => [
      entityId,
      context.snapshot.entities[entityId]!.modifiers.filter(
        (modifier) => modifier.expires_at_tick === null || modifier.expires_at_tick > expirationTick,
      ),
    ]),
  );
  const expired: Snapshot = { ...context.snapshot, entities: { ...context.snapshot.entities } };
  for (const [entityId, modifiers] of remaining) {
    expired.entities[entityId] = { ...expired.entities[entityId]!, modifiers };
  }
  const after = new Map(
    affectedEntities.map((entityId) => [entityId, capacities(expired, context.registry, entityId)]),
  );

  // The events come first so the change to `modifiers` can be recorded under the entity's first
  // expiry, which names the modifier's cause: a trace of the field and of the event agree.
  const firstEvent = new Map<string, string>();
  for (const entry of expiringAtTick) {
    const from = before.get(entry.entity)?.[entry.modifier.capacity] ?? 0;
    const to = after.get(entry.entity)?.[entry.modifier.capacity] ?? 0;
    const eventId = context.emit(
      "capability_changed",
      entry.entity,
      { capacity: entry.modifier.capacity, from, to },
      entry.modifier.cause_id,
    );
    if (!firstEvent.has(entry.entity)) {
      firstEvent.set(entry.entity, eventId);
    }
  }
  for (const [entityId, modifiers] of remaining) {
    context.set(entityId, "modifiers", modifiers, firstEvent.get(entityId)!);
  }
}
