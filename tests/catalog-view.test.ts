import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, catalog, createWorld, memoryWorld, type CatalogEntry } from "../src/index.js";
import { loadTemplates, parseRegistry, templatesHash } from "../src/templates.js";
import { CatalogResponseSchema } from "../src/contract.js";
import { cli } from "./cli-run.js";
import { tempDir } from "./harness.js";

// The architect's catalogue: what it may place, with the forms it may use and their defaults.

const shipped = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const entries = catalog(shipped);
// Two presets whose figures are no whole percentage: a tenth-full bottle (100 of 750) and a body that
// starts hungrier than `hunger_pct` can say.
const uneven = parseRegistry({
  ...shipped,
  tenth_bottle: { id: "tenth_bottle", extends: "bottle", props: { liquid_amount: 100 } },
  famished: { id: "famished", extends: "human_hungry", props: { hunger: 150 } },
});
const byTemplate = (id: string): CatalogEntry => {
  const found = entries.find((entry) => entry.template === id);
  ok(found !== undefined, id);
  return found;
};

test("every template is offered but the companions of detachable parts, by id", () => {
  const ids = entries.map((entry) => entry.template);
  deepStrictEqual(ids, [...ids].sort());
  const hidden = Object.keys(shipped).filter((id) => !ids.includes(id)).sort();
  // Companions, and the one base the shipped set marks `"catalog": false`.
  ok(hidden.length > 0 && hidden.every((id) => id.includes(".") || id === "quadruped"), hidden.join(" "));
  // A template with a dot is offered only when it is no part's companion; none of these is.
  ok(ids.every((id) => !id.includes(".")));
  for (const id of ["room", "anchor", "glass_shard", "human_hungry", "bottle"]) {
    ok(ids.includes(id), id);
  }
  // The same set gives the same answer.
  strictEqual(canonicalJson(catalog(shipped)), canonicalJson(entries));
});

test("an entry shows the definition an architect chooses by, and no tuning", () => {
  deepStrictEqual(byTemplate("human"), {
    template: "human",
    size_cm: { w: 45, d: 30, h: 180 },
    mass_g: 70000,
    container: false,
    surface: false,
    openable: false,
    barrier: false,
    light_source: false,
    agent: true,
    parts: ["head", "torso", "arm_l", "hand_l", "thumb_l", "arm_r", "hand_r", "thumb_r", "pocket"],
    capacities: { sight: 100, hearing: 100, speech: 100, moving: 100, touch: 100, manipulation: 100 },
    breaks_into: [],
    forms: { condition: "intact" },
  });
  const bottle = byTemplate("bottle");
  deepStrictEqual([bottle.capacity_cm3, bottle.breaks_into], [750, ["glass_shard"]]);
  deepStrictEqual([byTemplate("chest").container, byTemplate("table").surface, byTemplate("door").openable], [true, true, true]);
  deepStrictEqual([byTemplate("bars").barrier, byTemplate("lantern").light_source], [true, true]);
  strictEqual("capacity_cm3" in byTemplate("stone"), false);
  // Tuning stays in the template.
  const text = JSON.stringify(entries);
  for (const tuning of ["reach_cm", "attack_damage", "bleed_damage", "break_fall_cm", "default_hit_part", "processes"]) {
    strictEqual(text.includes(tuning), false, tuning);
  }
});

test("the forms a preset takes, and their defaults", () => {
  deepStrictEqual(byTemplate("stone").forms, { condition: "intact" });
  deepStrictEqual(byTemplate("candle").forms, { condition: "intact", fuel_pct: 100 });
  deepStrictEqual(byTemplate("bread").forms, { condition: "intact", portions_pct: 100 });
  deepStrictEqual(byTemplate("human_hungry").forms, { condition: "intact", hunger_pct: 0 });
  // A bottle starts full of its wine; a cup is empty and names no material.
  deepStrictEqual(byTemplate("bottle").forms, { condition: "intact", liquid: { material: "wine", pct: 100 } });
  deepStrictEqual(byTemplate("cup").forms, { condition: "intact", liquid: { material: null, pct: 0 } });
});

test("a default that spelled out would place something else is marked approximate", () => {
  const of = (id: string) => catalog(uneven).find((entry) => entry.template === id)!.forms;
  // 13% of 750 is 97, not the 100 the preset holds.
  deepStrictEqual(of("tenth_bottle"), { condition: "intact", liquid: { material: "wine", pct: 13 }, approximate: ["liquid"] });
  // Listed as the most a scenario may say; 150 would be refused.
  deepStrictEqual(of("famished"), { condition: "intact", hunger_pct: 100, approximate: ["hunger_pct"] });
  deepStrictEqual(entries.filter((entry) => entry.forms.approximate !== undefined).map((entry) => entry.template), []);
  CatalogResponseSchema.parse({ catalog: catalog(uneven) });
});

