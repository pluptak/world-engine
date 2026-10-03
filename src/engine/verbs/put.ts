import type { Entity } from "../../model.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import { addressEntity, addressText, closedEnclosure, wouldLoop, withinReach } from "./address.js";

type Relation = "on" | "in";

function template(context: CommandContext, entity: Entity) {
  const found = context.registry[entity.template];
  if (found === undefined) {
    throw new TypeError(`Unknown template ${entity.template}`);
  }
  return found;
}

function relationOf(context: CommandContext): Relation | null {
  const value = (context.command.args ?? {}).relation;
  return value === "on" || value === "in" ? value : null;
}

function innerDimensions(destination: Entity): number[] | null {
  const width = destination.props.inner_w_cm;
  const depth = destination.props.inner_d_cm;
  const height = destination.props.inner_h_cm;
  if (typeof width !== "number" || typeof depth !== "number" || typeof height !== "number") {
    return null;
  }
  return [width, depth, height];
}

// Nothing here fixes an orientation, so the item's longest dimensions meet the destination's longest:
// a 20 by 100 thing fits a 120 by 60 table, and a 70 cm chair leg does not fit a 35 cm chest.
function fits(item: number[], destination: number[]): boolean {
  const itemDescending = [...item].sort((left, right) => right - left);
  const destinationDescending = [...destination].sort((left, right) => right - left);
  return itemDescending.every((value, index) => value <= (destinationDescending[index] ?? 0));
}

function footprintRefusal(context: CommandContext, item: Entity, destination: Entity): PreconditionResult | null {
  const size = template(context, item).size_cm;
  const footprint = template(context, destination).size_cm;
  return fits([size.w, size.d], [footprint.w, footprint.d])
    ? null
    : { status: "refused", reason_code: "too_large" };
}

function innerRefusal(context: CommandContext, item: Entity, destination: Entity): PreconditionResult | null {
  const size = template(context, item).size_cm;
  const inner = innerDimensions(destination);
  return inner === null || !fits([size.w, size.d, size.h], inner)
    ? { status: "refused", reason_code: "too_large" }
    : null;
}

function placementRefusal(
  context: CommandContext,
  item: Entity,
  destination: Entity,
  relation: Relation,
): PreconditionResult | null {
  if (wouldLoop(context, item.id, destination.id)) {
    return { status: "refused", reason_code: "circular_placement" };
  }
  if (!withinReach(context, destination.id)) {
    return { status: "refused", reason_code: "out_of_reach" };
  }

  if (relation === "on") {
    if (destination.props.surface !== true) {
      return { status: "refused", reason_code: "not_a_surface" };
    }
    if (closedEnclosure(context.snapshot, destination.id) !== null) {
      return { status: "refused", reason_code: "container_closed" };
    }
    return footprintRefusal(context, item, destination);
  }

  if (destination.props.container !== true) {
    return { status: "refused", reason_code: "not_a_container" };
  }
  const shut = destination.props.openable === true && destination.props.open !== true;
  if (shut || closedEnclosure(context.snapshot, destination.id) !== null) {
    return { status: "refused", reason_code: "container_closed" };
  }
  return innerRefusal(context, item, destination);
}

function preconditions(context: CommandContext): PreconditionResult {
  const relation = relationOf(context);
  const destinationText = addressText(context, "destination");
  if (relation === null || destinationText === null) {
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

  const address = addressEntity(context, destinationText, "not_a_surface");
  if (address.status === "failed") {
    return address.result;
  }

  return placementRefusal(context, item, address.entity, relation) ?? { status: "ok" };
}

function transition(context: TransitionContext): void {
  const target = context.target;
  const relation = relationOf(context);
  const destinationText = addressText(context, "destination");
  if (target === null || relation === null || destinationText === null) {
    throw new TypeError("Put target or placement changed after validation");
  }

  const address = addressEntity(context, destinationText, "not_a_surface");
  if (address.status === "failed") {
    throw new TypeError("Put destination changed after validation");
  }
  const destination = address.entity;

  const onSurface = relation === "on";
  const movedEvent = context.emit("moved", target.entity_id, { relation }, context.root_event_id);
  context.set(target.entity_id, "contained_in", onSurface ? null : destination.id, movedEvent);
  context.set(target.entity_id, "support", onSurface ? destination.id : null, movedEvent);
  context.set(target.entity_id, "pos", null, movedEvent);
}

export const putVerb: Verb = {
  requires_target: true,
  preconditions,
  transition,
};
