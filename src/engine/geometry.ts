import type { Id, Pos, Snapshot } from "../model.js";
import type { TemplateRegistry } from "../templates.js";

function requireEntity(snapshot: Snapshot, id: Id) {
  const entity = snapshot.entities[id];
  if (entity === undefined) {
    throw new TypeError(`Unknown entity ${id}`);
  }
  return entity;
}

function requireTemplateHeight(registry: TemplateRegistry, templateId: string): number {
  const template = registry[templateId];
  if (template === undefined) {
    throw new TypeError(`Unknown template ${templateId}`);
  }
  return template.size_cm.h;
}

export function elevation(snapshot: Snapshot, registry: TemplateRegistry, id: Id): number {
  const visiting = new Set<Id>();
  const resolve = (currentId: Id): number => {
    if (visiting.has(currentId)) {
      throw new TypeError(`Support or containment cycle at ${currentId}`);
    }

    visiting.add(currentId);
    const entity = requireEntity(snapshot, currentId);
    let result: number;

    if (entity.contained_in !== null) {
      result = resolve(entity.contained_in);
    } else if (entity.support === null) {
      result = 0;
    } else {
      const support = requireEntity(snapshot, entity.support);
      const supportElevation = resolve(support.id);
      result =
        support.template === "room"
          ? 0
          : supportElevation + requireTemplateHeight(registry, support.template);
    }

    visiting.delete(currentId);
    return result;
  };

  return resolve(id);
}

export function effectivePos(snapshot: Snapshot, id: Id): Pos | null {
  const visiting = new Set<Id>();
  const resolve = (currentId: Id): Pos | null => {
    if (visiting.has(currentId)) {
      throw new TypeError(`Support or containment cycle at ${currentId}`);
    }

    visiting.add(currentId);
    const entity = requireEntity(snapshot, currentId);
    if (entity.pos !== null) {
      return { ...entity.pos };
    }

    const parent = entity.contained_in ?? entity.support;
    if (parent === null) {
      return null;
    }

    const result = resolve(parent);
    visiting.delete(currentId);
    return result;
  };

  return resolve(id);
}

export type Direction = "+x" | "-x" | "+y" | "-y";

export interface Sweep {
  // The whole centimetres the entity travels, at most the distance asked for.
  distance: number;
  // What stopped it short, or null when it travelled the full distance.
  obstacle: Id | null;
}

function footprint(registry: TemplateRegistry, templateId: string): { w: number; d: number } {
  const template = registry[templateId];
  if (template === undefined) {
    throw new TypeError(`Unknown template ${templateId}`);
  }
  return { w: template.size_cm.w, d: template.size_cm.d };
}

// How far an entity standing on a support can slide along one axis before its footprint would
// overlap another's on the same support. Footprints are centred on pos, axis-aligned, and compared
// on doubled coordinates so odd sizes stay integral; touching edges do not overlap. A footprint
// already overlapping the mover never blocks it, so whatever starts entangled can always be moved.
export function sweep(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  id: Id,
  direction: Direction,
  distance: number,
  skip: (id: Id) => boolean,
): Sweep {
  const mover = requireEntity(snapshot, id);
  const from = effectivePos(snapshot, id);
  if (from === null || mover.support === null || mover.contained_in !== null) {
    return { distance, obstacle: null };
  }
  const size = footprint(registry, mover.template);
  const alongX = direction.endsWith("x");
  const sign = direction.startsWith("+") ? 1 : -1;
  let result: Sweep = { distance, obstacle: null };

  for (const otherId of Object.keys(snapshot.entities).sort()) {
    const other = requireEntity(snapshot, otherId);
    if (
      otherId === id ||
      other.support !== mover.support ||
      other.contained_in !== null ||
      other.status === "destroyed" ||
      // Rubble is passed over: what broke, and what declares itself debris (`rubble` in props,
      // which spawn copies from the template).
      other.status === "broken" ||
      other.props.rubble === true ||
      skip(otherId)
    ) {
      continue;
    }
    const at = effectivePos(snapshot, otherId);
    if (at === null) {
      continue;
    }
    const otherSize = footprint(registry, other.template);
    const spanX = size.w + otherSize.w;
    const spanY = size.d + otherSize.d;
    const dx2 = 2 * (at.x - from.x);
    const dy2 = 2 * (at.y - from.y);
    if (Math.abs(dx2) < spanX && Math.abs(dy2) < spanY) {
      continue;
    }
    const across = alongX ? dy2 : dx2;
    if (Math.abs(across) >= (alongX ? spanY : spanX)) {
      continue;
    }
    const ahead = sign * (alongX ? dx2 : dy2);
    const gap2 = ahead - (alongX ? spanX : spanY);
    if (gap2 < 0) {
      continue;
    }
    // Contact at gap2 / 2; the largest whole distance that still leaves no overlap.
    const free = Math.floor(gap2 / 2);
    if (free < result.distance) {
      result = { distance: free, obstacle: otherId };
    }
  }
  return result;
}

