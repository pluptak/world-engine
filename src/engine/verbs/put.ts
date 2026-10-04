import { capacities } from "../capacity.js";
import { misfit } from "../fit.js";
import type { Entity } from "../../model.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import { insufficientCode, meetsRequirements, unmetRequirement } from "../carry.js";
import { addressEntity, addressText, closedEnclosure, reachData, wouldLoop, withinReach } from "./address.js";

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

function footprintRefusal(context: CommandContext, item: Entity, destination: Entity): PreconditionResult | null {
  const size = template(context, item).size_cm;
  const footprint = template(context, destination).size_cm;
  const data = misfit([size.w, size.d], [footprint.w, footprint.d]);
  return data === null
    ? null
    : { status: "refused", reason_code: "too_large", reason_data: data };
}

function innerRefusal(context: CommandContext, item: Entity, destination: Entity): PreconditionResult | null {
  const size = template(context, item).size_cm;
  const inner = innerDimensions(destination);
  // No inner dimensions to report a space against, so the refusal carries no data.
  if (inner === null) {
    return { status: "refused", reason_code: "too_large" };
  }
  const data = misfit([size.w, size.d, size.h], inner);
  return data === null
    ? null
    : { status: "refused", reason_code: "too_large", reason_data: data };
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
    const data = reachData(context.snapshot, context.actor.id, destination.id);
    return {
      status: "refused",
      reason_code: "out_of_reach",
      ...(data !== null && { reason_data: data }),
    };
  }

  if (relation === "on") {
    if (destination.props.surface !== true) {
      return { status: "refused", reason_code: "not_a_surface" };
    }
    const enclosure = closedEnclosure(context.snapshot, destination.id);
    if (enclosure !== null) {
      return { status: "refused", reason_code: "container_closed", reason_data: { enclosure } };
    }
    return footprintRefusal(context, item, destination);
  }

  if (destination.props.container !== true) {
    return { status: "refused", reason_code: "not_a_container" };
  }
  const shut = destination.props.openable === true && destination.props.open !== true;
  const enclosure = shut ? destination.id : closedEnclosure(context.snapshot, destination.id);
  if (enclosure !== null) {
    return { status: "refused", reason_code: "container_closed", reason_data: { enclosure } };
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
  // Placing into a container needs hands; setting onto a surface does not, and the verb's
  // declaration names the capacity the `in` relation spends.
  if (relation === "in") {
    const required = context.verb.requires ?? [];
    if (
      !meetsRequirements(capacities(context.snapshot, context.registry, context.actor.id), required)
    ) {
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
  args: { relation: { kind: "enum", values: ["on", "in"] }, destination: { kind: "address" } },
  refuses: [
    "not_carried",
    "circular_placement",
    "out_of_reach",
    "not_a_surface",
    "container_closed",
    "too_large",
    "not_a_container",
    "insufficient_manipulation",
  ],
  requires: [{ capacity: "manipulation", at_least: 50 }],
  preconditions,
  transition,
};
