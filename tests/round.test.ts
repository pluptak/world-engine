import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, openWorld, type Command, type Id, type Scenario, type World } from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { presetRegistry } from "./presets.js";
import { tempDir } from "./harness.js";

// A round (`docs/rounds.md`): each move is decided against the same world, the moves are taken in an order
// the seed and the tick give, and the clock moves once. The race is for one stone in the hall; ann and bob
// both stand in reach of it.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));
const registry = presetRegistry(loadTemplates(templates));

function scenario(extra: Scenario = [], door = "door"): Scenario {
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "door", template: door, overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
    { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 0, y: 80 } } },
    ...extra,
  ];
}

function open(
  t: { after(callback: () => void): void },
  options: { seed?: number; extra?: Scenario; door?: string; registry?: TemplateRegistry; name?: string } = {},
): { world: World; id: (name: string) => Id } {
  const dir = join(tempDir(t), options.name ?? "round");
  const entities = scenario(options.extra, options.door);
  const world = createWorld(dir, options.seed === undefined ? entities : { seed: options.seed, entities }, options.registry ?? registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, id };
}

// A door that jams half the time: a template of its own, since a scenario may not write `jam_pct`.
function jamRegistry(t: { after(callback: () => void): void }): TemplateRegistry {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  writeFileSync(join(dir, "jam_half_door.json"), JSON.stringify({ id: "jam_half_door", extends: "door", props: { jam_pct: 50 } }));
  return presetRegistry(loadTemplates(dir));
}

let seq = 0;
function move(id: Id, verb: string, target?: string, args?: Record<string, unknown>, command_id?: string): Command {
  seq += 1;
  return {
    command_id: command_id ?? `m${seq}`,
    actor: id,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  };
}

test("two agents take one stone in one round: one gets it, the other is preempted, and the clock moves once", (t) => {
  const { world, id } = open(t, { seed: 11 });
  const round = world.round([move(id("ann"), "take", "stone", undefined, "ann-take"), move(id("bob"), "take", "stone", undefined, "bob-take")]);
  strictEqual(round.status, "ok");
  deepStrictEqual(round.results.map((result) => result.status).sort(), ["ok", "preempted"]);
  strictEqual(world.snapshot().tick, 1);
  strictEqual(round.closing?.status, "ok");
  const holder = world.entity(id("stone"))?.contained_in;
  ok(holder === id("ann") || holder === id("bob"));
});

test("the order is a pure function of the seed and the tick: the same seed and tick give the same winner, and the winner varies with the tick", (t) => {
  const race = (world: World, id: (name: string) => Id): void => {
    world.round([move(id("ann"), "take", "stone", undefined, "ann-take"), move(id("bob"), "take", "stone", undefined, "bob-take")]);
  };
  const winners: string[] = [];
  for (let tick = 0; tick < 8; tick += 1) {
    const first = open(t, { seed: 11, name: `a${tick}` });
    const again = open(t, { seed: 11, name: `b${tick}` });
    // Each world is brought to the same tick by empty rounds, which take the closing tick alone.
    for (let step = 0; step < tick; step += 1) {
      first.world.round([]);
      again.world.round([]);
    }
    race(first.world, first.id);
    race(again.world, again.id);
    const winner = first.world.entity(first.id("stone"))?.contained_in;
    strictEqual(again.world.entity(again.id("stone"))?.contained_in, winner, `tick ${tick}`);
    winners.push(winner === first.id("ann") ? "ann" : "bob");
  }
  ok(new Set(winners).size === 2, `both winners appear over the ticks: ${winners.join(",")}`);
});

test("a move refused where the round starts takes no part: it is refused with its own code and nothing changes for it", (t) => {
  const { world, id } = open(t, { seed: 11 });
  // Bob's move is out of the hall: refused at the start, so it is logged as refused and applies nothing.
  const round = world.round([
    move(id("ann"), "take", "stone", undefined, "a1"),
    move(id("bob"), "move", undefined, { to: { x: 99999, y: 0 } }, "bob-far"),
  ]);
  strictEqual(round.results[0]?.status, "ok");
  strictEqual(round.results[1]?.status, "refused");
  strictEqual(round.results[1]?.events.length, 0);
  strictEqual(world.entity(id("bob"))?.pos?.x, 0);
  strictEqual(world.snapshot().tick, 1);
});

test("a wait is not a move of a round, and nor is an edit", (t) => {
  const { world, id } = open(t, { seed: 11 });
  const round = world.round([move(id("ann"), "wait", undefined, { ticks: 3 }, "w1")]);
  deepStrictEqual([round.results[0]?.status, round.results[0]?.reason_code], ["invalid", "not_a_round_move"]);
  // Nothing was applied: the one tick the round takes is its close alone.
  strictEqual(world.snapshot().tick, 1);
});