// Walking: what is lower than this is stepped over or stood on, never in the way of feet.
export const STEP_OVER_CM = 20;

type Fraction = { num: number; den: number };

const less = (a: Fraction, b: Fraction): boolean => a.num * b.den < b.num * a.den;

// The things an agent's footprint can meet on its own support: what a push would meet, less what
// is low enough to step over, an open barrier (a gate standing open), and whatever the agent
// already overlaps where it starts, so an agent never gets stuck in a place it is already in. An
// agent arriving from another room starts nowhere here, so nothing is skipped for it.
function walkObstacles(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  id: Id,
  arriving: boolean,
): { id: Id; at: Pos; w: number; d: number; barrier: boolean }[] {
  const mover = requireEntity(snapshot, id);
  const from = effectivePos(snapshot, id);
  if (from === null || mover.support === null) {
    return [];
  }
  const size = footprint(registry, mover.template);
  const found: { id: Id; at: Pos; w: number; d: number; barrier: boolean }[] = [];
  for (const otherId of Object.keys(snapshot.entities).sort()) {
    const other = requireEntity(snapshot, otherId);
    const template = registry[other.template];
    if (
      otherId === id ||
      template === undefined ||
      other.support !== mover.support ||
      other.contained_in !== null ||
      other.status === "destroyed" ||
      other.status === "broken" ||
      other.props.rubble === true ||
      template.props.abstract === true ||
      (other.props.barrier === true && other.props.open === true) ||
      (other.props.barrier !== true && template.size_cm.h < STEP_OVER_CM)
    ) {
      continue;
    }
    const at = effectivePos(snapshot, otherId);
    if (at === null) {
      continue;
    }
    const { w, d } = template.size_cm;
    if (!arriving && 2 * Math.abs(at.x - from.x) < size.w + w && 2 * Math.abs(at.y - from.y) < size.d + d) {
      continue;
    }
    found.push({ id: otherId, at, w, d, barrier: other.props.barrier === true });
  }
  return found;
}

interface Box {
  id: Id;
  at: Pos;
  w: number;
  d: number;
}

// The boxes a straight segment from `from` to `to` enters, carrying a footprint of `size` (zero for
// a thing passed hand to hand), in the order it meets them, the lowest id first on a tie.
function crossings(from: Pos, to: Pos, size: { w: number; d: number }, boxes: Box[]): Id[] {
  // On doubled coordinates the path is S + t·(E − S) for t in [0, 1], and it crosses a box where
  // it enters the open box of half-spans (w₁ + w₂, d₁ + d₂) around the box's centre.
  const sx = 2 * from.x;
  const sy = 2 * from.y;
  const dx = 2 * (to.x - from.x);
  const dy = 2 * (to.y - from.y);
  const met: { id: Id; t: Fraction }[] = [];
  for (const box of boxes) {
    let lo: Fraction = { num: 0, den: 1 };
    let hi: Fraction = { num: 1, den: 1 };
    let misses = false;
    for (const [start, delta, centre, span] of [
      [sx, dx, 2 * box.at.x, size.w + box.w],
      [sy, dy, 2 * box.at.y, size.d + box.d],
    ] as const) {
      if (delta === 0) {
        misses ||= Math.abs(start - centre) >= span;
        continue;
      }
      const near = { num: centre - span - start, den: delta };
      const far = { num: centre + span - start, den: delta };
      const [enter, leave] = delta > 0 ? [near, far] : [far, near];
      const positive = (f: Fraction): Fraction => (f.den < 0 ? { num: -f.num, den: -f.den } : f);
      const entering = positive(enter);
      const leaving = positive(leave);
      if (less(lo, entering)) {
        lo = entering;
      }
      if (less(leaving, hi)) {
        hi = leaving;
      }
    }
    if (!misses && less(lo, hi)) {
      met.push({ id: box.id, t: lo });
    }
  }
  met.sort((left, right) => (less(left.t, right.t) ? -1 : less(right.t, left.t) ? 1 : left.id < right.id ? -1 : 1));
  return met.map((entry) => entry.id);
}

