import { capacities } from "../capacity.js";
import { insufficientCode, meetsRequirements, unmetRequirement } from "../carry.js";
import type { Id, Snapshot } from "../../model.js";
import type {
  CommandContext,
  PreconditionResult,
  TransitionContext,
  Verb,
} from "../command.js";
import { closedEnclosure, reachData, withinReach } from "./address.js";

// What one entity hides, in id order, so that the events a search drives come out in one order.
function hiddenBy(snapshot: Snapshot, concealerId: Id): Id[] {
  return Object.keys(snapshot.entities)
    .sort()
    .filter((id) => snapshot.entities[id]?.concealed_by === concealerId);
}

// Moving either end of the relation uncovers it: whatever the mover was hiding stops being hidden,
// and the mover stops being hidden. One `revealed` event per entity, caused by the move that did it,
// so a listener can see the uncovering rather than infer it. Searching is the only thing that looks
// underneath without moving anything, and it changes nothing.
export function revealConcealed(
  context: TransitionContext,
  moverId: Id,
  causeEventId: Id,
): void {
  const mover = context.snapshot.entities[moverId];
  const uncovered = [
    ...hiddenBy(context.snapshot, moverId),
    ...(mover !== undefined && mover.concealed_by !== null ? [moverId] : []),
  ].sort();
  for (const id of uncovered) {
    // The event names whatever was doing the hiding, which for the mover is not itself.
    const concealer = context.snapshot.entities[id]?.concealed_by ?? null;
    const revealed = context.emit("revealed", id, { concealer }, causeEventId);
    context.set(id, "concealed_by", null, revealed);
  }
}

function preconditions(context: CommandContext): PreconditionResult {
  const target = context.target;
  if (target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  // A part is not a thing to search under, only the entity that declares it.
  if (target.part !== null) {
    return { status: "refused", reason_code: "target_attached" };
  }
  const concealer = context.snapshot.entities[target.entity_id];
  if (concealer === undefined) {
    return { status: "invalid", reason_code: "no_such_entity" };
  }
  const enclosure = closedEnclosure(context.snapshot, concealer.id);
  if (enclosure !== null) {
    return { status: "refused", reason_code: "container_closed", reason_data: { enclosure } };
  }
  if (!withinReach(context, concealer.id)) {
    const data = reachData(context.snapshot, context.actor.id, concealer.id);
    return {
      status: "refused",
      reason_code: "out_of_reach",
      ...(data !== null && { reason_data: data }),
    };
  }
  const required = context.verb.requires ?? [];
  if (!meetsRequirements(capacities(context.snapshot, context.registry, context.actor.id), required)) {
    const data = unmetRequirement(
      capacities(context.snapshot, context.registry, context.actor.id),
      required,
    );
    return {
      status: "refused",
      reason_code: insufficientCode(required),
      ...(data !== null && { reason_data: data }),
    };
  }
  return { status: "ok" };
}

// A search changes no state: only found events result, and the world keeps no record of who looked.
function transition(context: TransitionContext): void {
  const target = context.target;
  if (target === null) {
    throw new TypeError("Search target changed after validation");
  }
  for (const id of hiddenBy(context.snapshot, target.entity_id)) {
    context.emit("found", id, { concealer: target.entity_id }, context.root_event_id);
  }
}

export const searchVerb: Verb = {
  duration: { ticks: 1 },
  requires_target: true,
  args: {},
  refuses: [
    "target_attached",
    "container_closed",
    "out_of_reach",
    "insufficient_manipulation",
  ],
  requires: [{ capacity: "manipulation", at_least: 50 }],
  preconditions,
  transition,
};