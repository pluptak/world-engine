import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// The workshop is the spec for occupancy and collision, written before either exists. Tests marked
// `todo` state the wanted behaviour and fail today; each becomes a plain test when it ships.
//
// Decisions the numbers below rely on:
// - `pos` is the centre of a w × d footprint, axis-aligned. Odd sizes give half centimetres, so
//   overlap is compared on doubled coordinates: two footprints overlap when 2·|Δx| < w₁ + w₂ and
//   2·|Δy| < d₁ + d₂. Touching edges do not overlap.
// - Overlap is a legal state, never a `validateSnapshot` rule. Only motion collides.
// - Physical motion collides: `push`/`pull`, falls and drops where they land. An agent's own `move`
//   is checked at its destination and against barriers only (docs/walking.md, the cell spec).
// - A pushed thing collides only with things on the same support. It travels the largest whole
//   distance that leaves no overlap, emits `moved` with that distance, then `collided` (entity: the
//   mover, data.with: what it hit). An obstacle is not moved. Already touching refuses `blocked`.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const workshop = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/workshop.json", import.meta.url)), "utf8"),
) as Scenario;

const NAMES = ["shop", "bench", "cup", "chair", "stone", "bottle", "ann", "bob", "rex"] as const;
type Name = (typeof NAMES)[number];