// Where an agent walking from its position to `to` is stopped: outside the room's footprint (a
// room's origin is its centre), across a barrier on the straight way there (the first one met, the
// lowest id on a tie), or into anything solid standing at the destination (the lowest id). The path
// meets only barriers: furniture and people are walked around, bars and fences are not. An agent
// `arriving` through a door is checked where it lands in the new room, with no path inside it.
export type WalkStop = { reason: "out_of_bounds" } | { reason: "blocked"; with: Id } | null;

export function walkStop(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  id: Id,
  to: Pos,
  arriving = false,
): WalkStop {
  const mover = requireEntity(snapshot, id);
  const from = effectivePos(snapshot, id);
  const room = mover.support === null ? undefined : snapshot.entities[mover.support];
  if (from === null || room === undefined || room.template !== "room") {
    return null;
  }
  const size = footprint(registry, mover.template);
  const bounds = footprint(registry, room.template);
  if (2 * Math.abs(to.x) + size.w > bounds.w || 2 * Math.abs(to.y) + size.d > bounds.d) {
    return { reason: "out_of_bounds" };
  }

  const obstacles = walkObstacles(snapshot, registry, id, arriving);
  const first = crossings(from, to, size, obstacles.filter((candidate) => candidate.barrier))[0];
  if (first !== undefined) {
    return { reason: "blocked", with: first };
  }

  for (const obstacle of obstacles) {
    if (2 * Math.abs(obstacle.at.x - to.x) < size.w + obstacle.w && 2 * Math.abs(obstacle.at.y - to.y) < size.d + obstacle.d) {
      return { reason: "blocked", with: obstacle.id };
    }
  }
  return null;
}

// A thing passed between two entities in one room (handed over, set down, lifted) goes straight from
// one's position to the other's, and every shut barrier on that line must leave a gap it fits:
// the thing turned edgewise, its smallest dimension at most the barrier's `gap_cm` (none, nothing
// passes). The first barrier it does not fit names the refusal. An agent never passes a gap.
export type GapStop = { with: Id; size_cm: number; gap_cm: number } | null;

export function gapStop(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  thingId: Id,
  fromId: Id,
  toId: Id,
): GapStop {
  const thing = registry[requireEntity(snapshot, thingId).template];
  const from = effectivePos(snapshot, fromId);
  const to = effectivePos(snapshot, toId);
  const room = requireEntity(snapshot, fromId).location;
  const sameRoom = room !== null && requireEntity(snapshot, toId).location === room;
  if (thing === undefined || from === null || to === null || !sameRoom) {
    return null;
  }
  const barriers: Box[] = [];
  for (const id of Object.keys(snapshot.entities).sort()) {
    const other = requireEntity(snapshot, id);
    const template = registry[other.template];
    const at = effectivePos(snapshot, id);
    if (
      template !== undefined &&
      at !== null &&
      other.support === room &&
      other.props.barrier === true &&
      other.props.open !== true
    ) {
      barriers.push({ id, at, w: template.size_cm.w, d: template.size_cm.d });
    }
  }
  const size = Math.min(thing.size_cm.w, thing.size_cm.d, thing.size_cm.h);
  // The hand's line is a centimetre wide, so the seam where two sections meet is no way through.
  for (const id of crossings(from, to, { w: 1, d: 1 }, barriers)) {
    const gap = requireEntity(snapshot, id).props.gap_cm;
    const gapCm = typeof gap === "number" && Number.isSafeInteger(gap) && gap > 0 ? gap : 0;
    if (size > gapCm) {
      return { with: id, size_cm: size, gap_cm: gapCm };
    }
  }
  return null;
}

// The agent standing in an entity's footprint on the same support, the lowest id first, or null:
// what a gate swinging shut would close on. Both stand on the floor, so both positions are stored
// and no chain is walked: the clock runs before a broken result is validated away. Something with
// no position of its own (a door between rooms) has no footprint anyone stands in.
export function standingIn(snapshot: Snapshot, registry: TemplateRegistry, id: Id): Id | null {
  const entity = requireEntity(snapshot, id);
  const at = entity.pos;
  if (at === null || entity.support === null) {
    return null;
  }
  const size = footprint(registry, entity.template);
  for (const otherId of Object.keys(snapshot.entities).sort()) {
    const other = requireEntity(snapshot, otherId);
    const there = other.pos;
    if (
      otherId === id ||
      there === null ||
      other.contained_in !== null ||
      other.support !== entity.support ||
      other.props.agent !== true ||
      other.detached_from !== null ||
      other.status === "destroyed"
    ) {
      continue;
    }
    const theirs = footprint(registry, other.template);
    const overlaps =
      2 * Math.abs(there.x - at.x) < size.w + theirs.w && 2 * Math.abs(there.y - at.y) < size.d + theirs.d;
    if (overlaps) {
      return otherId;
    }
  }
  return null;
}
