import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { canonicalJson } from "./engine/canonical.js";

export interface PartDecl {
  name: string;
  parent: string | null;
  contributes: Record<string, number>;
  detachable: boolean;
  max_integrity: number;
}

export interface Template {
  id: string;
  size_cm: { w: number; d: number; h: number };
  mass_g: number;
  parts: PartDecl[];
  props: Record<string, number | string | boolean>;
  break_products: { template: string; count: number }[];
  break_residue: Record<string, number>;
}

export type TemplateRegistry = Record<string, Template>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
}

function assertNumericRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, number> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  for (const [key, number] of Object.entries(value)) {
    assertNumber(number, `${label}.${key}`);
  }
}

function parseTemplate(value: unknown, source: string): Template {
  if (!isRecord(value)) {
    throw new TypeError(`${source} must contain a template object`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new TypeError(`${source} has an invalid id`);
  }
  if (!isRecord(value.size_cm)) {
    throw new TypeError(`${source}.size_cm must be an object`);
  }
  for (const dimension of ["w", "d", "h"] as const) {
    assertNumber(value.size_cm[dimension], `${source}.size_cm.${dimension}`);
  }
  assertNumber(value.mass_g, `${source}.mass_g`);
  if (!Array.isArray(value.parts)) {
    throw new TypeError(`${source}.parts must be an array`);
  }
  if (!isRecord(value.props)) {
    throw new TypeError(`${source}.props must be an object`);
  }
  for (const [key, prop] of Object.entries(value.props)) {
    if (
      typeof prop !== "string" &&
      typeof prop !== "number" &&
      typeof prop !== "boolean"
    ) {
      throw new TypeError(`${source}.props.${key} must be a primitive`);
    }
  }
  if (!Array.isArray(value.break_products)) {
    throw new TypeError(`${source}.break_products must be an array`);
  }
  assertNumericRecord(value.break_residue, `${source}.break_residue`);

  const parts = value.parts.map((part, index): PartDecl => {
    const label = `${source}.parts[${index}]`;
    if (!isRecord(part)) {
      throw new TypeError(`${label} must be an object`);
    }
    if (typeof part.name !== "string" || part.name.length === 0) {
      throw new TypeError(`${label}.name must be a non-empty string`);
    }
    if (part.parent !== null && typeof part.parent !== "string") {
      throw new TypeError(`${label}.parent must be a string or null`);
    }
    assertNumericRecord(part.contributes, `${label}.contributes`);
    if (typeof part.detachable !== "boolean") {
      throw new TypeError(`${label}.detachable must be a boolean`);
    }
    assertNumber(part.max_integrity, `${label}.max_integrity`);
    return {
      name: part.name,
      parent: part.parent,
      contributes: { ...part.contributes },
      detachable: part.detachable,
      max_integrity: part.max_integrity,
    };
  });

  const breakProducts = value.break_products.map((product, index) => {
    const label = `${source}.break_products[${index}]`;
    if (!isRecord(product) || typeof product.template !== "string") {
      throw new TypeError(`${label} must contain a template id`);
    }
    assertNumber(product.count, `${label}.count`);
    return { template: product.template, count: product.count };
  });

  const template: Template = {
    id: value.id,
    size_cm: {
      w: value.size_cm.w as number,
      d: value.size_cm.d as number,
      h: value.size_cm.h as number,
    },
    mass_g: value.mass_g,
    parts,
    props: { ...value.props } as Template["props"],
    break_products: breakProducts,
    break_residue: { ...value.break_residue },
  };

  validateParts(template, source);
  return template;
}

function validateParts(template: Template, source: string): void {
  const parts = new Map<string, PartDecl>();
  for (const part of template.parts) {
    if (parts.has(part.name)) {
      throw new TypeError(`${source} has duplicate part ${part.name}`);
    }
    parts.set(part.name, part);
  }

  for (const part of template.parts) {
    if (part.parent !== null && !parts.has(part.parent)) {
      throw new TypeError(`${source} part ${part.name} has missing parent ${part.parent}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visiting.has(name)) {
      throw new TypeError(`${source} has a part cycle at ${name}`);
    }
    if (visited.has(name)) {
      return;
    }

    visiting.add(name);
    const parent = parts.get(name)?.parent;
    if (parent !== null && parent !== undefined) {
      visit(parent);
    }
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of [...parts.keys()].sort()) {
    visit(name);
  }
}

export function loadTemplates(dir: string): TemplateRegistry {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  const registry: TemplateRegistry = {};

  for (const file of files) {
    const path = join(dir, file);
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const template = parseTemplate(parsed, file);
    if (Object.hasOwn(registry, template.id)) {
      throw new TypeError(`Duplicate template id ${template.id}`);
    }
    registry[template.id] = template;
  }

  return registry;
}

export function templatesHash(registry: TemplateRegistry): string {
  return createHash("sha256").update(canonicalJson(registry)).digest("hex");
}
