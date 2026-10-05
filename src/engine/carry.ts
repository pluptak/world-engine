import type { Entity, Id, ReasonData, Snapshot } from "../model.js";
import type { HoldsDecl, TemplateRegistry } from "../templates.js";
import type {
  CapacityRequirement,
  CarryAlternative,
  CommandContext,
} from "./command.js";
import { misfit } from "./fit.js";

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

export interface SpacePart {
  name: string;
  inner: [number, number, number];
}

export interface HolderLayout {
  grips: string[];
  spaces: SpacePart[];
}

// The holder parts a template declares, in declaration order. Grips hold one item; a two-handed
// item also occupies the lowest other grip, derived, never stored. Spaces hold what fits.
export function holderLayout(registry: TemplateRegistry, templateId: string): HolderLayout {
  const template = registry[templateId];
  const grips: string[] = [];
  const spaces: SpacePart[] = [];
  for (const part of template?.parts ?? []) {
    const holds: HoldsDecl | undefined = part.holds;
    if (holds === undefined) {
      continue;
    }
    if (holds.kind === "grip") {
      grips.push(part.name);
    } else {
      spaces.push({ name: part.name, inner: [holds.inner_w_cm, holds.inner_d_cm, holds.inner_h_cm] });
    }
  }
  return { grips, spaces };
}

// A part holds only while it and every ancestor above it are intact or damaged: a hand on a
// severed arm is gone with the arm.
export function partAvailable(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  holderId: Id,
  partName: string,
): boolean {
  const holder = snapshot.entities[holderId];
  const template = holder === undefined ? undefined : registry[holder.template];
  if (holder === undefined || template === undefined) {
    return false;
  }
  const parents = new Map(template.parts.map((part) => [part.name, part.parent]));
  let current: string | null = partName;
  while (current !== null) {
    const state = holder.parts[current];
    if (state === undefined || (state.status !== "intact" && state.status !== "damaged")) {
      return false;
    }
    current = parents.get(current) ?? null;
  }
  return true;
}

export interface GripItem {
  id: Id;
  in_part: string;
  hands: number;
}

// Everything the holder carries that names a part of it, whatever kind the part is.
export function heldInParts(snapshot: Snapshot, holderId: Id): GripItem[] {
  const items: GripItem[] = [];
  for (const id of Object.keys(snapshot.entities).sort()) {
    const entity = snapshot.entities[id];
    if (entity?.contained_in === holderId && entity.in_part !== null) {
      items.push({ id, in_part: entity.in_part, hands: handsOf(entity) });
    }
  }
  return items;
}

// A two-handed item's other grip: the lowest grip that is not its primary, in template order.
// Derived, never stored, so verbs, validation and loss agree on which two grips it uses.
export function gripSecondary(grips: string[], primary: string): string | undefined {
  return grips.find((grip) => grip !== primary);
}

// Lowest-first packing of grip-held items under their written primaries: a two-handed item takes
// its primary and its secondary. Null when two items need one grip. Set-based, so the verdict
// never depends on the order items were placed in.
export function packGrips(
  grips: string[],
  items: GripItem[],
): { full: Set<string>; used: Map<string, string[]> } | null {
  const used = new Map<string, string[]>();
  const occupy = (grip: string, id: string): void => {
    const list = used.get(grip) ?? [];
    list.push(id);
    used.set(grip, list);
  };
  for (const item of items) {
    if (!grips.includes(item.in_part)) {
      return null;
    }
    occupy(item.in_part, item.id);
    if (item.hands > 1) {
      const second = gripSecondary(grips, item.in_part);
      if (second === undefined) {
        return null;
      }
      occupy(second, item.id);
    }
  }
  const full = new Set<string>();
  for (const [grip, ids] of used) {
    if (ids.length > 1) {
      return null;
    }
    full.add(grip);
  }
  return { full, used };
}

