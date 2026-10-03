import { capacity } from "../capacity.js";
import { effectivePos } from "../geometry.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import { closedEnclosure, isAgent } from "./address.js";

function preconditions(context: CommandContext): PreconditionResult {
  const target = context.target;
  if (target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  if (target.part !== null) {
    return { status: "refused", reason_code: "target_attached" };
  }

  const entity = context.snapshot.entities[target.entity_id];
  if (entity === undefined) {
    return { status: "invalid", reason_code: "no_such_entity" };
  }

  const actorPos = effectivePos(context.snapshot, context.actor.id);
  const targetPos = effectivePos(context.snapshot, entity.id);
  const reach = context.actor.props.reach_cm;
  if (
    actorPos === null ||
    targetPos === null ||
    entity.location !== context.actor.location ||
    typeof reach !== "number" ||
    (actorPos.x - targetPos.x) ** 2 + (actorPos.y - targetPos.y) ** 2 > reach ** 2
  ) {
    return { status: "refused", reason_code: "out_of_reach" };
  }

  const requiredManipulation = entity.props.hands_required === 2 ? 100 : 50;
  if (
    (capacity(context.snapshot, context.registry, context.actor.id, "manipulation") ?? 0) <
    requiredManipulation
  ) {
    return { status: "refused", reason_code: "insufficient_manipulation" };
  }
  if (entity.contained_in !== null && entity.contained_in !== context.actor.id) {
    const holder = context.snapshot.entities[entity.contained_in];
    if (holder === undefined) {
      return { status: "invalid", reason_code: "no_such_entity" };
    }
    if (closedEnclosure(context.snapshot, entity.id) !== null) {
      return { status: "refused", reason_code: "container_closed" };
    }
    // Only an agent holds: a container or a piece of furniture keeps what is inside it, and what it
    // keeps is there to be taken out.
    if (isAgent(context.snapshot, holder.id)) {
      return { status: "refused", reason_code: "held_by_another" };
    }
  }

  return { status: "ok" };
}

function transition(context: TransitionContext): void {
  const target = context.target;
  if (target === null) {
    throw new TypeError("Take target changed after validation");
  }

  const movedEvent = context.emit("moved", target.entity_id, {}, context.root_event_id);
  context.set(target.entity_id, "contained_in", context.actor.id, movedEvent);
  context.set(target.entity_id, "support", null, movedEvent);
  context.set(target.entity_id, "pos", null, movedEvent);
}

export const takeVerb: Verb = {
  requires_target: true,
  preconditions,
  transition,
};
