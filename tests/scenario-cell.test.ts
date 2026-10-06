import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";

// The cell block is the spec for walking. A lit 1000 × 1000 cm room, its origin at the centre, is cut
// along y = 0 by ten 100 cm sections of bars, wall to wall; the section at x 50 is a locked gate.
// Ann is inside (y < 0) with a cot and a note on the floor; Bob is outside with the gate's key.
//
// Decisions the numbers below rely on:
// - A move is checked at its destination against everything solid on the same floor: the agent's
//   footprint may not overlap it. What is under 20 cm (a note, a key, shards) is stepped over.
// - The way there is checked only against barriers (`barrier` in props): furniture and people are
//   walked around, bars are not. A shut gate is a barrier; an open one is not.
// - The destination's footprint must lie inside the room's. A refused move moves nothing.
// - Overlap an agent already has never stops it, and arriving through a door is checked where the
//   agent lands.

const cell = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/cell.json", import.meta.url)), "utf8"),
) as Scenario;

const NAMES = ["block", "bars_m450", "bars_m350", "bars_m250", "gate", "ann", "cot", "bob", "key", "note"] as const;
type Name = (typeof NAMES)[number];

function open(t: { after(callback: () => void): void }): { world: World; ids: Record<Name, Id> } {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-cell-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const world = createWorld(join(dir, "cell"), cell);
  const ids = {} as Record<Name, Id>;
  for (const name of NAMES) {
    const id = world.id(name);
    ok(id !== null, name);
    ids[name] = id;
  }
  return { world, ids };
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

const walk = (world: World, actor: Id, x: number, y: number): Result => run(world, actor, "move", undefined, { to: { x, y } });

test("the bars divide the room: ann walks her side, but not through them or round their end", (t) => {
  const { world, ids } = open(t);
  strictEqual(walk(world, ids.ann, -200, -300).status, "ok");

  // Straight north through the bars: the two sections either side of x -200 meet the path at the
  // same point, and the lower id is named.
  const through = walk(world, ids.ann, -200, 100);
  strictEqual(through.reason_code, "blocked");
  deepStrictEqual(through.reason_data, { with: ids.bars_m250 });
  // Up the west wall (a human is 45 wide, so x -470 is as close as it gets): the bars reach it.
  strictEqual(walk(world, ids.ann, -470, -300).status, "ok");
  deepStrictEqual(walk(world, ids.ann, -470, 200).reason_data, { with: ids.bars_m450 });
  // Out of the room: 2·490 + 30 is past the 1000 cm wall; 2·480 + 30 is not.
  strictEqual(walk(world, ids.ann, 0, -490).reason_code, "out_of_bounds");
  strictEqual(walk(world, ids.ann, 0, -480).status, "ok");
  deepStrictEqual(world.entity(ids.ann)?.pos, { x: 0, y: -480 });
});

test("walking steps over a note but not into the cot", (t) => {
  const { world, ids } = open(t);
  strictEqual(walk(world, ids.ann, -150, -100).status, "ok");
  deepStrictEqual(walk(world, ids.ann, -300, -300).reason_data, { with: ids.cot });
  // Placed over the cot by the world's author, she is never stuck there: the overlap she starts
  // in does not stop her, even shuffling along inside it.
  strictEqual(world.edit({ kind: "place", target: ids.ann, support: ids.block, pos: { x: -300, y: -300 } }).status, "ok");
  strictEqual(walk(world, ids.ann, -280, -300).status, "ok");
});

test("across the bars they see each other and hand things over within reach", (t) => {
  const { world, ids } = open(t);
  // Bars 5 cm deep, a human 30: each stands 18 cm from the line, 36 cm apart.
  strictEqual(walk(world, ids.ann, -150, -18).status, "ok");
  strictEqual(walk(world, ids.bob, -150, 18).status, "ok");
  strictEqual(walk(world, ids.ann, -150, -17).reason_code, "blocked");
  strictEqual(world.query({ kind: "perceive", observer: ids.ann, entity: ids.bob, sense: "sight" }).value, "true");
  strictEqual(run(world, ids.bob, "give", "key", { destination: ids.ann }).status, "ok");
  strictEqual(world.entity(ids.key)?.contained_in, ids.ann);
  strictEqual(run(world, ids.ann, "attack", ids.bob).status, "ok");
});

test("the locked gate holds until it is unlocked and opened; then it is a way through", (t) => {
  const { world, ids } = open(t);
  strictEqual(walk(world, ids.ann, 50, -60).status, "ok");
  deepStrictEqual(walk(world, ids.ann, 50, 100).reason_data, { with: ids.gate });

  strictEqual(walk(world, ids.bob, 50, 40).status, "ok");
  strictEqual(run(world, ids.bob, "unlock", "gate").status, "ok");
  strictEqual(run(world, ids.bob, "open", "gate").status, "ok");
  // Bob stands on the way out, and people are walked around: only the destination must be clear.
  strictEqual(walk(world, ids.ann, 50, 100).status, "ok");
  deepStrictEqual(world.entity(ids.ann)?.pos, { x: 50, y: 100 });
});

test("the bars hold: too heavy to push, and a pushed cot stops at them", (t) => {
  const { world, ids } = open(t);
  strictEqual(walk(world, ids.bob, -350, 30).status, "ok");
  strictEqual(run(world, ids.bob, "push", ids.bars_m350, { dir: "-y", distance_cm: 10 }).reason_code, "too_heavy");

  strictEqual(walk(world, ids.ann, -210, -300).status, "ok");
  const pushed = run(world, ids.ann, "push", "cot", { dir: "+y", distance_cm: 400 });
  strictEqual(pushed.status, "ok");
  // Cot half-depth 30 + bars 2.5 from y -300 to 0: 267.5, so 267.
  deepStrictEqual(pushed.events.find((event) => event.type === "moved")?.data, { distance_cm: 267 });
  deepStrictEqual(pushed.events.find((event) => event.type === "collided")?.data, { with: ids.bars_m350 });
});

test("arriving through a door is checked where the agent lands", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-cell-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const world = createWorld(join(dir, "two"), [
    { id: "hall", template: "room", overrides: { name: "hall" } },
    { id: "yard", template: "room", overrides: { name: "yard" } },
    { id: "door", template: "door", overrides: { name: "door", props: { open: true, from: "hall", to: "yard" } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "cart", template: "table", overrides: { name: "cart", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
  ]);
  const ann = world.id("ann")!;
  const yard = world.id("yard")!;
  deepStrictEqual(run(world, ann, "move", undefined, { location: yard }).reason_data, { with: world.id("cart") });
  strictEqual(run(world, ann, "move", undefined, { to: { x: 0, y: 100 } }).status, "ok");
  strictEqual(run(world, ann, "move", undefined, { location: yard }).status, "ok");
});
