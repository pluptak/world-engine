import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { memoryWorld, type Result, type World } from "../src/index.js";
import { spawn } from "../src/engine/spawn.js";
import type { Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash } from "../src/templates.js";

// Each verb refuses what it cannot do, with a declared code, or writes a valid result; the store's
// validation is a net for bugs, never a rule a verb leans on. These are the paths random runs found
// reaching the net, each with the answer it gets now. The property test holds the general rule.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function room(): { world: World; ids: Record<string, string> } {
  let snapshot: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const ids: Record<string, string> = {};
  const add = (name: string, template: string, overrides: Record<string, unknown>) => {
    const made = spawn(snapshot, registry, template, { name, ...overrides });
    snapshot = made.snapshot;
    ids[name] = made.id;
  };
  add("hall", "room", { props: { lit: true } });
  add("yard", "room", { props: { lit: true } });
  add("door", "door", { props: { openable: true, open: true, from: ids.hall, to: ids.yard } });
  const floor = { location: ids.hall, support: ids.hall };
  add("table", "table", { ...floor, pos: { x: 100, y: 0 } });
  add("cup", "cup", { location: ids.hall, support: ids.table });
  add("ann", "human", { ...floor, pos: { x: 0, y: 0 } });
  add("bob", "human", { ...floor, pos: { x: 0, y: 60 } });
  return { world: memoryWorld(snapshot, registry), ids };
}

let seq = 0;
function act(world: World, actor: string, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `g${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

const outcome = (result: Result) => [result.status, result.reason_code, result.reason_data];

test("taking oneself, or what holds one, is circular_placement", () => {
  const { world, ids } = room();
  deepStrictEqual(outcome(act(world, ids.ann!, "take", ids.ann)), ["refused", "circular_placement", undefined]);
  strictEqual(world.edit({ kind: "place", target: ids.ann!, contained_in: ids.bob!, in_part: "hand_l", pos: null }).status, "ok");
  deepStrictEqual(outcome(act(world, ids.ann!, "take", ids.bob)), ["refused", "circular_placement", undefined]);
});

test("an agent held by another goes where it is carried", () => {
  const { world, ids } = room();
  strictEqual(world.edit({ kind: "place", target: ids.ann!, contained_in: ids.bob!, in_part: "hand_l", pos: null }).status, "ok");
  deepStrictEqual(outcome(act(world, ids.ann!, "move", undefined, { to: { x: -100, y: 0 } })), [
    "refused",
    "carried",
    { by: ids.bob },
  ]);
  deepStrictEqual(outcome(act(world, ids.ann!, "move", undefined, { location: ids.yard })), [
    "refused",
    "carried",
    { by: ids.bob },
  ]);
});

test("a carried agent drops a thing from where its carrier stands", () => {
  const { world, ids } = room();
  strictEqual(act(world, ids.ann!, "take", "cup").status, "ok");
  strictEqual(world.edit({ kind: "place", target: ids.ann!, contained_in: ids.bob!, in_part: "hand_l", pos: null }).status, "ok");
  strictEqual(act(world, ids.ann!, "drop", "cup").status, "ok");
  deepStrictEqual([world.entity(ids.cup!)?.support, world.entity(ids.cup!)?.pos], [ids.hall, { x: 0, y: 60 }]);
});

test("an agent standing on a table steps down where it walks, checked where it lands", () => {
  const { world, ids } = room();
  strictEqual(world.edit({ kind: "place", target: ids.ann!, support: ids.table!, pos: null }).status, "ok");
  // Landing on bob is refused; landing clear is a step down onto the floor.
  deepStrictEqual(outcome(act(world, ids.ann!, "move", undefined, { to: { x: 0, y: 60 } })), [
    "refused",
    "blocked",
    { with: ids.bob },
  ]);
  strictEqual(act(world, ids.ann!, "move", undefined, { to: { x: -100, y: 0 } }).status, "ok");
  deepStrictEqual([world.entity(ids.ann!)?.support, world.entity(ids.ann!)?.pos], [ids.hall, { x: -100, y: 0 }]);
  // Through a door from a table, she arrives standing where the table stood.
  strictEqual(world.edit({ kind: "place", target: ids.ann!, support: ids.table!, pos: null }).status, "ok");
  strictEqual(act(world, ids.ann!, "move", undefined, { location: ids.yard }).status, "ok");
  deepStrictEqual([world.entity(ids.ann!)?.support, world.entity(ids.ann!)?.pos], [ids.yard, { x: 100, y: 0 }]);
});

test("a push slides only what stands on a room's floor", () => {
  const { world, ids } = room();
  deepStrictEqual(outcome(act(world, ids.ann!, "push", "cup", { dir: "+x", distance_cm: 10 })), [
    "refused",
    "not_on_floor",
    { support: ids.table },
  ]);
  deepStrictEqual(outcome(act(world, ids.ann!, "pull", "cup", { dir: "+x", distance_cm: 10 })), [
    "refused",
    "not_on_floor",
    { support: ids.table },
  ]);
});

test("a room is never placed in, on or under anything", () => {
  const { world, ids } = room();
  const placed = world.edit({ kind: "place", target: ids.yard!, contained_in: ids.ann!, in_part: "hand_l", pos: null });
  deepStrictEqual([placed.status, placed.reason_code], ["refused", "room_placed"]);
});

test("a walker uncovers what it hides and what anything it carries hides", () => {
  const { world, ids } = room();
  strictEqual(world.edit({ kind: "place", target: ids.cup!, concealed_by: ids.ann! }).status, "ok");
  const walked = act(world, ids.ann!, "move", undefined, { to: { x: -50, y: 0 } });
  deepStrictEqual(walked.events.map((event) => event.type), ["move", "moved", "revealed"]);
  strictEqual(world.entity(ids.cup!)?.concealed_by, null);

  // Bob hides behind the table ann then carries; ann walks to the yard, and he is uncovered.
  strictEqual(world.edit({ kind: "place", target: ids.table!, contained_in: ids.ann!, in_part: "hand_l", pos: null }).status, "ok");
  strictEqual(world.edit({ kind: "place", target: ids.bob!, concealed_by: ids.table! }).status, "ok");
  const left = act(world, ids.ann!, "move", undefined, { location: ids.yard });
  ok(left.events.some((event) => event.type === "revealed" && event.entity === ids.bob));
  strictEqual(world.entity(ids.bob!)?.concealed_by, null);
});
