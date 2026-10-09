import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, WORLD_AUTHOR, type Entity, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { lostField } from "../src/engine/upgrade.js";
import { replay } from "../src/store/file-store.js";
import { loadTemplates, parseRegistry, templatesHash, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A thing used up leaves what its template says it leaves, where it stood: `spent_products` spawned and
// `spent_residue` added to the surface they went to, every spawn caused by one `spent` event, which a
// process's `then: { spent: true }` or the last bite of a `consume` makes. The author's `remove` never does.

const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const burn = (then: unknown) => ({
  id: "burn",
  every_ticks: 1,
  while: { prop: "burning", op: "eq", value: true },
  effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } },
  then,
});

const registry: TemplateRegistry = parseRegistry({
  ...base,
  ash: { id: "ash", extends: "stone" },
  // A light that leaves two heaps of ash and soot on whatever it stood on.
  taper: {
    id: "taper",
    extends: "stone",
    size_cm: { w: 2, d: 2, h: 10 },
    mass_g: 20,
    props: { light_source: true, burning: false, fuel: 3 },
    spent_products: [{ template: "ash", count: 2 }],
    spent_residue: { soot: 4 },
    processes: [burn({ spent: true })],
  },
  // A loaf of one portion that leaves a crumb and flour.
  loaf: {
    id: "loaf",
    extends: "bread",
    props: { portions: 1 },
    spent_products: [{ template: "ash", count: 1 }],
    spent_residue: { flour: 2 },
  },
});

const floor = (x: number) => ({ location: "hall", support: "hall", pos: { x, y: 0 } });

function worldOf(t: { after(callback: () => void): void }, extra: Scenario, lit = true): { dir: string; world: World; ann: Id } {
  const dir = join(tempDir(t), "w");
  const scenario: Scenario = [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit } } },
    { id: "table", template: "table", overrides: { name: "table", ...floor(100) } },
    { id: "ann", template: "human", overrides: { name: "ann", ...floor(0) } },
    ...extra,
  ];
  const world = createWorld(dir, scenario, registry);
  return { dir, world, ann: world.id("ann")! };
}

