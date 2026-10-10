import { deepStrictEqual, notStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { actorWorld, aliasOf, createWorld, type Coverage, type Id, type Result, type Scenario } from "../src/index.js";
import { tempDir } from "./harness.js";

// An arm with a gripper and no legs (`docs/manipulator.md`): powered by a cable from the generator and
// controlled from the control room through a panel, which the terminal controls. Ann stands by it.
const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "control", template: "room", overrides: { name: "control room", props: { lit: true } } },
  { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -300, y: 0 } } },
  { id: "cable", template: "cable", overrides: { name: "cable", location: "hall", support: "hall", pos: { x: 120, y: 200 }, props: { powered_by: "generator" } } },
  {
    id: "panel",
    template: "cable",
    overrides: { name: "panel", location: "hall", support: "hall", pos: { x: 200, y: 200 }, props: { powered_by: "generator", controlled_by: "ai" } },
  },
  { id: "ai", template: "terminal", overrides: { name: "ai", location: "control", support: "control", pos: { x: 0, y: 0 } } },
  {
    id: "arm",
    template: "arm",
    overrides: { name: "arm", location: "hall", support: "hall", pos: { x: 0, y: 0 }, props: { powered_by: "cable", controlled_by: "panel" } },
  },
  { id: "key", template: "key", overrides: { name: "key", location: "hall", support: "hall", pos: { x: -60, y: 0 }, props: { opens: "gate" } } },
  { id: "cup", template: "cup", overrides: { name: "cup", location: "hall", support: "hall", pos: { x: 400, y: 0 } } },
  {
    id: "gate",
    template: "door",
    overrides: { name: "gate", location: "hall", support: "hall", pos: { x: -300, y: -300 }, props: { open: false, locked: true, from: "hall", to: "control" } },
  },
  { id: "chest", template: "chest", overrides: { name: "chest", location: "hall", support: "hall", pos: { x: 100, y: -60 } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: -100, y: 60 } } },
];

// Touch is declared, so the arm feels what it grips (`docs/senses.md`); the default is sight and hearing.
const TOUCHING: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near", "reachable"],
  senses: ["sight", "hearing", "touch"],
  properties: ["integrity", "residue", "pos", "open"],
};

function open(t: { after(callback: () => void): void }) {
  const world = createWorld(join(tempDir(t), "arm"), scenario, undefined, { coverage: TOUCHING });
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result => {
    seq += 1;
    return world.command({
      command_id: `m${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
    });
  };
  return { world, id, run };
}

const verdict = (result: Result) => [result.status, result.reason_code, result.reason_data];

// Three of a human's blows destroy a thing of no parts at full integrity.
function wreck(run: (actor: Id, verb: string, target?: string, args?: Record<string, unknown>) => Result, ann: Id, target: string): void {
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(ann, "attack", target).status, "ok");
  }
}

function walk(run: (actor: Id, verb: string, target?: string, args?: Record<string, unknown>) => Result, ann: Id, to: { x: number; y: number }): void {
  strictEqual(run(ann, "move", undefined, { to }).status, "ok");
}

test("the arm takes, puts and gives within reach, and cannot name what lies beyond it", (t) => {
  const { world, id, run } = open(t);
  const [arm, ann, key, chest] = [id("arm"), id("ann"), id("key"), id("chest")];
  strictEqual(run(arm, "take", "key").status, "ok");
  // Beyond reach the arm cannot name the cup at all: it addresses only what it can reach.
  strictEqual(run(arm, "take", "cup").status, "unresolved");
  strictEqual(run(arm, "put", "key", { relation: "in", destination: "chest" }).status, "ok");
  strictEqual(world.entity(key)?.contained_in, chest);
  strictEqual(run(arm, "take", "key").status, "ok");
  strictEqual(run(arm, "give", "key", { destination: "ann" }).status, "ok");
  strictEqual(world.entity(key)?.contained_in, ann);
});

test("the arm cannot move: it has no moving capacity", (t) => {
  const { id, run } = open(t);
  deepStrictEqual(verdict(run(id("arm"), "move", undefined, { to: { x: 50, y: 50 } })), [
    "refused",
    "insufficient_moving",
    { capacity: "moving", have: 0, need: 1 },
  ]);
});

test("a broken link refuses every command of the arm, with its data, and works again once the author restores it", (t) => {
  const { world, id, run } = open(t);
  const [arm, ann, panel, cable, key] = [id("arm"), id("ann"), id("panel"), id("cable"), id("key")];
  // The panel between the arm and the terminal is destroyed: disconnected at the panel.
  walk(run, ann, { x: 200, y: 280 });
  wreck(run, ann, "panel");
  deepStrictEqual(verdict(run(arm, "take", "key")), ["refused", "disconnected", { at: panel }]);
  deepStrictEqual(verdict(run(arm, "move", undefined, { to: { x: 50, y: 50 } })), ["refused", "disconnected", { at: panel }]);
  // The author points the arm straight at the terminal: the same command works.
  strictEqual(world.edit({ kind: "update_props", target: arm, props: { controlled_by: id("ai") } }).status, "ok");
  strictEqual(run(arm, "take", "key").status, "ok");

  // The cable that powers it is cut: unpowered at the arm, with the cable as the cut.
  walk(run, ann, { x: 120, y: 280 });
  wreck(run, ann, "cable");
  deepStrictEqual(verdict(run(arm, "drop", "key")), ["refused", "unpowered", { at: arm, cut: cable }]);
  deepStrictEqual(verdict(run(arm, "give", "key", { destination: "ann" })), ["refused", "unpowered", { at: arm, cut: cable }]);
  strictEqual(world.entity(key)?.contained_in, arm);
  strictEqual(world.edit({ kind: "update_props", target: arm, props: { powered_by: id("generator") } }).status, "ok");
  strictEqual(run(arm, "drop", "key").status, "ok");
});

test("an agent with no controlled_by is untouched by the rule, while the arm is unpowered", (t) => {
  const { id, run } = open(t);
  const [ann, key] = [id("ann"), id("key")];
  walk(run, ann, { x: 120, y: 280 });
  wreck(run, ann, "cable");
  strictEqual(run(id("arm"), "take", "key").reason_code, "unpowered");
  // Ann takes what the arm could not, and walks on: her body needs no power.
  walk(run, ann, { x: -100, y: 60 });
  strictEqual(run(ann, "take", "key").status, "ok");
  strictEqual(run(ann, "drop", "key").status, "ok");
});

// The arm has no sight and no touch, so its view lists nothing; reach alone decides what it can name.
test("the arm's own view lists nothing it senses, and names only what is within its reach", (t) => {
  const { world, id, run } = open(t);
  const arm = id("arm");
  strictEqual(run(arm, "take", "key").status, "ok");
  const view = actorWorld(world, arm);
  deepStrictEqual(view.observe().entities, []);
  // The chest is within reach, so it can be named (and its take refused on what the arm can carry);
  // the cup is beyond reach and cannot be named at all.
  notStrictEqual(view.command({ command_id: "view-near", verb: "take", target: aliasOf(arm, id("chest")) }).status, "unresolved");
  strictEqual(view.command({ command_id: "view-far", verb: "take", target: aliasOf(arm, id("cup")) }).status, "unresolved");
});
