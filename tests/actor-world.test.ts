import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  actorWorld,
  createWorld,
  memoryWorld,
  type ActorCommand,
  type Scenario,
  type World,
} from "../src/index.js";

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-actor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

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
    strictEqual(result.observation.version, world.snapshot().version);
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
    deepStrictEqual(ann.observe({ since: 0 }), world.observe(ANN, { since: 0 }));
    deepStrictEqual(ann.inspect(STONE), world.inspect(ANN, STONE));
    throws(() => actorWorld(world, "e99"), (error: { code?: string }) => error.code === "no_such_entity");
  }
});
