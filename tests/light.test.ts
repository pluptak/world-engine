import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, WORLD_AUTHOR, type Id, type Result, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { SHARED_FIXTURES } from "./presets.js";
import { tempDir } from "./harness.js";

// A room is lit when it says so or when something burning in it gives light, so darkness can fall
// by itself: a lantern lit in a dark room lets those in it see, a carried one lights wherever its
// carrier stands, and a light that burns out takes the room with it.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
// A light source with no fuel to burn: it burns without end. Making a stone a light source is a
// definition, so it is a preset of its own.
const presets = parseRegistry({
  ...registry,
  ...SHARED_FIXTURES,
  unfueled_light: { id: "unfueled_light", extends: "stone", props: { light_source: true } },
});

interface Dark {
  world: World;
  ann: Id;
  bob: Id;
  lantern: Id;
  note: Id;
  pebble: Id;
  hall: Id;
  yard: Id;
}

function dark(t: { after(callback: () => void): void }, extra: Parameters<typeof createWorld>[1] = []): Dark {
  const root = tempDir(t);
  const world = createWorld(join(root, "w"), [
    { id: "hall", template: "room", overrides: { name: "hall" } },
    { id: "yard", template: "room", overrides: { name: "yard" } },
    { id: "door", template: "door", overrides: { name: "door", props: { open: true, from: "hall", to: "yard" } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: -100, y: 0 } } },
    { id: "lantern", template: "lantern", overrides: { name: "lantern", location: "hall", support: "hall", pos: { x: 40, y: 0 } } },
    { id: "note", template: "stone", overrides: { name: "note", location: "hall", support: "hall", pos: { x: 0, y: 60 } } },
    { id: "pebble", template: "stone", overrides: { name: "pebble", location: "yard", support: "yard", pos: { x: 150, y: 0 } } },
    ...extra,
  ], presets);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, ann: id("ann"), bob: id("bob"), lantern: id("lantern"), note: id("note"), pebble: id("pebble"), hall: id("hall"), yard: id("yard") };
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

