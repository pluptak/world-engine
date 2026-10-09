import type { Template, TemplateRegistry } from "../templates.js";
import { share } from "./forms.js";

// What the architect may pick and say about it: each preset's shown definition and the forms a
// scenario entry may use on it, with their defaults (what the entry means when it leaves one out).
// Tuning (reach, damage, process timing, hit parts) is not shown. Pure, and a function of the
// template set alone, so a caller can read it before any world exists.
export interface CatalogForms {
  // Present when the preset declares `fuel`; the default is all of it.
  fuel_pct?: number;
  // Present when the preset declares `capacity_cm3`: the material it holds (null when none) and how
  // full it starts.
  liquid?: { material: string | null; pct: number };
  condition: "intact";
  // Present when the preset declares `hunger`; the default is the figure it starts at.
  hunger_pct?: number;
  // Present when the preset declares `portions`; the default is all of them.
  portions_pct?: number;
  // The forms whose listed default places something other than leaving the form out: a liquid that
  // is no whole percentage of the capacity, a hunger above what `hunger_pct` can say. Absent when none.
  approximate?: ("liquid" | "hunger_pct")[];
}

export interface CatalogEntry {
  template: string;
  size_cm: { w: number; d: number; h: number };
  mass_g: number;
  container: boolean;
  surface: boolean;
  openable: boolean;
  barrier: boolean;
  light_source: boolean;
  agent: boolean;
  capacity_cm3?: number;
  // Part names, in the template's order.
  parts: string[];
  // What the parts add up to, by capacity (sight, manipulation, ...).
  capacities: Record<string, number>;
  // The templates it breaks into, each once, in the order it declares them.
  breaks_into: string[];
  forms: CatalogForms;
}

// A detachable part's own template is `<template>.<part>`, itself a template (and so its parts have
// theirs): it exists to be spawned when the part comes off, and the architect never picks it.
function companions(registry: TemplateRegistry): Set<string> {
  const found = new Set<string>();
  for (const template of Object.values(registry)) {
    for (const part of template.parts) {
      const id = `${template.id}.${part.name}`;
      if (part.detachable && Object.hasOwn(registry, id)) {
        found.add(id);
      }
    }
  }
  return found;
}

function integerProp(template: Template, name: string): number | undefined {
  const value = template.props[name];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function formsOf(template: Template): CatalogForms {
  const forms: CatalogForms = { condition: "intact" };
  const approximate: ("liquid" | "hunger_pct")[] = [];
  if (integerProp(template, "fuel") !== undefined) {
    forms.fuel_pct = 100;
  }
  const capacity = integerProp(template, "capacity_cm3");
  if (capacity !== undefined) {
    const amount = integerProp(template, "liquid_amount") ?? 0;
    const material = template.props.liquid_material;
    const pct = Math.min(100, Math.floor((amount * 100) / capacity));
    forms.liquid = { material: typeof material === "string" && material !== "" ? material : null, pct };
    // Judged by what placing the listed pct stores, so the floor and the never-0 rule count.
    if (share(capacity, pct) !== amount) {
      approximate.push("liquid");
    }
  }
  const hunger = integerProp(template, "hunger");
  if (hunger !== undefined) {
    forms.hunger_pct = Math.min(hunger, 100);
    if (hunger > 100) {
      approximate.push("hunger_pct");
    }
  }
  if (integerProp(template, "portions") !== undefined) {
    forms.portions_pct = 100;
  }
  if (approximate.length > 0) {
    forms.approximate = approximate;
  }
  return forms;
}

function entryOf(template: Template): CatalogEntry {
  const capacities: Record<string, number> = {};
  for (const part of template.parts) {
    for (const [capacity, amount] of Object.entries(part.contributes)) {
      capacities[capacity] = (capacities[capacity] ?? 0) + amount;
    }
  }
  const capacity = integerProp(template, "capacity_cm3");
  return {
    template: template.id,
    size_cm: { ...template.size_cm },
    mass_g: template.mass_g,
    container: template.props.container === true,
    surface: template.props.surface === true,
    openable: template.props.openable === true,
    barrier: template.props.barrier === true,
    light_source: template.props.light_source === true,
    agent: template.props.agent === true,
    ...(capacity !== undefined && { capacity_cm3: capacity }),
    parts: template.parts.map((part) => part.name),
    capacities,
    breaks_into: [...new Set(template.break_products.filter((product) => product.count > 0).map((product) => product.template))],
    forms: formsOf(template),
  };
}

// Every pickable preset by template id: all but the companions of detachable parts and the bases a
// template set marks `"catalog": false`.
export function catalogOf(registry: TemplateRegistry): CatalogEntry[] {
  const hidden = companions(registry);
  return Object.keys(registry)
    .sort()
    .filter((id) => !hidden.has(id) && registry[id]!.catalog !== false)
    .map((id) => entryOf(registry[id]!));
}
