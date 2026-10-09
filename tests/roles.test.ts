import { deepStrictEqual, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, WorldError, type World } from "../src/index.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";

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

function chestWorld(): { dir: string; world: World; chest: string } {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-roles-"));
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

function after(t: { after(callback: () => void): void }, dir: string): void {
  t.after(() => rmSync(dir, { recursive: true, force: true }));
}

test("an edit spawn that changes or adds a definition is refused, and repeats pass", (t) => {
  const { dir, world } = chestWorld();
  after(t, dir);
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

  // Repeating the template's own definitions is not a change, and leaving them out keeps them:
  // the override merges onto the template's props.
  const repeated = world.edit({
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
  strictEqual(repeated.status, "ok");
  const bare = world.edit({
    kind: "spawn",
    template: "chest",
    overrides: { name: "plain", location: "e1", support: "e1", pos: { x: 40, y: 0 } },
  });
  strictEqual(bare.status, "ok");
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
  const { dir, world, chest } = chestWorld();
  after(t, dir);

  const changed = world.edit({ kind: "set_props", target: chest, props: { ...CHEST, openable: true } });
  deepStrictEqual([changed.status, changed.reason_code], ["refused", "field_not_editable"]);

  const dropped = world.edit({ kind: "set_props", target: chest, props: { open: true } });
  deepStrictEqual([dropped.status, dropped.reason_code], ["refused", "field_not_editable"]);

  const repeated = world.edit({ kind: "set_props", target: chest, props: { ...CHEST, open: true } });
  strictEqual(repeated.status, "ok");
  deepStrictEqual(world.entity(chest)?.props, { ...CHEST, open: true });
});

test("update_props merges, so only the keys it writes can differ", (t) => {
  const { dir, world, chest } = chestWorld();
  after(t, dir);

  const changed = world.edit({ kind: "update_props", target: chest, props: { openable: true } });
  deepStrictEqual([changed.status, changed.reason_code], ["refused", "field_not_editable"]);

  // State merges over the definitions, which stay what the template declares.
  const merged = world.edit({ kind: "update_props", target: chest, props: { open: true } });
  strictEqual(merged.status, "ok");
  deepStrictEqual(world.entity(chest)?.props, { ...CHEST, open: true });
});

test("a scenario entry is held to the same rule before anything is written", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-roles-scenario-"));
  after(t, dir);
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

  // A merged override names only state; the entity keeps its template's definitions.
  const world = createWorld(join(dir, "merged"), entry({ open: true }));
  deepStrictEqual(
    Object.fromEntries(Object.entries(world.entity(world.id("chest")!)!.props).filter(([key]) => key in CHEST)),
    { ...CHEST },
  );
  strictEqual(world.entity(world.id("chest")!)?.props.open, true);
});

test("a definition a template declares under fields is held the same way", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-roles-fields-"));
  after(t, dir);
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
