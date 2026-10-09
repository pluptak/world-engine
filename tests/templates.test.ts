import { deepStrictEqual, ok, strictEqual, throws as assertThrows } from "node:assert";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  openWorld,
  WorldError,
  type Scenario,
} from "../src/index.js";
import { loadTemplates, parseRegistry, templatesHash, type TemplateRegistry } from "../src/templates.js";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));
const registry = loadTemplates(templatesDir);

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-templates-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function copiedTemplates(t: { after(callback: () => void): void }): string {
  const dir = join(tempDir(t), "templates");
  cpSync(templatesDir, dir, { recursive: true });
  return dir;
}

// A minimal declaration, so the resolution tests below read as templates rather than as fixtures.
function decl(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    size_cm: { w: 10, d: 10, h: 10 },
    mass_g: 100,
    parts: [],
    props: {},
    break_products: [],
    break_residue: {},
    ...extra,
  };
}

const wineScenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  { template: "wine_bottle", overrides: { name: "flask", location: "e1", support: "e2" } },
  {
    template: "human",
    overrides: { name: "pusher", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
  // In the table's path, so the push stops short and the jolt knocks the bottle off.
  {
    template: "stone",
    overrides: { name: "doorstop", location: "e1", support: "e1", pos: { x: 129, y: 0 } },
  },
];

const pushTable = {
  command_id: "push-table",
  actor: "e4",
  verb: "push",
  target: "table",
} as const;

function storeWorld(t: { after(callback: () => void): void }, templates = registry) {
  const dir = join(tempDir(t), "world");
  return { dir, world: createWorld(dir, wineScenario, templates) };
}

test("wine_bottle inherits every bottle field and overrides only its liquid", () => {
  const wine = registry.wine_bottle;
  const bottle = registry.bottle;
  ok(wine);
  ok(bottle);

  strictEqual(Object.hasOwn(wine, "extends"), false);
  deepStrictEqual(wine.size_cm, bottle.size_cm);
  strictEqual(wine.mass_g, bottle.mass_g);
  deepStrictEqual(wine.parts, bottle.parts);
  deepStrictEqual(wine.break_products, bottle.break_products);
  deepStrictEqual(wine.break_residue, bottle.break_residue);
  deepStrictEqual(wine.props, { ...bottle.props, liquid_material: "grape_wine" });
});

test("holder parts declare what they hold", () => {
  const hand = registry.human?.parts.find((part) => part.name === "hand_l");
  deepStrictEqual(hand?.holds, { kind: "grip" });
  deepStrictEqual(
    registry.human?.parts.find((part) => part.name === "hand_r")?.holds,
    { kind: "grip" },
  );
  deepStrictEqual(registry.human?.parts.find((part) => part.name === "pocket")?.holds, {
    kind: "space",
    inner_w_cm: 18,
    inner_d_cm: 12,
    inner_h_cm: 4,
  });
  for (const template of ["dog", "cat", "horse"] as const) {
    deepStrictEqual(
      registry[template]?.parts.find((part) => part.name === "jaw")?.holds,
      { kind: "grip" },
      `${template} jaw holds nothing`,
    );
  }
  strictEqual(registry.human?.parts.find((part) => part.name === "head")?.holds, undefined);
});

test("holds resolve with the part and vanish when a child replaces its parts", () => {
  const grip = {
    name: "hand",
    parent: null,
    contributes: {},
    detachable: false,
    max_integrity: 100,
    holds: { kind: "grip" },
  };
  const resolved = parseRegistry({
    parent: decl("parent", { parts: [grip] }),
    heir: { id: "heir", extends: "parent" },
    blank: decl("blank", { extends: "parent", parts: [] }),
  });
  deepStrictEqual(resolved.heir?.parts, [grip]);
  deepStrictEqual(resolved.blank?.parts, []);
});

test("a part that holds wrongly is refused by name", () => {
  const bad = (holds: unknown) =>
    decl("bad", {
      parts: [
        {
          name: "hand",
          parent: null,
          contributes: {},
          detachable: false,
          max_integrity: 100,
          holds,
        },
      ],
    });
  for (const holds of [{ kind: "pocket" }, { kind: "space" }, { kind: "space", inner_w_cm: 1 }, 1]) {
    assertThrows(
      () => parseRegistry({ bad: bad(holds) }),
      (error: unknown) =>
        error instanceof TypeError &&
        error.message.startsWith("templates.json#bad.parts[0].holds"),
      `holds ${JSON.stringify(holds)} loads`,
    );
  }
});

test("two children of one parent resolve to the same fields", () => {
  const resolved = parseRegistry({
    parent: decl("parent", { break_residue: { glass: 5 } }),
    one: { id: "one", extends: "parent" },
    two: { id: "two", extends: "parent" },
  });

  deepStrictEqual(resolved.one, { ...resolved.parent, id: "one" });
  deepStrictEqual(resolved.two, { ...resolved.parent, id: "two" });
});

test("a chain merges every parent, the nearest winning", () => {
  const chain = parseRegistry({
    root: decl("root", { mass_g: 1, props: { a: 1, shared: "root" }, fields: { a: { tier: "state", type: "integer" }, b: { tier: "state", type: "integer" }, c: { tier: "state", type: "integer" }, shared: { tier: "state", type: "string" } }, break_residue: { glass: 5 } }),
    middle: { id: "middle", extends: "root", props: { b: 2, shared: "middle" } },
    leaf: { id: "leaf", extends: "middle", props: { c: 3, shared: "leaf" } },
  });

  strictEqual(chain.leaf?.mass_g, 1);
  strictEqual(chain.leaf?.props.shared, "leaf");
  deepStrictEqual(chain.leaf?.props, { a: 1, shared: "leaf", b: 2, c: 3 });
  deepStrictEqual(chain.leaf?.break_residue, { glass: 5 });
  deepStrictEqual(chain.middle?.props, { a: 1, shared: "middle", b: 2 });
});

test("a child's own fields win, declared parts replace the parent's and undeclared ones are inherited", () => {
  const parent = decl("parent", {
    mass_g: 1,
    props: { waxed: true, size: "big" },
    fields: { waxed: { tier: "state", type: "boolean" }, size: { tier: "state", type: "string" } },
    parts: [
      {
        name: "lid",
        parent: null,
        contributes: {},
        detachable: false,
        max_integrity: 100,
      },
    ],
  });
  const resolved = parseRegistry({
    parent,
    child: decl("child", { extends: "parent", mass_g: 2, props: { size: "small" }, parts: [] }),
    heir: { id: "heir", extends: "parent" },
  });

  strictEqual(resolved.child?.mass_g, 2);
  deepStrictEqual(resolved.child?.props, { waxed: true, size: "small" });
  deepStrictEqual(resolved.child?.parts, []);
  strictEqual(resolved.parent?.parts.length, 1);

  deepStrictEqual(resolved.heir?.parts, resolved.parent?.parts);
  strictEqual(resolved.heir?.mass_g, 1);
});

test("an incomplete root is refused by name, however a child reached it", (t) => {
  const raw = JSON.parse(canonicalJson(registry)) as Record<string, unknown>;
  raw.bottle = { id: "bottle", props: {} };
  raw.wine_bottle = { id: "wine_bottle", extends: "bottle" };

  assertThrows(
    () => parseRegistry(raw),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message ===
        "templates.json#bottle declares no size_cm or mass_g or parts or break_products or break_residue and extends nothing",
  );

  const dir = copiedTemplates(t);
  writeFileSync(join(dir, "bottle.json"), `${JSON.stringify({ id: "bottle", props: {} })}\n`, "utf8");
  assertThrows(
    () => loadTemplates(dir),
    (error: unknown) =>
      error instanceof TypeError && error.message.startsWith("bottle.json declares no size_cm"),
  );
});

test("an extends cycle is refused with the chain that made it", () => {
  assertThrows(
    () => parseRegistry({ a: decl("a", { extends: "b" }), b: decl("b", { extends: "c" }), c: decl("c", { extends: "a" }) }),
    (error: unknown) =>
      error instanceof TypeError && error.message === "Template extends cycle: a -> b -> c -> a",
  );

  assertThrows(
    () => parseRegistry({ alone: decl("alone", { extends: "alone" }) }),
    (error: unknown) =>
      error instanceof TypeError && error.message === "Template extends cycle: alone -> alone",
  );
});

test("an unknown parent is refused with the chain that reached it", () => {
  assertThrows(
    () => parseRegistry({ a: decl("a", { extends: "b" }), b: decl("b", { extends: "ghost" }) }),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === "Template extends unknown parent: a -> b -> ghost",
  );
});

test("a cycle in a directory of files is refused before anything is used", (t) => {
  const dir = copiedTemplates(t);
  writeFileSync(
    join(dir, "wine_bottle.json"),
    `${JSON.stringify({ id: "wine_bottle", extends: "bottle", props: {} })}\n`,
    "utf8",
  );
  writeFileSync(
    join(dir, "bottle.json"),
    `${JSON.stringify({ id: "bottle", extends: "wine_bottle" })}\n`,
    "utf8",
  );

  assertThrows(
    () => loadTemplates(dir),
    (error: unknown) =>
      error instanceof TypeError && /extends cycle: bottle -> wine_bottle -> bottle/.test(error.message),
  );
});

test("the resolved set hashes like the same set written out in full", (t) => {
  const spelledOut = copiedTemplates(t);
  writeFileSync(
    join(spelledOut, "wine_bottle.json"),
    `${canonicalJson(registry.wine_bottle)}\n`,
    "utf8",
  );

  const extended = loadTemplates(templatesDir);
  const fromFiles = loadTemplates(spelledOut);
  strictEqual(templatesHash(fromFiles), templatesHash(extended));
  strictEqual(canonicalJson(fromFiles), canonicalJson(extended));
  strictEqual(
    templatesHash(parseRegistry(JSON.parse(canonicalJson(extended)))),
    templatesHash(extended),
  );
  strictEqual(canonicalJson(extended).includes("extends"), false);
});

test("a store world pushes a wine_bottle off its table into shards and its own residue", (t) => {
  const { dir, world } = storeWorld(t);
  const result = world.command(pushTable);

  strictEqual(result.status, "ok");
  deepStrictEqual(result.events.map((event) => event.type), [
    "push",
    "moved",
    "collided",
    "displaced",
    "dropped",
    "broken",
    "spawned",
    "spawned",
    "spawned",
  ]);
  strictEqual(result.events[4]?.data.fall_cm, 75);
  strictEqual(world.entity("e3")?.status, "broken");
  strictEqual(world.entity("e3")?.props.liquid_amount, 0);
  deepStrictEqual(world.entity("e1")?.residue, { glass: 5, grape_wine: 75 });
  strictEqual(
    Object.values(world.snapshot().entities).filter((entity) => entity.template === "glass_shard")
      .length,
    3,
  );

  const frozen = readFileSync(join(dir, "templates.json"), "utf8");
  strictEqual(frozen.includes("extends"), false);
  strictEqual(openWorld(dir).snapshot().templates_hash, world.snapshot().templates_hash);
});

test("a memory world breaks a wine_bottle exactly as a store world does", (t) => {
  const { world } = storeWorld(t);
  const seeded = world.snapshot();
  const memory = memoryWorld(seeded, registry);

  const store = world.command(pushTable);
  const inMemory = memory.command(pushTable);

  strictEqual(store.status, "ok");
  strictEqual(inMemory.status, "ok");
  strictEqual(canonicalJson(inMemory.snapshot), canonicalJson(store.snapshot));
  strictEqual(canonicalJson(inMemory.events), canonicalJson(store.events));
  deepStrictEqual(memory.entity("e1")?.residue, { glass: 5, grape_wine: 75 });
});

test("a world needs no template file once it holds the resolved set", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = storeWorld(t, loadTemplates(copies));
  const before = canonicalJson(world.snapshot());

  rmSync(copies, { recursive: true, force: true });

  const reopened = openWorld(dir);
  strictEqual(canonicalJson(reopened.snapshot()), before);
  strictEqual(reopened.command(pushTable).status, "ok");
  deepStrictEqual(reopened.entity("e1")?.residue, { glass: 5, grape_wine: 75 });
});

