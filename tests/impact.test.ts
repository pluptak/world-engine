import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld, type Coverage, type Result, type Scenario, type World } from "../src/index.js";

const TOUCHING: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "touch"],
  properties: ["integrity", "residue", "pos"],
};

function world(t: { after(callback: () => void): void }, scenario: Scenario): World {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-impact-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return createWorld(join(dir, "w"), scenario, undefined, { coverage: TOUCHING });
}

const floor = (name: string, template: string, x: number, y: number) => ({
  id: name,
  template,
  overrides: { name, location: "room", support: "room", pos: { x, y } },
});

function idOf(w: World, name: string): string {
  const id = w.id(name);
  ok(id !== null, name);
  return id;
}

function push(w: World, target: string, distance_cm: number): Result {
  return w.command({
    command_id: `push-${target}-${distance_cm}`,
    actor: idOf(w, "ann"),
    verb: "push",
    target,
    args: { dir: "+x", distance_cm },
    perceivers: true,
  });
}

function types(result: Result): string[] {
  return result.events.map((event) => event.type);
}

// The stone (2000 g) against the bottle (500 g, breaks from 50 cm): 2000 · d against 25000.
function stoneAndBottle(t: { after(callback: () => void): void }, gap: number): World {
  return world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("stone", "stone", 0, 0),
    // Half-widths 10 + 4, so the stone travels exactly `gap`.
    floor("bottle", "bottle", 14 + gap, 0),
    floor("ann", "human", 0, 60),
  ]);
}

test("a stone that travels 12 cm into the bottle does not break it", (t) => {
  const w = stoneAndBottle(t, 12);
  const result = push(w, "stone", 50);
  deepStrictEqual(types(result), ["push", "moved", "collided"]);
  strictEqual(w.entity(idOf(w, "bottle"))?.status, "intact");
});

test("a stone that travels 13 cm into the bottle breaks it, and the wine lands on the floor", (t) => {
  const w = stoneAndBottle(t, 13);
  const result = push(w, "stone", 50);
  deepStrictEqual(types(result), ["push", "moved", "collided", "broken", "spawned", "spawned", "spawned"]);
  strictEqual(w.entity(idOf(w, "bottle"))?.status, "broken");
  strictEqual(w.entity(idOf(w, "room"))?.residue.wine, 750);
  strictEqual(w.entity(idOf(w, "stone"))?.status, "intact");
});

test("a fragile mover breaks itself: a bottle pushed 60 cm into a stone", (t) => {
  const w = world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("bottle", "bottle", 0, 0),
    floor("stone", "stone", 74, 0),
    floor("ann", "human", 0, 60),
  ]);
  const result = push(w, "bottle", 100);
  deepStrictEqual(result.events.find((event) => event.type === "moved")?.data, { distance_cm: 60 });
  strictEqual(result.events.find((event) => event.type === "broken")?.entity, idOf(w, "bottle"));
  strictEqual(w.entity(idOf(w, "bottle"))?.status, "broken");
});

test("what is hit feels the collision: rex feels the chair, ann who pushed it does not", (t) => {
  const w = world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("chair", "chair", 0, 0),
    floor("rex", "dog", 100, 0),
    floor("ann", "human", 0, 60),
  ]);
  const result = push(w, "chair", 100);
  const collided = result.events.find((event) => event.type === "collided");
  ok(collided !== undefined);
  deepStrictEqual(collided.perceivers?.touch, [idOf(w, "rex")]);
});
