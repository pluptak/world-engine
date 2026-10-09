import type { Entity } from "../model.js";

// Who may write a field: `definition` the template author only, `state` the world author (the
// architect only through a form, none declared yet), `derived` the engine only.
export type Tier = "definition" | "state" | "derived";

// `id` is a string naming an entity; templates name none, a scenario or an edit does.
export type PropType = "boolean" | "integer" | "string" | "id";

export interface PropField {
  type: PropType;
  tier: Tier;
  // Props a template must declare beside this one.
  requires?: readonly string[];
}

// Every prop the engine reads. A prop no code reads is declared by its template under `fields`.
export const PROP_FIELDS: Readonly<Record<string, PropField>> = {
  abstract: { type: "boolean", tier: "definition" },
  agent: { type: "boolean", tier: "definition" },
  attack_damage: { type: "integer", tier: "definition" },
  barrier: { type: "boolean", tier: "definition" },
  bite_damage: { type: "integer", tier: "definition" },
  bleed_damage: { type: "integer", tier: "definition" },
  bleed_every_ticks: { type: "integer", tier: "definition" },
  bleed_times: { type: "integer", tier: "definition" },
  break_fall_cm: { type: "integer", tier: "definition" },
  burning: { type: "boolean", tier: "state", requires: ["light_source"] },
  carry_limit_g: { type: "integer", tier: "definition" },
  closes_after: { type: "integer", tier: "definition", requires: ["openable"] },
  container: { type: "boolean", tier: "definition", requires: ["inner_w_cm", "inner_d_cm", "inner_h_cm"] },
  default_hit_part: { type: "string", tier: "definition" },
  from: { type: "id", tier: "state", requires: ["openable"] },
  fuel: { type: "integer", tier: "state", requires: ["light_source"] },
  gap_cm: { type: "integer", tier: "definition", requires: ["barrier"] },
  hand_height_cm: { type: "integer", tier: "definition" },
  hands_required: { type: "integer", tier: "definition" },
  hunger: { type: "integer", tier: "state" },
  inner_d_cm: { type: "integer", tier: "definition" },
  inner_h_cm: { type: "integer", tier: "definition" },
  inner_w_cm: { type: "integer", tier: "definition" },
  light_source: { type: "boolean", tier: "definition" },
  liquid_amount: { type: "integer", tier: "state" },
  liquid_material: { type: "string", tier: "state" },
  liquid_nutrition: { type: "integer", tier: "definition" },
  lit: { type: "boolean", tier: "state" },
  locked: { type: "boolean", tier: "state", requires: ["openable"] },
  nutrition: { type: "integer", tier: "definition" },
  open: { type: "boolean", tier: "state", requires: ["openable"] },
  openable: { type: "boolean", tier: "definition" },
  opens: { type: "id", tier: "state" },
  portions: { type: "integer", tier: "state" },
  reach_cm: { type: "integer", tier: "definition" },
  rubble: { type: "boolean", tier: "definition" },
  surface: { type: "boolean", tier: "definition" },
  to: { type: "id", tier: "state", requires: ["openable"] },
  topples: { type: "boolean", tier: "definition" },
};

// Every field of an entity besides `props`, by who may write it. Placement is state; the location
// the engine keeps in step with it is derived. `status` and `detached_from` are state: a corpse or a
// severed limb is a state the world can reach, so the world author may place one.
export const ENTITY_FIELDS: Readonly<Record<Exclude<keyof Entity, "props">, Tier>> = {
  id: "derived",
  template: "definition",
  name: "state",
  aliases: "state",
  location: "derived",
  support: "state",
  contained_in: "state",
  in_part: "state",
  concealed_by: "state",
  pos: "state",
  detached_from: "state",
  integrity: "state",
  status: "state",
  parts: "state",
  residue: "state",
  modifiers: "derived",
};

export function propTypeMatches(type: PropType, value: number | string | boolean): boolean {
  switch (type) {
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "string":
    case "id":
      return typeof value === "string";
  }
}
