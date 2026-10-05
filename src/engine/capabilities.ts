import type { Coverage } from "../model.js";

// What the engine can compute, whatever a world declares. Coverage is the world's choice among
// these; a world may leave one out, never add one the engine has no rule for. Properties are open:
// `integrity`, `residue` and `pos` are computed, and any other property name is read from the
// entity's own props, so a world may cover any property it gives its entities.
// Frozen, because the checks read it: a caller cannot widen what the engine claims to compute.
export const ENGINE_CAPABILITIES = Object.freeze({
  relations: Object.freeze(["support", "contained_in", "location", "attached_to", "status", "near"] as const),
  senses: Object.freeze(["sight", "hearing", "smell", "touch"] as const),
  computed_properties: Object.freeze(["integrity", "residue", "pos"] as const),
});

export type Sense = (typeof ENGINE_CAPABILITIES.senses)[number];

export function computesRelation(name: string): boolean {
  return (ENGINE_CAPABILITIES.relations as readonly string[]).includes(name);
}

export function computesSense(name: string): boolean {
  return (ENGINE_CAPABILITIES.senses as readonly string[]).includes(name);
}

// The names a coverage declares that the engine cannot compute, in category then name order.
export function uncomputable(coverage: Coverage): { category: "relations" | "senses"; name: string }[] {
  return [
    ...[...coverage.relations].sort().filter((name) => !computesRelation(name)).map((name) => ({ category: "relations" as const, name })),
    ...[...coverage.senses].sort().filter((name) => !computesSense(name)).map((name) => ({ category: "senses" as const, name })),
  ];
}
