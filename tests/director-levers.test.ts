import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, WorldError, type Id, type Result, type Scene, type World } from "../src/index.js";
import { directorWorld } from "../src/director-world.js";
import { playerWorld } from "../src/player-world.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// The director's levers (`docs/roles.md`): a pool beat played, a door's odds steered within the range the
// scene gave, and quiet rounds closed while every player is idle. Each lever is in the log under `director`.
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function scene(extra: Partial<Scene> = {}): Scene {
  return {
    entities: [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
      { id: "door", template: "door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
      { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
      { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
      { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 0, y: 80 } } },
    ],
    run: {
      tick_limit: 40,
      slots: ["ann", "bob"],
      pool: [{ id: "pooled", action: { kind: "sound", entity: "door" } }],
      odds: [{ entity: "door", prop: "jam_pct", min: 0, max: 60 }],
    },
    ...extra,
  };
}

function open(t: { after(callback: () => void): void }, extra: Partial<Scene> = {}): { world: World; id: (name: string) => Id } {
  const world = createWorld(join(tempDir(t), "levers"), scene(extra), registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, id };
}

// A started run with dana in ann and eve in bob, both players registered.
function playing(t: { after(callback: () => void): void }, extra: Partial<Scene> = {}): { world: World; id: (name: string) => Id } {
  const made = open(t, extra);
  const director = directorWorld(made.world);
  director.edit({ kind: "register_player", handle: "dana", slot: made.id("ann") }, { command_id: "reg-dana" });
  director.edit({ kind: "register_player", handle: "eve", slot: made.id("bob") }, { command_id: "reg-eve" });
  director.edit({ kind: "start_run" }, { command_id: "start" });
  return made;
}

let seq = 0;
const reason = (result: Result): [string, string | undefined] => [result.status, result.reason_code];
const nextId = (): string => `lever-${(seq += 1)}`;

test("the director plays a pool beat at a tick ahead, once; a second play and a past tick are refused", (t) => {
  const { world, id } = open(t);
  const director = directorWorld(world);
  deepStrictEqual(reason(director.edit({ kind: "play_beat", id: "pooled", at_tick: 0 }, { command_id: nextId() })), ["refused", "beat_in_past"]);
  const played = director.edit({ kind: "play_beat", id: "pooled", at_tick: 3 }, { command_id: "play" });
  strictEqual(played.status, "ok");
  deepStrictEqual(world.snapshot().run?.pool, []);
  const beat = world.schedule({ kind: "beat" }).find((cause) => cause.kind === "beat" && cause.id === "pooled");
  ok(beat !== undefined);
  deepStrictEqual([beat.due_tick, beat.entity, beat.cause_id], [3, id("door"), played.events[0]?.event_id]);
  deepStrictEqual(reason(director.edit({ kind: "play_beat", id: "pooled", at_tick: 5 }, { command_id: nextId() })), ["refused", "no_such_pool_beat"]);
  strictEqual(director.edit({ kind: "start_run" }, { command_id: "go" }).status, "ok");
  // Time passes in rounds while the run runs: four closed rounds, and the beat sounds in the third.
  const sounded = [0, 1, 2, 3].flatMap((): number[] => (world.round([]).closing?.events ?? []).filter((event) => event.type === "sounded").map((event) => event.tick));
  deepStrictEqual(sounded, [3]);
});

test("a steered door's odds are in force within the range, and out of it or on a device with no range are refused", (t) => {
  const { world, id } = open(t);
  const director = directorWorld(world);
  strictEqual(director.edit({ kind: "steer", entity: id("door"), prop: "jam_pct", value: 40 }, { command_id: "steer-40" }).status, "ok");
  deepStrictEqual(world.snapshot().run?.steered, [{ entity: id("door"), prop: "jam_pct", value: 40 }]);
  deepStrictEqual(reason(director.edit({ kind: "steer", entity: id("door"), prop: "jam_pct", value: 61 }, { command_id: nextId() })), ["refused", "out_of_range"]);
  deepStrictEqual(reason(director.edit({ kind: "steer", entity: id("stone"), prop: "jam_pct", value: 10 }, { command_id: nextId() })), ["refused", "not_steerable"]);
});

test("a steered jam is what the device rolls against, and the template's value is left as it was", (t) => {
  // The ai's terminal controls the door from the yard, so its commands are remote and may jam.
  const jams = createWorld(join(tempDir(t), "jams"), {
    entities: [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
      { id: "generator", template: "generator", overrides: { name: "generator", location: "yard", support: "yard", pos: { x: -300, y: -300 } } },
      { id: "ai", template: "terminal", overrides: { name: "ai", location: "yard", support: "yard", pos: { x: 300, y: 0 }, props: { powered_by: "generator" } } },
      { id: "door", template: "door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" } } },
    ],
    run: { tick_limit: 40, odds: [{ entity: "door", prop: "jam_pct", min: 0, max: 100 }] },
  }, registry, { seed: 4 });
  const director = directorWorld(jams);
  const ai = jams.id("ai");
  const door = jams.id("door");
  ok(ai !== null && door !== null);
  director.edit({ kind: "start_run" }, { command_id: "go" });
  director.edit({ kind: "steer", entity: door, prop: "jam_pct", value: 100 }, { command_id: "jam-all" });
  // While the run runs, an agent acts in a round.
  const jammed = jams.round([{ command_id: "open-1", actor: ai, verb: "open", target: "door" }]).results[0]!;
  deepStrictEqual(jammed.events.map((event) => event.type), ["open", "jammed"]);
  director.edit({ kind: "steer", entity: door, prop: "jam_pct", value: 0 }, { command_id: "jam-none" });
  const opened = jams.round([{ command_id: "open-2", actor: ai, verb: "open", target: "door" }]).results[0]!;
  strictEqual(opened.status, "ok");
  deepStrictEqual(opened.events.some((event) => event.type === "jammed"), false);
});

