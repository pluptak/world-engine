import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import {
  actorWorld,
  canonicalJson,
  createWorld,
  memoryWorld,
  type ActorCommand,
  type Scenario,
  type World,
} from "../src/index.js";
import { tempDir } from "./harness.js";

// Ann and bob in a hall with a stone at ann's feet and a chest 300 cm off; lit or not.
function hall(lit: boolean): Scenario {
  const at = (x: number) => ({ location: "hall", support: "hall", pos: { x, y: 0 } });
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit } } },
    { id: "ann", template: "human", overrides: { name: "ann", ...at(0) } },
    { id: "bob", template: "human", overrides: { name: "bob", ...at(40) } },
    { id: "stone", template: "stone", overrides: { name: "stone", ...at(20) } },
    { id: "chest", template: "chest", overrides: { name: "chest", ...at(300) } },
  ];
}

// A store world and a memory world over the same snapshot: the view reads both alike.
function worlds(t: { after(callback: () => void): void }, lit: boolean): [World, World] {
  const store = createWorld(join(tempDir(t), "hall"), hall(lit));
  const names = { hall: "e1", ann: "e2", bob: "e3", stone: "e4", chest: "e5" };
  return [store, memoryWorld(store.snapshot(), undefined, names)];
}

const ANN = "e2";
const BOB = "e3";
const STONE = "e4";
const CHEST = "e5";

test("an actor's result carries its verdict and what it sensed, never the world's record", (t) => {
  for (const world of worlds(t, true)) {
    const ann = actorWorld(world, ANN);
    const result = ann.command({ command_id: "take-stone", verb: "take", target: "stone" });
    strictEqual(result.status, "ok");
    strictEqual(result.resolved_target, STONE);
    deepStrictEqual(Object.keys(result).sort(), ["command_id", "observation", "resolved_target", "status"]);
    strictEqual(result.observation.observer, ANN);
    strictEqual(result.observation.tick, world.snapshot().tick);
    deepStrictEqual(result.observation.events.map((event) => event.type), ["take", "moved"]);
  }
});

test("the view acts as its own actor only, and never asks who else sensed it", (t) => {
  for (const world of worlds(t, true)) {
    const ann = actorWorld(world, ANN);
    const before = world.snapshot().version;
    const smuggled = { command_id: "take-as-bob", verb: "take", target: "stone", actor: BOB, perceivers: true };
    strictEqual(ann.command(smuggled as ActorCommand).status, "ok");
    strictEqual(world.entity(STONE)?.contained_in, ANN);
    deepStrictEqual(world.attempts(before).map((attempt) => attempt.command.actor), [ANN]);
    ok(world.since(before).events.every((event) => !("perceivers" in event)));
  }
});

test("a refusal names nothing the actor cannot sense", (t) => {
  const walk: ActorCommand = { command_id: "walk", verb: "move", args: { to: { x: 300, y: 0 } } };
  // In the dark the chest that stops ann is no one's to name: the world's record has it, her view
  // does not.
  for (const world of worlds(t, false)) {
    const ann = actorWorld(world, ANN);
    deepStrictEqual(world.check({ ...walk, actor: ANN }).reason_data, { with: CHEST });
    const checked = ann.check(walk);
    deepStrictEqual([checked.status, checked.reason_code, checked.reason_data], ["refused", "blocked", undefined]);
    const result = ann.command(walk);
    deepStrictEqual([result.status, result.reason_code, result.reason_data], ["refused", "blocked", undefined]);
    ok(result.observation.entities.every((entity) => entity.id !== CHEST));
  }
  // Seen across a lit hall, it is named.
  for (const world of worlds(t, true)) {
    const ann = actorWorld(world, ANN);
    deepStrictEqual(ann.check(walk).reason_data, { with: CHEST });
    deepStrictEqual(ann.command(walk).reason_data, { with: CHEST });
  }
});

test("observe and inspect are the actor's own, and an unknown actor has no view", (t) => {
  for (const world of worlds(t, true)) {
    const ann = actorWorld(world, ANN);
    const { version: _version, ...seen } = world.observe(ANN, { since_tick: 0 });
    deepStrictEqual(ann.observe({ since_tick: 0 }), { ...seen, tick: world.snapshot().tick });
    deepStrictEqual(ann.inspect(STONE), world.inspect(ANN, STONE));
    throws(() => actorWorld(world, "e99"), (error: { code?: string }) => error.code === "no_such_entity");
  }
});

