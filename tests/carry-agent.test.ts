import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { tempDir } from "./harness.js";

// A character held by another (`docs/verbs-moving.md`): it keeps its senses, speech and hands, but its own
// walk is its carrier's. Ann carries a cat, and a human, through the door into the yard.
function scenario(): Scenario {
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "door", template: "door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
    { id: "stone", template: "stone", overrides: { name: "stone", location: "yard", support: "yard", pos: { x: 200, y: 0 } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 60 } } },
    { id: "tib", template: "cat", overrides: { name: "tib", location: "hall", support: "hall", pos: { x: 40, y: 60 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: -40, y: 60 } } },
    { id: "cid", template: "human", overrides: { name: "cid", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  ];
}

let seq = 0;
function act(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `c${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

function open(t: { after(callback: () => void): void }): { world: World; id: (name: string) => Id } {
  const world = createWorld(join(tempDir(t), "carry"), scenario());
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, id };
}

test("a cat held by a human cannot walk, but it sees the room its carrier walks into, and walks again once dropped", (t) => {
  const { world, id } = open(t);
  const [ann, tib, stone] = [id("ann"), id("tib"), id("stone")];
  strictEqual(act(world, ann, "take", "tib").status, "ok");
  strictEqual(world.entity(tib)?.contained_in, ann);
  const refused = act(world, tib, "move", undefined, { to: { x: 100, y: 60 } });
  deepStrictEqual([refused.status, refused.reason_code, refused.reason_data], ["refused", "being_carried", { carrier: ann }]);
  // Ann opens the door and carries the cat through it: the cat is in the yard, and sees what is there.
  strictEqual(act(world, ann, "open", "door").status, "ok");
  strictEqual(act(world, ann, "move", undefined, { through: "door" }).status, "ok");
  strictEqual(world.entity(ann)?.location, id("yard"));
  strictEqual(world.query({ kind: "perceive", observer: tib, sense: "sight", entity: stone }).value, "true");
  // Dropped, the cat is its own again: it walks.
  strictEqual(act(world, ann, "drop", "tib").status, "ok");
  strictEqual(world.entity(tib)?.contained_in, null);
  strictEqual(act(world, tib, "move", undefined, { to: { x: 100, y: 60 } }).status, "ok");
});

test("a human held by another still speaks, and cannot walk", (t) => {
  // A held human keeps its speech: a weight is no limit on what a hand holds, as the builder found.
  const { world, id } = open(t);
  const [ann, bob] = [id("ann"), id("bob")];
  strictEqual(act(world, ann, "take", "bob").status, "ok");
  deepStrictEqual(act(world, bob, "move", undefined, { to: { x: 100, y: 60 } }).reason_code, "being_carried");
  strictEqual(act(world, bob, "say", undefined, { utterance: "hello" }).status, "ok");
});

test("a third agent cannot take a held agent from its carrier's hand", (t) => {
  const { world, id } = open(t);
  const [ann, bob, cid] = [id("ann"), id("bob"), id("cid")];
  strictEqual(act(world, ann, "take", "bob").status, "ok");
  const grabbed = act(world, cid, "take", "bob");
  deepStrictEqual([grabbed.status, grabbed.reason_code], ["refused", "held_by_another"]);
  strictEqual(world.entity(bob)?.contained_in, ann);
});
