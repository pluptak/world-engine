import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { canonicalJson } from "./engine/canonical.js";
import { PROP_FIELDS, propTypeMatches, type PropType, type Tier } from "./engine/fields.js";

export type HoldsDecl = { kind: "grip" } | { kind: "space"; inner_w_cm: number; inner_d_cm: number; inner_h_cm: number };

export interface PartDecl {
  name: string;
  parent: string | null;
  contributes: Record<string, number>;
  detachable: boolean;
  max_integrity: number;
  holds?: HoldsDecl;
}

export type ProcessOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte";

// Something a thing does by itself while a condition on its props holds: every `every_ticks`, move
// the integer prop `adjust_prop.prop` by `by`, stopping at `min` or `max` when given.
export interface ProcessDecl {
  id: string;
  every_ticks: number;
  // A prop of the entity that, when it is a positive integer, is the delay instead of `every_ticks`.
  every_ticks_prop?: string;
  // The chance, from 1 to 99, that a run takes effect; a run rolls the world's dice, so it needs a seed.
  chance_pct?: number;
  while?: { prop: string; op: ProcessOp; value: number | string | boolean };
  effect: { adjust_prop: { prop: string; by: number; min?: number; max?: number } };
  // Once, when a run brings the prop to the bound it was moving toward.
  then?: ProcessThen;
}

export type ProcessThen =
  | { set_prop: { prop: string; value: number | string | boolean } }
  | { damage: { amount: number } }
  | { remove: true }
  // The entity is used up: it leaves its `spent_products` and `spent_residue` where it stood, then goes.
  | { spent: true };

// A prop no engine code reads, declared by the template that uses it: its type and who may write it.
export interface FieldDecl {
  tier: Exclude<Tier, "derived">;
  type: Exclude<PropType, "id">;
}

export interface Template {
  id: string;
  size_cm: { w: number; d: number; h: number };
  mass_g: number;
  parts: PartDecl[];
  props: Record<string, number | string | boolean>;
  break_products: { template: string; count: number }[];
  break_residue: Record<string, number>;
  // What being used up leaves behind, as breaking leaves its products and residue. Absent when empty, so a
  // template that leaves nothing hashes as it always did.
  spent_products?: { template: string; count: number }[];
  spent_residue?: Record<string, number>;
  // Absent when a template declares none, so a template without processes hashes as it always did.
  processes?: ProcessDecl[];
  // Absent when none is declared, as processes are.
  fields?: Record<string, FieldDecl>;
  // `false` for a base the architect is not offered (the catalogue view); absent otherwise. A template's
  // own, never inherited: a child of such a base is offered.
  catalog?: false;
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
  spent_products?: { template: string; count: number }[];
  spent_residue?: Record<string, number>;
  processes?: ProcessDecl[];
  fields?: Record<string, FieldDecl>;
  catalog?: boolean;
  // Fields of inherited parts, by name; consumed when the template is resolved, so no key survives it.
  part_overrides?: Record<string, PartOverride>;
}

// What a template may change of an inherited part: any field but its name.
type PartOverride = Partial<Omit<PartDecl, "name">>;

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

  if (Object.hasOwn(value, "part_overrides")) {
    if (Object.hasOwn(value, "parts")) {
      throw new TypeError(`${source} declares both parts and part_overrides`);
    }
    decl.part_overrides = parsePartOverrides(value.part_overrides, `${source}.part_overrides`);
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
      assertInteger(product.count, `${label}.count`);
      if (product.count < 0) {
        throw new TypeError(`${label}.count must not be negative`);
      }
      return { template: product.template, count: product.count };
    });
  }

  if (Object.hasOwn(value, "break_residue")) {
    assertNumericRecord(value.break_residue, `${source}.break_residue`);
    decl.break_residue = { ...value.break_residue };
  }

  if (Object.hasOwn(value, "spent_products")) {
    if (!Array.isArray(value.spent_products)) {
      throw new TypeError(`${source}.spent_products must be an array`);
    }
    decl.spent_products = value.spent_products.map((product, index) => {
      const label = `${source}.spent_products[${index}]`;
      if (!isRecord(product) || typeof product.template !== "string") {
        throw new TypeError(`${label} must contain a template id`);
      }
      assertOnlyKeys(product, ["template", "count"], label);
      assertInteger(product.count, `${label}.count`);
      if (product.count < 0) {
        throw new TypeError(`${label}.count must not be negative`);
      }
      return { template: product.template, count: product.count };
    });
  }

  if (Object.hasOwn(value, "spent_residue")) {
    assertNumericRecord(value.spent_residue, `${source}.spent_residue`);
    decl.spent_residue = { ...value.spent_residue };
  }

  if (Object.hasOwn(value, "processes")) {
    decl.processes = parseProcesses(value.processes, `${source}.processes`);
  }

  if (Object.hasOwn(value, "fields")) {
    decl.fields = parseFields(value.fields, `${source}.fields`);
  }

  if (Object.hasOwn(value, "catalog")) {
    if (typeof value.catalog !== "boolean") {
      throw new TypeError(`${source}.catalog must be a boolean`);
    }
    decl.catalog = value.catalog;
  }

  return decl;
}