function open(t: { after(callback: () => void): void }): { world: World; ids: Record<Name, Id> } {
  const dir = tempDir(t);
  const world = createWorld(join(dir, "workshop"), workshop, registry);
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
    command_id: `w${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

function types(result: Result): string[] {
  return result.events.map((event) => event.type);
}

function eventOf(result: Result, type: string) {
  const event = result.events.find((candidate) => candidate.type === type);
  ok(event !== undefined, `no ${type} event`);
  return event;
}

function entity(world: World, id: Id) {
  const found = world.entity(id);
  ok(found !== null, id);
  return found;
}

test("the workshop builds into a valid world", (t) => {
  const { world, ids } = open(t);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  deepStrictEqual(entity(world, ids.chair).pos, { x: 150, y: 0 });
  strictEqual(entity(world, ids.cup).support, ids.bench);
});

test("an agent cannot stand inside the bench: the move is refused and names it", (t) => {
  const { world, ids } = open(t);
  const result = run(world, ids.ann, "move", undefined, { to: { x: 300, y: 0 } });
  strictEqual(result.reason_code, "blocked");
  deepStrictEqual(result.reason_data, { with: ids.bench });
  deepStrictEqual(entity(world, ids.ann).pos, { x: 150, y: 60 });
});

test(
  "a chair pushed into the bench stops at contact, 67 of 100 cm",
  (t) => {
    const { world, ids } = open(t);
    // Centres 150 apart, half-widths 22.5 + 60: the chair may travel 67.5, so 67.
    const result = run(world, ids.ann, "push", "chair", { dir: "+x", distance_cm: 100 });
    strictEqual(result.status, "ok");
    deepStrictEqual(types(result), ["push", "moved", "collided"]);
    deepStrictEqual(eventOf(result, "moved").data, { distance_cm: 67 });
    const collided = eventOf(result, "collided");
    strictEqual(collided.entity, ids.chair);
    deepStrictEqual(collided.data, { with: ids.bench });
    strictEqual(collided.cause_id, eventOf(result, "moved").event_id);
    deepStrictEqual(entity(world, ids.chair).pos, { x: 217, y: 0 });
    deepStrictEqual(entity(world, ids.bench).pos, { x: 300, y: 0 });
  },
);

test(
  "the cup on the bench is no obstacle: it is on another support",
  (t) => {
    const { world, ids } = open(t);
    const result = run(world, ids.ann, "push", "chair", { dir: "+x", distance_cm: 100 });
    deepStrictEqual(eventOf(result, "collided").data, { with: ids.bench });
    strictEqual(entity(world, ids.cup).support, ids.bench);
  },
);

test(
  "a chair already against the bench refuses blocked and changes nothing",
  (t) => {
    const { world, ids } = open(t);
    run(world, ids.ann, "push", "chair", { dir: "+x", distance_cm: 100 });
    // Closer, so reach holds whether or not the chair stopped.
    run(world, ids.ann, "move", undefined, { to: { x: 200, y: 60 } });
    const before = world.snapshot().version;
    const result = run(world, ids.ann, "push", "chair", { dir: "+x", distance_cm: 10 });
    strictEqual(result.status, "refused");
    strictEqual(result.reason_code, "blocked");
    deepStrictEqual(result.reason_data, { with: ids.bench });
    strictEqual(world.snapshot().version, before);
  },
);

test(
  "pulling the chair away from the bench is never blocked by it",
  (t) => {
    const { world, ids } = open(t);
    run(world, ids.ann, "push", "chair", { dir: "+x", distance_cm: 100 });
    run(world, ids.ann, "move", undefined, { to: { x: 200, y: 60 } });
    const result = run(world, ids.ann, "pull", "chair", { dir: "+x", distance_cm: 30 });
    strictEqual(result.status, "ok");
    deepStrictEqual(types(result), ["pull", "moved"]);
    deepStrictEqual(entity(world, ids.chair).pos, { x: 187, y: 0 });
  },
);

test(
  "an agent is an obstacle: the chair stops at rex, who stays put",
  (t) => {
    const { world, ids } = open(t);
    // Centres 100 apart in y, half-depths 22.5 + 12.5: exactly 65.
    const result = run(world, ids.ann, "push", "chair", { dir: "-y", distance_cm: 100 });
    strictEqual(result.status, "ok");
    deepStrictEqual(eventOf(result, "moved").data, { distance_cm: 65 });
    deepStrictEqual(eventOf(result, "collided").data, { with: ids.rex });
    deepStrictEqual(entity(world, ids.chair).pos, { x: 150, y: -65 });
    deepStrictEqual(entity(world, ids.rex).pos, { x: 150, y: -100 });
  },
);

test(
  "a stone pushed into the bottle stops at it and the impact breaks the bottle",
  (t) => {
    const { world, ids } = open(t);
    // Centres 100 apart, half-widths 10 + 4: 86.
    const result = run(world, ids.bob, "push", "stone", { dir: "+x", distance_cm: 150 });
    strictEqual(result.status, "ok");
    deepStrictEqual(eventOf(result, "moved").data, { distance_cm: 86 });
    const collided = eventOf(result, "collided");
    deepStrictEqual(collided.data, { with: ids.bottle });
    // The severity formula is open; what is fixed is that the break is caused by the collision.
    const broken = eventOf(result, "broken");
    strictEqual(broken.entity, ids.bottle);
    strictEqual(broken.cause_id, collided.event_id);
    strictEqual(entity(world, ids.bottle).status, "broken");
  },
);

test(
  "a light impact damages nothing: chair against bench leaves both whole",
  (t) => {
    const { world, ids } = open(t);
    const result = run(world, ids.ann, "push", "chair", { dir: "+x", distance_cm: 100 });
    ok(types(result).includes("collided"));
    ok(!types(result).includes("damaged"));
    strictEqual(entity(world, ids.chair).integrity, 100);
    strictEqual(entity(world, ids.bench).integrity, 100);
  },
);

// The drop point is the holder's centre, and an agent cannot walk to stand over a table, so a walking
// agent drops at its feet and sets things on the bench with `put`. A holder placed over a surface by
// the world's author (a legal overlap) is how a drop still meets one.
function placeAnn(world: World, ids: Record<Name, Id>, pos: { x: number; y: number }): void {
  strictEqual(world.edit({ kind: "place", target: ids.ann, support: ids.shop, pos }).status, "ok");
}

test("a cup dropped beside the bench falls to the floor; put sets it on the bench", (t) => {
  const { world, ids } = open(t);
  strictEqual(run(world, ids.ann, "move", undefined, { to: { x: 300, y: 45 } }).status, "ok");
  strictEqual(run(world, ids.ann, "take", "cup").status, "ok");
  deepStrictEqual(eventOf(run(world, ids.ann, "drop", "cup"), "dropped").data, { fall_cm: 100 });
  strictEqual(entity(world, ids.cup).support, ids.shop);
  strictEqual(run(world, ids.ann, "take", "cup").status, "ok");
  strictEqual(run(world, ids.ann, "put", "cup", { relation: "on", destination: "bench" }).status, "ok");
  strictEqual(entity(world, ids.cup).support, ids.bench);
});

test("a cup dropped over the bench comes to rest on it, falling 25 cm, not 100", (t) => {
  const { world, ids } = open(t);
  strictEqual(run(world, ids.ann, "move", undefined, { to: { x: 300, y: 60 } }).status, "ok");
  strictEqual(run(world, ids.ann, "take", "cup").status, "ok");
  placeAnn(world, ids, { x: 300, y: 20 });
  const result = run(world, ids.ann, "drop", "cup");
  strictEqual(result.status, "ok");
  // Hand height 100, bench height 75.
  deepStrictEqual(eventOf(result, "dropped").data, { fall_cm: 25 });
  strictEqual(entity(world, ids.cup).support, ids.bench);
  strictEqual(entity(world, ids.cup).pos, null);
});

test("a cup dropped over the stone falls past it to the floor: a stone is no surface", (t) => {
  const { world, ids } = open(t);
  strictEqual(run(world, ids.ann, "move", undefined, { to: { x: 300, y: 60 } }).status, "ok");
  strictEqual(run(world, ids.ann, "take", "cup").status, "ok");
  placeAnn(world, ids, { x: 150, y: 200 });
  const result = run(world, ids.ann, "drop", "cup");
  deepStrictEqual(eventOf(result, "dropped").data, { fall_cm: 100 });
  strictEqual(entity(world, ids.cup).support, ids.shop);
});

test(
  "a short push of the bench leaves the cup standing on it",
  (t) => {
    const { world, ids } = open(t);
    strictEqual(run(world, ids.ann, "move", undefined, { to: { x: 300, y: 60 } }).status, "ok");
    const result = run(world, ids.ann, "push", "bench", { dir: "-y", distance_cm: 10 });
    strictEqual(result.status, "ok");
    deepStrictEqual(types(result), ["push", "moved"]);
    strictEqual(entity(world, ids.cup).support, ids.bench);
  },
);

test("rubble does not block: the stone slides on over the broken bottle and its shards", (t) => {
  const { world, ids } = open(t);
  run(world, ids.bob, "push", "stone", { dir: "+x", distance_cm: 150 });
  strictEqual(entity(world, ids.bottle).status, "broken");
  strictEqual(run(world, ids.bob, "move", undefined, { to: { x: 200, y: 220 } }).status, "ok");
  const result = run(world, ids.bob, "push", "stone", { dir: "+x", distance_cm: 30 });
  strictEqual(result.status, "ok");
  deepStrictEqual(types(result), ["push", "moved"]);
  deepStrictEqual(entity(world, ids.stone).pos, { x: 266, y: 200 });
});

test("a struck agent takes no harm: the chair stops at rex, who keeps every point", (t) => {
  const { world, ids } = open(t);
  const parts = entity(world, ids.rex).parts;
  const result = run(world, ids.ann, "push", "chair", { dir: "-y", distance_cm: 100 });
  deepStrictEqual(eventOf(result, "collided").data, { with: ids.rex });
  ok(!types(result).includes("damaged"));
  strictEqual(entity(world, ids.rex).integrity, 100);
  deepStrictEqual(entity(world, ids.rex).parts, parts);
});