test("an empty round is one tick, and with no seed one move is taken while two are refused no_seed", (t) => {
  const { world, id } = open(t);
  const empty = world.round([]);
  deepStrictEqual([empty.status, empty.results, world.snapshot().tick], ["ok", [], 1]);
  strictEqual(empty.closing?.status, "ok");
  strictEqual(world.round([move(id("ann"), "take", "stone")]).status, "ok");
  const two = world.round([move(id("ann"), "take", "stone"), move(id("bob"), "wait")]);
  deepStrictEqual([two.status, two.reason_code, two.results.length], ["refused", "no_seed", 0]);
  strictEqual(world.snapshot().tick, 2);
});

test("two moves from one actor are refused duplicate_actor and nothing is applied; a round flag outside a round is refused", (t) => {
  const { world, id } = open(t, { seed: 11 });
  const twice = world.round([move(id("ann"), "take", "stone"), move(id("ann"), "take", "stone")]);
  deepStrictEqual([twice.status, twice.reason_code, twice.results.length], ["invalid", "duplicate_actor", 0]);
  strictEqual(world.snapshot().tick, 0);
  const flagged = world.command({ command_id: "f1", actor: id("ann"), verb: "take", target: "stone", round: true } as Command);
  deepStrictEqual([flagged.status, flagged.reason_code], ["invalid", "invalid_args"]);
});

test("a self-closing door opened in a round closes on the tick it is due, not before", (t) => {
  const { world, id } = open(t, {
    seed: 11,
    extra: [{ id: "shut", template: "self_closing_door", overrides: { name: "shut", location: "hall", support: "hall", pos: { x: -60, y: 0 }, props: { open: false, from: "hall", to: "yard" } } }],
  });
  const opened = world.round([move(id("ann"), "open", "shut", undefined, "o1")]);
  strictEqual(opened.results[0]?.status, "ok");
  const openedEvent = opened.results[0]?.events.find((event) => event.type === "opened");
  ok(openedEvent !== undefined);
  // The close is due two ticks after the opening: the round's own tick does not reach it.
  strictEqual(opened.closing?.events.some((event) => event.type === "closed"), false);
  strictEqual(world.schedule({ kind: "close" })[0]?.due_tick, openedEvent.tick + 2);
  const later = world.round([]);
  strictEqual(later.closing?.events.some((event) => event.type === "closed"), true);
  strictEqual(world.snapshot().tick, 2);
});

test("a door's jam roll is the same whether one agent or two move, since the other move rolls nothing", (t) => {
  const jams = jamRegistry(t);
  const alone = open(t, { seed: 5, name: "alone", door: "jam_half_door", registry: jams });
  const crowd = open(t, { seed: 5, name: "crowd", door: "jam_half_door", registry: jams });
  const one = alone.world.round([move(alone.id("ann"), "open", "door", undefined, "o")]);
  const two = crowd.world.round([
    move(crowd.id("bob"), "take", "stone", undefined, "t"),
    move(crowd.id("ann"), "open", "door", undefined, "o"),
  ]);
  const types = (result: { events: { type: string }[] } | undefined) => result?.events.map((event) => event.type);
  deepStrictEqual(types(one.results[0]), types(two.results[1]));
  deepStrictEqual(alone.world.snapshot().rng, crowd.world.snapshot().rng);
});

test("a store world replays a round exactly: its log verifies, and a reopened world is the same", (t) => {
  const dir = join(tempDir(t), "stored");
  const stored = createWorld(dir, { seed: 11, entities: scenario() }, registry);
  const [ann, bob] = [stored.id("ann"), stored.id("bob")];
  ok(ann !== null && bob !== null);
  stored.round([move(ann, "take", "stone", undefined, "a"), move(bob, "take", "stone", undefined, "b")]);
  stored.round([]);
  strictEqual(stored.verify().ok, true);
  strictEqual(openWorld(dir).snapshot().tick, 2);
  deepStrictEqual(openWorld(dir).snapshot().entities, stored.snapshot().entities);
});

test("a running run refuses a lone command and the author's advance, and takes its agents' moves in a round", (t) => {
  const dir = join(tempDir(t), "running");
  const world = createWorld(dir, { seed: 11, entities: scenario(), run: { tick_limit: 10, slots: ["ann"] } }, registry);
  const ann = world.id("ann");
  ok(ann !== null);
  strictEqual(world.edit({ kind: "start_run" }).status, "ok");
  const lone = world.command({ command_id: "lone", actor: ann, verb: "take", target: "stone" });
  deepStrictEqual([lone.status, lone.reason_code], ["refused", "round_only"]);
  const advanced = world.command({ command_id: "adv", actor: "world", verb: "advance", args: { ticks: 1 } });
  deepStrictEqual([advanced.status, advanced.reason_code], ["refused", "round_only"]);
  strictEqual(world.round([move(ann, "take", "stone")]).results[0]?.status, "ok");
});
