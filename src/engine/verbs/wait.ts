import { capacities } from "../capacity.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import type { Modifier } from "../../model.js";

function ticksToWait(context: CommandContext): number | null {
  const ticks = context.command.args?.ticks;
  return typeof ticks === "number" && Number.isSafeInteger(ticks) && ticks > 0
    ? ticks
    : null;
}

function preconditions(context: CommandContext): PreconditionResult {
  const ticks = ticksToWait(context);
  if (ticks === null || !Number.isSafeInteger(context.snapshot.tick + ticks)) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  return { status: "ok" };
}

interface ExpiringModifier {
  entity: string;
  modifier: Modifier;
  order: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function transition(context: TransitionContext): void {
  const ticks = ticksToWait(context);
  if (ticks === null) {
    throw new TypeError("Wait duration changed after validation");
  }

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
    for (const entityId of affectedEntities) {
      const entity = context.snapshot.entities[entityId]!;
      const modifiers = entity.modifiers.filter(
        (modifier) => modifier.expires_at_tick === null || modifier.expires_at_tick > expirationTick,
      );
      context.set(entityId, "modifiers", modifiers, context.root_event_id);
    }
    const after = new Map(
      affectedEntities.map((entityId) => [
        entityId,
        capacities(context.snapshot, context.registry, entityId),
      ]),
    );

    for (const entry of expiringAtTick) {
      const from = before.get(entry.entity)?.[entry.modifier.capacity] ?? 0;
      const to = after.get(entry.entity)?.[entry.modifier.capacity] ?? 0;
      context.emit(
        "capability_changed",
        entry.entity,
        { capacity: entry.modifier.capacity, from, to },
        entry.modifier.cause_id,
      );
    }
  }

  context.snapshot = { ...context.snapshot, tick: endTick };
}

export const waitVerb: Verb = {
  requires_target: false,
  preconditions,
  transition,
};
