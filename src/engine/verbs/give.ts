import { capacities } from "../capacity.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import type { Id } from "../../model.js";
import { carryAlternatives, carryCheck, gripPlacement, heldCount, inSpacePart } from "../carry.js";
import { addressEntity, addressText, gapRefusal, isAgent, refuseOutOfReach, wouldLoop } from "./address.js";

function preconditions(context: CommandContext): PreconditionResult {
  const destinationText = addressText(context, "destination");
  if (destinationText === null) {
    return { status: "invalid", reason_code: "invalid_args" };
  }

  const target = context.target;
  if (target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  if (target.part !== null) {
    return { status: "refused", reason_code: "not_carried" };
  }

  const item = context.snapshot.entities[target.entity_id];
  if (item === undefined) {
    return { status: "invalid", reason_code: "no_such_entity" };
  }
  if (item.contained_in !== context.actor.id) {
    return { status: "refused", reason_code: "not_carried" };
  }
  // An item in a space part (pocket) must be taken out first before giving it.
  if (inSpacePart(context.registry, context.actor, item)) {
    return { status: "refused", reason_code: "not_in_hand" };
  }

  const address = addressEntity(context, destinationText, "not_an_actor");
  if (address.status === "failed") {
    return address.result;
  }
  const recipient = address.entity;

  if (recipient.id === context.actor.id) {
    return { status: "refused", reason_code: "cannot_give_to_self" };
  }
  if (!isAgent(context.snapshot, recipient.id)) {
    return { status: "refused", reason_code: "not_an_actor" };
  }
  if (wouldLoop(context, item.id, recipient.id)) {
    return { status: "refused", reason_code: "circular_placement" };
  }
  const reach = refuseOutOfReach(context, recipient.id);
  if (reach !== null) {
    return reach;
  }
  const gap = gapRefusal(context, item.id, context.actor.id, recipient.id);
  if (gap !== null) {
    return gap;
  }
  const carry = carryCheck(
    capacities(context.snapshot, context.registry, recipient.id),
    recipient.props,
    item,
    context.registry,
    heldCount(context.snapshot, recipient.id),
    context.verb.carry_alternatives ?? [],
  );
  if (!carry.ok) {
    return {
      status: "refused",
      reason_code: carry.reason_code,
      ...(carry.reason_data !== undefined && { reason_data: carry.reason_data }),
    };
  }
  const grip = gripPlacement(context, recipient.id, item);
  if (grip.status !== "ok") {
    return grip.status === "invalid"
      ? { status: "invalid", reason_code: grip.reason_code }
      : {
          status: "refused",
          reason_code: grip.reason_code,
          ...(grip.reason_data !== undefined && { reason_data: grip.reason_data }),
        };
  }

  return { status: "ok" };
}

// Consent is not modelled: a character agent decides whether the recipient accepts.
function transition(context: TransitionContext): void {
  const target = context.target;
  const destinationText = addressText(context, "destination");
  if (target === null || destinationText === null) {
    throw new TypeError("Give target or destination changed after validation");
  }

  const address = addressEntity(context, destinationText, "not_an_actor");
  if (address.status === "failed") {
    throw new TypeError("Give destination changed after validation");
  }

  const movedEvent = context.emit(
    "moved",
    target.entity_id,
    { from: context.actor.id, to: address.entity.id },
    context.root_event_id,
  );
  const item = context.snapshot.entities[target.entity_id];
  if (item === undefined) {
    throw new TypeError("Give target changed after validation");
  }
  const grip = gripPlacement(context, address.entity.id, item);
  if (grip.status !== "ok") {
    throw new TypeError("Give grip changed after validation");
  }
  context.set(target.entity_id, "contained_in", address.entity.id, movedEvent);
  context.set(target.entity_id, "in_part", grip.part, movedEvent);
}

// Each agent the actor can name, when the item is in its hand: all a give takes.
function suggest(context: CommandContext, nameable: readonly Id[]): Record<string, unknown>[] {
  const { snapshot, registry, actor, target } = context;
  const item = target === null ? undefined : snapshot.entities[target.entity_id];
  if (item === undefined || item.contained_in !== actor.id || inSpacePart(registry, actor, item)) {
    return [];
  }
  return nameable
    .filter((id) => id !== item.id && isAgent(snapshot, id))
    .map((destination) => ({ destination }));
}

export const giveVerb: Verb = {
  duration: { ticks: 1 },
  requires_target: true,
  args: { destination: { kind: "address" }, part: { kind: "address" } },
  refuses: [
    "not_carried",
    "not_in_hand",
    "cannot_give_to_self",
    "not_an_actor",
    "circular_placement",
    "out_of_reach",
    "too_big_for_gap",
    "insufficient_manipulation",
    "two_hands_required",
    "too_heavy",
    "mouth_full",
    "hands_full",
    "unknown_part",
  ],
  carry_alternatives: carryAlternatives,
  suggest,
  preconditions,
  transition,
};