test("placing a preset with its default forms is placing it with none, unless they are approximate", (t) => {
  const dir = tempDir(t);
  catalog(uneven).forEach((entry, index) => {
    const { forms } = entry;
    const named = { name: "thing" };
    const plain = createWorld(join(dir, `plain-${index}`), [{ id: "thing", template: entry.template, overrides: named }], uneven);
    const spell = () => createWorld(
      join(dir, `forms-${index}`),
      [
        {
          id: "thing",
          template: entry.template,
          overrides: {
            ...named,
            ...(forms.fuel_pct !== undefined && { fuel_pct: forms.fuel_pct }),
            ...(forms.liquid !== undefined && { liquid: { ...(forms.liquid.material !== null && { material: forms.liquid.material }), pct: forms.liquid.pct } }),
            condition: forms.condition,
            ...(forms.hunger_pct !== undefined && { hunger_pct: forms.hunger_pct }),
            ...(forms.portions_pct !== undefined && { portions_pct: forms.portions_pct }),
          },
        },
      ],
      uneven,
    );
    const spelled = spell();
    if (forms.approximate !== undefined) {
      ok(canonicalJson(spelled.entity(spelled.id("thing")!)) !== canonicalJson(plain.entity(plain.id("thing")!)), entry.template);
      return;
    }
    // An empty vessel spelled out stores the 0 and the "" a plain one leaves absent: the same nothing.
    const written = structuredClone(spelled.entity(spelled.id("thing")!)!);
    if (forms.liquid?.pct === 0) {
      delete written.props.liquid_amount;
      delete written.props.liquid_material;
    }
    deepStrictEqual(written, plain.entity(plain.id("thing")!), entry.template);
  });
});

test("a base marked catalog false is not offered, and its child is", () => {
  const registry = parseRegistry({
    ...shipped,
    base_lamp: { id: "base_lamp", extends: "lantern", catalog: false },
    parlour_lamp: { id: "parlour_lamp", extends: "base_lamp", props: { fuel: 4 } },
  });
  const ids = catalog(registry).map((entry) => entry.template);
  ids.forEach((id) => ok(!id.startsWith("quadruped"), id));
  deepStrictEqual([ids.includes("base_lamp"), ids.includes("parlour_lamp"), ids.includes("lantern")], [false, true, true]);
  strictEqual(registry.parlour_lamp?.catalog, undefined);
  // The mark is no entity prop: it is a template key, and `abstract` is another thing.
  strictEqual(registry.base_lamp?.props.abstract, undefined);
  // Only a base that says so carries the key; the shipped set has one.
  deepStrictEqual(Object.values(shipped).filter((template) => "catalog" in template).map((template) => template.id), ["quadruped"]);
  ok(templatesHash(registry) !== templatesHash(shipped));
  throws(() => parseRegistry({ ...shipped, bad: { id: "bad", extends: "stone", catalog: "no" } }), /catalog must be a boolean/);
});

test("a world offers the presets of its own templates, and the CLI answers with or without a world", (t) => {
  const dir = tempDir(t);
  const registry = parseRegistry({ ...shipped, tall_stone: { id: "tall_stone", extends: "stone", size_cm: { w: 10, d: 10, h: 90 } } });
  const stored = createWorld(join(dir, "w"), [{ id: "hall", template: "room", overrides: { name: "hall" } }], registry);
  const expected = catalog(registry);
  deepStrictEqual(stored.catalog(), expected);
  deepStrictEqual(stored.fork().catalog(), expected);
  deepStrictEqual(memoryWorld(stored.snapshot(), registry).catalog(), expected);
  ok(stored.catalog().some((entry) => entry.template === "tall_stone"));

  const ofWorld = cli(JSON.stringify({ op: "catalog", world: join(dir, "w") }));
  strictEqual(ofWorld.status, 0, ofWorld.stdout);
  deepStrictEqual(JSON.parse(ofWorld.stdout), { catalog: expected });
  // No world: the shipped set, which has no tall_stone.
  const shippedSet = cli(JSON.stringify({ op: "catalog" }));
  strictEqual(shippedSet.status, 0, shippedSet.stdout);
  const parsed = CatalogResponseSchema.parse(JSON.parse(shippedSet.stdout));
  deepStrictEqual(parsed.catalog, entries);
  strictEqual(cli(JSON.stringify({ op: "catalog", world: join(dir, "nowhere") })).status, 2);
});
