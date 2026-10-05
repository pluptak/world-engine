import type { Entity, Id, Snapshot } from "../model.js";
import type { TemplateRegistry } from "../templates.js";

// The one thing a new template set may not take away from an entity that is already in the world.
export interface LostField {
  entity: Id;
  template: string;
  field: string;
}

// Props and residue are deliberately absent: a template seeds them at spawn, but the entity owns
// them afterwards, so a key no template declares is ordinary (a scenario may add one) and residue
// arrives from transfers rather than from any declaration. What is left is what would leave live
// state unreadable: a part in use that is no longer declared, or a product that can no longer be
// spawned. Size, mass, contributions, residue amounts and `default_hit_part` are read off templates
// too, and changing them moves the present without breaking the past; the replay check behind this
// rule is what covers the past.
function lostFor(snapshot: Snapshot, entity: Entity, registry: TemplateRegistry): string | null {
  const template = registry[entity.template];
  if (template === undefined) {
    return "template";
  }

  // A part at its default is not stored (parts.ts), so a part is in use when it has stored state
  // or something sits in it; an untouched one the template drops is a template change like any other.
  const declared = new Set(template.parts.map((part) => part.name));
  const used = new Set(Object.keys(entity.parts));
  for (const other of Object.values(snapshot.entities)) {
    if (other.contained_in === entity.id && other.in_part !== null) {
      used.add(other.in_part);
    }
  }
  for (const part of [...used].sort()) {
    if (!declared.has(part)) {
      return `parts.${part}`;
    }
  }

  // A break spawns its products by id, so a target that is gone is a throw waiting for the next
  // fall rather than something the world can report.
  for (const product of template.break_products) {
    if (registry[product.template] === undefined) {
      return `break_products.${product.template}`;
    }
  }

  return null;
}

// The first field a live entity's template no longer provides, walking entities in id order, or null
// when the new set leaves every one of them whole. Deterministic: the same pair always names the
// same field.
export function lostField(snapshot: Snapshot, registry: TemplateRegistry): LostField | null {
  for (const id of Object.keys(snapshot.entities).sort()) {
    const entity = snapshot.entities[id];
    if (entity === undefined) {
      continue;
    }
    const field = lostFor(snapshot, entity, registry);
    if (field !== null) {
      return { entity: id, template: entity.template, field };
    }
  }

  return null;
}
