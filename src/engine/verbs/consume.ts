import { heldInParts } from "../carry.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import type { Entity } from "../../model.js";
import { closedEnclosure, reachData, withinReach } from "./address.js";
import { removeEntity } from "./edit.js";

// What one `consume` takes: a solid thing (`nutrition`, gone whole) or an amount of a liquid
// (`liquid_nutrition` per 100 cm³ of what the vessel holds, which stays). Either lowers the actor's
// `hunger`, if it declares one, by what it gives.
type Plan =
  | { kind: "solid"; nutrition: number }
  | { kind: "liquid"; amount: number; available: number; material: string; nutrition: number };

type Refusal = Exclude<PreconditionResult, { status: "ok" }>;

function wholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function plan(item: Entity, requested: unknown): { plan: Plan } | Refusal {
  const material = item.props.liquid_material;
  const available = item.props.liquid_amount;
  if (typeof material === "string" && material.length > 0 && wholeNumber(available) && available > 0) {
    const perHundred = item.props.liquid_nutrition;
    if (!wholeNumber(perHundred) || perHundred < 0) {
      return { status: "refused", reason_code: "not_consumable" };
    }
    // An absent amount takes everything, as a pour does; a present one is a whole positive integer.
    if (requested !== undefined && !(wholeNumber(requested) && requested > 0)) {
      return { status: "invalid", reason_code: "invalid_args" };
    }
    const amount = requested === undefined ? available : requested;
    if (amount > available) {
      return { status: "refused", reason_code: "insufficient_liquid", reason_data: { requested: amount, available } };
    }
    return { plan: { kind: "liquid", amount, available, material, nutrition: Math.trunc((amount * perHundred) / 100) } };
  }
  const nutrition = item.props.nutrition;
  if (!wholeNumber(nutrition) || nutrition <= 0) {
    return { status: "refused", reason_code: "not_consumable" };
  }
  // A solid thing is eaten whole: an amount of it means nothing.
  if (requested !== undefined) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  return { plan: { kind: "solid", nutrition } };
}

// A creature whose mouth already holds something else cannot eat: the jaw is one grip, and the
// mouth rules of take and give apply to it here too.
function mouthBusy(context: CommandContext, itemId: string): boolean {
  const parts = context.registry[context.actor.template]?.parts ?? [];
  const mouths = parts
    .filter((part) => (part.contributes.mouth_carry ?? 0) > 0 && part.holds?.kind === "grip")
    .map((part) => part.name);
  return (
    mouths.length > 0 &&
    heldInParts(context.snapshot, context.actor.id).some((held) => held.id !== itemId && mouths.includes(held.in_part))
  );
}

function planned(context: CommandContext): { item: Entity; plan: Plan } | Refusal {
  const target = context.target;
  if (target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  if (target.part !== null) {
    return { status: "refused", reason_code: "not_consumable" };
  }
  const item = context.snapshot.entities[target.entity_id];
  if (item === undefined) {
    return { status: "invalid", reason_code: "no_such_entity" };
  }
  const chosen = plan(item, (context.command.args ?? {}).amount);
  if (!("plan" in chosen)) {
    return chosen;
  }
  const enclosure = closedEnclosure(context.snapshot, item.id);
  if (enclosure !== null) {
    return { status: "refused", reason_code: "container_closed", reason_data: { enclosure } };
  }
  // What the actor carries is in reach by being carried, in a hand or a pocket; anything else is
  // measured from where the actor stands.
  if (item.contained_in !== context.actor.id && !withinReach(context, item.id)) {
    const data = reachData(context.snapshot, context.actor.id, item.id);
    return { status: "refused", reason_code: "out_of_reach", ...(data !== null && { reason_data: data }) };
  }
  if (mouthBusy(context, item.id)) {
    return { status: "refused", reason_code: "mouth_full" };
  }
  return { item, plan: chosen.plan };
}

function preconditions(context: CommandContext): PreconditionResult {
  const result = planned(context);
  return "plan" in result ? { status: "ok" } : result;
}

function transition(context: TransitionContext): void {
  const result = planned(context);
  if (!("plan" in result)) {
    throw new TypeError("Consume target changed after validation");
  }
  const { item, plan: taken } = result;
  const eaten = context.emit(
    "consumed",
    item.id,
    taken.kind === "solid"
      ? { nutrition: taken.nutrition }
      : { nutrition: taken.nutrition, material: taken.material, amount: taken.amount },
    context.root_event_id,
  );
  // Only a body that declares a hunger has one to lower.
  const hunger = context.actor.props.hunger;
  if (wholeNumber(hunger)) {
    context.set(context.actor.id, "props", { ...context.actor.props, hunger: Math.max(0, hunger - taken.nutrition) }, eaten);
  }
  if (taken.kind === "solid") {
    removeEntity(context, item.id, eaten);
    return;
  }
  const remaining = taken.available - taken.amount;
  // An emptied vessel declares no material at all, the way a poured or broken one does.
  context.set(
    item.id,
    "props",
    { ...item.props, liquid_amount: remaining, ...(remaining === 0 && { liquid_material: "" }) },
    eaten,
  );
}

export const consumeVerb: Verb = {
  duration: { ticks: 1 },
  requires_target: true,
  args: { amount: { kind: "int" } },
  refuses: ["not_consumable", "insufficient_liquid", "container_closed", "out_of_reach", "mouth_full"],
  preconditions,
  transition,
};