test("a child that inherits a detachable part needs its own companion template", () => {
  const raw = JSON.parse(canonicalJson(registry)) as Record<string, unknown>;
  raw.pupil = { id: "pupil", extends: "human" };

  assertThrows(
    () => parseRegistry(raw),
    (error: unknown) =>
      error instanceof TypeError && error.message === "Missing detached part template pupil.arm_l",
  );
});

test("a child that declares no parts inherits nothing to need a companion for", () => {
  const raw = JSON.parse(canonicalJson(registry)) as Record<string, unknown>;
  raw.blank = { id: "blank", extends: "human", parts: [] };

  const resolved = parseRegistry(raw);
  deepStrictEqual(resolved.blank?.parts, []);
});

test("upgradeTemplates reads a child's inherited fields, not its extends key", (t) => {
  const { world } = storeWorld(t);
  const withoutShards: TemplateRegistry = { ...registry };
  delete withoutShards.glass_shard;
  const memory = memoryWorld(world.snapshot(), registry);

  assertThrows(
    () => memory.upgradeTemplates(withoutShards),
    (error: unknown) =>
      error instanceof WorldError &&
      error.code === "templates_lost_field" &&
      error.message.includes("break_products.glass_shard"),
  );
  strictEqual(canonicalJson(memory.snapshot()), canonicalJson(world.snapshot()));
});

