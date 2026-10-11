import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld, WORLD_AUTHOR, type Id, type Result, type Scenario } from "../src/index.js";
import { tempDir } from "./harness.js";

// A device controlled from elsewhere, as in tests/remote.test.ts: the vault door is controlled by
// the panel, the panel by the AI's terminal, both powered by the generator. The spare door draws
// straight from the generator; the terminal itself runs on it too.
const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "control", template: "room", overrides: { name: "control room", props: { lit: true } } },
  { id: "vault", template: "room", overrides: { name: "vault", props: { lit: true } } },
  {
    id: "vault_door",
    template: "door",
    overrides: {
      name: "vault door",
      location: "hall",
      support: "hall",
      pos: { x: 0, y: 300 },
      props: { open: false, locked: true, from: "hall", to: "vault", powered_by: "generator", controlled_by: "panel" },
    },
  },
  {
    id: "spare_door",
    template: "door",
    overrides: {
      name: "spare door",
      location: "hall",
      support: "hall",
      pos: { x: 0, y: -300 },
      props: { open: false, locked: true, from: "hall", to: "vault", powered_by: "generator", controlled_by: "panel" },
    },
  },
  { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -200, y: 0 } } },
  {
    id: "panel",
    template: "cable",
    overrides: { name: "panel", location: "hall", support: "hall", pos: { x: 200, y: 0 }, props: { powered_by: "generator", controlled_by: "ai" } },
  },
  {
    id: "cable",
    template: "cable",
    overrides: { name: "cable", location: "hall", support: "hall", pos: { x: 100, y: 0 }, props: { powered_by: "generator" } },
  },
  { id: "ai", template: "terminal", overrides: { name: "ai", location: "control", support: "control", pos: { x: 0, y: 0 } } },
  { id: "sys", template: "terminal", overrides: { name: "sys", location: "control", support: "control", pos: { x: 200, y: 0 }, props: { powered_by: "generator" } } },
  { id: "cam", template: "camera", overrides: { name: "cam", location: "hall", support: "hall", pos: { x: 300, y: 300 }, props: { powered_by: "generator", controlled_by: "ai" } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "vault_key", template: "key", overrides: { name: "vault key", location: "hall", contained_in: "ann", props: { opens: "vault_door" } } },
];

function open(t: { after(callback: () => void): void }) {
  const world = createWorld(join(tempDir(t), "power-switch"), scenario);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result => {
    seq += 1;
    return world.command({ command_id: `s${seq}`, actor, verb, ...(target !== undefined && { target }), ...(args !== undefined && { args }) });
  };
  return { world, id, run };
}

const verdict = (result: Result) => [result.status, result.reason_code, result.reason_data];

test("a generator switched off leaves a remote unlock refused unpowered with cut the generator", (t) => {
  const { world, id, run } = open(t);
  const [ai, generator] = [id("ai"), id("generator")];
  strictEqual(world.edit({ kind: "update_props", target: generator, props: { on: false } }).status, "ok");
  deepStrictEqual(verdict(run(ai, "unlock", "vault door")), ["refused", "unpowered", { at: id("vault_door"), cut: generator }]);
});

test("a key still turns by hand what a switched-off source will not open by wire", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, generator] = [id("ai"), id("ann"), id("generator")];
  strictEqual(world.edit({ kind: "update_props", target: generator, props: { on: false } }).status, "ok");
  strictEqual(verdict(run(ai, "unlock", "vault door"))[0], "refused");
  strictEqual(run(ann, "move", undefined, { to: { x: 0, y: 250 } }).status, "ok");
  strictEqual(run(ann, "unlock", "vault door").status, "ok");
  strictEqual(world.entity(id("vault_door"))?.props.locked, false);
});

test("a cable switched off cuts what lies beyond it and nothing before it", (t) => {
  const { world, id, run } = open(t);
  const [ai, door, cable] = [id("ai"), id("vault_door"), id("cable"), id("generator")];
  strictEqual(world.edit({ kind: "update_props", target: door, props: { powered_by: cable } }).status, "ok");
  strictEqual(world.edit({ kind: "update_props", target: cable, props: { on: false } }).status, "ok");
  deepStrictEqual(verdict(run(ai, "unlock", "vault door")), ["refused", "unpowered", { at: door, cut: cable }]);
  strictEqual(run(ai, "unlock", "spare door").status, "ok");
});

test("switching on again restores power", (t) => {
  const { world, id, run } = open(t);
  const [ai, generator] = [id("ai"), id("generator")];
  strictEqual(world.edit({ kind: "update_props", target: generator, props: { on: false } }).status, "ok");
  strictEqual(verdict(run(ai, "unlock", "vault door"))[0], "refused");
  strictEqual(world.edit({ kind: "update_props", target: generator, props: { on: true } }).status, "ok");
  strictEqual(run(ai, "unlock", "vault door").status, "ok");
});

test("a terminal on a switched-off walk is refused unpowered and senses nothing", (t) => {
  const { world, id, run } = open(t);
  const [sys, ann, generator] = [id("sys"), id("ann"), id("generator")];
  strictEqual(world.edit({ kind: "update_props", target: generator, props: { on: false } }).status, "ok");
  deepStrictEqual(verdict(run(sys, "wait", undefined, { ticks: 1 })), ["refused", "unpowered", { at: sys, cut: generator }]);
  deepStrictEqual(world.query({ kind: "perceive", observer: sys, entity: ann, sense: "sight" }), { value: "false", basis_code: "unpowered" });
});

test("a camera on a switched-off walk feeds nothing", (t) => {
  const { world, id } = open(t);
  const [ai, cam, stone] = [id("ai"), id("cam"), id("ann")];
  deepStrictEqual(world.query({ kind: "perceive", observer: ai, entity: stone, sense: "sight" }), { value: "true", basis_code: "camera" });
  strictEqual(world.edit({ kind: "update_props", target: cam, props: { on: false } }).status, "ok");
  deepStrictEqual(world.query({ kind: "perceive", observer: ai, entity: stone, sense: "sight" }), { value: "false", basis_code: "not_perceptible" });
});

test("a beat switching the generator off cuts power at its tick, and its follower restores it", (t) => {
  const { world, id, run } = open(t);
  const [ai, generator] = [id("ai"), id("generator")];
  let seq = 100;
  const edit = (editArg: unknown) => {
    seq += 1;
    return world.edit(editArg as never, { command_id: `e${seq}` });
  };
  strictEqual(edit({ kind: "schedule_beat", id: "cut", at_tick: 3, action: { kind: "update_props", target: generator, props: { on: false } } }).status, "ok");
  strictEqual(edit({ kind: "schedule_beat", id: "restore", at_tick: 5, action: { kind: "update_props", target: generator, props: { on: true } } }).status, "ok");
  strictEqual(run(ai, "unlock", "vault door").status, "ok");
  strictEqual(world.edit({ kind: "update_props", target: id("vault_door"), props: { locked: true } }).status, "ok");
  strictEqual(world.command({ command_id: "adv1", actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 3 } }).status, "ok");
  deepStrictEqual(verdict(run(ai, "unlock", "vault door")), ["refused", "unpowered", { at: id("vault_door"), cut: generator }]);
  strictEqual(world.command({ command_id: "adv2", actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 2 } }).status, "ok");
  strictEqual(run(ai, "unlock", "vault door").status, "ok");
});