test("quiet rounds close while every live player is idle, and stop at the max, one tick before a beat, or at a round a body senses", (t) => {
  const { world, id } = playing(t);
  const director = directorWorld(world);
  // Dana has a move, so the time does not pass for her.
  playerWorld(world, "dana").submit({ command_id: "dana-wait", verb: "wait", args: { ticks: 1 } });
  deepStrictEqual(director.closeRounds({ max: 5 }), { status: "refused", reason_code: "players_active", rounds: 0 });
  // Both idle: five quiet rounds, then the max.
  playerWorld(world, "dana").withdraw();
  playerWorld(world, "dana").idle();
  playerWorld(world, "eve").idle();
  deepStrictEqual(director.closeRounds({ max: 5 }), { status: "ok", rounds: 5, stopped: "max" });
  strictEqual(world.snapshot().tick, 5);
  // A beat due three rounds on: the quiet stops one round before it.
  strictEqual(world.edit({ kind: "schedule_beat", id: "knock", at_tick: 9, action: { kind: "sound", entity: id("door") } }, { command_id: "knock" }).status, "ok");
  deepStrictEqual(director.closeRounds({ max: 10, stop_before: "knock" }), { status: "ok", rounds: 3, stopped: "beat" });
  strictEqual(world.snapshot().tick, 8);
  deepStrictEqual(world.schedule({ kind: "beat" }).map((cause) => cause.due_tick), [9]);
  deepStrictEqual(director.closeRounds({ max: 10, stop_before: "nothing" }), { status: "refused", reason_code: "no_such_beat", rounds: 0 });
  // The knock falls at 9, the next round: ann in the hall hears it, so the quiet stops at once.
  deepStrictEqual(director.closeRounds({ max: 10 }), { status: "ok", rounds: 1, stopped: "heard" });
  // Every quiet round is a closed round, and it is the director's.
  const closes = world.attempts(0).filter((attempt) => attempt.round?.close === true && attempt.by?.role === "director");
  // Five, then three, then one: nine quiet rounds, each closed by the director.
  strictEqual(closes.length, 9);
});

test("every lever is in the log under the director's role, and the scene refuses a pool or odds it cannot hold", (t) => {
  const { world, id } = playing(t);
  const director = directorWorld(world);
  director.edit({ kind: "steer", entity: id("door"), prop: "jam_pct", value: 20 }, { command_id: "steer-log" });
  director.edit({ kind: "play_beat", id: "pooled", at_tick: 6 }, { command_id: "play-log" });
  const logged = world.attempts(0);
  const by = (command: string) => logged.find((attempt) => attempt.command.command_id === command)?.by;
  deepStrictEqual(by("steer-log"), { role: "director" });
  deepStrictEqual(by("play-log"), { role: "director" });
  // The scene: a pool beat with a tick, a pool id used twice, and odds on a device that is no door.
  const refusal = (extra: Partial<Scene>, rule: string) => {
    throws(
      () => createWorld(join(tempDir(t), "refused"), scene(extra), registry),
      (error: unknown) => error instanceof WorldError && error.code === "invalid_scenario" && error.message.includes(rule),
      rule,
    );
  };
  refusal({ run: { tick_limit: 9, pool: [{ id: "timed", at_tick: 4, action: { kind: "sound", entity: "door" } }] } }, "run.pool[0]: invalid_beat");
  refusal({ run: { tick_limit: 9, pool: [{ id: "twin", action: { kind: "sound", entity: "door" } }, { id: "twin", action: { kind: "sound", entity: "door" } }] } }, "run.pool[1]: duplicate_beat");
  refusal({ run: { tick_limit: 9, odds: [{ entity: "stone", prop: "jam_pct", min: 0, max: 50 }] } }, "run.odds[0].entity: not_a_door");
  refusal({ run: { tick_limit: 9, odds: [{ entity: "door", prop: "jam_pct", min: 70, max: 50 }] } }, "run.odds[0]: invalid_odds");
});
