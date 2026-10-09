import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, WorldError, type World } from "../src/index.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

const shipped = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

// Definitions are the template author's: a chest is a container of its inner size, and no override
// or edit may change that, add to it, or drop it. State is the author's to write.
const CHEST = {
  container: true,
  topples: true,
  inner_w_cm: 55,
  inner_d_cm: 35,
  inner_h_cm: 35,
} as const;

function chestWorld(t: { after(callback: () => void): void }): { dir: string; world: World; chest: string } {
  const dir = tempDir(t);
  const world = createWorld(join(dir, "w"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    {
      id: "chest",
      template: "chest",
      overrides: { name: "chest", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
    },
  ]);
  return { dir, world, chest: world.id("chest")! };
}

test("an edit spawn that changes or adds a definition is refused, and repeats pass", (t) => {
  const { world } = chestWorld(t);
  const before = canonicalJson(world.snapshot());

  const changed = world.edit({
    kind: "spawn",
    template: "chest",
    overrides: { name: "lidded", location: "e1", support: "e1", pos: { x: 10, y: 0 }, props: { openable: true } },
  });
  deepStrictEqual([changed.status, changed.reason_code], ["refused", "field_not_editable"]);

  const narrowed = world.edit({
    kind: "spawn",
    template: "chest",
    overrides: { name: "narrow", location: "e1", support: "e1", pos: { x: 20, y: 0 }, props: { inner_w_cm: 10 } },
  });
  deepStrictEqual([narrowed.status, narrowed.reason_code], ["refused", "field_not_editable"]);

  // Setting state that requires a definition the chest grants is refused unmet_requires, not
  // accepted as field_not_editable: open needs openable, which the template does not declare.
  const openableOnly = world.edit({
    kind: "spawn",
    template: "chest",
    overrides: {
      name: "twin",
      location: "e1",
      support: "e1",
      pos: { x: 30, y: 0 },
      props: { ...CHEST, open: true },
    },
  });
  deepStrictEqual([openableOnly.status, openableOnly.reason_code], ["refused", "unmet_requires"]);
  // Repeating the template's own definitions is not a change; the override merges and passes.
  const repeated = world.edit({
    kind: "spawn",
    template: "chest",
    overrides: { name: "twin", location: "e1", support: "e1", pos: { x: 30, y: 0 }, props: { ...CHEST } },
  });
  strictEqual(repeated.status, "ok");
  const bare = world.edit({
    kind: "spawn",
    template: "chest",
    overrides: { name: "plain", location: "e1", support: "e1", pos: { x: 40, y: 0 } },
  });
  strictEqual(bare.status, "ok");
  // Both spawns succeed, and each created entity keeps the template's definitions.
  for (const event of [repeated, bare]) {
    const id = event.events[1]?.entity;
    deepStrictEqual(
      Object.fromEntries(Object.entries(world.entity(String(id))!.props).filter(([key]) => key in CHEST)),
      { ...CHEST },
    );
  }
  strictEqual(canonicalJson(world.snapshot()) === before, false);
});

test("set_props replaces, so dropping a definition is refused with the change", (t) => {
  const { world, chest } = chestWorld(t);

  const changed = world.edit({ kind: "set_props", target: chest, props: { ...CHEST, openable: true } });
  deepStrictEqual([changed.status, changed.reason_code], ["refused", "field_not_editable"]);

  // A wholesale replace drops the definitions, which is `field_not_editable` before validation
  // sees it; keeping them and adding `open` reaches the entity-props rule and is `unmet_requires`.
  const replaced = world.edit({ kind: "set_props", target: chest, props: { open: true } });
  deepStrictEqual([replaced.status, replaced.reason_code], ["refused", "field_not_editable"]);

  const merged = world.edit({ kind: "set_props", target: chest, props: { ...CHEST, open: true } });
  deepStrictEqual([merged.status, merged.reason_code], ["refused", "unmet_requires"]);
});

test("update_props merges, so only the keys it writes can differ", (t) => {
  const { world, chest } = chestWorld(t);

  const changed = world.edit({ kind: "update_props", target: chest, props: { openable: true } });
  deepStrictEqual([changed.status, changed.reason_code], ["refused", "field_not_editable"]);

  // A chest grants no `openable`, so `open` on it is refused unmet_requires even when merged.
  const merged = world.edit({ kind: "update_props", target: chest, props: { open: true } });
  deepStrictEqual([merged.status, merged.reason_code], ["refused", "unmet_requires"]);
});

test("a scenario entry is held to the same rule before anything is written", (t) => {
  const dir = tempDir(t);
  const base = [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  ] as const;
  const entry = (props?: Record<string, number | string | boolean>) => [
    ...base,
    {
      id: "chest",
      template: "chest",
      overrides: {
        name: "chest",
        location: "hall",
        support: "hall",
        pos: { x: 0, y: 0 },
        ...(props === undefined ? {} : { props }),
      },
    },
  ];

  try {
    createWorld(join(dir, "changed"), entry({ openable: true }));
    throw new Error("Expected the scenario to be refused");
  } catch (error) {
    strictEqual(error instanceof WorldError, true);
    strictEqual((error as WorldError).code, "field_not_editable");
  }

  // A chest grants no `openable`, so setting `open` on it is now refused as `unmet_requires`:
  // the preset grants no prop the field needs, and a state value can never supply one.
  throws(
    () => createWorld(join(dir, "merged"), entry({ open: true })),
    (error: unknown) =>
      error instanceof WorldError &&
      error.code === "invalid_snapshot" &&
      error.issues?.some((i) => i.code === "unmet_requires" && i.path.join(".") === "entities.e2.props.open"),
  );
});

test("a definition a template declares under fields is held the same way", (t) => {
  const dir = tempDir(t);
  const registry = parseRegistry({
    ...shipped,
    metronome: {
      id: "metronome",
      extends: "stone",
      props: { rate: 4 },
      fields: { rate: { tier: "definition", type: "integer" } },
    },
  });
  const world = createWorld(join(dir, "w"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "tick", template: "metronome", overrides: { name: "tick", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  ], registry);
  const tick = world.id("tick")!;

  const changed = world.edit({ kind: "update_props", target: tick, props: { rate: 1 } });
  deepStrictEqual([changed.status, changed.reason_code], ["refused", "field_not_editable"]);

  const repeated = world.edit({ kind: "update_props", target: tick, props: { rate: 4 } });
  strictEqual(repeated.status, "ok");
});

test("the architect writes placement, names, traits, forms and a few plain states, and no other field", (t) => {
  const dir = tempDir(t);
  const hall = { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } };
  const at = { location: "hall", support: "hall", pos: { x: 0, y: 0 } };
  const entry = (template: string, overrides: Record<string, unknown>) => [
    hall,
    { id: "thing", template, overrides: { name: "thing", ...at, ...overrides } },
  ] as Parameters<typeof createWorld>[1];
  const refusedField = (name: string, template: string, overrides: Record<string, unknown>): string => {
    const target = join(dir, name);
    try {
      createWorld(target, entry(template, overrides));
    } catch (error) {
      strictEqual(existsSync(target), false, `${name} wrote a world`);
      return error instanceof WorldError ? `${error.code}: ${error.message.replace(/^.*writes /, "")}` : String(error);
    }
    return "built";
  };

  // Raw quantities, parts, a status, residue and every other prop are the world author's or the preset's.
  const refusals: Array<[string, string, Record<string, unknown>, string]> = [
    ["fuel", "candle", { props: { fuel: 3 } }, "props.fuel"],
    ["liquid", "bottle", { props: { liquid_amount: 3 } }, "props.liquid_amount"],
    ["material", "bottle", { props: { liquid_material: "beer" } }, "props.liquid_material"],
    ["hunger", "human_hungry", { props: { hunger: 40 } }, "props.hunger"],
    ["portions", "bread", { props: { portions: 1 } }, "props.portions"],
    ["integrity", "stone", { integrity: 50 }, "integrity"],
    ["status", "stone", { status: "broken" }, "status"],
    ["residue", "stone", { residue: { wine: 5 } }, "residue"],
    ["detached", "stone", { detached_from: { entity: "hall", part: "hand_l" } }, "detached_from"],
    ["undeclared", "stone", { props: { foo: "bar" } }, "props.foo"],
    // A definition, even when it repeats the preset's own value: the preset says it, not the scene.
    ["repeated", "door", { props: { openable: true } }, "props.openable"],
    ["tuning", "human", { props: { attack_damage: 1 } }, "props.attack_damage"],
  ];
  for (const [name, template, overrides, field] of refusals) {
    strictEqual(refusedField(name, template, overrides), `field_not_editable: ${field}, which the architect may not`, name);
  }
  // A derived field keeps its own code.
  strictEqual(refusedField("derived", "stone", { modifiers: [{ capacity: "manipulation", delta: -1, expires: 5, cause_id: "ev1" }] }).split(":")[0], "derived_field");

  // What it may say builds: placement, names, traits, the forms and the plain states.
  const allowed = createWorld(join(dir, "allowed"), [
    { id: "hall", template: "room", overrides: { name: "hall", aliases: ["den"], props: { lit: true }, traits: { colour: "brown" } } },
    { id: "gate", template: "door", overrides: { name: "gate", ...at, props: { open: false, locked: true, from: "hall", to: "hall" } } },
    { id: "lamp", template: "lantern", overrides: { name: "lamp", ...at, fuel_pct: 50, props: { burning: true } } },
  ]);
  const lamp = allowed.entity(allowed.id("lamp")!)!;
  deepStrictEqual([lamp.props.fuel, lamp.props.burning], [10, true]);
  strictEqual(allowed.entity(allowed.id("gate")!)?.props.locked, true);

  // The edit is the world author's, and writes any state.
  const written = allowed.edit({ kind: "update_props", target: allowed.id("lamp")!, props: { fuel: 3 } });
  strictEqual(written.status, "ok");
  strictEqual(allowed.entity(allowed.id("lamp")!)?.props.fuel, 3);
});
