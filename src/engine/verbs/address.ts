import { effectivePos } from "../geometry.js";
import { resolveTarget } from "../resolve.js";
import type { Entity, Id, Snapshot } from "../../model.js";
import type { CommandContext, PreconditionResult } from "../command.js";

// Agency is declared, never inferred: a template says so, and a severed part is not the whole it came
// from even when its own template is the agent's.
export function isAgent(snapshot: Snapshot, id: Id): boolean {
  const entity = snapshot.entities[id];
  if (entity === undefined) {
    throw new TypeError(`Unknown entity ${id}`);
  }
  return entity.props.agent === true && entity.detached_from === null;
}

// The first container up the containment chain that is shut: what is inside it is out of the world
// until it opens, however many containers deep it sits.
export function closedEnclosure(snapshot: Snapshot, id: Id): Id | null {
  const visited = new Set<Id>();
  let current = snapshot.entities[id]?.contained_in ?? null;

  while (current !== null) {
    if (visited.has(current)) {
      throw new TypeError(`Containment cycle at ${current}`);
    }
    visited.add(current);

    const entity = snapshot.entities[current];
    if (entity === undefined) {
      throw new TypeError(`Unknown entity ${current}`);
    }
    if (entity.props.openable === true && entity.props.open !== true) {
      return current;
    }
    current = entity.contained_in;
  }

  return null;
}

export type Address =
  | { status: "resolved"; entity: Entity }
  | { status: "failed"; result: PreconditionResult };

export function addressText(context: CommandContext, name: string): string | null {
  const value = (context.command.args ?? {})[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// A part is a declared piece of its entity, never a destination that can hold or receive anything.
export function addressEntity(
  context: CommandContext,
  text: string,
  partReasonCode: string,
): Address {
  const resolution = resolveTarget(context.snapshot, context.actor.id, text);
  if (resolution.status === "unresolved") {
    return { status: "failed", result: { status: "unresolved" } };
  }
  if (resolution.status === "ambiguous") {
    return { status: "failed", result: { status: "ambiguous", candidates: resolution.candidates } };
  }
  if (resolution.target.part !== null) {
    return { status: "failed", result: { status: "refused", reason_code: partReasonCode } };
  }

  const entity = context.snapshot.entities[resolution.target.entity_id];
  if (entity === undefined) {
    return { status: "failed", result: { status: "invalid", reason_code: "no_such_entity" } };
  }
  return { status: "resolved", entity };
}

export function withinReach(context: CommandContext, destinationId: Id): boolean {
  const destination = context.snapshot.entities[destinationId];
  if (destination === undefined) {
    throw new TypeError(`Unknown entity ${destinationId}`);
  }

  const actorPos = effectivePos(context.snapshot, context.actor.id);
  const destinationPos = effectivePos(context.snapshot, destinationId);
  const reach = context.actor.props.reach_cm;
  if (
    actorPos === null ||
    destinationPos === null ||
    destination.location !== context.actor.location ||
    typeof reach !== "number"
  ) {
    return false;
  }

  return (actorPos.x - destinationPos.x) ** 2 + (actorPos.y - destinationPos.y) ** 2 <= reach ** 2;
}

// A placement may not close a containment or support loop: the item would hold what holds it.
export function wouldLoop(context: CommandContext, itemId: Id, destinationId: Id): boolean {
  const visited = new Set<Id>();
  let current: Id | null = destinationId;

  while (current !== null) {
    if (current === itemId) {
      return true;
    }
    if (visited.has(current)) {
      throw new TypeError(`Support or containment cycle at ${current}`);
    }
    visited.add(current);

    const entity: Entity | undefined = context.snapshot.entities[current];
    if (entity === undefined) {
      throw new TypeError(`Unknown entity ${current}`);
    }
    current = entity.contained_in ?? entity.support;
  }

  return false;
}