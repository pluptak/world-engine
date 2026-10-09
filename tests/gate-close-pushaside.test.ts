import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { SHARED_FIXTURES } from "./presets.js";

const cell = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/cell.json", import.meta.url)), "utf8"),
) as Scenario;

// A heap of rubble as tall as a stone: declaring debris is a definition, so it is a preset of its own.
const registry = parseRegistry({
  ...loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))),
  ...SHARED_FIXTURES,
  rubble_heap: { id: "rubble_heap", extends: "stone", props: { rubble: true } },
});

function open(t: { after(callback: () => void): void }): World {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return createWorld(join(dir, "cell"), cell, registry);
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

test("a hand close moves what stands in the gateway aside, then shuts", (t) => {
  const world = open(t);
  const ann = world.id("ann")!;
  const bob = world.id("bob")!;
  const gate = world.id("gate")!;
  const block = world.id("block")!;
  ok(ann !== null && bob !== null && gate !== null);
  strictEqual(run(world, bob, "move", undefined, { to: { x: 50, y: 40 } }).status, "ok");
  strictEqual(run(world, bob, "unlock", "gate").status, "ok");
  strictEqual(run(world, bob, "open", "gate").status, "ok");
  strictEqual(world.edit({ kind: "place", target: ann, support: block, pos: { x: 50, y: 0 } }).status, "ok");
  const closed = run(world, bob, "close", "gate");
  strictEqual(closed.status, "ok");
  strictEqual(world.entity(gate)?.props.open, false);
  deepStrictEqual(world.entity(ann)?.pos, { x: 50, y: 18 });
  deepStrictEqual(closed.events.map((event) => event.type), ["close", "closed", "moved"]);
  const closedEvent = closed.events.find((event) => event.type === "closed")!;
  const movedEvent = closed.events.find((event) => event.type === "moved")!;
  strictEqual(movedEvent.cause_id, closedEvent.event_id);
  strictEqual(movedEvent.entity, ann);
});

test("a hand close moves items aside but leaves what is low enough to step over", (t) => {
  const world = open(t);
  const bob = world.id("bob")!;
  const gate = world.id("gate")!;
  const block = world.id("block")!;
  const note = world.id("note")!;
  strictEqual(run(world, bob, "move", undefined, { to: { x: 50, y: 40 } }).status, "ok");
  strictEqual(run(world, bob, "unlock", "gate").status, "ok");
  strictEqual(run(world, bob, "open", "gate").status, "ok");
  const made = world.edit({
    kind: "spawn",
    template: "stone",
    overrides: { name: "rock", location: block, support: block, pos: { x: 55, y: 0 } },
  });
  strictEqual(made.status, "ok");
  const rock = made.events[1]!.entity;
  strictEqual(world.edit({ kind: "place", target: note, support: block, pos: { x: 45, y: 0 } }).status, "ok");
  const closed = run(world, bob, "close", "gate");
  strictEqual(closed.status, "ok");
  strictEqual(world.entity(gate)?.props.open, false);
  deepStrictEqual(world.entity(rock)?.pos, { x: 55, y: 13 });
  deepStrictEqual(world.entity(note)?.pos, { x: 45, y: 0 });
  deepStrictEqual(closed.events.map((event) => event.type), ["close", "closed", "moved"]);
  strictEqual(closed.events.find((event) => event.type === "moved")!.entity, rock);
});

test("what stands south of the line goes south", (t) => {
  const world = open(t);
  const ann = world.id("ann")!;
  const bob = world.id("bob")!;
  const gate = world.id("gate")!;
  const block = world.id("block")!;
  strictEqual(run(world, bob, "move", undefined, { to: { x: 50, y: 40 } }).status, "ok");
  strictEqual(run(world, bob, "unlock", "gate").status, "ok");
  strictEqual(run(world, bob, "open", "gate").status, "ok");
  strictEqual(world.edit({ kind: "place", target: ann, support: block, pos: { x: 50, y: -10 } }).status, "ok");
  strictEqual(run(world, bob, "close", "gate").status, "ok");
  deepStrictEqual(world.entity(ann)?.pos, { x: 50, y: -18 });
});

test("what the gate moves uncovers what it hid; rubble and the low stay put", (t) => {
  const world = open(t);
  const ann = world.id("ann")!;
  const bob = world.id("bob")!;
  const block = world.id("block")!;
  const spawnAt = (template: string, name: string, x: number, props?: Record<string, number | string | boolean>) => {
    const made = world.edit({
      kind: "spawn",
      template,
      overrides: { name, location: block, support: block, pos: { x, y: 0 }, ...(props ? { props } : {}) },
    });
    strictEqual(made.status, "ok", name);
    return made.events[1]!.entity;
  };
  strictEqual(run(world, bob, "move", undefined, { to: { x: 50, y: 40 } }).status, "ok");
  strictEqual(run(world, bob, "unlock", "gate").status, "ok");
  strictEqual(run(world, bob, "open", "gate").status, "ok");
  strictEqual(world.edit({ kind: "place", target: ann, support: block, pos: { x: 50, y: -2 } }).status, "ok");
  // A cup hidden behind ann, and a heap of rubble as tall as a stone, both in the gateway.
  const cup = spawnAt("cup", "cup", 30);
  strictEqual(world.edit({ kind: "place", target: cup, concealed_by: ann }).status, "ok");
  const heap = spawnAt("rubble_heap", "heap", 80);
  const closed = run(world, bob, "close", "gate");
  deepStrictEqual(closed.events.map((event) => [event.type, event.entity]), [
    ["close", world.id("gate")],
    ["closed", world.id("gate")],
    ["moved", ann],
    ["revealed", cup],
  ]);
  strictEqual(world.entity(cup)?.concealed_by, null);
  deepStrictEqual(world.entity(heap)?.pos, { x: 80, y: 0 });
});
