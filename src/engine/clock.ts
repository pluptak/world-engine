import { capacities } from "./capacity.js";
import type { Command, TransitionContext, Verb, VerbDuration } from "./command.js";
import type { Modifier } from "../model.js";

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

// Runs after the verb's own consequences: the clock steps from the command's tick through every
// tick that has something due, ending at tick + ticks. What is due today is a modifier's expiry,
// processed in (tick, entity, capacity, cause, order) order; each `capability_changed` names the
// event that made the modifier as its cause, not this command.
export function advanceClock(context: TransitionContext, ticks: number): void {
  const startTick = context.snapshot.tick;
  const endTick = startTick + ticks;
  const expiring: ExpiringModifier[] = [];
  for (const entityId of Object.keys(context.snapshot.entities).sort()) {
    const entity = context.snapshot.entities[entityId]!;
    entity.modifiers.forEach((modifier, order) => {
      if (
        modifier.expires_at_tick !== null &&
        modifier.expires_at_tick > startTick &&
        modifier.expires_at_tick <= endTick
      ) {
        expiring.push({ entity: entityId, modifier, order });
      }
    });
  }
  expiring.sort(
    (left, right) =>
      left.modifier.expires_at_tick! - right.modifier.expires_at_tick! ||
      compareText(left.entity, right.entity) ||
      compareText(left.modifier.capacity, right.modifier.capacity) ||
      compareText(left.modifier.cause_id, right.modifier.cause_id) ||
      left.order - right.order,
  );

  const expirationTicks = [...new Set(expiring.map((entry) => entry.modifier.expires_at_tick!))].sort(
    (left, right) => left - right,
  );
  for (const expirationTick of expirationTicks) {
    const expiringAtTick = expiring.filter(
      (entry) => entry.modifier.expires_at_tick === expirationTick,
    );
    const affectedEntities = [...new Set(expiringAtTick.map((entry) => entry.entity))].sort();
    const before = new Map(
      affectedEntities.map((entityId) => [
        entityId,
        capacities(context.snapshot, context.registry, entityId),
      ]),
    );

    context.snapshot = { ...context.snapshot, tick: expirationTick };
    const remaining = new Map(
      affectedEntities.map((entityId) => [
        entityId,
        context.snapshot.entities[entityId]!.modifiers.filter(
          (modifier) => modifier.expires_at_tick === null || modifier.expires_at_tick > expirationTick,
        ),
      ]),
    );
    const expired: typeof context.snapshot = {
      ...context.snapshot,
      entities: { ...context.snapshot.entities },
    };
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

  context.snapshot = { ...context.snapshot, tick: endTick };
}
