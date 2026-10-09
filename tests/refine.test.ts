import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, memoryWorld, openWorld, verifyWorld, type Id, type Result, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { cli } from "./cli-run.js";
import { buildInitial, genStep, mulberry32, withProcessFixtures } from "./property-gen.js";
import { tempDir } from "./harness.js";

// Refinement: an entity becomes a preset that extends the one it is, keeping its state and taking the
// new preset's definitions, or is refused and nothing changes.

const shipped = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const registry = parseRegistry({
  ...JSON.parse(canonicalJson(shipped)) as Record<string, unknown>,
  small_table: { id: "small_table", extends: "table", size_cm: { w: 20, d: 15, h: 75 } },
  flat_table: { id: "flat_table", extends: "table", props: { surface: false } },
  big_chest: { id: "big_chest", extends: "chest", size_cm: { w: 130, d: 70, h: 40 } },
  tiny_chest: { id: "tiny_chest", extends: "chest", props: { inner_w_cm: 10, inner_d_cm: 10, inner_h_cm: 10 } },
  half_bottle: { id: "half_bottle", extends: "bottle", props: { capacity_cm3: 500 } },
  sturdy_bottle: { id: "sturdy_bottle", extends: "bottle", mass_g: 900, props: { break_fall_cm: 400 } },
  frail: { id: "frail", extends: "human", part_overrides: { arm_l: { max_integrity: 50 } } },
  torso_only: {
    id: "torso_only",
    extends: "human",
    parts: [
      { name: "head", parent: null, contributes: { sight: 100, hearing: 100, speech: 100 }, detachable: false, max_integrity: 100 },
      { name: "torso", parent: null, contributes: { moving: 100, touch: 100 }, detachable: false, max_integrity: 100 },
    ],
  },
});

const floor = (x: number, y = 0) => ({ location: "hall", support: "hall", pos: { x, y } });

function built(t: { after(callback: () => void): void }): { world: World; dir: string; id: (name: string) => Id } {
  const dir = join(tempDir(t), "w");
  const world = createWorld(
    dir,
    [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "table", template: "table", overrides: { name: "table", ...floor(0) } },
      { id: "book", template: "book", overrides: { name: "book", location: "hall", support: "table" } },
      { id: "box", template: "chest", overrides: { name: "box", location: "hall", support: "table" } },
      { id: "chest", template: "chest", overrides: { name: "chest", ...floor(300) } },
      { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", contained_in: "chest" } },
      { id: "bottle", template: "bottle", overrides: { name: "bottle", ...floor(-300) } },
      { id: "lamp", template: "lantern", overrides: { name: "lamp", ...floor(-200), fuel_pct: 25, props: { burning: true } } },
      { id: "ann", template: "human", overrides: { name: "ann", ...floor(200) } },
    ],
    registry,
  );
  return { world, dir, id: (name) => world.id(name)! };
}

let n = 0;
const refine = (world: World, target: Id, template: string): Result => world.edit({ kind: "refine", target, template }, { command_id: `refine-${(n += 1)}` });

function refused(result: Result, code: string, data?: unknown): void {
  deepStrictEqual([result.status, result.reason_code], ["refused", code]);
  if (data !== undefined) {
    deepStrictEqual(result.reason_data, data);
  }
}

test("a lantern refined to a candle takes the candle's definitions and keeps its state and place", (t) => {
  const { world, id } = built(t);
  const lamp = id("lamp");
  const before = world.entity(lamp)!;
  deepStrictEqual([before.props.fuel, before.props.burning], [5, true]);
  const result = refine(world, lamp, "candle");
  strictEqual(result.status, "ok");

  const after = world.entity(lamp)!;
  strictEqual(after.template, "candle");
  // State stays: the fuel it had (a candle's own is 8) and that it burns, its name and where it stands.
  deepStrictEqual([after.props.fuel, after.props.burning], [5, true]);
  deepStrictEqual([after.name, after.support, after.pos, after.location], [before.name, before.support, before.pos, before.location]);
  // Definitions are the preset's: nothing of the lantern's is left that the candle redefines.
  deepStrictEqual({ ...after.props, fuel: 8 }, { ...registry.candle!.props, burning: true });
  strictEqual(world.snapshot().version, 1);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);

  // One `edited` event says what became what, and the delta is the template field.
  const edited = result.events.filter((event) => event.type === "edited");
  deepStrictEqual(edited.map((event) => [event.entity, event.data]), [[lamp, { field: "template", from: "lantern", to: "candle" }]]);
  ok(result.deltas.some((delta) => delta.field === "template" && delta.from === "lantern" && delta.to === "candle"));

  // The candle's own burn process now runs: used up, it leaves the world, which a lantern's does not.
  const waiter = id("ann");
  for (let tick = 0; tick < 6; tick += 1) {
    world.command({ command_id: `wait-${tick}`, actor: waiter, verb: "wait", args: { ticks: 1 } });
  }
  strictEqual(world.entity(lamp), null);
});