function advance(world: World, ticks: number): Result {
  seq += 1;
  return world.command({ command_id: `a${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });
}

const sees = (world: World, observer: Id, entity: Id) =>
  world.query({ kind: "perceive", observer, sense: "sight", entity });

test("a lantern lit in a dark room lets those in it see, and the lit event is seen", (t) => {
  const { world, ann, bob, lantern, note } = dark(t);
  deepStrictEqual(sees(world, bob, note), { value: "false", basis_code: "location_unlit" });

  const lit = run(world, ann, "light", "lantern");
  strictEqual(lit.status, "ok");
  deepStrictEqual(lit.events.slice(0, 2).map((event) => event.type), ["light", "lit"]);
  strictEqual(world.entity(lantern)?.props.burning, true);
  deepStrictEqual(sees(world, bob, note), { value: "true", basis_code: "same_location_lit" });
  // The lighting is itself seen, though it began in the dark: the room is lit after the command.
  const litEvent = lit.events.find((event) => event.type === "lit");
  ok(litEvent);
  strictEqual(world.query({ kind: "perceive", observer: bob, sense: "sight", event_id: litEvent.event_id }).value, "true");
  // A hand act: nobody hears it.
  strictEqual(world.query({ kind: "perceive", observer: bob, sense: "hearing", event_id: litEvent.event_id }).value, "false");
});

test("dousing darkens the room, and was seen by those who saw it done", (t) => {
  const { world, ann, bob, note } = dark(t);
  run(world, ann, "light", "lantern");
  const doused = run(world, ann, "douse", "lantern");
  strictEqual(doused.status, "ok");
  deepStrictEqual(sees(world, bob, note), { value: "false", basis_code: "location_unlit" });
  const event = doused.events.find((candidate) => candidate.type === "doused");
  ok(event);
  // Lit before the command, dark after: seen, since a perceive is true at either end.
  strictEqual(world.query({ kind: "perceive", observer: bob, sense: "sight", event_id: event.event_id }).value, "true");
  // Nothing burns, so the burn process is withdrawn and the fuel stays.
  strictEqual(world.snapshot().schedule?.some((cause) => cause.kind === "process") ?? false, false);
});

test("a lantern burns out by itself, and the room goes dark with it", (t) => {
  const { world, ann, bob, lantern, note } = dark(t);
  run(world, ann, "light", "lantern");
  const fuelAt = (): unknown => world.entity(lantern)?.props.fuel;
  strictEqual(fuelAt(), 19);
  advance(world, 10);
  strictEqual(fuelAt(), 9);
  strictEqual(world.entity(lantern)?.props.burning, true);
  deepStrictEqual(sees(world, bob, note), { value: "true", basis_code: "same_location_lit" });

  const burnout = advance(world, 30);
  const written = burnout.events.filter((event) => event.type === "changed" && event.entity === lantern);
  deepStrictEqual(
    written.slice(-2).map((event) => [event.tick, event.data.prop, event.data.to]),
    [[20, "fuel", 0], [20, "burning", false]],
  );
  strictEqual(written.length, 10);
  strictEqual(world.entity(lantern)?.props.burning, false);
  deepStrictEqual(sees(world, bob, note), { value: "false", basis_code: "location_unlit" });
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);

  // The chain reads back from the burnout to the lighting.
  const chain = world.trace({ entity: lantern, field: "props" }).events.map((event) => event.type);
  deepStrictEqual(chain.slice(0, 2), ["light", "lit"]);
  deepStrictEqual(chain.slice(-2), ["changed", "changed"]);

  // Out of fuel it will not light again.
  const again = run(world, ann, "light", "lantern");
  strictEqual(again.reason_code, "no_fuel");
});

test("a carried lantern lights the room its carrier stands in, and follows a move", (t) => {
  const { world, ann, bob, note, pebble, yard } = dark(t);
  strictEqual(run(world, ann, "take", "lantern").status, "ok");
  strictEqual(run(world, ann, "light", "lantern").status, "ok");
  // Held in a hand, it lights the hall where Ann stands.
  strictEqual(sees(world, bob, note).value, "true");

  strictEqual(run(world, ann, "move", undefined, { location: yard }).status, "ok");
  // It left with her: the yard is lit, and the hall behind her is dark again.
  strictEqual(sees(world, ann, pebble).value, "true");
  deepStrictEqual(sees(world, bob, note), { value: "false", basis_code: "location_unlit" });
  // Across the open door sight needs both rooms lit, and only one is.
  strictEqual(sees(world, ann, note).value, "false");
});

test("a room that is lit by its own prop stays lit when a light in it is doused", (t) => {
  const { world, ann, bob, note, hall } = dark(t);
  strictEqual(world.edit({ kind: "set_props", target: hall, props: { lit: true } }).status, "ok");
  run(world, ann, "light", "lantern");
  run(world, ann, "douse", "lantern");
  strictEqual(sees(world, bob, note).value, "true");
});

test("a light shut in a closed container gives none, and opening it lets the light out", (t) => {
  const { world, ann, bob, lantern, note } = dark(t, [
    { id: "chest", template: "shut_chest", overrides: { name: "chest", location: "hall", support: "hall", pos: { x: 50, y: 50 } } },
  ]);
  const chestId = world.id("chest")!;
  const placed = world.edit({ kind: "place", target: lantern, contained_in: chestId, pos: null });
  strictEqual(placed.status, "ok", String(placed.reason_code));
  // Ann can neither see nor grope for it in the shut chest, so she cannot name it; the author can
  // set it burning.
  strictEqual(run(world, ann, "light", "lantern").status, "unresolved");
  strictEqual(world.edit({ kind: "set_props", target: lantern, props: { ...world.entity(lantern)!.props, burning: true } }).status, "ok");
  deepStrictEqual(sees(world, bob, note), { value: "false", basis_code: "location_unlit" });
  const opened = run(world, ann, "open", "chest");
  strictEqual(opened.status, "ok", String(opened.reason_code));
  deepStrictEqual(sees(world, bob, note), { value: "true", basis_code: "same_location_lit" });
});

test("light and douse refuse with declared codes", (t) => {
  const { world, ann, lantern, note } = dark(t, [
    { id: "dog", template: "dog", overrides: { name: "rex", location: "hall", support: "hall", pos: { x: 30, y: 0 } } },
    { id: "far", template: "candle", overrides: { name: "far", location: "hall", support: "hall", pos: { x: 400, y: 0 } } },
    { id: "ever", template: "unfueled_light", overrides: { name: "ever", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
  ]);
  const dog = world.id("dog")!;
  const code = (result: Result) => [result.status, result.reason_code];
  deepStrictEqual(code(run(world, ann, "light", "note")), ["refused", "not_a_light"]);
  // In the dark the far candle is neither seen nor in reach; lit by the lantern, it is seen and out
  // of reach.
  deepStrictEqual(code(run(world, ann, "light", "far")), ["unresolved", undefined]);
  deepStrictEqual(code(run(world, ann, "douse", "lantern")), ["refused", "not_burning"]);
  deepStrictEqual(code(run(world, dog, "light", "lantern")), ["refused", "insufficient_manipulation"]);
  strictEqual(run(world, ann, "light", "lantern").status, "ok");
  deepStrictEqual(code(run(world, ann, "light", "far")), ["refused", "out_of_reach"]);
  deepStrictEqual(code(run(world, ann, "light", "lantern")), ["refused", "already_burning"]);
  world.edit({ kind: "set_props", target: lantern, props: { ...world.entity(lantern)!.props, burning: false, fuel: 0 } });
  deepStrictEqual(code(run(world, ann, "light", "lantern")), ["refused", "no_fuel"]);
  deepStrictEqual(code(run(world, ann, "light", `${ann}.hand_l`)), ["refused", "target_attached"]);
  // A light with no fuel prop at all burns without end.
  strictEqual(run(world, ann, "light", "ever").status, "ok");
  strictEqual(world.entity(world.id("ever")!)?.props.burning, true);
});

test("a candle is a lantern with less fuel that is used up where a lantern only goes out", () => {
  strictEqual(registry.candle?.props.fuel, 8);
  strictEqual(registry.lantern?.props.fuel, 20);
  const burn = (id: string) => registry[id]?.processes?.[0];
  // The same burn, but for what it does on reaching the bound.
  deepStrictEqual({ ...burn("candle"), then: undefined }, { ...burn("lantern"), then: undefined });
  deepStrictEqual(burn("lantern")?.then, { set_prop: { prop: "burning", value: false } });
  deepStrictEqual(burn("candle")?.then, { spent: true });
  strictEqual(registry.candle?.props.light_source, true);
});
