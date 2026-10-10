import { WorldError } from "../errors.js";
import type { Template } from "../templates.js";
import type { EntityOverrides } from "./spawn.js";

// What the architect may say about a thing in a scenario instead of a raw quantity: whole percentages
// of what the preset holds, and two named levels of condition. Each is converted once, here, to the
// one stored value (`fuel`, `liquid_amount` and `liquid_material`, `integrity`, `hunger`, `portions`),
// so a form is a second way to write a field and never a second stored field. Pure and integer.
export interface ArchitectForms {
  fuel_pct?: number;
  liquid?: { material?: string; pct: number };
  // "intact" or "damaged"; anything else is refused invalid_form.
  condition?: string;
  hunger_pct?: number;
  portions_pct?: number;
}

export const FORM_KEYS = ["fuel_pct", "liquid", "condition", "hunger_pct", "portions_pct"] as const;

export function hasForms(overrides: object): boolean {
  return FORM_KEYS.some((key) => key in overrides);
}

function fail(code: "invalid_form" | "form_not_applicable" | "no_liquid_material", index: number, what: string): never {
  throw new WorldError(code, `Scenario entry ${index}: ${what}`);
}

function wholePercent(value: unknown, index: number, form: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100) {
    fail("invalid_form", index, `${form} must be a whole number from 0 to 100`);
  }
  return value;
}

// A percentage of what the preset holds, floored, except that one above 0 never comes to 0: a
// candle's 8 fuel at 10% is 1, so it still lights.
export function share(whole: number, percent: number): number {
  const part = Math.floor((whole * percent) / 100);
  return percent > 0 ? Math.max(part, 1) : part;
}

function presetInteger(template: Template, prop: string, index: number, form: string): number {
  const value = template.props[prop];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("form_not_applicable", index, `${form} needs a template that declares ${prop}, and ${template.id} does not`);
  }
  return value;
}

// The overrides with every form converted away. A scenario entry is checked by `architectWrites`
// first, so no raw prop a form converts to is beside it: one fact is written one way.
export function applyForms(template: Template, overrides: EntityOverrides & ArchitectForms, index: number): EntityOverrides {
  const { fuel_pct, liquid, condition, hunger_pct, portions_pct, ...rest } = overrides;
  const props: Record<string, number | string | boolean> = { ...rest.props };
  const result: EntityOverrides = { ...rest };
  const write = (prop: string, value: number | string): void => {
    props[prop] = value;
  };

  if (fuel_pct !== undefined) {
    const percent = wholePercent(fuel_pct, index, "fuel_pct");
    write("fuel", share(presetInteger(template, "fuel", index, "fuel_pct"), percent));
  }
  if (liquid !== undefined) {
    if (liquid === null || typeof liquid !== "object" || Object.keys(liquid).some((key) => key !== "material" && key !== "pct")) {
      fail("invalid_form", index, "liquid must be { material?, pct }");
    }
    const percent = wholePercent(liquid.pct, index, "liquid.pct");
    if (liquid.material !== undefined && (typeof liquid.material !== "string" || liquid.material === "")) {
      fail("invalid_form", index, "liquid.material must be a non-empty string");
    }
    const capacity = presetInteger(template, "capacity_cm3", index, "liquid");
    const material = liquid.material ?? template.props.liquid_material;
    if (percent > 0 && (typeof material !== "string" || material === "")) {
      fail("no_liquid_material", index, `liquid at ${percent}% names no material and ${template.id} holds none`);
    }
    write("liquid_amount", share(capacity, percent));
    write("liquid_material", percent === 0 ? "" : (material as string));
  }
  if (condition !== undefined) {
    if (condition !== "intact" && condition !== "damaged") {
      fail("invalid_form", index, "condition must be intact or damaged");
    }
    result.integrity = condition === "intact" ? 100 : 50;
  }
  if (hunger_pct !== undefined) {
    presetInteger(template, "hunger", index, "hunger_pct");
    write("hunger", wholePercent(hunger_pct, index, "hunger_pct"));
  }
  if (portions_pct !== undefined) {
    const percent = wholePercent(portions_pct, index, "portions_pct");
    write("portions", share(presetInteger(template, "portions", index, "portions_pct"), percent));
  }
  if (Object.keys(props).length > 0) {
    result.props = props;
  }
  return result;
}

// What a scenario entry may write besides the forms: placement, a name, aliases, traits and the
// plain state values below. Everything else is the world author's (an edit) or the template's: a raw
// quantity, a part, a status, residue, a definition. Props read as state elsewhere (`fields.ts`), but
// these are the ones a scene needs said in plain terms: a door open, a lamp lit, a link.
const ARCHITECT_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "aliases",
  "traits",
  "location",
  "support",
  "contained_in",
  "in_part",
  "concealed_by",
  "pos",
  ...FORM_KEYS,
]);
const ARCHITECT_PROPS: ReadonlySet<string> = new Set(["open", "locked", "burning", "lit", "from", "to", "opens", "powered_by", "controlled_by"]);

// The first field or prop (`props.<name>`) of a scenario entry's overrides the architect may not
// write, or null. Run on the entry as written, before the forms become the raw props they convert to.
export function architectWrites(overrides: object): string | null {
  for (const key of Object.keys(overrides)) {
    if (!ARCHITECT_FIELDS.has(key) && key !== "props") {
      return key;
    }
  }
  const props = (overrides as { props?: unknown }).props;
  if (props !== null && typeof props === "object") {
    for (const name of Object.keys(props)) {
      if (!ARCHITECT_PROPS.has(name)) {
        return `props.${name}`;
      }
    }
  }
  return null;
}
