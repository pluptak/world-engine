import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { canonicalJson } from "./engine/canonical.js";

export type HoldsDecl = { kind: "grip" } | { kind: "space"; inner_w_cm: number; inner_d_cm: number; inner_h_cm: number };

export interface PartDecl {
  name: string;
  parent: string | null;
  contributes: Record<string, number>;
  detachable: boolean;
  max_integrity: number;
  holds?: HoldsDecl;
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

// What a template file declares before its parent is folded in: every field except `id` may be
// absent, and an absent field is what inheritance fills in.
interface TemplateDecl {
  id: string;
  extends: string | null;
  size_cm?: { w: number; d: number; h: number };
  mass_g?: number;
  parts?: PartDecl[];
  props?: Record<string, number | string | boolean>;
  break_products?: { template: string; count: number }[];
  break_residue?: Record<string, number>;
}

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

function parseDecl(value: unknown, source: string): TemplateDecl {
  if (!isRecord(value)) {
    throw new TypeError(`${source} must contain a template object`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new TypeError(`${source} has an invalid id`);
  }
  if (
    value.extends !== undefined &&
    (typeof value.extends !== "string" || value.extends.length === 0)
  ) {
    throw new TypeError(`${source}.extends must be a non-empty string`);
  }

  const decl: TemplateDecl = { id: value.id, extends: value.extends ?? null };

  if (Object.hasOwn(value, "size_cm")) {
    if (!isRecord(value.size_cm)) {
      throw new TypeError(`${source}.size_cm must be an object`);
    }
    for (const dimension of ["w", "d", "h"] as const) {
      assertNumber(value.size_cm[dimension], `${source}.size_cm.${dimension}`);
    }
    decl.size_cm = {
      w: value.size_cm.w as number,
      d: value.size_cm.d as number,
      h: value.size_cm.h as number,
    };
  }

  if (Object.hasOwn(value, "mass_g")) {
    assertNumber(value.mass_g, `${source}.mass_g`);
    decl.mass_g = value.mass_g;
  }

  if (Object.hasOwn(value, "parts")) {
    if (!Array.isArray(value.parts)) {
      throw new TypeError(`${source}.parts must be an array`);
    }
    decl.parts = value.parts.map((part, index): PartDecl => {
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
        ...parseHolds(part.holds, label),
      };
    });
  }

  if (Object.hasOwn(value, "props")) {
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
    decl.props = { ...value.props } as TemplateDecl["props"];
  }

  if (Object.hasOwn(value, "break_products")) {
    if (!Array.isArray(value.break_products)) {
      throw new TypeError(`${source}.break_products must be an array`);
    }
    decl.break_products = value.break_products.map((product, index) => {
      const label = `${source}.break_products[${index}]`;
      if (!isRecord(product) || typeof product.template !== "string") {
        throw new TypeError(`${label} must contain a template id`);
      }
      assertNumber(product.count, `${label}.count`);
      return { template: product.template, count: product.count };
    });
  }

  if (Object.hasOwn(value, "break_residue")) {
    assertNumericRecord(value.break_residue, `${source}.break_residue`);
    decl.break_residue = { ...value.break_residue };
  }

  return decl;
}

function parseHolds(value: unknown, label: string): { holds?: HoldsDecl } {
  if (value === undefined) {
    return {};
  }
  const holdsLabel = `${label}.holds`;
  if (!isRecord(value) || (value.kind !== "grip" && value.kind !== "space")) {
    throw new TypeError(`${holdsLabel} must declare kind "grip" or "space"`);
  }
  if (value.kind === "grip") {
    if (!Object.keys(value).every((key) => key === "kind")) {
      throw new TypeError(`${holdsLabel} carries only its kind`);
    }
    return { holds: { kind: "grip" } };
  }
  for (const dimension of ["inner_w_cm", "inner_d_cm", "inner_h_cm"] as const) {
    assertNumber(value[dimension], `${holdsLabel}.${dimension}`);
  }
  if (!Object.keys(value).every((key) => key === "kind" || key.startsWith("inner_"))) {
    throw new TypeError(`${holdsLabel} carries only its kind and inner dimensions`);
  }
  return {
    holds: {
      kind: "space",
      inner_w_cm: value.inner_w_cm as number,
      inner_d_cm: value.inner_d_cm as number,
      inner_h_cm: value.inner_h_cm as number,
    },
  };
}

// Inherited containers are never shared with a caller: each template's merge base is rebuilt from
// the declarations here, and a declared list is copied into the resolved template.
function copyParts(parts: readonly PartDecl[]): PartDecl[] {
  return parts.map((part) => ({
    ...part,
    contributes: { ...part.contributes },
    ...(part.holds !== undefined && { holds: { ...part.holds } }),
  }));
}

function requireResolved(decl: TemplateDecl, source: string): Template {
  const missing = ["size_cm", "mass_g", "parts", "props", "break_products", "break_residue"].filter(
    (field) => decl[field as keyof TemplateDecl] === undefined,
  );
  if (missing.length > 0) {
    throw new TypeError(`${source} declares no ${missing.join(" or ")} and extends nothing`);
  }

  return {
    id: decl.id,
    size_cm: { ...decl.size_cm! },
    mass_g: decl.mass_g!,
    parts: copyParts(decl.parts!),
    props: { ...decl.props! },
    break_products: decl.break_products!.map((product) => ({ ...product })),
    break_residue: { ...decl.break_residue! },
  };
}

// The child's own field wins, props are shallow-merged over the parent's, and parts are replaced
// rather than merged: a child that declares parts declares the whole part tree it has.
function overParent(parent: Template, decl: TemplateDecl): Template {
  return {
    id: decl.id,
    size_cm: decl.size_cm === undefined ? parent.size_cm : { ...decl.size_cm },
    mass_g: decl.mass_g ?? parent.mass_g,
    parts: decl.parts === undefined ? parent.parts : copyParts(decl.parts),
    props: { ...parent.props, ...decl.props },
    break_products:
      decl.break_products === undefined
        ? parent.break_products
        : decl.break_products.map((product) => ({ ...product })),
    break_residue:
      decl.break_residue === undefined
        ? parent.break_residue
        : { ...decl.break_residue },
  };
}

// The ids from a template up to its root, child first. A cycle or a parent no template declares is
// refused here, with the chain that produced it, before any field is merged.
function ancestry(id: string, decls: ReadonlyMap<string, TemplateDecl>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current !== null) {
    if (seen.has(current)) {
      throw new TypeError(`Template extends cycle: ${[...chain, current].join(" -> ")}`);
    }
    const decl = decls.get(current);
    if (decl === undefined) {
      throw new TypeError(`Template extends unknown parent: ${[...chain, current].join(" -> ")}`);
    }
    seen.add(current);
    chain.push(current);
    current = decl.extends;
  }
  return chain;
}

