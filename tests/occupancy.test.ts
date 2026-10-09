import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, createWorld, type Scenario, type World } from "../src/index.js";
import { tempDir } from "./harness.js";

function world(t: { after(callback: () => void): void }, scenario: Scenario): World {
  const dir = tempDir(t);
  return createWorld(join(dir, "w"), scenario);
}

const floor = (name: string, template: string, x: number, y: number) => ({
  id: name,
  template,
  overrides: { name, location: "room", support: "room", pos: { x, y } },
});

function push(w: World, actor: string, target: string, dir: string, distance_cm: number) {
  const id = w.id(actor);
  ok(id !== null);
  return w.command({ command_id: `${target}-${dir}-${distance_cm}`, actor: id, verb: "push", target, args: { dir, distance_cm } });
}

test("a footprint that starts overlapping never blocks: the chair slides out from under the table", (t) => {
  const w = world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("table", "table", 0, 0),
    floor("chair", "chair", 40, 0),
    floor("ann", "human", 40, 60),
  ]);
  const result = push(w, "ann", "chair", "+x", 50);
  strictEqual(result.status, "ok");
  deepStrictEqual(result.events.map((event) => event.type), ["push", "moved"]);
});

test("an anchor in the path is a point, not an obstacle", (t) => {
  const w = world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("mark", "anchor", 60, 0),
    floor("chair", "chair", 0, 0),
    floor("ann", "human", 0, 60),
  ]);
  const result = push(w, "ann", "chair", "+x", 100);
  strictEqual(result.status, "ok");
  deepStrictEqual(result.events.map((event) => event.type), ["push", "moved"]);
});

test("the nearest of two obstacles stops the push, and a blocked push writes nothing", (t) => {
  const w = world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("chair", "chair", 0, 0),
    floor("near", "stone", 50, 0),
    floor("far", "stone", 90, 0),
    floor("ann", "human", 0, 60),
  ]);
  // Half-widths 22.5 + 10: contact at 17.5 from 50, so 17.
  const first = push(w, "ann", "chair", "+x", 100);
  deepStrictEqual(first.events.find((event) => event.type === "moved")?.data, { distance_cm: 17 });
  deepStrictEqual(first.events.find((event) => event.type === "collided")?.data, { with: w.id("near") });
  const before = canonicalJson(w.snapshot());
  const second = push(w, "ann", "chair", "+x", 10);
  strictEqual(second.reason_code, "blocked");
  strictEqual(canonicalJson(w.snapshot()), before);
});

test("a footprint has no height: a stone stops at a table's edge instead of passing under it", (t) => {
  const w = world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("stone", "stone", 0, 0),
    floor("table", "table", 100, 0),
    floor("ann", "human", 0, 60),
  ]);
  // Half-widths 10 + 60 against centres 100 apart: 30.
  const result = push(w, "ann", "stone", "+x", 100);
  deepStrictEqual(result.events.find((event) => event.type === "moved")?.data, { distance_cm: 30 });
  deepStrictEqual(result.events.find((event) => event.type === "collided")?.data, { with: w.id("table") });
});
