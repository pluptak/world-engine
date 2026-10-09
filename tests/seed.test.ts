import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cli } from "./cli-run.js";
import { canonicalJson, createWorld, memoryWorld, openWorld, WORLD_AUTHOR, type Id, type Result, type World } from "../src/index.js";
import { nextRandom } from "../src/engine/rng.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { replay } from "../src/store/file-store.js";
import { loadTemplates, parseRegistry, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// The dice live in the snapshot: a state that every roll advances, so the same seed and the same
// commands always roll the same, through any handle and through replay.

const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const registry: TemplateRegistry = parseRegistry({
  ...base,
  // Grows a point every tick, but only on half the runs.
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
  { id: "lichen", template: "lichen", overrides: { name: "lichen", location: "tent", support: "tent", pos: { x: 100, y: 0 } } },
];

function open(t: { after(callback: () => void): void }, seed?: number): { dir: string; world: World; lichen: Id; ann: Id } {
  const root = tempDir(t);
  const dir = join(root, "w");
  const world = createWorld(dir, entries, registry, seed === undefined ? undefined : { seed });
  return { dir, world, lichen: world.id("lichen")!, ann: world.id("ann")! };
}

// Numbered by the world's own version, so two worlds given the same calls log the same lines.
const advance = (world: World, ticks: number): Result =>
  world.command({ command_id: `s${world.snapshot().version}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });

const size = (world: World, lichen: Id): unknown => world.entity(lichen)?.props.size;

test("the generator is mulberry32: a state in, a number in [0, 1) and the next state out", () => {
  const first = nextRandom(0);
  const second = nextRandom(first.state);
  ok(first.value >= 0 && first.value < 1 && second.value >= 0 && second.value < 1);
  strictEqual(first.state, 0x6d2b79f5);
  deepStrictEqual(nextRandom(0), first);
  ok(first.value !== second.value);
});

test("the same seed and commands give a byte-identical world through two handles and through replay", (t) => {
  const one = open(t, 42);
  const two = open(t, 42);
  for (const world of [one.world, two.world]) {
    advance(world, 30);
    advance(world, 30);
  }
  strictEqual(canonicalJson(one.world.snapshot()), canonicalJson(two.world.snapshot()));
  strictEqual(canonicalJson(openWorld(one.dir).snapshot()), canonicalJson(one.world.snapshot()));
  strictEqual(readFileSync(join(one.dir, "log.jsonl"), "utf8"), readFileSync(join(two.dir, "log.jsonl"), "utf8"));
  strictEqual(canonicalJson(replay(one.dir, registry)), canonicalJson(one.world.snapshot()));
  // 60 runs at one in two: some grew and some did not, and the dice moved.
  const grown = size(one.world, one.lichen) as number;
  ok(grown > 1 && grown < 61, `size ${grown}`);
  ok(one.world.snapshot().rng !== 42);
  deepStrictEqual(validateSnapshot(one.world.snapshot(), registry), []);
});

test("a miss writes nothing and says nothing, and a different seed rolls differently", (t) => {
  const one = open(t, 1);
  const result = advance(one.world, 40);
  const changed = result.events.filter((event) => event.type === "changed");
  strictEqual(size(one.world, one.lichen), 1 + changed.length);
  ok(changed.length > 0 && changed.length < 40, `grew ${changed.length} times in 40 runs`);
  // Every run is accounted for: the process is still pending, so the misses rescheduled it.
  strictEqual(one.world.snapshot().schedule?.some((cause) => cause.kind === "process"), true);

  const other = open(t, 2);
  advance(other.world, 40);
  ok(canonicalJson(other.world.snapshot()) !== canonicalJson(one.world.snapshot()));
});

test("a world with no seed refuses what would roll, with nothing changed, until it is given one", (t) => {
  const { world, lichen } = open(t);
  const before = canonicalJson(world.snapshot());
  const refused = advance(world, 5);
  deepStrictEqual([refused.status, refused.reason_code], ["refused", "no_seed"]);
  strictEqual(canonicalJson(world.snapshot()), before);
  strictEqual("rng" in world.snapshot(), false);
  // Nothing was made up: a check says the same.
  deepStrictEqual(world.check({ command_id: "c", actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 5 } }).reason_code, "no_seed");

  // Commands that roll nothing carry on; time that does not reach the process is not a roll either.
  strictEqual(world.edit({ kind: "set_seed", seed: 7 }).status, "ok");
  strictEqual(world.snapshot().rng, 7);
  strictEqual(advance(world, 5).status, "ok");
  ok(world.snapshot().rng !== 7);
  ok((size(world, lichen) as number) >= 1);
});

test("a refused, invalid, checked or preempted command leaves the dice alone", (t) => {
  const { world, ann, lichen } = open(t, 99);
  advance(world, 3);
  const rng = world.snapshot().rng;
  world.check({ command_id: "c1", actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 10 } });
  strictEqual(world.snapshot().rng, rng);
  strictEqual(advance(world, 0).status, "invalid");
  strictEqual(world.snapshot().rng, rng);

  // Sent against a version in which the lichen was in reach: ok then, out of reach now, so
  // preempted, and the tick it would have taken rolled nothing.
  const stale = world.snapshot().version;
  strictEqual(world.edit({ kind: "place", target: lichen, support: "e1", pos: { x: 400, y: 0 } }).status, "ok");
  const after = world.snapshot().rng;
  const late = world.command({ command_id: "late", actor: ann, verb: "take", target: "lichen" }, { basedOn: stale });
  strictEqual(late.status, "preempted");
  strictEqual(world.snapshot().rng, after);
});

test("a seed is a whole number from 0 to 2^32 - 1, in a snapshot, an edit and an option", (t) => {
  const { world } = open(t, 5);
  const snapshot = world.snapshot();
  for (const bad of [-1, 1.5, 2 ** 32, Number.NaN]) {
    deepStrictEqual(validateSnapshot({ ...snapshot, rng: bad }, registry).map((issue) => issue.code), ["invalid_rng"]);
    deepStrictEqual(world.edit({ kind: "set_seed", seed: bad }).status, "invalid");
    throws(() => memoryWorld(snapshot, registry, {}, { seed: bad }), TypeError);
  }
  strictEqual(world.edit({ kind: "set_seed", seed: 2 ** 32 - 1 }).status, "ok");
  strictEqual(world.snapshot().rng, 2 ** 32 - 1);
  // The option replaces the snapshot's own.
  strictEqual(memoryWorld(snapshot, registry, {}, { seed: 11 }).snapshot().rng, 11);
});

test("chance_pct is a whole number from 1 to 99 and inherited through extends", () => {
  for (const bad of [0, 100, 1.5, "half"]) {
    throws(
      () =>
        parseRegistry({
          ...base,
          bad: { id: "bad", extends: "stone", props: { n: 0 }, processes: [{ id: "p", every_ticks: 1, chance_pct: bad, effect: { adjust_prop: { prop: "n", by: 1 } } }] },
        }),
      TypeError,
    );
  }
  const child = parseRegistry({ ...registry, moss: { id: "moss", extends: "lichen" } });
  strictEqual(child.moss?.processes?.[0]?.chance_pct, 50);
});

test("a scenario file may carry a seed, and init gives the world its dice", (t) => {
  const root = tempDir(t);
  const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
  const run = (args: string[], input?: string) => cli(input, args);
  const file = join(root, "seeded.json");
  writeFileSync(file, JSON.stringify({ seed: 123, entities: [{ id: "tent", template: "room", overrides: { name: "tent" } }] }));
  const made = run(["init", join(root, "w1"), file]);
  strictEqual(made.status, 0, made.stdout + made.stderr);
  const snapshot = JSON.parse(run([], JSON.stringify({ op: "snapshot", world: join(root, "w1") })).stdout);
  strictEqual(snapshot.rng, 123);

  const plain = join(root, "plain.json");
  writeFileSync(plain, JSON.stringify([{ id: "tent", template: "room", overrides: { name: "tent" } }]));
  strictEqual(run(["init", join(root, "w2"), plain]).status, 0);
  const none = JSON.parse(run([], JSON.stringify({ op: "snapshot", world: join(root, "w2") })).stdout);
  strictEqual("rng" in none, false);

  const bad = join(root, "bad.json");
  writeFileSync(bad, JSON.stringify({ seed: -3, entities: [] }));
  strictEqual(run(["init", join(root, "w3"), bad]).status, 2);
});