// Resolution happens once, here: everything downstream sees a set with no `extends` in it, so the
// hash, a world's frozen templates.json and upgradeTemplates never have to know a parent existed.
function resolveTemplates(
  decls: ReadonlyMap<string, TemplateDecl>,
  sources: ReadonlyMap<string, string>,
): TemplateRegistry {
  const registry: TemplateRegistry = {};
  for (const id of [...decls.keys()].sort()) {
    const chain = ancestry(id, decls);
    const rootId = chain[chain.length - 1]!;
    let template = requireResolved(decls.get(rootId)!, sources.get(rootId) ?? rootId);
    for (const chainId of chain.slice(0, -1).reverse()) {
      template = overParent(template, decls.get(chainId)!);
    }
    validateParts(template, sources.get(id) ?? id);
    registry[id] = template;
  }

  assertMissingCompanions(registry);
  return registry;
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

export function missingCompanions(registry: TemplateRegistry): string[] {
  const missing: string[] = [];
  for (const template of Object.values(registry)) {
    for (const part of template.parts) {
      if (part.detachable) {
        const companionId = `${template.id}.${part.name}`;
        if (!Object.hasOwn(registry, companionId)) {
          missing.push(companionId);
        }
      }
    }
  }
  return missing.sort();
}

function assertMissingCompanions(registry: TemplateRegistry): void {
  const missing = missingCompanions(registry);
  if (missing.length > 0) {
    const [first] = missing;
    throw new TypeError(`Missing detached part template ${first}`);
  }
}

export function loadTemplates(dir: string): TemplateRegistry {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  const decls = new Map<string, TemplateDecl>();
  const sources = new Map<string, string>();

  for (const file of files) {
    const path = join(dir, file);
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const decl = parseDecl(parsed, file);
    if (decls.has(decl.id)) {
      throw new TypeError(`Duplicate template id ${decl.id}`);
    }
    decls.set(decl.id, decl);
    sources.set(decl.id, file);
  }

  return resolveTemplates(decls, sources);
}

// The same validation for a whole set read as one object rather than a directory of files: a key
// that disagrees with the id inside it is a rename the caller did not ask for.
export function parseRegistry(value: unknown, source = "templates.json"): TemplateRegistry {
  if (!isRecord(value)) {
    throw new TypeError(`${source} must contain a template object`);
  }
  const decls = new Map<string, TemplateDecl>();
  const sources = new Map<string, string>();

  for (const id of Object.keys(value).sort()) {
    const decl = parseDecl(value[id], `${source}#${id}`);
    if (decl.id !== id) {
      throw new TypeError(`${source}#${id} declares id ${decl.id}`);
    }
    decls.set(id, decl);
    sources.set(id, `${source}#${id}`);
  }

  return resolveTemplates(decls, sources);
}

const hashCache = new WeakMap<TemplateRegistry, string>();

export function templatesHash(registry: TemplateRegistry): string {
  const cached = hashCache.get(registry);
  if (cached !== undefined) {
    return cached;
  }
  const hash = createHash("sha256").update(canonicalJson(registry)).digest("hex");
  hashCache.set(registry, hash);
  return hash;
}