// Where a new item lands in the holder's grips: the lowest grip with room, or the refusal it
// earns. Capacity checks run before this, so a full jaw still answers mouth_full, never this.
// The item itself is left out of the packing: it vacates its grip on the way in.
export function claimGrip(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  holderId: Id,
  item: Entity,
  named?: string | null,
  exclude?: Id | null,
): { part: string } | { reason_code: string; reason_data?: ReasonData } {
  const holder = snapshot.entities[holderId];
  const template = holder === undefined ? undefined : registry[holder.template];
  if (holder === undefined || template === undefined) {
    return { reason_code: "unknown_part" };
  }
  const grips = holderLayout(registry, holder.template).grips.filter((grip) =>
    partAvailable(snapshot, registry, holderId, grip),
  );
  const packed = packGrips(
    grips,
    heldInParts(snapshot, holderId).filter(
      (held) => held.id !== exclude && grips.includes(held.in_part),
    ),
  );
  // An unpackable holder is refused, never written through: every grip reads full.
  const full = packed === null ? new Set(grips) : packed.full;
  const hands = handsOf(item);
  const freeCount = grips.filter((grip) => !full.has(grip)).length;
  if (named !== undefined && named !== null) {
    if (!grips.includes(named)) {
      return { reason_code: "unknown_part" };
    }
    const second = hands > 1 ? gripSecondary(grips, named) : named;
    if (full.has(named) || second === undefined || full.has(second)) {
      return { reason_code: "hands_full", reason_data: { free: 0, need: hands } };
    }
    return { part: named };
  }
  if (hands > 1) {
    const primary = grips.find((grip) => {
      const second = gripSecondary(grips, grip);
      return !full.has(grip) && second !== undefined && !full.has(second);
    });
    if (primary === undefined) {
      return { reason_code: "hands_full", reason_data: { free: freeCount, need: hands } };
    }
    return { part: primary };
  }
  const free = grips.filter((grip) => !full.has(grip));
  if (free.length === 0) {
    return { reason_code: "hands_full", reason_data: { free: 0, need: hands } };
  }
  return { part: free[0]! };
}

// The grip a take or give lands in: the named grip or the lowest free one, after the capacity
// checks ran. The transition recomputes it because the context carries no verdict between calls.
export function gripPlacement(
  context: CommandContext,
  holderId: Id,
  item: Entity,
):
  | { status: "ok"; part: string }
  | { status: "refused"; reason_code: string; reason_data?: ReasonData }
  | { status: "invalid"; reason_code: string } {
  const raw = (context.command.args ?? {}).part;
  if (raw !== undefined && (typeof raw !== "string" || raw.length === 0)) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  const claimed = claimGrip(
    context.snapshot,
    context.registry,
    holderId,
    item,
    (raw as string | undefined) ?? null,
    item.id,
  );
  if ("part" in claimed) {
    return { status: "ok", part: claimed.part };
  }
  if (claimed.reason_code === "hands_full") {
    return { status: "refused", reason_code: "hands_full", reason_data: claimed.reason_data };
  }
  return { status: "refused", reason_code: "unknown_part" };
}

// Who falls when the holder loses parts: items naming unavailable parts, and two-handed items
// whose secondary went with them. Deterministic in the item set; the caller drops the named in
// id order. Items naming no declared holder part are the validator's business and stay out of it.
export function gripEvictions(snapshot: Snapshot, registry: TemplateRegistry, holderId: Id): Id[] {
  const holder = snapshot.entities[holderId];
  const template = holder === undefined ? undefined : registry[holder.template];
  if (holder === undefined || template === undefined) {
    return [];
  }
  const layout = holderLayout(registry, holder.template);
  const declared = new Set([...layout.grips, ...layout.spaces.map((space) => space.name)]);
  const available = new Set(
    [...declared].filter((name) => partAvailable(snapshot, registry, holderId, name)),
  );
  const evicted: Id[] = [];
  for (const item of heldInParts(snapshot, holderId)) {
    if (!declared.has(item.in_part)) {
      continue;
    }
    if (!available.has(item.in_part)) {
      evicted.push(item.id);
      continue;
    }
    if (item.hands > 1 && layout.grips.includes(item.in_part)) {
      const second = gripSecondary(layout.grips, item.in_part);
      if (second === undefined || !available.has(second)) {
        evicted.push(item.id);
      }
    }
  }
  return evicted;
}

// Whether the item fits the holder's space part, reporting the failing pair like a container.
export function spaceRefusal(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  holderId: Id,
  part: string,
  item: Entity,
): { reason_code: string; reason_data?: ReasonData } | null {
  const holder = snapshot.entities[holderId];
  const template = holder === undefined ? undefined : registry[holder.template];
  if (template === undefined) {
    return { reason_code: "unknown_part" };
  }
  const space = holderLayout(registry, template.id).spaces.find((candidate) => candidate.name === part);
  if (space === undefined) {
    return { reason_code: "unknown_part" };
  }
  const size = registry[item.template]?.size_cm;
  if (size === undefined) {
    return { reason_code: "too_large" };
  }
  const data = misfit([size.w, size.d, size.h], [...space.inner]);
  return data === null ? null : { reason_code: "too_large", reason_data: data };
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

// Whether the item is in a space part (not a grip) of the holder.
export function inSpacePart(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  holder: Entity,
  item: Entity,
): boolean {
  if (item.in_part === null) {
    return false;
  }
  const layout = holderLayout(registry, holder.template);
  return layout.spaces.some((space) => space.name === item.in_part);
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
