import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, WORLD_AUTHOR, type Id, type Result, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";

// Eating and drinking: a solid thing with `nutrition` is eaten whole, a vessel's liquid is drunk by
// the amount, and either lowers the eater's `hunger`, which a hungry body raises by itself.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const hungry = registry.human_hungry!.props;

interface Table {
  world: World;
  ann: Id;
  gus: Id;
  rex: Id;
  bread: Id;
}

function table(t: { after(callback: () => void): void }, gusProps: Record<string, number | string | boolean> = {}, extra: Parameters<typeof createWorld>[1] = []): Table {
  const root = mkdtempSync(join(tmpdir(), "world-engine-consume-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const world = createWorld(join(root, "w"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    {
      id: "gus",
      template: "human_hungry",
      overrides: { name: "gus", location: "hall", support: "hall", pos: { x: -100, y: 0 }, props: { ...hungry, ...gusProps } },
    },
    { id: "rex", template: "dog", overrides: { name: "rex", location: "hall", support: "hall", pos: { x: 100, y: 0 } } },
    { id: "bread", template: "bread", overrides: { name: "bread", location: "hall", support: "hall", pos: { x: -80, y: 0 } } },
    ...extra,
  ]);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, ann: id("ann"), gus: id("gus"), rex: id("rex"), bread: id("bread") };
}

let seq = 0;
function run(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `c${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

const advance = (world: World, ticks: number): Result => {
  seq += 1;
  return world.command({ command_id: `a${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });
};

const code = (result: Result) => [result.status, result.reason_code];

test("bread is eaten whole: the hunger it lowers, the item it takes, and the chain between them", (t) => {
  const { world, gus, bread } = table(t, { hunger: 50 });
  const eaten = run(world, gus, "consume", "bread");
  strictEqual(eaten.status, "ok");
  deepStrictEqual(eaten.events.map((event) => event.type), ["consume", "consumed", "removed"]);
  const [root, consumed, removed] = eaten.events;
  strictEqual(consumed?.cause_id, root?.event_id);
  strictEqual(removed?.cause_id, consumed?.event_id);
  deepStrictEqual(consumed?.data, { nutrition: 40 });
  strictEqual(world.entity(bread), null);
  strictEqual(world.entity(gus)?.props.hunger, 10);
  // The write to hunger is recorded under the `consumed` event.
  const delta = eaten.deltas.find((candidate) => candidate.entity === gus && candidate.field === "props");
  strictEqual(delta?.event_id, consumed?.event_id);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("hunger is floored at 0, and a body with no hunger eats all the same", (t) => {
  const { world, ann, gus } = table(t, { hunger: 10 }, [
    { id: "crust", template: "bread", overrides: { name: "crust", location: "hall", support: "hall", pos: { x: 20, y: 0 } } },
  ]);
  strictEqual(run(world, gus, "consume", "bread").status, "ok");
  strictEqual(world.entity(gus)?.props.hunger, 0);
  // Ann is an ordinary human: no hunger to lower, and the crust is eaten anyway.
  strictEqual(run(world, ann, "consume", "crust").status, "ok");
  strictEqual(world.entity(world.id("crust")!), null);
  strictEqual("hunger" in (world.entity(ann)?.props ?? {}), false);
});

test("what is carried is eaten from the hand, and refusals are declared", (t) => {
  const chestProps = registry.chest!.props;
  const { world, ann, gus } = table(t, {}, [
    { id: "chest", template: "chest", overrides: { name: "chest", location: "hall", support: "hall", pos: { x: 60, y: 60 }, props: { ...chestProps, openable: true, open: false } } },
    { id: "far", template: "bread", overrides: { name: "far", location: "hall", support: "hall", pos: { x: 400, y: 0 } } },
    { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 30, y: 0 } } },
  ]);
  const chest = world.id("chest")!;
  const stored = world.edit({ kind: "spawn", template: "bread", overrides: { name: "hidden", contained_in: chest } });
  strictEqual(stored.status, "ok");
  deepStrictEqual(code(run(world, ann, "consume", "stone")), ["refused", "not_consumable"]);
  deepStrictEqual(code(run(world, ann, "consume", "far")), ["refused", "out_of_reach"]);
  deepStrictEqual(code(run(world, ann, "consume", "hidden")), ["refused", "container_closed"]);
  deepStrictEqual(code(run(world, ann, "consume", `${gus}.head`)), ["refused", "not_consumable"]);
  deepStrictEqual(code(run(world, ann, "consume", "bread", { amount: 5 })), ["invalid", "invalid_args"]);
  // Picked up, the bread is in hand and eaten there.
  strictEqual(run(world, gus, "take", "bread").status, "ok");
  strictEqual(run(world, gus, "consume", "bread").status, "ok");
});