test("state the entity has beats the preset's default, and a new preset's definitions replace the old", (t) => {
  const { world, id } = built(t);
  const bottle = id("bottle");
  world.edit({ kind: "update_props", target: bottle, props: { liquid_amount: 400, liquid_material: "beer" } });
  strictEqual(refine(world, bottle, "sturdy_bottle").status, "ok");
  const after = world.entity(bottle)!;
  deepStrictEqual([after.props.liquid_amount, after.props.liquid_material], [400, "beer"]);
  strictEqual(after.props.break_fall_cm, 400);
  // The mass a template gives is read off the template, so it follows the entity.
  strictEqual(registry[after.template]?.mass_g, 900);
});

test("only a preset that extends the entity's is a refinement", (t) => {
  const { world, id } = built(t);
  const before = canonicalJson(world.snapshot());
  // A stranger, the same preset, and a parent (going back up) are not refinements.
  refused(refine(world, id("book"), "chest"), "not_a_refinement");
  refused(refine(world, id("lamp"), "lantern"), "not_a_refinement");
  const refinedOnce = refine(world, id("lamp"), "candle");
  strictEqual(refinedOnce.status, "ok");
  refused(refine(world, id("lamp"), "lantern"), "not_a_refinement");
  // Through more than one step it still descends.
  strictEqual(refine(world, id("bottle"), "wine_bottle").status, "ok");
  strictEqual(refine(world, id("table"), "small_table").status, "refused");
  // A template the set does not have is an invalid edit, not a refusal.
  const unknown = refine(world, id("bottle"), "no_such_preset");
  deepStrictEqual([unknown.status, unknown.reason_code], ["invalid", "unknown_template"]);
  // Nothing before the one ok refinement and the wine bottle changed.
  ok(canonicalJson(world.snapshot()) !== before);
  strictEqual(world.entity(id("book"))?.template, "book");
});