let seq = 0;
function advance(world: World, ticks: number): Result {
  seq += 1;
  return world.command({ command_id: `spent-${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });
}

const entitiesOf = (world: World, template: string): Entity[] =>
  Object.values(world.snapshot().entities).filter((entity) => entity.template === template);

const types = (result: Result): string[] => result.events.map((event) => event.type);

test("a candle that burns out is gone, and the room is as dark as it was before it was lit", (t) => {
  const { world, ann } = worldOf(
    t,
    [{ id: "candle", template: "candle", overrides: { name: "candle", location: "hall", support: "table", fuel_pct: 25, props: { burning: true } } }],
    false,
  );
  const table = world.id("table")!;
  const candle = world.id("candle")!;
  const sees = () => world.query({ kind: "perceive", observer: ann, entity: table, sense: "sight" });
  deepStrictEqual(sees(), { value: "true", basis_code: "same_location_lit" });

  const first = advance(world, 1);
  strictEqual(first.status, "ok");
  deepStrictEqual(types(first).filter((type) => type !== "advance"), ["changed"]);
  strictEqual(world.entity(candle)?.props.fuel, 1);

  const last = advance(world, 1);
  deepStrictEqual(types(last), ["advance", "changed", "spent", "removed"]);
  strictEqual(world.entity(candle), null);
  strictEqual(sees().value, "false");
  strictEqual(sees().basis_code, "location_unlit");
  // A candle has no products and no residue: nothing but the spent mark is left of it.
  strictEqual(entitiesOf(world, "ash").length, 0);
  deepStrictEqual(world.entity(table)?.residue, {});
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("what is used up on a table leaves its products and residue there, caused by one spent event", (t) => {
  const { dir, world } = worldOf(t, [
    { id: "taper", template: "taper", overrides: { name: "taper", location: "hall", support: "table", fuel_pct: 34, props: { burning: true } } },
  ]);
  const table = world.id("table")!;
  const taper = world.id("taper")!;
  const result = advance(world, 1);
  deepStrictEqual(types(result), ["advance", "changed", "spent", "spawned", "spawned", "removed"]);
  const [, changed, spent, firstAsh, secondAsh, removed] = result.events;
  strictEqual(spent?.entity, taper);
  strictEqual(spent?.cause_id, changed?.event_id);
  for (const event of [firstAsh, secondAsh, removed]) {
    strictEqual(event?.cause_id, spent?.event_id);
  }
  strictEqual(world.entity(taper), null);

  const ashes = entitiesOf(world, "ash");
  strictEqual(ashes.length, 2);
  for (const ash of ashes) {
    deepStrictEqual([ash.support, ash.contained_in, ash.location, ash.pos], [table, null, "e1", null]);
  }
  deepStrictEqual(world.entity(table)?.residue, { soot: 4 });
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);

  // A product traces back to the burn, through the spent mark.
  const ash = ashes[0]!;
  const chain = world.trace({ entity: ash.id, field: "entity" }).events;
  deepStrictEqual(chain.map((event) => event.type), ["changed", "spent", "spawned"]);
  strictEqual(chain[0]?.event_id, changed?.event_id);
  strictEqual(chain[0]?.cause_id, null);

  // The log replays it byte for byte, and verify finds the files as the log makes them.
  strictEqual(canonicalJson(replay(dir)), canonicalJson(world.snapshot()));
  deepStrictEqual(world.verify(), { ok: true, entries: 1, version: world.snapshot().version });
});

test("what is held in a hand or a pocket is used up at its holder's feet", (t) => {
  const { world, ann } = worldOf(t, [
    { id: "hand", template: "taper", overrides: { name: "hand", location: "hall", contained_in: "ann", fuel_pct: 34, props: { burning: true } } },
    { id: "pocket", template: "taper", overrides: { name: "pocket", location: "hall", contained_in: "ann", in_part: "pocket", fuel_pct: 34, props: { burning: true } } },
  ]);
  const hall = world.id("hall")!;
  strictEqual(world.entity(world.id("hand")!)?.contained_in, ann);
  strictEqual(world.entity(world.id("pocket")!)?.in_part, "pocket");
  const result = advance(world, 1);
  strictEqual(result.status, "ok");
  strictEqual(types(result).filter((type) => type === "spent").length, 2);
  const ashes = entitiesOf(world, "ash");
  strictEqual(ashes.length, 4);
  for (const ash of ashes) {
    // Not in the grip it left, which holds one item: on the floor where ann stands.
    deepStrictEqual([ash.support, ash.contained_in, ash.in_part, ash.location, ash.pos], [hall, null, null, hall, { x: 0, y: 0 }]);
  }
  deepStrictEqual(world.entity(hall)?.residue, { soot: 8 });
  strictEqual(world.entity(world.id("hand")!), null);
  strictEqual(world.entity(world.id("pocket")!), null);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("what is used up inside a container leaves its products inside it", (t) => {
  const { world } = worldOf(t, [
    { id: "chest", template: "chest", overrides: { name: "chest", ...floor(-100) } },
    { id: "taper", template: "taper", overrides: { name: "taper", location: "hall", contained_in: "chest", fuel_pct: 34, props: { burning: true } } },
  ]);
  const chest = world.id("chest")!;
  strictEqual(advance(world, 1).status, "ok");
  const ashes = entitiesOf(world, "ash");
  strictEqual(ashes.length, 2);
  for (const ash of ashes) {
    deepStrictEqual([ash.support, ash.contained_in, ash.location, ash.pos], [null, chest, "e1", null]);
  }
  deepStrictEqual(world.entity(chest)?.residue, { soot: 4 });
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("eating a thing whole spends it: bread leaves nothing, a loaf with products leaves them on the table", (t) => {
  const { world, ann } = worldOf(t, [
    { id: "bread", template: "bread", overrides: { name: "bread", location: "hall", support: "table", portions_pct: 25 } },
    { id: "loaf", template: "loaf", overrides: { name: "loaf", location: "hall", support: "table" } },
  ]);
  const table = world.id("table")!;
  const eat = (name: string, id: string) => world.command({ command_id: id, actor: ann, verb: "consume", target: name });
  const bread = eat("bread", "eat-bread");
  strictEqual(bread.status, "ok");
  deepStrictEqual(types(bread), ["consume", "consumed", "spent", "removed"]);
  strictEqual(entitiesOf(world, "ash").length, 0);
  deepStrictEqual(world.entity(table)?.residue, {});

  const loaf = eat("loaf", "eat-loaf");
  strictEqual(loaf.status, "ok");
  deepStrictEqual(types(loaf), ["consume", "consumed", "spent", "spawned", "removed"]);
  const [, , spent, spawned, removed] = loaf.events;
  strictEqual(spawned?.cause_id, spent?.event_id);
  strictEqual(removed?.cause_id, spent?.event_id);
  const [ash] = entitiesOf(world, "ash");
  deepStrictEqual([ash?.support, ash?.location], [table, "e1"]);
  deepStrictEqual(world.entity(table)?.residue, { flour: 2 });
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("a portion that is not the last is not spent", (t) => {
  const { world, ann } = worldOf(t, [
    { id: "bread", template: "bread", overrides: { name: "bread", location: "hall", support: "table" } },
  ]);
  const bite = world.command({ command_id: "bite", actor: ann, verb: "consume", target: "bread" });
  deepStrictEqual(types(bite), ["consume", "consumed"]);
  strictEqual(world.entity(world.id("bread")!)?.props.portions, 3);
});

test("the author's removal never spends: no products, no residue, no spent event", (t) => {
  const { world } = worldOf(t, [
    { id: "taper", template: "taper", overrides: { name: "taper", location: "hall", support: "table", props: { burning: true } } },
  ]);
  const taper = world.id("taper")!;
  const removal = world.edit({ kind: "remove", target: taper });
  strictEqual(removal.status, "ok");
  deepStrictEqual(types(removal), ["edit", "removed"]);
  strictEqual(entitiesOf(world, "ash").length, 0);
  deepStrictEqual(world.entity(world.id("table")!)?.residue, {});
  // Nothing is left to burn out.
  strictEqual(world.snapshot().schedule, undefined);
});

test("a spent event is seen and never heard, and the products it spawns are heard as a break's are", (t) => {
  const { world, ann } = worldOf(t, [
    { id: "taper", template: "taper", overrides: { name: "taper", location: "hall", support: "table", fuel_pct: 34, props: { burning: true } } },
  ]);
  seq += 1;
  const result = world.command(
    { command_id: `spent-${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 1 }, perceivers: true },
  );
  const sensed = (type: string) => result.events.filter((event) => event.type === type).map((event) => event.perceivers);
  deepStrictEqual(sensed("spent"), [{ sight: [ann], hearing: [], smell: [], touch: [], unknown_senses: ["smell", "touch"] }]);
  const [spawned] = sensed("spawned");
  ok(spawned !== undefined);
  deepStrictEqual(spawned.hearing, [ann]);
});

