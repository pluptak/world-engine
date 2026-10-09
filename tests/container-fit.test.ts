import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, memoryWorld, WORLD_AUTHOR, WorldError, type Entity, type Id, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates, parseRegistry, type TemplateRegistry } from "../src/templates.js";

// What sits in a plain container fits its `inner_*_cm`, as `put` already holds it to; a table in a chest is
// not a state `put` can reach, so no scenario, edit or cause of the clock may write one.

const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const registry: TemplateRegistry = parseRegistry({
  ...base,
  chip: { id: "chip", extends: "stone", size_cm: { w: 5, d: 5, h: 1 } },
  block: { id: "block", extends: "stone" },
  slab: { id: "slab", extends: "stone", size_cm: { w: 80, d: 80, h: 5 } },
  // Burns out leaving one thing that fits a cup, one that fits a chest and not a cup, and one that fits neither.
  wick: {
    id: "wick",
    extends: "stone",
    size_cm: { w: 2, d: 2, h: 5 },
    mass_g: 5,
    props: { light_source: true, burning: false, fuel: 1 },
    spent_products: [
      { template: "chip", count: 1 },
      { template: "block", count: 1 },
      { template: "slab", count: 1 },
    ],
    spent_residue: { soot: 1 },
    processes: [
      {
        id: "burn",
        every_ticks: 1,
        while: { prop: "burning", op: "eq", value: true },
        effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } },
        then: { spent: true },
      },
    ],
  },
});

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-container-fit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const floor = (x: number) => ({ location: "hall", support: "hall", pos: { x, y: 0 } });

function worldOf(t: { after(callback: () => void): void }, extra: Scenario): World {
  return createWorld(
    join(tempDir(t), "w"),
    [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "ann", template: "human", overrides: { name: "ann", ...floor(0) } },
      { id: "chest", template: "chest", overrides: { name: "chest", ...floor(-100) } },
      ...extra,
    ],
    registry,
  );
}

const of = (world: World, template: string): Entity[] =>
  Object.values(world.snapshot().entities).filter((entity) => entity.template === template);

function advance(world: World): void {
  const result = world.command({ command_id: "advance", actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 1 } });
  strictEqual(result.status, "ok", `${result.reason_code}`);
}

const burning = { burning: true };

test("the rule fires on a thing too big for its container, and not on one that fits or a container with no dimensions", (t) => {
  const world = worldOf(t, [
    { id: "shard", template: "glass_shard", overrides: { name: "shard", location: "hall", contained_in: "chest" } },
    { id: "box", template: "crate", overrides: { name: "box", ...floor(100) } },
  ]);
  const snapshot = world.snapshot();
  const chest = world.id("chest")!;
  const shard = world.id("shard")!;
  const codes = (entities: Record<Id, Entity>) => validateSnapshot({ ...snapshot, entities }, registry).map((issue) => issue.code);
  deepStrictEqual(codes(snapshot.entities), []);

  // A table, set into the chest.
  const table = { ...snapshot.entities[shard]!, template: "table" };
  const bad = validateSnapshot({ ...snapshot, entities: { ...snapshot.entities, [shard]: table } }, registry);
  deepStrictEqual(bad.map((issue) => [issue.code, issue.path]), [["container_contents_too_large", ["entities", shard, "contained_in"]]]);

  // The same table in a crate, which declares no inner dimensions, is left alone: only `put` reads them.
  const box = world.id("box")!;
  const inBox = { ...table, contained_in: box };
  deepStrictEqual(codes({ ...snapshot.entities, [shard]: inBox }), []);

  // A fraction of a centimetre over is over; exactly the inner size is not.
  const exact = { ...table, template: "chip" };
  deepStrictEqual(codes({ ...snapshot.entities, [shard]: exact, [chest]: { ...snapshot.entities[chest]!, props: { ...snapshot.entities[chest]!.props, inner_w_cm: 4, inner_d_cm: 4, inner_h_cm: 4 } } }), ["container_contents_too_large"]);
  deepStrictEqual(codes({ ...snapshot.entities, [shard]: exact, [chest]: { ...snapshot.entities[chest]!, props: { ...snapshot.entities[chest]!.props, inner_w_cm: 5, inner_d_cm: 5, inner_h_cm: 1 } } }), []);
});

