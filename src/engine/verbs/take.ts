import { capacities } from "../capacity.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import { carryAlternatives, carryCheck, gripPlacement, heldCount, holderLayout } from "../carry.js";
import { closedEnclosure, isAgent, inReach, reachData } from "./address.js";
import { revealConcealed } from "./search.js";

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

  if (!inReach(context.snapshot, context.actor.id, entity.id)) {
    const data = reachData(context.snapshot, context.actor.id, entity.id);
    return {
      status: "refused",
      reason_code: "out_of_reach",
      ...(data !== null && { reason_data: data }),
    };
  }

  const carry = carryCheck(
    capacities(context.snapshot, context.registry, context.actor.id),
    context.actor.props,
    entity,
    context.registry,
    heldCount(context.snapshot, context.actor.id),
    context.verb.carry_alternatives ?? [],
  );
  if (!carry.ok) {
    return {
      status: "refused",
      reason_code: carry.reason_code,
      ...(carry.reason_data !== undefined && { reason_data: carry.reason_data }),
    };
  }
  const grip = gripPlacement(context, context.actor.id, entity);
  if (grip.status !== "ok") {
    return grip.status === "invalid"
      ? { status: "invalid", reason_code: grip.reason_code }
      : {
          status: "refused",
          reason_code: grip.reason_code,
          ...(grip.reason_data !== undefined && { reason_data: grip.reason_data }),
        };
  }
  if (entity.contained_in !== null && entity.contained_in !== context.actor.id) {
    const holder = context.snapshot.entities[entity.contained_in];
    if (holder === undefined) {
      return { status: "invalid", reason_code: "no_such_entity" };
    }
    const enclosure = closedEnclosure(context.snapshot, entity.id);
    if (enclosure !== null) {
      return { status: "refused", reason_code: "container_closed", reason_data: { enclosure } };
    }
    // Only an agent holds: a container or a piece of furniture keeps what is inside it, and what it
    // keeps is there to be taken out. A hand is a contest the engine does not judge, but a pocket
    // is just a container: taking from another agent's space part is allowed, from a grip refused.
    if (isAgent(context.snapshot, holder.id)) {
      const spaces = holderLayout(context.registry, holder.template).spaces.map((space) => space.name);
      if (entity.in_part === null || !spaces.includes(entity.in_part)) {
        return { status: "refused", reason_code: "held_by_another" };
      }
    }
  }

  return { status: "ok" };
}

function transition(context: TransitionContext): void {
  const target = context.target;
  if (target === null) {
    throw new TypeError("Take target changed after validation");
  }
  const entity = context.snapshot.entities[target.entity_id];
  if (entity === undefined) {
    throw new TypeError("Take target changed after validation");
  }
  const grip = gripPlacement(context, context.actor.id, entity);
  if (grip.status !== "ok") {
    throw new TypeError("Take grip changed after validation");
  }

  const movedEvent = context.emit("moved", target.entity_id, {}, context.root_event_id);
  context.set(target.entity_id, "contained_in", context.actor.id, movedEvent);
  context.set(target.entity_id, "in_part", grip.part, movedEvent);
  context.set(target.entity_id, "support", null, movedEvent);
  context.set(target.entity_id, "pos", null, movedEvent);
  // Lifting a thing uncovers whatever it was hiding and takes it out from under whatever hid it.
  revealConcealed(context, target.entity_id, movedEvent);
}

export const takeVerb: Verb = {
  duration: { ticks: 1 },
  requires_target: true,
  args: { part: { kind: "address" } },
  refuses: [
    "target_attached",
    "out_of_reach",
    "insufficient_manipulation",
    "container_closed",
    "held_by_another",
    "two_hands_required",
    "too_heavy",
    "mouth_full",
    "hands_full",
    "unknown_part",
  ],
  carry_alternatives: carryAlternatives,
  preconditions,
  transition,
};