test("the spent keys inherit through extends, are replaced by the child's own, and an empty one clears them", () => {
  const parent = { id: "parent", extends: "stone", spent_products: [{ template: "ash", count: 2 }], spent_residue: { soot: 1 } };
  const set = parseRegistry({
    ...base,
    ash: { id: "ash", extends: "stone" },
    parent,
    inherits: { id: "inherits", extends: "parent" },
    replaces: { id: "replaces", extends: "parent", spent_products: [{ template: "ash", count: 5 }], spent_residue: { grit: 3 } },
    clears: { id: "clears", extends: "parent", spent_products: [], spent_residue: {} },
  });
  deepStrictEqual(set.inherits?.spent_products, [{ template: "ash", count: 2 }]);
  deepStrictEqual(set.inherits?.spent_residue, { soot: 1 });
  deepStrictEqual(set.replaces?.spent_products, [{ template: "ash", count: 5 }]);
  deepStrictEqual(set.replaces?.spent_residue, { grit: 3 });
  strictEqual(set.clears?.spent_products, undefined);
  strictEqual(set.clears?.spent_residue, undefined);
  // A template that leaves nothing carries neither key, so it hashes as it did before they existed.
  strictEqual("spent_products" in (set.stone ?? {}), false);
  ok(templatesHash(set) !== templatesHash(parseRegistry({ ...base, ash: { id: "ash", extends: "stone" } })));
  // The shipped candle is used up; the lantern it extends only goes out.
  deepStrictEqual(base.candle?.processes?.[0]?.then, { spent: true });
  deepStrictEqual(base.lantern?.processes?.[0]?.then, { set_prop: { prop: "burning", value: false } });
});

test("a malformed spent declaration is refused when the set is read", () => {
  const withSpent = (extra: Record<string, unknown>) => () => parseRegistry({ ...base, odd: { id: "odd", extends: "stone", ...extra } });
  throws(withSpent({ spent_products: {} }), /spent_products must be an array/);
  throws(withSpent({ spent_products: [{ count: 1 }] }), /must contain a template id/);
  throws(withSpent({ spent_products: [{ template: "stone", count: 1.5 }] }), /count must be an integer/);
  throws(withSpent({ spent_products: [{ template: "stone", count: -1 }] }), /must not be negative/);
  throws(withSpent({ spent_products: [{ template: "stone", count: 1, extra: 1 }] }), /unknown field extra/);
  throws(withSpent({ spent_residue: [] }), /spent_residue must be an object/);
  throws(withSpent({ spent_residue: { soot: "lots" } }), /spent_residue\.soot must be a finite number/);
  // A bound is still needed, and exactly one effect.
  throws(withSpent({ processes: [burn({ spent: false })] }), /spent must be true/);
  throws(withSpent({ processes: [burn({ spent: true, remove: true })] }), /exactly one of/);
  throws(
    withSpent({ processes: [{ ...burn({ spent: true }), effect: { adjust_prop: { prop: "fuel", by: -1 } } }] }),
    /needs the bound/,
  );
});

test("a template set that loses a product of what is in the world is reported against the entity", (t) => {
  const { world } = worldOf(t, [
    { id: "taper", template: "taper", overrides: { name: "taper", location: "hall", support: "table" } },
  ]);
  const { ash: _gone, ...without } = registry;
  deepStrictEqual(lostField(world.snapshot(), without as TemplateRegistry), {
    entity: world.id("taper")!,
    template: "taper",
    field: "spent_products.ash",
  });
  strictEqual(lostField(world.snapshot(), registry), null);
});
