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
