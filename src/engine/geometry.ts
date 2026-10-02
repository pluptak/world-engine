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