test("a table refined to a smaller one under a book that no longer fits is refused, and nothing changes", (t) => {
  const { world, id } = built(t);
  const before = canonicalJson(world.snapshot());
  // The book (25 by 18) has nothing to lie on in a 20 by 15 top.
  refused(refine(world, id("table"), "small_table"), "too_large", { item_cm: 25, space_cm: 20 });
  // A surface that stops being one cannot keep what stands on it.
  refused(refine(world, id("table"), "flat_table"), "not_a_surface");
  // And an entity may not outgrow the surface it stands on.
  refused(refine(world, id("box"), "big_chest"), "too_large", { item_cm: 130, space_cm: 120 });
  strictEqual(canonicalJson(world.snapshot()), before);
  strictEqual(world.snapshot().version, 0);
  // With the book gone the same refinement is allowed: the book was the only thing in the way.
  strictEqual(world.edit({ kind: "remove", target: id("book") }).status, "ok");
  strictEqual(world.edit({ kind: "remove", target: id("box") }).status, "ok");
  strictEqual(refine(world, id("table"), "small_table").status, "ok");
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("contents must still fit their holder and the liquid its vessel", (t) => {
  const { world, id } = built(t);
  const before = canonicalJson(world.snapshot());
  // A stone of 20 cm does not fit 10 cm of space: the snapshot's own rule refuses the result.
  refused(refine(world, id("chest"), "tiny_chest"), "container_contents_too_large");
  // 750 of wine in a bottle that now holds 500.
  refused(refine(world, id("bottle"), "half_bottle"), "liquid_exceeds_capacity", { held: 750, capacity: 500 });
  strictEqual(canonicalJson(world.snapshot()), before);
  // Poured down to what fits, it is allowed.
  world.edit({ kind: "update_props", target: id("bottle"), props: { liquid_amount: 500 } });
  strictEqual(refine(world, id("bottle"), "half_bottle").status, "ok");
  strictEqual(world.entity(id("bottle"))?.props.liquid_amount, 500);
});

test("stored part state is held to the new preset, and a part at its new default is no longer stored", (t) => {
  const { world, id } = built(t);
  const ann = id("ann");
  // Intact at 100 of 100 is the default and is not stored; 80 is stored.
  world.edit({ kind: "set_part", target: ann, part: "arm_l", state: { integrity: 80, status: "intact" } });
  world.edit({ kind: "set_part", target: ann, part: "torso", state: { integrity: 30, status: "damaged" } });
  const before = canonicalJson(world.snapshot());
  // The new arm holds at most 50, and the stored 80 is out of range.
  refused(refine(world, ann, "frail"), "integrity_out_of_range");
  // Lowered to what it can be, the arm is exactly the new default and leaves the record.
  world.edit({ kind: "set_part", target: ann, part: "arm_l", state: { integrity: 50, status: "intact" } });
  strictEqual(canonicalJson(world.snapshot()) === before, false);
  strictEqual(refine(world, ann, "frail").status, "ok");
  deepStrictEqual(Object.keys(world.entity(ann)!.parts), ["torso"]);
  // A stored part the new preset does not have is a refusal, and a part state untouched stays untouched.
  const hall = id("hall");
  const standing = (x: number) => ({ location: hall, support: hall, pos: { x, y: 0 } });
  const bob = world.edit({ kind: "spawn", template: "human", overrides: { name: "bob", ...standing(100) } });
  strictEqual(bob.status, "ok");
  const bobId = bob.events.find((event) => event.type === "spawned")!.entity;
  world.edit({ kind: "set_part", target: bobId, part: "hand_l", state: { integrity: 0, status: "destroyed" } });
  refused(refine(world, bobId, "torso_only"), "unknown_part");
  const clean = world.edit({ kind: "spawn", template: "human", overrides: { name: "cy", ...standing(120) } });
  const cyId = clean.events.find((event) => event.type === "spawned")!.entity;
  strictEqual(refine(world, cyId, "torso_only").status, "ok");
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("only the world author refines, an edit is the one way, and a beat cannot", (t) => {
  const { world, id } = built(t);
  const lamp = id("lamp");
  const asActor = world.command({ command_id: "c1", actor: id("ann"), verb: "edit", target: lamp, args: { edit: { kind: "refine", target: lamp, template: "candle" } } });
  deepStrictEqual([asActor.status, asActor.reason_code], ["invalid", "invalid_author"]);
  const malformed = world.edit({ kind: "refine", target: lamp, template: "" });
  deepStrictEqual([malformed.status, malformed.reason_code], ["invalid", "invalid_args"]);
  // A beat acts at a later tick, and the architect's setup is over by then: refine is no beat action.
  const beat = world.edit({ kind: "schedule_beat", id: "b1", at_tick: 5, action: { kind: "refine", target: lamp, template: "candle" } as never });
  strictEqual(beat.status, "invalid");
  strictEqual(world.entity(lamp)?.template, "lantern");
});

test("a refinement is logged and replays: verify agrees, and a reopened world is the same", (t) => {
  const { world, dir, id } = built(t);
  strictEqual(refine(world, id("lamp"), "candle").status, "ok");
  strictEqual(refine(world, id("bottle"), "sturdy_bottle").status, "ok");
  refused(refine(world, id("table"), "small_table"), "too_large");
  const verified = verifyWorld(dir);
  strictEqual(verified.ok, true);
  const reopened = openWorld(dir);
  strictEqual(canonicalJson(reopened.snapshot()), canonicalJson(world.snapshot()));
  strictEqual(reopened.entity(id("lamp"))?.template, "candle");
  // The world's frozen templates remember where each came from, so a reopened one judges the same way:
  // a sibling of the bottle's current preset is no refinement of it, and the table is refused on fit.
  refused(refine(reopened, id("bottle"), "wine_bottle"), "not_a_refinement");
  strictEqual(reopened.edit({ kind: "refine", target: id("table"), template: "small_table" }).reason_code, "too_large");
});

// A lantern with a second process on the fuel it already has, so the refinement writes no prop and only
// its template says the leak is new; and one whose new process waits on a prop the lantern does not set.
const leaking = parseRegistry({
  ...JSON.parse(canonicalJson(shipped)) as Record<string, unknown>,
  leaky_lantern: {
    id: "leaky_lantern",
    extends: "lantern",
    processes: [{ id: "leak", every_ticks: 2, effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } } }],
  },
  guarded_lantern: {
    id: "guarded_lantern",
    extends: "lantern",
    processes: [{
      id: "leak",
      every_ticks: 2,
      while: { prop: "burning", op: "eq", value: true },
      effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } },
    }],
  },
});

function lanternHall(t: { after(callback: () => void): void }): { world: World; dir: string; lamp: Id; ann: Id } {
  const dir = join(tempDir(t), "w");
  const world = createWorld(
    dir,
    [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "lamp", template: "lantern", overrides: { name: "lamp", ...floor(-200) } },
      { id: "ann", template: "human", overrides: { name: "ann", ...floor(200) } },
    ],
    leaking,
  );
  return { world, dir, lamp: world.id("lamp")!, ann: world.id("ann")! };
}