test("a scenario, memoryWorld, edit place and edit spawn refuse a table in a chest, and leave the world as it was", (t) => {
  const scenario: Scenario = [
    { id: "hall", template: "room", overrides: { name: "hall" } },
    { id: "chest", template: "chest", overrides: { name: "chest", ...floor(0) } },
    { id: "table", template: "table", overrides: { name: "table", location: "hall", contained_in: "chest" } },
  ];
  let thrown: unknown;
  try {
    createWorld(join(tempDir(t), "bad"), scenario, registry);
  } catch (error) {
    thrown = error;
  }
  ok(thrown instanceof WorldError && thrown.code === "invalid_snapshot");
  deepStrictEqual((thrown as WorldError).issues?.map((issue) => issue.code), ["container_contents_too_large"]);

  const world = worldOf(t, [{ id: "table", template: "table", overrides: { name: "table", ...floor(100) } }]);
  const before = canonicalJson(world.snapshot());
  const chest = world.id("chest")!;
  const place = world.edit({ kind: "place", target: world.id("table")!, contained_in: chest, support: null, pos: null });
  deepStrictEqual([place.status, place.reason_code], ["refused", "container_contents_too_large"]);
  const spawn = world.edit({ kind: "spawn", template: "table", overrides: { location: "e1", contained_in: chest } });
  deepStrictEqual([spawn.status, spawn.reason_code], ["refused", "container_contents_too_large"]);
  strictEqual(canonicalJson(world.snapshot()), before);
  // What fits is placed as before.
  strictEqual(world.edit({ kind: "spawn", template: "chip", overrides: { location: "e1", contained_in: chest } }).status, "ok");
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  strictEqual(memoryWorld(world.snapshot(), registry).snapshot().version, world.snapshot().version);
});

test("put still refuses what is too large, with the data it always gave", (t) => {
  const world = worldOf(t, [
    { id: "cup", template: "cup", overrides: { name: "cup", ...floor(30) } },
    { id: "rock", template: "stone", overrides: { name: "rock", ...floor(20) } },
  ]);
  const ann = world.id("ann")!;
  strictEqual(world.command({ command_id: "take", actor: ann, verb: "take", target: "rock" }).status, "ok");
  const put = world.command({ command_id: "put", actor: ann, verb: "put", target: "rock", args: { relation: "in", destination: "cup" } });
  deepStrictEqual([put.status, put.reason_code], ["refused", "too_large"]);
});

test("a product that does not fit the container is set beside it, so the clock never produces a snapshot it must refuse", (t) => {
  // In the chest: the chip and the block fit, the slab goes beside it where it stands.
  const inChest = worldOf(t, [{ id: "wick", template: "wick", overrides: { name: "wick", location: "hall", contained_in: "chest", props: burning } }]);
  const chest = inChest.id("chest")!;
  advance(inChest);
  for (const [template, inside] of [["chip", true], ["block", true], ["slab", false]] as const) {
    const [product] = of(inChest, template);
    ok(product !== undefined, template);
    deepStrictEqual(
      [product.contained_in, product.support, product.location, product.pos],
      inside ? [chest, null, "e1", null] : [null, "e1", "e1", { x: -100, y: 0 }],
      template,
    );
  }
  deepStrictEqual(inChest.entity(chest)?.residue, { soot: 1 });
  deepStrictEqual(validateSnapshot(inChest.snapshot(), registry), []);

  // In a cup in the chest: only the chip fits the cup, the block goes into the chest, the slab beside it.
  const nested = worldOf(t, [
    { id: "cup", template: "cup", overrides: { name: "cup", location: "hall", contained_in: "chest" } },
    { id: "wick", template: "wick", overrides: { name: "wick", location: "hall", contained_in: "cup", props: burning } },
  ]);
  advance(nested);
  const cup = nested.id("cup")!;
  const nestedChest = nested.id("chest")!;
  deepStrictEqual([of(nested, "chip")[0]?.contained_in, of(nested, "block")[0]?.contained_in, of(nested, "slab")[0]?.contained_in], [cup, nestedChest, null]);
  deepStrictEqual(of(nested, "slab")[0]?.pos, { x: -100, y: 0 });
  deepStrictEqual(nested.entity(cup)?.residue, { soot: 1 });
  deepStrictEqual(validateSnapshot(nested.snapshot(), registry), []);

  // In a cup in a hand: the chip stays in the cup, the rest lands at the holder's feet.
  const held = worldOf(t, [
    { id: "cup", template: "cup", overrides: { name: "cup", location: "hall", contained_in: "ann" } },
    { id: "wick", template: "wick", overrides: { name: "wick", location: "hall", contained_in: "cup", props: burning } },
  ]);
  advance(held);
  const heldCup = held.id("cup")!;
  strictEqual(of(held, "chip")[0]?.contained_in, heldCup);
  for (const template of ["block", "slab"]) {
    const [product] = of(held, template);
    deepStrictEqual([product?.contained_in, product?.in_part, product?.support, product?.pos], [null, null, "e1", { x: 0, y: 0 }], template);
  }
  deepStrictEqual(validateSnapshot(held.snapshot(), registry), []);
});
