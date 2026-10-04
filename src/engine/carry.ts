import type { Entity, Id, ReasonData, Snapshot } from "../model.js";
import type { TemplateRegistry } from "../templates.js";
import type { CapacityRequirement, CarryAlternative } from "./command.js";

// What it takes to hold a thing, declared once and read by take, give, and the loss of a carrier:
// hands scale with the item's hands_required; a mouth takes one thing at a time, never a
// two-handed one, and only up to the carrier's own limit.
export const carryAlternatives: readonly CarryAlternative[] = [
  { capacity: "manipulation", per_hand: 50 },
  { capacity: "mouth_carry", at_least: 1, max_hands: 1, mass_limit_prop: "carry_limit_g", holds: 1 },
];

export function heldCount(snapshot: Snapshot, carrierId: Id): number {
  return Object.keys(snapshot.entities).filter(
    (id) => snapshot.entities[id]?.contained_in === carrierId,
  ).length;
}

// Why one alternative fails, in the order its conditions are declared; null when it can hold the item.
// A capacity shortfall names what it had and what it needed.
type Failure =
  | { kind: "capacity"; capacity: string; have: number; need: number }
  | { kind: "hands" }
  | { kind: "weight"; capacity: string }
  | { kind: "full"; capacity: string };

const failureRank: Record<Failure["kind"], number> = {
  capacity: 0,
  hands: 1,
  weight: 2,
  full: 3,
};

function failureCode(failure: Failure): string {
  switch (failure.kind) {
    case "capacity":
      return `insufficient_${failure.capacity}`;
    case "hands":
      return "two_hands_required";
    case "weight":
      return "too_heavy";
    case "full":
      return "mouth_full";
  }
}

function handsOf(item: Entity): number {
  return item.props.hands_required === 2 ? 2 : 1;
}

function alternativeFailure(
  caps: Record<string, number> | null,
  carrierProps: Record<string, number | string | boolean>,
  item: Entity,
  registry: TemplateRegistry,
  otherHeld: number,
  alternative: CarryAlternative,
): Failure | null {
  if (caps === null) {
    return {
      kind: "capacity",
      capacity: alternative.capacity,
      have: 0,
      need: alternative.per_hand !== undefined ? handsOf(item) * alternative.per_hand : (alternative.at_least ?? 1),
    };
  }
  const hands = handsOf(item);
  if (alternative.per_hand !== undefined) {
    return (caps[alternative.capacity] ?? 0) >= hands * alternative.per_hand
      ? null
      : {
          kind: "capacity",
          capacity: alternative.capacity,
          have: caps[alternative.capacity] ?? 0,
          need: hands * alternative.per_hand,
        };
  }
  if ((caps[alternative.capacity] ?? 0) < (alternative.at_least ?? 1)) {
    return {
      kind: "capacity",
      capacity: alternative.capacity,
      have: caps[alternative.capacity] ?? 0,
      need: alternative.at_least ?? 1,
    };
  }
  if (alternative.max_hands !== undefined && hands > alternative.max_hands) {
    return { kind: "hands" };
  }
  if (alternative.mass_limit_prop !== undefined) {
    const limit = carrierProps[alternative.mass_limit_prop];
    const template = registry[item.template];
    if (typeof limit !== "number" || template === undefined || template.mass_g > limit) {
      return { kind: "weight", capacity: alternative.capacity };
    }
  }
  if (alternative.holds !== undefined && otherHeld >= alternative.holds) {
    return { kind: "full", capacity: alternative.capacity };
  }
  return null;
}

// Whether any declared alternative can hold the item; a refusal names the failure that came
// furthest through its conditions, ties going to the first declared alternative. A capacity
// shortfall also reports what it had and what it needed.
export function carryCheck(
  caps: Record<string, number> | null,
  carrierProps: Record<string, number | string | boolean>,
  item: Entity,
  registry: TemplateRegistry,
  otherHeld: number,
  alternatives: readonly CarryAlternative[],
): { ok: true } | { ok: false; reason_code: string; reason_data?: ReasonData } {
  let worst: { code: string; rank: number; reason_data?: ReasonData } | null = null;
  for (const alternative of alternatives) {
    const failure = alternativeFailure(caps, carrierProps, item, registry, otherHeld, alternative);
    if (failure === null) {
      return { ok: true };
    }
    const rank = failureRank[failure.kind];
    if (worst === null || rank > worst.rank) {
      worst = {
        code: failureCode(failure),
        rank,
        ...(failure.kind === "capacity" && {
          reason_data: { capacity: failure.capacity, have: failure.have, need: failure.need },
        }),
      };
    }
  }
  return worst === null
    ? { ok: false, reason_code: "uncarryable" }
    : {
        ok: false,
        reason_code: worst.code,
        ...(worst.reason_data !== undefined && { reason_data: worst.reason_data }),
      };
}

// The capacity that held the item before a change and cannot after it, or null. Losing is not
// gated by slots, so the caller passes an otherHeld of zero.
export function lostCarry(
  before: Record<string, number> | null,
  after: Record<string, number> | null,
  carrierProps: Record<string, number | string | boolean>,
  item: Entity,
  registry: TemplateRegistry,
  alternatives: readonly CarryAlternative[],
): string | null {
  for (const alternative of alternatives) {
    const wasMet =
      alternativeFailure(before, carrierProps, item, registry, 0, alternative) === null;
    const isMet = alternativeFailure(after, carrierProps, item, registry, 0, alternative) === null;
    if (wasMet && !isMet) {
      return alternative.capacity;
    }
  }
  return null;
}

export function meetsRequirements(
  caps: Record<string, number> | null,
  requirements: readonly CapacityRequirement[],
): boolean {
  return requirements.every((requirement) => (caps?.[requirement.capacity] ?? 0) >= requirement.at_least);
}

export function insufficientCode(named: readonly { capacity: string }[]): string {
  return `insufficient_${named[0]?.capacity ?? "manipulation"}`;
}

// The first unmet capacity requirement with what it had and what it needed, if any is unmet.
export function unmetRequirement(
  caps: Record<string, number> | null,
  requirements: readonly CapacityRequirement[],
): { capacity: string; have: number; need: number } | null {
  const found = requirements.find(
    (requirement) => (caps?.[requirement.capacity] ?? 0) < requirement.at_least,
  );
  return found === undefined
    ? null
    : {
        capacity: found.capacity,
        have: caps?.[found.capacity] ?? 0,
        need: found.at_least,
      };
}
