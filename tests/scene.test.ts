import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli } from "./cli-run.js";
import { canonicalJson, createWorld, openWorld, WORLD_AUTHOR, WorldError, type Id, type Result, type Scene, type World } from "../src/index.js";
import { tempDir } from "./harness.js";

// A scene (`docs/scenario.md`) is the architect's whole setup: entities, the dice's seed, the beats queued
// at creation and the run's limits. A beat names its entities by scenario id and is checked as a
// `schedule_beat` would be, and a refusal names its path and rule, with nothing written.
function scene(extra: Partial<Scene> = {}): Scene {
  return {
    seed: 9,
    entities: [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
      { id: "door", template: "door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
      { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    ],
    beats: [
      { id: "knock", at_tick: 3, action: { kind: "sound", entity: "door" } },
      { id: "chime", at_tick: 6, action: { kind: "sound", entity: "door", loud: true }, then: [{ id: "chime-echo", delay_ticks: 2, action: { kind: "sound", entity: "door" } }] },
      { id: "tick", at_tick: 2, action: { kind: "sound", entity: "door" }, repeat: { every_ticks: 4, times: 1 } },
    ],
    ...extra,
  };
}

function build(t: { after(callback: () => void): void }, extra: Partial<Scene> = {}): { dir: string; world: World } {
  const dir = join(tempDir(t), "scene");
  return { dir, world: createWorld(dir, scene(extra)) };
}

// The scene's refusal: its code, and the message names the path and the rule.
function refusal(t: { after(callback: () => void): void }, extra: Partial<Scene>, rule: string): void {
  const dir = join(tempDir(t), "refused");
  throws(
    () => createWorld(dir, scene(extra)),
    (error: unknown) => error instanceof WorldError && error.code === "invalid_scenario" && error.message.includes(rule),
    rule,
  );
  // Nothing is written: the world's files are never made.
  strictEqual(existsSync(join(dir, "initial.json")), false, rule);
}

let seq = 0;
function advance(world: World, ticks: number): Result {
  seq += 1;
  return world.command({ command_id: `scene-adv-${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });
}
const soundedAt = (result: Result): number[] => result.events.filter((event) => event.type === "sounded").map((event) => event.tick);

test("a scene's beats are queued at their ticks with no cause, and run as an edited beat would", (t) => {
  const { world } = build(t);
  const beats = world.schedule({ kind: "beat" });
  deepStrictEqual(
    beats.map((cause) => [cause.kind === "beat" ? cause.id : "", cause.due_tick, cause.cause_id]),
    [["tick", 2, null], ["knock", 3, null], ["chime", 6, null]],
  );
  // The chime's echo waits for the chime to run; the repeat's second run waits for the first.
  deepStrictEqual(soundedAt(advance(world, 10)), [2, 3, 6, 6, 8]);
  deepStrictEqual(world.schedule({ kind: "beat" }), []);
});

test("a follower is scheduled by its parent's run, and a repeat's next run comes from the run before", (t) => {
  const { world } = build(t);
  deepStrictEqual(advance(world, 2).status, "ok");
  // Only what the scene queued is pending: the echo is not, until the chime has run.
  deepStrictEqual(
    world.schedule({ kind: "beat" }).map((cause) => (cause.kind === "beat" ? cause.id : "")),
    ["knock", "chime", "tick"],
  );
  // The chime runs at 6 and queues its echo two ticks on; the repeat's last run is also at 6.
  deepStrictEqual(soundedAt(advance(world, 4)), [3, 6, 6]);
  deepStrictEqual(
    world.schedule({ kind: "beat" }).map((cause) => [cause.kind === "beat" ? cause.id : "", cause.due_tick]),
    [["chime-echo", 8]],
  );
});

test("a run's limits and slots are stored and read back by snapshot(), and a scene without one has none", (t) => {
  const { world } = build(t, { run: { tick_limit: 20, slots: ["ann"] } });
  const ann = world.id("ann");
  ok(ann !== null);
  deepStrictEqual(world.snapshot().run, { tick_limit: 20, slots: [ann] });
  strictEqual("run" in build(t).world.snapshot(), false);
});

test("a beat that is malformed is refused with its path", (t) => {
  refusal(t, { beats: [{ id: "bad", at_tick: 3, action: { kind: "explode", entity: "door" } }] }, "beats[0]: invalid_beat");
});

test("a beat not ahead of the clock is refused", (t) => {
  refusal(t, { beats: [{ id: "now", at_tick: 0, action: { kind: "sound", entity: "door" } }] }, "beats[0]: beat_in_past");
});

test("two beats with one id are refused at the second", (t) => {
  refusal(
    t,
    { beats: [{ id: "a", at_tick: 1, action: { kind: "sound", entity: "door" } }, { id: "a", at_tick: 2, action: { kind: "sound", entity: "door" } }] },
    "beats[1]: duplicate_beat",
  );
});

test("a beat whose subject is no scenario entity is refused, naming the path of the entity", (t) => {
  refusal(t, { beats: [{ id: "ghost", at_tick: 1, action: { kind: "sound", entity: "nobody" } }] }, "beats[0].action.entity: no_such_entity");
});

test("beyond 256 beats the scene is refused at the one that goes over", (t) => {
  const beats = Array.from({ length: 257 }, (_unused, index) => ({ id: `b${index}`, at_tick: 1, action: { kind: "sound", entity: "door" } }));
  refusal(t, { beats }, "beats[256]: too_many_beats");
});

test("a slot that is no agent is refused", (t) => {
  refusal(t, { run: { slots: ["door"] } }, "run.slots[0]: not_an_agent");
});

test("a run with neither key is refused", (t) => {
  refusal(t, { run: {} }, "run: empty_run");
});

test("a tick limit that is not a positive int is refused", (t) => {
  refusal(t, { run: { tick_limit: 0 } }, "run.tick_limit: invalid_run");
});

test("a slot named twice is refused at the second", (t) => {
  refusal(t, { run: { slots: ["ann", "ann"] } }, "run.slots[1]: duplicate_slot");
});

test("the CLI's init and createWorld build the same world from the same scene", (t) => {
  const dir = join(tempDir(t), "cli");
  const file = join(tempDir(t), "scene.json");
  const json = { ...scene({ run: { tick_limit: 12, slots: ["ann"] } }) };
  writeFileSync(file, JSON.stringify(json));
  strictEqual(JSON.parse(cli(undefined, ["init", dir, file]).stdout).status, "ok");
  const library = createWorld(join(tempDir(t), "lib"), scene({ run: { tick_limit: 12, slots: ["ann"] } }));
  strictEqual(canonicalJson(openWorld(dir).snapshot()), canonicalJson(library.snapshot()));
  ok(library.snapshot().rng !== undefined, "the seed is the scene's");
});

test("a store world reopened keeps the beats and the run it was made with", (t) => {
  const { dir, world } = build(t, { run: { tick_limit: 30, slots: ["ann"] } });
  deepStrictEqual(openWorld(dir).schedule({ kind: "beat" }), world.schedule({ kind: "beat" }));
  deepStrictEqual(openWorld(dir).snapshot().run, world.snapshot().run);
});