test("a carried actor is told who carries it, felt for in the dark", (t) => {
  // Ann holds a cat in her left hand in a dark hall; the chest stands 300 cm off.
  const carried: Scenario = [
    ...hall(false),
    { id: "tib", template: "cat", overrides: { name: "tib", location: "hall", contained_in: "ann", in_part: "hand_l" } },
  ];
  const store = createWorld(join(tempDir(t), "carried"), carried);
  for (const world of [store, memoryWorld(store.snapshot(), undefined, { tib: "e6" })]) {
    const tib = actorWorld(world, "e6");
    const walk: ActorCommand = { command_id: "walk-off", verb: "move", args: { to: { x: 100, y: 0 } } };
    // Ann is neither seen nor felt (touch is uncovered), but she is within the cat's reach, so the cat
    // could name her itself: the view names her as the holder.
    ok(tib.observe().entities.every((entity) => entity.id !== ANN));
    for (const verdict of [tib.check(walk), tib.command(walk)]) {
      deepStrictEqual([verdict.status, verdict.reason_code, verdict.reason_data], ["refused", "carried", { by: ANN }]);
    }
    strictEqual(tib.command({ command_id: "nose-ann", verb: "attack", target: "ann" }).resolved_target, ANN);
  }
});

// Every key anywhere in a value, so a test can say none of them is `version`.
function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysIn);
  }
  return value !== null && typeof value === "object"
    ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysIn(inner)])
    : [];
}

test("nothing an actor is sent carries the world's version", (t) => {
  for (const world of worlds(t, true)) {
    const ann = actorWorld(world, ANN);
    const take: ActorCommand = { command_id: "take-stone", verb: "take", target: "stone" };
    const sent = [ann.check(take), ann.command(take), ann.options({ refused: true }), ann.observe({ since_tick: 0 })];
    deepStrictEqual(sent.flatMap(keysIn).filter((key) => key === "version" || key === "based_on_version"), []);
  }
});

test("since_tick is the events at that tick or later, alike in a store and a memory world", (t) => {
  const answers = worlds(t, true).map((world) => {
    const ann = actorWorld(world, ANN);
    const bob = actorWorld(world, BOB);
    const looked = ann.command({ command_id: "take-stone", verb: "take", target: "stone" }).observation.tick;
    strictEqual(bob.command({ command_id: "bob-waits", verb: "wait", args: { ticks: 1 } }).status, "ok");
    strictEqual(bob.command({ command_id: "bob-steps", verb: "move", args: { to: { x: 60, y: 0 } } }).status, "ok");
    const since = ann.observe({ since_tick: looked });
    // Bob's step is seen; ann's own take, at the tick before, is not told again.
    ok(since.events.every((event) => event.tick >= looked));
    ok(since.events.some((event) => event.entity === BOB));
    return canonicalJson(since);
  });
  strictEqual(answers[0], answers[1]);
  for (const world of worlds(t, true)) {
    for (const since_tick of [-1, 0.5]) {
      throws(() => world.observe(ANN, { since_tick }), (error: { code?: string }) => error.code === "invalid_tick");
    }
    throws(() => world.observe(ANN, { since: 0, since_tick: 0 }), (error: { code?: string }) => error.code === "invalid_tick");
  }
});

test("a memory world has no events from before it at its starting tick", (t) => {
  const [store] = worlds(t, true);
  strictEqual(store.command({ command_id: "bob-waits", actor: BOB, verb: "wait", args: { ticks: 1 } }).status, "ok");
  const fork = store.fork();
  const tick = fork.snapshot().tick;
  throws(() => fork.observe(ANN, { since_tick: tick }), (error: { code?: string }) => error.code === "history_unavailable");
  deepStrictEqual(fork.observe(ANN, { since_tick: tick + 1 }).events, []);
});

test("an act out of sight tells the actor nothing, however many commands it took", (t) => {
  // Ann in the lit hall, bob alone in a dark cellar no door joins to it. Bob waits two ticks in one
  // command or in two: the world's version differs, ann's side of it does not.
  const apart: Scenario = [
    ...hall(true).filter((entry) => entry.id !== "bob"),
    { id: "cellar", template: "room", overrides: { name: "cellar" } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "cellar", support: "cellar", pos: { x: 0, y: 0 } } },
  ];
  const sides = [[2], [1, 1]].map((waits, n) => {
    const world = createWorld(join(tempDir(t), `apart${n}`), apart);
    const ann = actorWorld(world, world.id("ann")!);
    const bob = actorWorld(world, world.id("bob")!);
    const take: ActorCommand = { command_id: "take-stone", verb: "take", target: "stone" };
    const taken = ann.command(take);
    waits.forEach((ticks, i) => strictEqual(bob.command({ command_id: `wait-${i}`, verb: "wait", args: { ticks } }).status, "ok"));
    return {
      version: world.snapshot().version,
      seen: canonicalJson([taken, ann.observe({ since_tick: 0 }), ann.options({ refused: true }), ann.check(take)]),
    };
  });
  ok(sides[0]!.version !== sides[1]!.version);
  strictEqual(sides[0]!.seen, sides[1]!.seen);
});
