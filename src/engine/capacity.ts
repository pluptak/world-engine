import type { Id, Snapshot } from "../model.js";
import type { PartDecl, TemplateRegistry } from "../templates.js";

function entityAndTemplate(snapshot: Snapshot, registry: TemplateRegistry, entityId: Id) {
  const entity = snapshot.entities[entityId];
  if (entity === undefined) {
    throw new TypeError(`Unknown entity ${entityId}`);
  }

  const template = registry[entity.template];
  if (template === undefined) {
    throw new TypeError(`Unknown template ${entity.template}`);
  }

  return { entity, template };
}

function ancestorsAvailable(
  part: PartDecl,
  partsByName: Map<string, PartDecl>,
  partStates: Snapshot["entities"][string]["parts"],
): boolean {
  const visited = new Set<string>();
  let ancestorName = part.parent;

  while (ancestorName !== null) {
    if (visited.has(ancestorName)) {
      throw new TypeError(`Part cycle at ${ancestorName}`);
    }
    visited.add(ancestorName);

    const state = partStates[ancestorName];
    if (
      state === undefined ||
      state.status === "detached" ||
      state.status === "destroyed"
    ) {
      return false;
    }

    const ancestor = partsByName.get(ancestorName);
    if (ancestor === undefined) {
      throw new TypeError(`Unknown ancestor part ${ancestorName}`);
    }
    ancestorName = ancestor.parent;
  }

  return true;
}

export function capacity(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  entityId: Id,
  name: string,
): number | null {
  const { entity, template } = entityAndTemplate(snapshot, registry, entityId);
  if (template.parts.length === 0) {
    return null;
  }

  const partsByName = new Map(template.parts.map((part) => [part.name, part]));
  let total = 0;

  for (const part of template.parts) {
    const state = entity.parts[part.name];
    if (
      state === undefined ||
      (state.status !== "intact" && state.status !== "damaged") ||
      !Object.hasOwn(part.contributes, name) ||
      !ancestorsAvailable(part, partsByName, entity.parts)
    ) {
      continue;
    }
    total += part.contributes[name] ?? 0;
  }

  for (const modifier of entity.modifiers) {
    if (
      modifier.capacity === name &&
      (modifier.expires_at_tick === null || modifier.expires_at_tick > snapshot.tick)
    ) {
      total += modifier.delta;
    }
  }

  return Math.max(0, Math.min(100, total));
}

export function capacities(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  entityId: Id,
): Record<string, number> | null {
  const { template } = entityAndTemplate(snapshot, registry, entityId);
  if (template.parts.length === 0) {
    return null;
  }

  const names = [
    ...new Set(template.parts.flatMap((part) => Object.keys(part.contributes))),
  ].sort();
  return Object.fromEntries(
    names.map((name) => [name, capacity(snapshot, registry, entityId, name) ?? 0]),
  );
}
