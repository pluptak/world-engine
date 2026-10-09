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
function share(whole: number, percent: number): number {
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

// The overrides with every form converted away. A form beside the raw field it converts to is
// refused: one fact is written one way.
export function applyForms(template: Template, overrides: EntityOverrides & ArchitectForms, index: number): EntityOverrides {
  const { fuel_pct, liquid, condition, hunger_pct, portions_pct, ...rest } = overrides;
  const props: Record<string, number | string | boolean> = { ...rest.props };
  const result: EntityOverrides = { ...rest };
  const write = (prop: string, value: number | string, form: string): void => {
    if (Object.hasOwn(props, prop)) {
      fail("invalid_form", index, `${form} and props.${prop} both write ${prop}`);
    }
    props[prop] = value;
  };

  if (fuel_pct !== undefined) {
    const percent = wholePercent(fuel_pct, index, "fuel_pct");
    write("fuel", share(presetInteger(template, "fuel", index, "fuel_pct"), percent), "fuel_pct");
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
    write("liquid_amount", share(capacity, percent), "liquid");
    write("liquid_material", percent === 0 ? "" : (material as string), "liquid");
  }
  if (condition !== undefined) {
    if (condition !== "intact" && condition !== "damaged") {
      fail("invalid_form", index, "condition must be intact or damaged");
    }
    if (result.integrity !== undefined) {
      fail("invalid_form", index, "condition and integrity both write integrity");
    }
    result.integrity = condition === "intact" ? 100 : 50;
  }
  if (hunger_pct !== undefined) {
    presetInteger(template, "hunger", index, "hunger_pct");
    write("hunger", wholePercent(hunger_pct, index, "hunger_pct"), "hunger_pct");
  }
  if (portions_pct !== undefined) {
    const percent = wholePercent(portions_pct, index, "portions_pct");
    write("portions", share(presetInteger(template, "portions", index, "portions_pct"), percent), "portions_pct");
  }
  if (Object.keys(props).length > 0) {
    result.props = props;
  }
  return result;
}
