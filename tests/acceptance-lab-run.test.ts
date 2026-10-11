import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { aliasOf, createWorld, openWorld, type Id, type Result, type Scene, type World } from "../src/index.js";
import { directorWorld } from "../src/director-world.js";
import { playerWorld, type PlayerWorld } from "../src/player-world.js";
import { tempDir } from "./harness.js";

// The lab played as a run (`scenarios/lab-run.json`, `docs/limits-lab.md` "As a run"): the lab's subjects and AI are
// registered in slots, the director starts the run, scripted players submit through their handles only, and the
// director closes the rounds. One test per row; each builds its own world from the scene's seed.
const scene = JSON.parse(readFileSync(fileURLToPath(new URL("../scenarios/lab-run.json", import.meta.url)), "utf8")) as Scene;
const SUBJECTS = ["ann", "bob", "cid", "dee", "eve", "fay", "gus", "hal"] as const;
const ALL = [...SUBJECTS, "ai"];

// A run started with every slot registered: each subject on its own, the AI on the terminal's slot (terminal, arm).
function play(t: { after(callback: () => void): void }, dirName = "run") {
  const dir = join(tempDir(t), dirName);
  const world = createWorld(dir, scene, undefined);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  const director = directorWorld(world);
  for (const name of SUBJECTS) {
    strictEqual(director.edit({ kind: "register_player", handle: name, slot: id(name) }, { command_id: `reg-${name}` }).status, "ok");
  }
  strictEqual(director.edit({ kind: "register_player", handle: "ai", slot: id("terminal") }, { command_id: "reg-ai" }).status, "ok");
  strictEqual(director.edit({ kind: "start_run" }, { command_id: "start" }).status, "ok");
  return { dir, world, id, director, handle: (name: string): PlayerWorld => playerWorld(world, name) };
}

// The AI's body as its view names it: each body of the AI's slot is named by its alias in the view, keyed by the terminal.
const aiBody = (id: (name: string) => Id, name: "terminal" | "arm"): string => aliasOf(id("terminal"), id(name));

const reason = (result: Result): [string, string | undefined] => [result.status, result.reason_code];

test("row 1: two subjects reach for the key in one round: one takes it, the other's move is preempted, and the same seed gives the same winner on replay", (t) => {
  // The round's order comes from the seed, so a second world run from the same scene and moves names the same winner.
  const winner = (dirName: string): string => {
    const { world, id, director, handle } = play(t, dirName);
    strictEqual(world.edit({ kind: "place", target: id("ann"), support: id("lab"), pos: { x: -300, y: 60 } }).status, "ok");
    strictEqual(world.edit({ kind: "place", target: id("bob"), support: id("lab"), pos: { x: -300, y: -60 } }).status, "ok");
    deepStrictEqual(handle("ann").submit({ command_id: "ann-key", verb: "take", target: "key" }), { status: "ok" });
    deepStrictEqual(handle("bob").submit({ command_id: "bob-key", verb: "take", target: "key" }), { status: "ok" });
    const closed = director.closeRound();
    strictEqual(closed.status, "ok");
    deepStrictEqual(closed.results.map((result) => result.status).sort(), ["ok", "preempted"]);
    const taker = closed.results.find((result) => result.status === "ok")!.command_id === "ann-key" ? "ann" : "bob";
    strictEqual(world.entity(id("key"))?.contained_in, id(taker));
    ok(world.verify().ok);
    return taker;
  };
  strictEqual(winner("first"), winner("second"));
});

test("row 2: the AI locks the exit door through the panel while a subject at the panel unlocks it, in one round: the order decides, and both moves are in the log under their handles", (t) => {
  const { world, id, director, handle } = play(t);
  // Dee stands at the server panel, which works the exit door for whoever reaches it.
  strictEqual(world.edit({ kind: "place", target: id("dee"), support: id("server_room"), pos: { x: -300, y: 60 } }).status, "ok");
  deepStrictEqual(handle("ai").submit({ command_id: "ai-lock", verb: "lock", target: "exit door", body: aiBody(id, "terminal") }), { status: "ok" });
  deepStrictEqual(handle("dee").submit({ command_id: "dee-unlock", verb: "unlock", target: "exit door" }), { status: "ok" });
  const closed = director.closeRound();
  // The door starts locked: whichever move the round takes first decides it. A lock on a locked door is refused, so
  // the lock first leaves the door unlocked; the unlock first frees it, and the lock that follows then locks it.
  deepStrictEqual(closed.results.map((result) => result.command_id), ["ai-lock", "dee-unlock"]);
  deepStrictEqual(closed.results.map((result) => reason(result)), [["refused", "already_locked"], ["ok", undefined]]);
  strictEqual(world.entity(id("exit_door"))?.props.locked, false);
  // Both moves are in the log, each under the handle that sent it.
  const by = (command: string) => world.attempts(0).find((attempt) => attempt.command.command_id === command)?.by;
  deepStrictEqual(by("ai-lock"), { role: "player", handle: "ai" });
  deepStrictEqual(by("dee-unlock"), { role: "player", handle: "dee" });
});

