import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, memoryWorld, WORLD_AUTHOR, type Id, type World } from "../src/index.js";
import { loadTemplates, parseRegistry, type TemplateRegistry } from "../src/templates.js";

// A fork is a memory world that starts from a world's snapshot as it is now: same templates, names,
// coverage and dice, its own history from that version on, and nothing shared with its parent.

const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const registry: TemplateRegistry = parseRegistry({
  ...base,
  lichen: {
    id: "lichen",
    extends: "stone",
    props: { size: 1 },
    fields: { size: { tier: "state", type: "integer" } },
    processes: [{ id: "grow", every_ticks: 1, chance_pct: 50, effect: { adjust_prop: { prop: "size", by: 1, max: 1000 } } }],
  },
});

const entries = [
  { id: "tent", template: "room", overrides: { name: "tent", props: { lit: true } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "tent", support: "tent", pos: { x: 0, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "tent", support: "tent", pos: { x: -100, y: 0 } } },
  { id: "rock", template: "stone", overrides: { name: "rock", location: "tent", support: "tent", pos: { x: 60, y: 0 } } },
  { id: "lichen", template: "lichen", overrides: { name: "lichen", location: "tent", support: "tent", pos: { x: 200, y: 0 } } },
];

function open(t: { after(callback: () => void): void }): { world: World; ann: Id; bob: Id } {
  const root = mkdtempSync(join(tmpdir(), "world-engine-fork-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const world = createWorld(join(root, "w"), entries, registry, { seed: 77 });
  return { world, ann: world.id("ann")!, bob: world.id("bob")! };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const advance = (world: World, id: string, ticks: number) =>
  world.command({ command_id: id, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });

test("a fork starts where its parent is, with the same names and dice, and its history begins there", (t) => {
  const { world, ann } = open(t);
  advance(world, "a1", 5);
  const fork = world.fork();
  strictEqual(canonicalJson(fork.snapshot()), canonicalJson(world.snapshot()));
  strictEqual(fork.id("ann"), ann);
  strictEqual(fork.snapshot().rng, world.snapshot().rng);

  const at = fork.snapshot().version;
  deepStrictEqual(fork.since(at), { deltas: [], events: [] });
  throws(() => fork.since(at - 1), { code: "history_unavailable" });
  throws(() => fork.attempts(at - 1), { code: "history_unavailable" });
  throws(() => fork.trace({ entity: world.id("lichen")!, field: "props" }), { code: "history_unavailable" });
});

test("two forks given the same commands end byte-identical, and the parent does not move", (t) => {
  const { world, ann } = open(t);
  advance(world, "a1", 3);
  const parent = deepFreeze(structuredClone(world.snapshot()));
  const one = world.fork();
  const two = world.fork();
  for (const fork of [one, two]) {
    advance(fork, "f1", 20);
    fork.command({ command_id: "f2", actor: ann, verb: "take", target: "rock" });
  }
  strictEqual(canonicalJson(one.snapshot()), canonicalJson(two.snapshot()));
  strictEqual(canonicalJson(one.since(parent.version).events), canonicalJson(two.since(parent.version).events));
  ok(one.snapshot().version > parent.version);
  strictEqual(canonicalJson(world.snapshot()), canonicalJson(parent));
});

test("forks given different commands diverge, each unseen by the other and by the parent", (t) => {
  const { world, ann, bob } = open(t);
  const before = canonicalJson(world.snapshot());
  const one = world.fork();
  const two = world.fork();
  strictEqual(one.command({ command_id: "x", actor: ann, verb: "take", target: "rock" }).status, "ok");
  strictEqual(two.command({ command_id: "y", actor: bob, verb: "move", args: { to: { x: -150, y: 20 } } }).status, "ok");
  strictEqual(one.entity(world.id("rock")!)?.contained_in, ann);
  strictEqual(two.entity(world.id("rock")!)?.contained_in, null);
  strictEqual(one.entity(bob)?.pos?.x, -100);
  strictEqual(canonicalJson(world.snapshot()), before);
  // A parent that moves on leaves its forks where they were.
  advance(world, "p1", 10);
  strictEqual(one.snapshot().version, 1);
  // Rolling from the same state, a fork and its parent roll the same: the dice forked with it.
  const late = world.fork();
  const twin = world.fork();
  advance(late, "l1", 15);
  advance(twin, "l1", 15);
  strictEqual(canonicalJson(late.snapshot()), canonicalJson(twin.snapshot()));
});

test("a fork of a memory world answers query and observe as its parent did at that version", (t) => {
  const parent = memoryWorld(open(t).world.snapshot(), registry, { ann: "e2", bob: "e3" });
  for (let i = 0; i < 12; i += 1) {
    advance(parent, `m${i}`, 2);
  }
  parent.command({ command_id: "take", actor: "e2", verb: "take", target: "rock" });
  const fork = parent.fork();
  deepStrictEqual(fork.observe("e2", {}), parent.observe("e2", {}));
  deepStrictEqual(
    fork.query({ kind: "perceive", observer: "e3", sense: "sight", entity: "e4" }),
    parent.query({ kind: "perceive", observer: "e3", sense: "sight", entity: "e4" }),
  );
  deepStrictEqual(fork.query({ kind: "fact", subject: "e4", relation: "contained_in", object: "e2" }), parent.query({ kind: "fact", subject: "e4", relation: "contained_in", object: "e2" }));
  strictEqual(fork.id("bob"), "e3");
});

test("a stale command still preempts inside a fork, and a fork of a fork works", (t) => {
  const { world, ann } = open(t);
  const fork = world.fork();
  const stale = fork.snapshot().version;
  strictEqual(fork.edit({ kind: "place", target: world.id("rock")!, support: "e1", pos: { x: 400, y: 0 } }).status, "ok");
  const late = fork.command({ command_id: "late", actor: ann, verb: "take", target: "rock" }, { basedOn: stale });
  strictEqual(late.status, "preempted");

  const grand = fork.fork();
  strictEqual(grand.snapshot().version, fork.snapshot().version);
  strictEqual(grand.edit({ kind: "set_seed", seed: 1 }).status, "ok");
  strictEqual(fork.snapshot().rng, world.snapshot().rng);
});