test("a vessel is drunk by the amount and stays, emptied of its material at 0", (t) => {
  const { world, gus } = table(t, { hunger: 50 }, [
    { id: "wine", template: "wine_bottle", overrides: { name: "wine", location: "hall", support: "hall", pos: { x: -60, y: 20 } } },
  ]);
  const wine = world.id("wine")!;
  strictEqual(world.entity(wine)?.props.liquid_amount, 75);
  const first = run(world, gus, "consume", "wine", { amount: 30 });
  strictEqual(first.status, "ok");
  deepStrictEqual(first.events.map((event) => event.type), ["consume", "consumed"]);
  deepStrictEqual(first.events[1]?.data, { nutrition: 3, material: "grape_wine", amount: 30 });
  deepStrictEqual([world.entity(wine)?.props.liquid_amount, world.entity(gus)?.props.hunger], [45, 47]);

  deepStrictEqual(code(run(world, gus, "consume", "wine", { amount: 100 })), ["refused", "insufficient_liquid"]);
  deepStrictEqual(code(run(world, gus, "consume", "wine", { amount: 0 })), ["invalid", "invalid_args"]);
  deepStrictEqual(code(run(world, gus, "consume", "wine", { amount: "all" })), ["invalid", "invalid_args"]);

  // No amount takes what is left; the vessel is not removed.
  strictEqual(run(world, gus, "consume", "wine").status, "ok");
  deepStrictEqual(
    [world.entity(wine)?.props.liquid_amount, world.entity(wine)?.props.liquid_material, world.entity(gus)?.props.hunger],
    [0, "", 43],
  );
  deepStrictEqual(code(run(world, gus, "consume", "wine")), ["refused", "not_consumable"]);
});

test("a liquid that declares no nutrition is not drunk", (t) => {
  const { world, gus } = table(t, {}, [
    { id: "oil", template: "bottle", overrides: { name: "oil", location: "hall", support: "hall", pos: { x: -60, y: 20 }, props: { liquid_material: "lamp_oil", liquid_amount: 40 } } },
  ]);
  deepStrictEqual(code(run(world, gus, "consume", "oil")), ["refused", "not_consumable"]);
});

test("a creature whose jaw holds something else cannot eat, and one with a free jaw can", (t) => {
  const { world, rex } = table(t, {}, [
    { id: "stick", template: "stone", overrides: { name: "stick", location: "hall", support: "hall", pos: { x: 110, y: 0 } } },
    { id: "scrap", template: "bread", overrides: { name: "scrap", location: "hall", support: "hall", pos: { x: 120, y: 10 } } },
  ]);
  strictEqual(run(world, rex, "take", "stick").status, "ok");
  deepStrictEqual(code(run(world, rex, "consume", "scrap")), ["refused", "mouth_full"]);
  strictEqual(run(world, rex, "drop", "stick").status, "ok");
  strictEqual(run(world, rex, "consume", "scrap").status, "ok");
  // A dog needs no hands: eating asks for no capacity at all.
  strictEqual(world.entity(world.id("scrap")!), null);
});

test("a hungry body's hunger rises by itself, and eating lowers it and starts the rise again", (t) => {
  const { world, gus } = table(t, { hunger: 99 });
  const rose = advance(world, 12);
  deepStrictEqual(
    rose.events.filter((event) => event.type === "changed" && event.entity === gus).map((event) => [event.tick, event.data.prop, event.data.to]),
    [[10, "hunger", 100]],
  );
  // At the cap the rise ends and the starving begins, every five ticks.
  strictEqual(world.snapshot().schedule?.some((cause) => cause.kind === "process" && cause.process === "starve"), true);
  strictEqual(world.snapshot().schedule?.some((cause) => cause.kind === "process" && cause.process === "hunger"), false);

  strictEqual(run(world, gus, "consume", "bread").status, "ok");
  strictEqual(world.entity(gus)?.props.hunger, 60);
  // Eating withdrew the starving and started the rise again.
  strictEqual(world.snapshot().schedule?.some((cause) => cause.kind === "process" && cause.process === "starve"), false);
  strictEqual(world.snapshot().schedule?.some((cause) => cause.kind === "process" && cause.process === "hunger"), true);
});

test("a body left at full hunger starves to destruction, dropping what it held", (t) => {
  const { world, gus } = table(t, { hunger: 100, starvation: 18 }, [
    { id: "hoard", template: "stone", overrides: { name: "hoard", location: "hall", contained_in: "gus", in_part: "hand_l" } },
  ]);
  const hoard = world.id("hoard")!;
  const run10 = advance(world, 12);
  const types = run10.events.filter((event) => event.entity === gus || event.entity === hoard).map((event) => event.type);
  deepStrictEqual(types, ["changed", "changed", "destroyed", "dropped"]);
  strictEqual(world.entity(gus)?.status, "destroyed");
  strictEqual(world.entity(hoard)?.contained_in, null);
  deepStrictEqual(code(run(world, gus, "consume", "bread")), ["invalid", "not_an_agent"]);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});