test("a refinement starts the processes its new preset adds, caused by the edit", (t) => {
  const { world, dir, lamp, ann } = lanternHall(t);
  deepStrictEqual(world.snapshot().schedule, undefined);
  const result = refine(world, lamp, "leaky_lantern");
  strictEqual(result.status, "ok");
  const edited = result.events.find((event) => event.type === "edited")!;
  deepStrictEqual(world.snapshot().schedule, [
    { due_tick: 2, kind: "process", entity: lamp, cause_id: edited.event_id, process: "leak" },
  ]);

  const wait = (i: number) => world.command({ command_id: `leak-wait-${i}`, actor: ann, verb: "wait", args: { ticks: 1 } });
  strictEqual(wait(1).status, "ok");
  strictEqual(world.entity(lamp)?.props.fuel, 20);
  const second = wait(2);
  const changed = second.events.find((event) => event.type === "changed")!;
  deepStrictEqual([changed.tick, changed.cause_id, changed.data], [2, edited.event_id, { prop: "fuel", from: 20, to: 19, process: "leak" }]);
  strictEqual(world.entity(lamp)?.props.fuel, 19);

  strictEqual(verifyWorld(dir).ok, true);
  const reopened = openWorld(dir);
  strictEqual(canonicalJson(reopened.snapshot()), canonicalJson(world.snapshot()));
});

test("a refinement whose new process cannot run schedules nothing", (t) => {
  const { world, lamp } = lanternHall(t);
  strictEqual(refine(world, lamp, "guarded_lantern").status, "ok");
  deepStrictEqual(world.snapshot().schedule, undefined);
});

test("a world made before templates kept their lineage refines once its templates are upgraded", (t) => {
  const dir = join(tempDir(t), "w");
  createWorld(dir, [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "lamp", template: "lantern", overrides: { name: "lamp", ...floor(-200) } },
  ]);
  const path = join(dir, "templates.json");
  const stored = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, unknown>>;
  for (const template of Object.values(stored)) {
    delete template.lineage;
  }
  writeFileSync(path, canonicalJson(stored));

  const older = openWorld(dir);
  const lamp = older.id("lamp")!;
  refused(refine(older, lamp, "candle"), "not_a_refinement");
  const hash = older.snapshot().templates_hash;
  older.upgradeTemplates();
  strictEqual(older.snapshot().templates_hash, hash);
  strictEqual(refine(older, lamp, "candle").status, "ok");
  strictEqual(openWorld(dir).entity(lamp)?.template, "candle");
});

test("the CLI refines through the edit op", (t) => {
  const { dir, id } = built(t);
  const send = (edit: Record<string, unknown>) => JSON.parse(cli(JSON.stringify({ op: "edit", world: dir, edit })).stdout) as { status: string; reason_code?: string };
  const ok2 = send({ kind: "refine", target: id("lamp"), template: "candle" });
  strictEqual(ok2.status, "ok");
  const stranger = send({ kind: "refine", target: id("book"), template: "chest" });
  deepStrictEqual([stranger.status, stranger.reason_code], ["refused", "not_a_refinement"]);
  const extra = cli(JSON.stringify({ op: "edit", world: dir, edit: { kind: "refine", target: id("lamp"), template: "candle", more: 1 } }));
  strictEqual(extra.status, 2);
});

test("random refinements among random commands keep the world valid, and a refused one changes nothing", () => {
  const base = withProcessFixtures(shipped);
  const tally = { ok: 0, refused: 0 };
  for (let seed = 1; seed <= 60; seed += 1) {
    const world = memoryWorld(buildInitial(base), base);
    const rand = mulberry32(seed);
    for (let step = 0; step < 40; step += 1) {
      const next = genStep(rand, world.snapshot(), `r${seed}-${step}`);
      if (!("kind" in next)) {
        world.command(next);
      }
      // Then try to refine something, to a descendant of what it is about as often as to a stranger.
      const snapshot = world.snapshot();
      const ids = Object.keys(snapshot.entities).sort();
      const target = ids[Math.floor(rand() * ids.length)]!;
      const from = snapshot.entities[target]!.template;
      const pool = Object.values(base).filter((template) => (rand() < 0.8 ? template.lineage?.includes(from) === true : true));
      const template = pool[Math.floor(rand() * pool.length)]?.id;
      if (template === undefined) {
        continue;
      }
      const before = canonicalJson(snapshot);
      const result = world.edit({ kind: "refine", target, template }, { command_id: `refine-${seed}-${step}` });
      if (result.status === "ok") {
        tally.ok += 1;
        const after = world.snapshot();
        strictEqual(after.entities[target]?.template, template);
        strictEqual(after.version, snapshot.version + 1);
        deepStrictEqual(validateSnapshot(after, base), []);
        ok(base[template]!.lineage?.includes(from));
      } else {
        tally.refused += 1;
        strictEqual(canonicalJson(world.snapshot()), before, `${result.reason_code}`);
      }
    }
  }
  ok(tally.ok > 5 && tally.refused > 5, JSON.stringify(tally));
});