test("a product that names no template, a room or a fraction is refused when the set is read, for either key", (t) => {
  const message = (run: () => unknown): string => {
    try {
      run();
      return "loaded";
    } catch (error) {
      return error instanceof TypeError ? error.message : `not a TypeError: ${String(error)}`;
    }
  };
  const room = decl("room");
  for (const key of ["break_products", "spent_products"]) {
    const set = (product: unknown) => () => parseRegistry({ room, stone: decl("stone"), odd: decl("odd", { [key]: [product] }) });
    strictEqual(message(set({ template: "stone", count: 2 })), "loaded", key);
    strictEqual(message(set({ template: "nonesuch", count: 1 })), `templates.json#odd ${key} names unknown template nonesuch`, key);
    strictEqual(message(set({ template: "room", count: 1 })), `templates.json#odd ${key} names room, which cannot be set on anything`, key);
    strictEqual(message(set({ template: "stone", count: 1.5 })), `templates.json#odd.${key}[0].count must be an integer`, key);
    strictEqual(message(set({ template: "stone", count: -1 })), `templates.json#odd.${key}[0].count must not be negative`, key);
  }
  // A product defined later in the same set, and one a parent declared and a child inherits, both load.
  parseRegistry({ a: decl("a", { break_products: [{ template: "z", count: 1 }] }), b: decl("b", { extends: "a" }), z: decl("z") });
  // The same through the files of a directory, named by the file.
  const dir = copiedTemplates(t);
  writeFileSync(
    join(dir, "book.json"),
    `${JSON.stringify({ ...JSON.parse(readFileSync(join(dir, "book.json"), "utf8")), spent_products: [{ template: "nonesuch", count: 1 }] })}\n`,
    "utf8",
  );
  strictEqual(message(() => loadTemplates(dir)), "book.json spent_products names unknown template nonesuch");
  // What ships loads, and a world's frozen set is held to the same check.
  ok(Object.keys(loadTemplates(templatesDir)).length > 0);
});

test("a world cannot be opened on a frozen set whose product names no template", (t) => {
  const dir = join(tempDir(t), "w");
  createWorld(dir, [{ template: "room", overrides: { name: "room" } }]);
  const path = join(dir, "templates.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, unknown>>;
  raw.stone = { ...raw.stone!, break_products: [{ template: "nonesuch", count: 1 }] };
  writeFileSync(path, JSON.stringify(raw), "utf8");
  assertThrows(() => openWorld(dir), (error: unknown) => error instanceof Error && error.message.includes("names unknown template nonesuch"));
});