function parsePartOverrides(value: unknown, label: string): Record<string, PartOverride> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const overrides: Record<string, PartOverride> = {};
  for (const [name, part] of Object.entries(value)) {
    const at = `${label}.${name}`;
    if (!isRecord(part)) {
      throw new TypeError(`${at} must be an object`);
    }
    assertOnlyKeys(part, ["parent", "contributes", "detachable", "max_integrity", "holds"], at);
    const override: PartOverride = {};
    if (Object.hasOwn(part, "parent")) {
      if (part.parent !== null && typeof part.parent !== "string") {
        throw new TypeError(`${at}.parent must be a string or null`);
      }
      override.parent = part.parent;
    }
    if (Object.hasOwn(part, "contributes")) {
      assertNumericRecord(part.contributes, `${at}.contributes`);
      override.contributes = { ...part.contributes };
    }
    if (Object.hasOwn(part, "detachable")) {
      if (typeof part.detachable !== "boolean") {
        throw new TypeError(`${at}.detachable must be a boolean`);
      }
      override.detachable = part.detachable;
    }
    if (Object.hasOwn(part, "max_integrity")) {
      assertNumber(part.max_integrity, `${at}.max_integrity`);
      override.max_integrity = part.max_integrity;
    }
    Object.assign(override, parseHolds(part.holds, at));
    overrides[name] = override;
  }
  return overrides;
}

function parseFields(value: unknown, label: string): Record<string, FieldDecl> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const fields: Record<string, FieldDecl> = {};
  for (const [name, field] of Object.entries(value)) {
    const at = `${label}.${name}`;
    if (Object.hasOwn(PROP_FIELDS, name)) {
      throw new TypeError(`${at} is a prop the engine declares`);
    }
    if (!isRecord(field)) {
      throw new TypeError(`${at} must be an object`);
    }
    assertOnlyKeys(field, ["tier", "type"], at);
    if (field.tier !== "definition" && field.tier !== "state") {
      throw new TypeError(`${at}.tier must be definition or state`);
    }
    if (field.type !== "boolean" && field.type !== "integer" && field.type !== "string") {
      throw new TypeError(`${at}.type must be boolean, integer or string`);
    }
    fields[name] = { tier: field.tier, type: field.type };
  }
  return fields;
}

const PROCESS_OPS: readonly ProcessOp[] = ["eq", "ne", "lt", "lte", "gt", "gte"];

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const stray = Object.keys(value).find((key) => !allowed.includes(key));
  if (stray !== undefined) {
    throw new TypeError(`${label} has unknown field ${stray}`);
  }
}

function assertInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer`);
  }
}

function parseProcesses(value: unknown, label: string): ProcessDecl[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const seen = new Set<string>();
  return value.map((entry, index): ProcessDecl => {
    const at = `${label}[${index}]`;
    if (!isRecord(entry)) {
      throw new TypeError(`${at} must be an object`);
    }
    assertOnlyKeys(entry, ["id", "every_ticks", "every_ticks_prop", "chance_pct", "while", "effect", "then"], at);
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new TypeError(`${at}.id must be a non-empty string`);
    }
    if (seen.has(entry.id)) {
      throw new TypeError(`${label} declares process ${entry.id} twice`);
    }
    seen.add(entry.id);
    const named = `${label}.${entry.id}`;
    assertInteger(entry.every_ticks, `${named}.every_ticks`);
    if (entry.every_ticks < 1) {
      throw new TypeError(`${named}.every_ticks must be at least 1`);
    }
    const parsed: ProcessDecl = {
      id: entry.id,
      every_ticks: entry.every_ticks,
      effect: parseEffect(entry.effect, `${named}.effect`),
    };
    if (entry.every_ticks_prop !== undefined) {
      if (typeof entry.every_ticks_prop !== "string" || entry.every_ticks_prop.length === 0) {
        throw new TypeError(`${named}.every_ticks_prop must be a non-empty string`);
      }
      parsed.every_ticks_prop = entry.every_ticks_prop;
    }
    if (entry.chance_pct !== undefined) {
      assertInteger(entry.chance_pct, `${named}.chance_pct`);
      if (entry.chance_pct < 1 || entry.chance_pct > 99) {
        throw new TypeError(`${named}.chance_pct must be from 1 to 99`);
      }
      parsed.chance_pct = entry.chance_pct;
    }
    if (entry.while !== undefined) {
      const clause = entry.while;
      if (!isRecord(clause)) {
        throw new TypeError(`${named}.while must be an object`);
      }
      assertOnlyKeys(clause, ["prop", "op", "value"], `${named}.while`);
      if (typeof clause.prop !== "string" || clause.prop.length === 0) {
        throw new TypeError(`${named}.while.prop must be a non-empty string`);
      }
      if (!PROCESS_OPS.includes(clause.op as ProcessOp)) {
        throw new TypeError(`${named}.while.op must be one of ${PROCESS_OPS.join(", ")}`);
      }
      const wanted = clause.value;
      if (typeof wanted !== "string" && typeof wanted !== "number" && typeof wanted !== "boolean") {
        throw new TypeError(`${named}.while.value must be a primitive`);
      }
      if (clause.op !== "eq" && clause.op !== "ne" && typeof wanted !== "number") {
        throw new TypeError(`${named}.while.value must be a number for ${String(clause.op)}`);
      }
      parsed.while = { prop: clause.prop, op: clause.op as ProcessOp, value: wanted };
    }
    if (entry.then !== undefined) {
      const bound = parsed.effect.adjust_prop.by < 0 ? parsed.effect.adjust_prop.min : parsed.effect.adjust_prop.max;
      if (bound === undefined) {
        throw new TypeError(`${named}.then needs the bound the process moves toward (min for a negative by, max for a positive)`);
      }
      parsed.then = parseThen(entry.then, `${named}.then`);
    }
    return parsed;
  });
}

function parseThen(value: unknown, label: string): ProcessThen {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || !["set_prop", "damage", "remove", "spent"].includes(keys[0]!)) {
    throw new TypeError(`${label} must declare exactly one of set_prop, damage, remove or spent`);
  }
  if (keys[0] === "remove") {
    if (value.remove !== true) {
      throw new TypeError(`${label}.remove must be true`);
    }
    return { remove: true };
  }
  if (keys[0] === "spent") {
    if (value.spent !== true) {
      throw new TypeError(`${label}.spent must be true`);
    }
    return { spent: true };
  }
  if (keys[0] === "damage") {
    const damage = value.damage;
    if (!isRecord(damage)) {
      throw new TypeError(`${label}.damage must be an object`);
    }
    assertOnlyKeys(damage, ["amount"], `${label}.damage`);
    assertInteger(damage.amount, `${label}.damage.amount`);
    if (damage.amount < 1) {
      throw new TypeError(`${label}.damage.amount must be at least 1`);
    }
    return { damage: { amount: damage.amount } };
  }
  const set = value.set_prop;
  if (!isRecord(set)) {
    throw new TypeError(`${label}.set_prop must be an object`);
  }
  assertOnlyKeys(set, ["prop", "value"], `${label}.set_prop`);
  if (typeof set.prop !== "string" || set.prop.length === 0) {
    throw new TypeError(`${label}.set_prop.prop must be a non-empty string`);
  }
  if (typeof set.value !== "string" && typeof set.value !== "number" && typeof set.value !== "boolean") {
    throw new TypeError(`${label}.set_prop.value must be a primitive`);
  }
  return { set_prop: { prop: set.prop, value: set.value } };
}

function parseEffect(value: unknown, label: string): ProcessDecl["effect"] {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  assertOnlyKeys(value, ["adjust_prop"], label);
  const adjust = value.adjust_prop;
  if (!isRecord(adjust)) {
    throw new TypeError(`${label}.adjust_prop must be an object`);
  }
  assertOnlyKeys(adjust, ["prop", "by", "min", "max"], `${label}.adjust_prop`);
  if (typeof adjust.prop !== "string" || adjust.prop.length === 0) {
    throw new TypeError(`${label}.adjust_prop.prop must be a non-empty string`);
  }
  assertInteger(adjust.by, `${label}.adjust_prop.by`);
  if (adjust.by === 0) {
    throw new TypeError(`${label}.adjust_prop.by must not be 0`);
  }
  const result: { prop: string; by: number; min?: number; max?: number } = { prop: adjust.prop, by: adjust.by };
  for (const bound of ["min", "max"] as const) {
    if (adjust[bound] !== undefined) {
      assertInteger(adjust[bound], `${label}.adjust_prop.${bound}`);
      result[bound] = adjust[bound] as number;
    }
  }
  if (result.min !== undefined && result.max !== undefined && result.min > result.max) {
    throw new TypeError(`${label}.adjust_prop.min must not exceed max`);
  }
  return { adjust_prop: result };
}

function copyProcesses(processes: readonly ProcessDecl[]): ProcessDecl[] {
  return processes.map((decl) => ({
    ...decl,
    ...(decl.while !== undefined && { while: { ...decl.while } }),
    effect: { adjust_prop: { ...decl.effect.adjust_prop } },
    ...(decl.then !== undefined && { then: structuredClone(decl.then) }),
  }));
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
  if (decl.part_overrides !== undefined) {
    throw new TypeError(`${source} declares part_overrides and extends nothing`);
  }
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
    ...spentOf(decl.spent_products, decl.spent_residue),
    ...(decl.catalog === false && { catalog: false as const }),
    ...(decl.processes !== undefined && decl.processes.length > 0 && { processes: copyProcesses(decl.processes) }),
    ...(decl.fields !== undefined && Object.keys(decl.fields).length > 0 && { fields: copyFields(decl.fields) }),
  };
}

function copyFields(fields: Readonly<Record<string, FieldDecl>>): Record<string, FieldDecl> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, { ...field }]));
}

// The child's own field wins, props are shallow-merged over the parent's, and parts are replaced
// rather than merged: a child that declares parts declares the whole part tree it has.
function overParent(parent: Template, decl: TemplateDecl): Template {
  const processes = mergeProcesses(parent.processes ?? [], decl.processes ?? []);
  const fields = copyFields({ ...parent.fields, ...decl.fields });
  return {
    id: decl.id,
    size_cm: decl.size_cm === undefined ? parent.size_cm : { ...decl.size_cm },
    mass_g: decl.mass_g ?? parent.mass_g,
    parts: decl.parts !== undefined ? copyParts(decl.parts) : overriddenParts(parent.parts, decl),
    props: { ...parent.props, ...decl.props },
    break_products:
      decl.break_products === undefined
        ? parent.break_products
        : decl.break_products.map((product) => ({ ...product })),
    break_residue:
      decl.break_residue === undefined
        ? parent.break_residue
        : { ...decl.break_residue },
    ...spentOf(decl.spent_products ?? parent.spent_products, decl.spent_residue ?? parent.spent_residue),
    ...(decl.catalog === false && { catalog: false as const }),
    ...(processes.length > 0 && { processes }),
    ...(Object.keys(fields).length > 0 && { fields }),
  };
}

// The parent's parts with a child's `part_overrides` merged shallowly onto the part of each name: a
// field it gives replaces the parent's (a `contributes` as a whole), the rest is inherited. A name the
// parent has no part of is refused.
function overriddenParts(parts: readonly PartDecl[], decl: TemplateDecl): PartDecl[] {
  const overrides = decl.part_overrides;
  if (overrides === undefined) {
    return parts as PartDecl[];
  }
  for (const name of Object.keys(overrides)) {
    if (!parts.some((part) => part.name === name)) {
      throw new TypeError(`${decl.id} part_overrides names ${name}, which it inherits no part of`);
    }
  }
  return copyParts(parts).map((part) => {
    const override = Object.hasOwn(overrides, part.name) ? overrides[part.name]! : {};
    return {
      ...part,
      ...override,
      ...(override.contributes !== undefined && { contributes: { ...override.contributes } }),
      ...(override.holds !== undefined && { holds: { ...override.holds } }),
    };
  });
}

// What being used up leaves, copied, and left out when there is none: the child's own list or record
// replaces the parent's, and one declared empty clears it.
function spentOf(
  products: readonly { template: string; count: number }[] | undefined,
  residue: Readonly<Record<string, number>> | undefined,
): Pick<Template, "spent_products" | "spent_residue"> {
  return {
    ...(products !== undefined && products.length > 0 && { spent_products: products.map((product) => ({ ...product })) }),
    ...(residue !== undefined && Object.keys(residue).length > 0 && { spent_residue: { ...residue } }),
  };
}

// Processes merge by id like props: the parent's list, each replaced by a child's of the same id,
// then the child's new ones in the order it declares them.
function mergeProcesses(parent: readonly ProcessDecl[], own: readonly ProcessDecl[]): ProcessDecl[] {
  const replaced = new Map(own.map((decl) => [decl.id, decl]));
  const merged = parent.map((decl) => replaced.get(decl.id) ?? decl);
  const inherited = new Set(parent.map((decl) => decl.id));
  return copyProcesses([...merged, ...own.filter((decl) => !inherited.has(decl.id))]);
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
  declared: ReadonlyMap<string, TemplateDecl>,
  declaredSources: ReadonlyMap<string, string>,
): TemplateRegistry {
  const decls = new Map(declared);
  const sources = new Map(declaredSources);
  // A child that inherits its parent's parts and declares no companion of its own for one gets its
  // parent's, as a template extending it. A companion's own parts are inherited the same way, so
  // this runs until nothing is left to add; the resolved set is what a file for each would have made.
  for (;;) {
    const registry = resolveAll(decls, sources);
    const inherited = inheritedCompanions(registry, decls);
    if (inherited.length === 0) {
      assertMissingCompanions(registry);
      assertProducts(registry, sources);
      return registry;
    }
    for (const [id, parent] of inherited) {
      decls.set(id, { id, extends: parent });
      sources.set(id, `${parent} (inherited)`);
    }
  }
}

// The companions a child lacks that its parent has: `<child>.<part>` extending `<parent>.<part>`, for a
// detachable part the child has because it declares no parts of its own. [id, parent companion].
function inheritedCompanions(
  registry: TemplateRegistry,
  decls: ReadonlyMap<string, TemplateDecl>,
): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const id of Object.keys(registry).sort()) {
    const decl = decls.get(id);
    if (decl === undefined || decl.extends === null || decl.parts !== undefined) {
      continue;
    }
    for (const part of registry[id]!.parts) {
      const own = `${id}.${part.name}`;
      const inherited = `${decl.extends}.${part.name}`;
      if (part.detachable && !decls.has(own) && decls.has(inherited)) {
        found.push([own, inherited]);
      }
    }
  }
  return found;
}

function resolveAll(
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
    validateProps(template, sources.get(id) ?? id);
    registry[id] = template;
  }
  return registry;
}

// A product is spawned by its template id when a thing breaks or is used up, in a transition that has
// no way to refuse: one that names nothing, or a room (which nothing can be set on), would throw there
// and leave the clock unable to pass that tick, so it is refused here, when the set is read.
function assertProducts(registry: TemplateRegistry, sources: ReadonlyMap<string, string>): void {
  for (const id of Object.keys(registry).sort()) {
    const template = registry[id]!;
    for (const key of ["break_products", "spent_products"] as const) {
      for (const product of template[key] ?? []) {
        const at = `${sources.get(id) ?? id} ${key}`;
        if (!Object.hasOwn(registry, product.template)) {
          throw new TypeError(`${at} names unknown template ${product.template}`);
        }
        if (product.template === "room") {
          throw new TypeError(`${at} names room, which cannot be set on anything`);
        }
      }
    }
  }
}

// Every prop a template sets or its processes name is declared, by the engine's table or the
// template's own `fields`, holds a value of its type, and comes with the props it requires.
function validateProps(template: Template, source: string): void {
  const typeOf = (name: string): PropType | undefined => PROP_FIELDS[name]?.type ?? template.fields?.[name]?.type;
  for (const [name, value] of Object.entries(template.props)) {
    const type = typeOf(name);
    if (type === undefined) {
      throw new TypeError(`${source} props.${name} is not a declared prop`);
    }
    if (!propTypeMatches(type, value)) {
      throw new TypeError(`${source} props.${name} must be ${type === "integer" ? "an" : "a"} ${type}`);
    }
    const least = PROP_FIELDS[name]?.min;
    if (least !== undefined && typeof value === "number" && value < least) {
      throw new TypeError(`${source} props.${name} must be at least ${least}`);
    }
    for (const required of PROP_FIELDS[name]?.requires ?? []) {
      if (!Object.hasOwn(template.props, required)) {
        throw new TypeError(`${source} props.${name} requires ${required}`);
      }
    }
  }
  for (const process of template.processes ?? []) {
    const at = `${source} processes.${process.id}`;
    const named = [
      process.while?.prop,
      process.effect.adjust_prop.prop,
      process.every_ticks_prop,
      process.then !== undefined && "set_prop" in process.then ? process.then.set_prop.prop : undefined,
    ];
    for (const name of named) {
      if (name !== undefined && typeOf(name) === undefined) {
        throw new TypeError(`${at} names ${name}, which is not a declared prop`);
      }
    }
    if (typeOf(process.effect.adjust_prop.prop) !== "integer") {
      throw new TypeError(`${at} adjusts ${process.effect.adjust_prop.prop}, which is not an integer prop`);
    }
    if (process.then !== undefined && "set_prop" in process.then) {
      const { prop, value } = process.then.set_prop;
      if (!propTypeMatches(typeOf(prop)!, value)) {
        throw new TypeError(`${at} sets ${prop} to a value that is not ${typeOf(prop)}`);
      }
    }
  }
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
