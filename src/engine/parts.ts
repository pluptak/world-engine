import type { Entity, PartState } from "../model.js";
import type { PartDecl, Template } from "../templates.js";

// Part state is sparse: a part at its template default (intact, at max_integrity) is not stored.
// An absent entry reads as that default, so an untouched body stores nothing, every state has one
// stored form, and a part set back to its default leaves the record.
export function isDefaultPart(decl: PartDecl, state: PartState): boolean {
  return state.status === "intact" && state.integrity === decl.max_integrity;
}

// The state of a declared part, stored or default; undefined for a part the template does not
// declare and the entity does not store.
export function partState(
  template: Template | undefined,
  entity: Entity,
  name: string,
): PartState | undefined {
  const stored = entity.parts[name];
  if (stored !== undefined) {
    return stored;
  }
  const decl = template?.parts.find((part) => part.name === name);
  return decl === undefined ? undefined : { integrity: decl.max_integrity, status: "intact" };
}

// The record with each named part set to its state, an entry dropped where that is the default.
export function withParts(
  template: Template,
  parts: Record<string, PartState>,
  changes: Record<string, PartState>,
): Record<string, PartState> {
  const next = { ...parts };
  for (const name of Object.keys(changes).sort()) {
    const state = changes[name]!;
    const decl = template.parts.find((part) => part.name === name);
    if (decl !== undefined && isDefaultPart(decl, state)) {
      delete next[name];
    } else {
      next[name] = { ...state };
    }
  }
  return next;
}