test("row 3: every player idles; the director skips quiet rounds, which stop the round the alarm, played from the pool, reaches a subject", (t) => {
  const { world, id, director, handle } = play(t);
  for (const name of ALL) {
    strictEqual(handle(name).idle().status, "ok");
  }
  const alarm = world.snapshot().tick + 3;
  strictEqual(director.edit({ kind: "play_beat", id: "alarm", at_tick: alarm }, { command_id: "play-alarm" }).status, "ok");
  // Three quiet rounds: the third is the one the alarm falls due in, and a subject in the dormitory hears it.
  deepStrictEqual(director.closeRounds({ max: 20 }), { status: "ok", rounds: 3, stopped: "heard" });
  strictEqual(world.snapshot().tick, alarm);
  // A heard sound names no source to the listener, but tells which door it came through.
  deepStrictEqual(
    handle("ann").observe({ since_tick: alarm - 1 }).events.map((event) => [event.type, event.entity ?? null, event.heard_from ?? null]),
    [["sounded", null, aliasOf(id("ann"), id("dormitory_door"))]],
  );
  // With nothing due, the quiet rounds run to their bound.
  deepStrictEqual(director.closeRounds({ max: 2 }), { status: "ok", rounds: 2, stopped: "max" });
});

test("row 4: the director steers the exit door's odds to 50 within the range the scene gave, and the AI's remote commands jam at the sixth roll, not the ninth", (t) => {
  // The first jam among the AI's remote commands, in command order, with the door's odds as steered (or not).
  const firstJam = (dirName: string, steer?: number): number | null => {
    const { world, id, director, handle } = play(t, dirName);
    if (steer !== undefined) {
      strictEqual(director.edit({ kind: "steer", entity: id("exit_door"), prop: "jam_pct", value: steer }, { command_id: "steer" }).status, "ok");
    }
    for (let command = 0; command < 12; command += 1) {
      const before = world.snapshot().version;
      // Unlock and lock in turn, each a remote command from the door's controller: a roll is made when one passes.
      handle("ai").submit({ command_id: `ai-${command}`, verb: command % 2 === 0 ? "unlock" : "lock", target: "exit door", body: aiBody(id, "terminal") });
      director.closeRound();
      if (world.since(before).events.some((event) => event.type === "jammed")) {
        return command;
      }
    }
    return null;
  };
  strictEqual(firstJam("default"), 8);
  strictEqual(firstJam("steered", 50), 5);

  // The steer is in force, and a value outside the range is refused, below it and above it.
  const { world, id, director } = play(t, "range");
  deepStrictEqual(reason(director.edit({ kind: "steer", entity: id("exit_door"), prop: "jam_pct", value: 9 }, { command_id: "low" })), ["refused", "out_of_range"]);
  deepStrictEqual(reason(director.edit({ kind: "steer", entity: id("exit_door"), prop: "jam_pct", value: 51 }, { command_id: "high" })), ["refused", "out_of_range"]);
  strictEqual(director.edit({ kind: "steer", entity: id("exit_door"), prop: "jam_pct", value: 50 }, { command_id: "in" }).status, "ok");
  deepStrictEqual(world.snapshot().run?.steered, [{ entity: id("exit_door"), prop: "jam_pct", value: 50 }]);
});

