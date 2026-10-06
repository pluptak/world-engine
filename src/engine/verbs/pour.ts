import { capacities } from "../capacity.js";
import { insufficientCode, meetsRequirements, unmetRequirement, inSpacePart } from "../carry.js";
import { addResidue } from "../residue.js";
import type { Entity } from "../../model.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import { addressEntity, addressText, closedEnclosure, reachData, withinReach } from "./address.js";

interface Pour {
  source: Entity;
  destination: Entity;
  material: string;
  amount: number;
  available: number;
  // What a container destination already holds of this material; zero everywhere else.
  held: number;
  holds: boolean;
}

type Planning = { status: "ok"; pour: Pour } | Exclude<PreconditionResult, { status: "ok" }>;

type Refusal = Exclude<PreconditionResult, { status: "ok" }>;

// A failed address is always a refusal, though its type is the whole PreconditionResult.
function notPlanned(result: PreconditionResult): Refusal {
  return result.status === "ok" ? { status: "invalid", reason_code: "invalid_args" } : result;
}

// liquid_amount counts the same cubic centimetres the inner dimensions do, so a container's liquid
// capacity is its inner volume; a destination that declares no inner dimensions is unbounded here.
function liquidCapacity(destination: Entity): number | null {
  const width = destination.props.inner_w_cm;
  const depth = destination.props.inner_d_cm;
  const height = destination.props.inner_h_cm;
  if (typeof width !== "number" || typeof depth !== "number" || typeof height !== "number") {
    return null;
  }
  return Math.trunc(width * depth * height);
}

function liquidAmount(entity: Entity): number {
  const amount = entity.props.liquid_amount;
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

// The floor has no position of its own, so reaching it is being in the room; anything else is
// measured from where the actor stands.
function reachable(context: CommandContext, destination: Entity): boolean {
  if (destination.template === "room") {
    return destination.id === context.actor.location;
  }
  return withinReach(context, destination.id);
}

function plan(context: CommandContext): Planning {
  const destinationText = addressText(context, "destination");
  const target = context.target;
  if (destinationText === null) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  if (target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  if (target.part !== null) {
    return { status: "refused", reason_code: "not_carried" };
  }

  const source = context.snapshot.entities[target.entity_id];
  if (source === undefined) {
    return { status: "invalid", reason_code: "no_such_entity" };
  }
  if (source.contained_in !== context.actor.id) {
    return { status: "refused", reason_code: "not_carried" };
  }
  // A vessel in a space part (pocket) must be taken out first before pouring from it.
  if (inSpacePart(context.snapshot, context.registry, context.actor, source)) {
    return { status: "refused", reason_code: "not_in_hand" };
  }

  const material = source.props.liquid_material;
  if (typeof material !== "string" || material.length === 0) {
    return { status: "refused", reason_code: "no_liquid" };
  }
  const available = source.props.liquid_amount;
  if (typeof available !== "number" || !Number.isSafeInteger(available) || available < 0) {
    return { status: "refused", reason_code: "no_liquid" };
  }
  if (available === 0) {
    return { status: "refused", reason_code: "nothing_to_pour" };
  }

  // An absent amount pours everything; a present one is a whole positive integer, so no pour rounds
  // or quietly becomes the whole contents.
  const raw = (context.command.args ?? {}).amount;
  if (raw !== undefined && !(typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0)) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  const requested = raw === undefined ? available : raw;
  if (requested > available) {
    return {
      status: "refused",
      reason_code: "insufficient_liquid",
      reason_data: { requested, available },
    };
  }

  const required = context.verb.requires ?? [];
  const caps = capacities(context.snapshot, context.registry, context.actor.id);
  if (!meetsRequirements(caps, required)) {
    const data = unmetRequirement(caps, required);
    return {
      status: "refused",
      reason_code: insufficientCode(required),
      ...(data !== null && { reason_data: data }),
    };
  }

  const address = addressEntity(context, destinationText, "not_a_destination");
  if (address.status === "failed") {
    return notPlanned(address.result);
  }
  const destination = address.entity;
  if (destination.id === source.id) {
    return { status: "refused", reason_code: "cannot_pour_into_self" };
  }
  if (!reachable(context, destination)) {
    const data = reachData(context.snapshot, context.actor.id, destination.id);
    return {
      status: "refused",
      reason_code: "out_of_reach",
      ...(data !== null && { reason_data: data }),
    };
  }

  const holds = destination.props.container === true;
  if (!holds && destination.props.surface !== true && destination.template !== "room") {
    return { status: "refused", reason_code: "not_a_destination" };
  }

  // A container's own shutness hides its inside; anything else is hidden by whatever shut encloses
  // it, and a surface takes residue from above however shut the thing it stands on is.
  const enclosure = holds
    ? destination.props.openable === true && destination.props.open !== true
      ? destination.id
      : closedEnclosure(context.snapshot, destination.id)
    : closedEnclosure(context.snapshot, destination.id);
  if (enclosure !== null) {
    return { status: "refused", reason_code: "container_closed", reason_data: { enclosure } };
  }

  let held = 0;
  if (holds) {
    const existing = destination.props.liquid_material;
    if (typeof existing === "string" && existing.length > 0) {
      if (existing !== material) {
        return {
          status: "refused",
          reason_code: "incompatible_liquid",
          reason_data: { material, held_material: existing },
        };
      }
      held = liquidAmount(destination);
    }
    const capacity = liquidCapacity(destination);
    if (capacity !== null && held + requested > capacity) {
      return {
        status: "refused",
        reason_code: "container_full",
        reason_data: { requested, held, capacity },
      };
    }
  }

  return {
    status: "ok",
    pour: { source, destination, material, amount: requested, available, held, holds },
  };
}

function preconditions(context: CommandContext): PreconditionResult {
  const planned = plan(context);
  return planned.status === "ok" ? { status: "ok" } : planned;
}

function transition(context: TransitionContext): void {
  const planned = plan(context);
  if (planned.status !== "ok") {
    throw new TypeError("Pour source or destination changed after validation");
  }
  const { source, destination, material, amount, available, held, holds } = planned.pour;

  const pouredEvent = context.emit(
    "poured",
    source.id,
    { material, amount, to: destination.id },
    context.root_event_id,
  );

  const remaining = available - amount;
  const sourceProps: Record<string, number | string | boolean> = {
    ...source.props,
    liquid_amount: remaining,
  };
  // An emptied vessel declares no material at all, the way a broken one does.
  if (remaining === 0) {
    sourceProps.liquid_material = "";
  }
  context.set(source.id, "props", sourceProps, pouredEvent);

  if (holds) {
    const destinationProps = {
      ...destination.props,
      liquid_material: material,
      liquid_amount: held + amount,
    };
    context.set(destination.id, "props", destinationProps, pouredEvent);
    return;
  }
  addResidue(context, destination.id, { [material]: amount }, pouredEvent);
}

export const pourVerb: Verb = {
  duration: { ticks: 1 },
  requires_target: true,
  args: { destination: { kind: "address" }, amount: { kind: "int" } },
  refuses: [
    "not_carried",
    "not_in_hand",
    "no_liquid",
    "nothing_to_pour",
    "insufficient_liquid",
    "insufficient_manipulation",
    "not_a_destination",
    "cannot_pour_into_self",
    "out_of_reach",
    "container_closed",
    "incompatible_liquid",
    "container_full",
  ],
  requires: [{ capacity: "manipulation", at_least: 50 }],
  preconditions,
  transition,
};