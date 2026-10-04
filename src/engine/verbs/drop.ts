import type { Id } from "../../model.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import { resolveDropFall } from "../../resolvers/physical.js";

function preconditions(context: CommandContext): PreconditionResult {
  const target = context.target;
  if (target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  if (target.part !== null) {
    return { status: "refused", reason_code: "not_carried" };
  }

  const entity = context.snapshot.entities[target.entity_id];
  if (entity === undefined) {
    return { status: "invalid", reason_code: "no_such_entity" };
  }
  if (entity.contained_in !== context.actor.id) {
    return { status: "refused", reason_code: "not_carried" };
  }

  return { status: "ok" };
}

export function dropFallHook(
  context: TransitionContext,
  entityId: Id,
  droppedEventId: Id,
  fall_cm: number,
): void {
  resolveDropFall(context, entityId, droppedEventId, fall_cm);
}

export function dropCarriedItem(
  context: TransitionContext,
  holderId: Id,
  entityId: Id,
  causeId: Id,
): Id {
  const holder = context.snapshot.entities[holderId];
  const entity = context.snapshot.entities[entityId];
  if (holder === undefined || entity === undefined) {
    throw new TypeError("Drop holder or target changed after validation");
  }

  const handHeight = holder.props.hand_height_cm;
  const fall_cm = typeof handHeight === "number" ? handHeight : 0;
  const droppedEvent = context.emit(
    "dropped",
    entityId,
    { fall_cm },
    causeId,
  );
  context.set(entityId, "contained_in", null, droppedEvent);
  context.set(entityId, "support", holder.location, droppedEvent);
  context.set(entityId, "pos", holder.pos, droppedEvent);
  dropFallHook(context, entityId, droppedEvent, fall_cm);
  return droppedEvent;
}

function transition(context: TransitionContext): void {
  const target = context.target;
  if (target === null) {
    throw new TypeError("Drop target changed after validation");
  }

  dropCarriedItem(context, context.actor.id, target.entity_id, context.root_event_id);
}

export const dropVerb: Verb = {
  requires_target: true,
  args: {},
  refuses: ["not_carried"],
  preconditions,
  transition,
};