test("row 5: the terminal and the arm each move in one round under the one AI handle, and its view names the key alike from both", (t) => {
  const { world, id, director, handle } = play(t);
  // The arm stands in the lab within reach of the key on the floor.
  strictEqual(world.edit({ kind: "place", target: id("arm"), support: id("lab"), pos: { x: -200, y: 0 } }).status, "ok");
  const ai = handle("ai");
  const keyName = aliasOf(id("terminal"), id("key"));
  // The arm's view of the key is the name the AI's terminal gives it, and the arm's take is written with that name.
  deepStrictEqual(ai.options({ body: aiBody(id, "arm") }).ready.filter((option) => option.verb === "take").map((option) => option.target), [keyName]);
  deepStrictEqual(ai.submit({ command_id: "term-unlock", verb: "unlock", target: "exit door", body: aiBody(id, "terminal") }), { status: "ok" });
  deepStrictEqual(ai.submit({ command_id: "arm-take", verb: "take", target: keyName, body: aiBody(id, "arm") }), { status: "ok" });
  deepStrictEqual(
    ai.pending().map((move) => [move.body, move.command_id]).sort(),
    [[aiBody(id, "arm"), "arm-take"], [aiBody(id, "terminal"), "term-unlock"]].sort(),
  );
  const closed = director.closeRound();
  deepStrictEqual(closed.results.map((result) => reason(result)), [["ok", undefined], ["ok", undefined]]);
  strictEqual(world.entity(id("key"))?.contained_in, id("arm"));
  // The key is one thing in the AI's view, whichever body names it.
  ok(ai.observe().entities.some((entity) => entity.id === keyName));
  ok(ai.inspect(keyName) !== null);
});

test("row 6: the run ends on its tick limit, refusing every later move, and verify replays it exactly", (t) => {
  const { dir, world, director, handle, id } = play(t);
  // Dee stands in the server room, lit by its lamp until the cut.
  strictEqual(world.edit({ kind: "place", target: id("dee"), support: id("server_room"), pos: { x: -300, y: 60 } }).status, "ok");
  for (const name of ALL) {
    strictEqual(handle(name).idle().status, "ok");
  }
  // Two of the pool's beats are played from it: the power cut at tick 50, and the deadline a scene queued at tick 40.
  strictEqual(director.edit({ kind: "play_beat", id: "power_cut", at_tick: 50 }, { command_id: "play-cut" }).status, "ok");
  deepStrictEqual(director.closeRounds({ max: 39 }), { status: "ok", rounds: 39, stopped: "max" });
  const deadline = (cause: { kind: string; id?: string }) => cause.kind === "beat" && cause.id === "deadline";
  ok(world.schedule({ kind: "beat" }).some((cause) => deadline(cause) && cause.due_tick === 40));
  deepStrictEqual(director.closeRounds({ max: 1 }), { status: "ok", rounds: 1, stopped: "max" });
  ok(!world.schedule({ kind: "beat" }).some(deadline), "the deadline has fallen due");
  strictEqual(world.since(0).events.some((event) => event.type === "beat_skipped" && JSON.stringify(event.data).includes("deadline")), false);
  // Past the cut the server room is dark: its lamp is out, and a subject there sees nothing of the generator.
  deepStrictEqual(director.closeRounds({ max: 11 }), { status: "ok", rounds: 11, stopped: "max" });
  deepStrictEqual(world.query({ kind: "perceive", observer: id("dee"), entity: id("generator"), sense: "sight" }), {
    value: "false",
    basis_code: "location_unlit",
  });
  // The AI, whose terminal runs on the generator, is refused unpowered with cut the generator for any move.
  deepStrictEqual(world.check({ command_id: "ai-dark", actor: id("terminal"), verb: "unlock", target: id("exit_door") }), {
    status: "refused",
    command_id: "ai-dark",
    resolved_target: null,
    reason_code: "unpowered",
    reason_data: { at: id("terminal"), cut: id("generator") },
  });
  // The quiet rounds run to the limit, and the round after it is refused: the run has ended.
  deepStrictEqual(director.closeRounds({ max: 100 }), { status: "refused", reason_code: "run_ended", rounds: 9 });
  deepStrictEqual(world.snapshot().run?.ended, { reason: "tick_limit", tick: 60 });
  strictEqual(world.snapshot().tick, 60);
  deepStrictEqual(handle("ann").submit({ command_id: "late", verb: "wait", args: { ticks: 1 } }), { status: "refused", reason_code: "run_not_running" });
  const late = director.closeRound();
  deepStrictEqual([late.status, late.reason_code], ["refused", "run_ended"]);
  // The stored run verifies on the world that ran it and on its reopening.
  strictEqual(world.verify().ok, true);
  strictEqual(openWorld(dir).verify().ok, true);
});
