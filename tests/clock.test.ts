import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, memoryWorld, verbs } from "../src/index.js";
import { readEvents } from "../src/store/file-store.js";
import { canonicalJson } from "../src/engine/canonical.js";
import { capacity } from "../src/engine/capacity.js";
import { apply } from "../src/engine/pipeline.js";
import { spawn } from "../src/engine/spawn.js";
import type { Command } from "../src/engine/command.js";
import { defaultCoverage, type Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash } from "../src/templates.js";

// Every ok command takes the time its verb declares, and the clock advances after the verb has
// resolved: what falls due in that time happens at the end of the command, caused by whatever
// scheduled it. Nothing else moves the clock; a refusal takes no time.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function duel(): { snapshot: Snapshot; room: string; attacker: string; guard: string; crate: string } {
  const base: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(base, registry, "room", { name: "room", props: { lit: true } });
  const at = { location: room.id, support: room.id };
  const attacker = spawn(room.snapshot, registry, "human", { name: "attacker", ...at, pos: { x: 0, y: 0 } });
  const guard = spawn(attacker.snapshot, registry, "human", { name: "guard", ...at, pos: { x: 50, y: 0 } });
  const crate = spawn(guard.snapshot, registry, "stone", {
    name: "crate",
    ...at,
    pos: { x: 50, y: 60 },
    props: { hands_required: 2 },
  });
  return { snapshot: crate.snapshot, room: room.id, attacker: attacker.id, guard: guard.id, crate: crate.id };
}

let seq = 0;
function run(snapshot: Snapshot, command: Omit<Command, "command_id">) {
  seq += 1;
  return apply(snapshot, registry, { command_id: `c${seq}`, ...command });
}

test("each verb declares its duration: one tick, wait and advance their argument, an edit none", () => {
  const durations = Object.fromEntries(verbs().map((entry) => [entry.verb, entry.duration]));
  for (const [verb, duration] of Object.entries(durations)) {
    const expected = verb === "wait" || verb === "advance" ? { arg: "ticks" } : verb === "edit" ? { ticks: 0 } : { ticks: 1 };
    deepStrictEqual(duration, expected, verb);
  }

  const { snapshot, attacker, guard } = duel();
  strictEqual(run(snapshot, { actor: attacker, verb: "move", args: { to: { x: -100, y: 0 } } }).snapshot.tick, 1);
  strictEqual(run(snapshot, { actor: attacker, verb: "wait", args: { ticks: 5 } }).snapshot.tick, 5);
  const edited = run(snapshot, {
    actor: "world",
    verb: "edit",
    target: guard,
    // An edit writes state; the prop is incidental, what matters is that no time passes.
    args: { edit: { kind: "update_props", target: guard, props: { hunger: 10 } } },
  });
  strictEqual(edited.status, "ok");
  strictEqual(edited.snapshot.tick, 0);
});

test("a command that does not happen takes no time", () => {
  const { snapshot, attacker } = duel();
  const before = canonicalJson(snapshot);
  for (const command of [
    { actor: attacker, verb: "open", target: "crate" },
    { actor: attacker, verb: "move", args: { to: { x: 900, y: 0 } } },
    { actor: attacker, verb: "wait", args: { ticks: 0 } },
    { actor: attacker, verb: "fly" },
    { actor: attacker, verb: "take", target: "nothing" },
  ]) {
    const result = run(snapshot, command);
    ok(result.status !== "ok", command.verb);
    strictEqual(canonicalJson(result.snapshot), before, command.verb);
  }
});

test("a stun wears off during whatever command spans its expiry, after that command's own events", () => {
  const { snapshot, attacker, guard } = duel();
  const hit = run(snapshot, { actor: attacker, verb: "attack", target: `${guard}.hand_r` });
  const damaged = hit.events.find((event) => event.type === "damaged");
  ok(damaged);
  deepStrictEqual(hit.snapshot.entities[guard]?.modifiers.map((modifier) => modifier.expires_at_tick), [3]);
  strictEqual(hit.snapshot.tick, 1);

  const stepped = run(hit.snapshot, { actor: attacker, verb: "move", args: { to: { x: -50, y: 0 } } });
  strictEqual(stepped.snapshot.tick, 2);
  // At tick 2 the guard still has 80 of the 100 the crate needs; the refusal takes no time.
  const early = run(stepped.snapshot, { actor: guard, verb: "take", target: "crate" });
  deepStrictEqual(early.reason_data, { capacity: "manipulation", have: 80, need: 100 });
  strictEqual(early.snapshot.tick, 2);

  // The attacker's next step spans tick 3: the stun ends there, without anyone waiting, and its
  // event names the blow that caused it, not the step.
  const next = run(stepped.snapshot, { actor: attacker, verb: "move", args: { to: { x: -100, y: 0 } } });
  deepStrictEqual(next.events.map((event) => event.type), ["move", "moved", "capability_changed"]);
  const recovered = next.events[2]!;
  strictEqual(recovered.cause_id, damaged.event_id);
  deepStrictEqual(recovered.data, { capacity: "manipulation", from: 80, to: 100 });
  strictEqual(next.snapshot.tick, 3);
  strictEqual(capacity(next.snapshot, registry, guard, "manipulation"), 100);
  strictEqual(run(next.snapshot, { actor: guard, verb: "take", target: "crate" }).status, "ok");
});

test("tracing the modifiers a stun left behind leads to the blow, not to the step it ended during", () => {
  const { snapshot, attacker, guard } = duel();
  const world = memoryWorld(snapshot, registry);
  strictEqual(world.command({ command_id: "hit", actor: attacker, verb: "attack", target: `${guard}.hand_r` }).status, "ok");
  strictEqual(world.command({ command_id: "s1", actor: attacker, verb: "move", args: { to: { x: -50, y: 0 } } }).status, "ok");
  strictEqual(world.command({ command_id: "s2", actor: attacker, verb: "move", args: { to: { x: -100, y: 0 } } }).status, "ok");
  deepStrictEqual(world.entity(guard)?.modifiers, []);
  const chain = world.trace({ entity: guard, field: "modifiers" }).events;
  deepStrictEqual(chain.map((event) => [event.command_id, event.type]), [
    ["hit", "attack"],
    ["hit", "damaged"],
    ["s2", "capability_changed"],
  ]);
});

test("every event carries its tick: the command's start, or the tick something fell due", () => {
  const { snapshot, attacker, guard } = duel();
  const world = memoryWorld({ ...snapshot, coverage: defaultCoverage() }, registry);
  const hit = world.command({ command_id: "hit", actor: attacker, verb: "attack", target: `${guard}.hand_r` });
  deepStrictEqual(hit.events.map((event) => [event.type, event.tick]), [
    ["attack", 0],
    ["damaged", 0],
    ["capability_changed", 0],
  ]);
  // A five-tick wait from tick 1: the stun ends inside it, at 3, and the wait ends at 6.
  const waited = world.command({ command_id: "rest", actor: attacker, verb: "wait", args: { ticks: 5 } }, { observe: true });
  deepStrictEqual(waited.events.map((event) => [event.type, event.tick]), [
    ["wait", 1],
    ["capability_changed", 3],
  ]);
  strictEqual(waited.snapshot.tick, 6);
  deepStrictEqual(waited.observation?.events.map((event) => [event.type, event.tick]), [
    ["wait", 1],
    ["capability_changed", 3],
  ]);
  deepStrictEqual(world.since(0).events.map((event) => event.tick), [0, 0, 0, 1, 3]);
});

test("a stored event without its tick is refused on reading", (t) => {
  const base = mkdtempSync(join(tmpdir(), "world-engine-clock-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "w");
  const world = createWorld(dir, [
    { id: "room", template: "room", overrides: { name: "room" } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: 0, y: 0 } } },
  ]);
  strictEqual(world.command({ command_id: "w", actor: world.id("ann")!, verb: "wait", args: { ticks: 2 } }).status, "ok");
  const path = join(dir, "events.jsonl");
  deepStrictEqual(readEvents(dir).map((event) => event.tick), [0]);
  const stripped = readFileSync(path, "utf8").replace(/"tick":0,/, "");
  writeFileSync(path, stripped, "utf8");
  throws(() => readEvents(dir), /Invalid event entry at line 1/);
});

test("a beat is an ordered batch: its commands take their time in turn", () => {
  const { snapshot, attacker, guard } = duel();
  const world = memoryWorld(snapshot, registry);
  const results = world.beat([
    { command_id: "b1", actor: attacker, verb: "move", args: { to: { x: -50, y: 0 } } },
    { command_id: "b2", actor: guard, verb: "take", target: "crate" },
    { command_id: "b3", actor: guard, verb: "move", args: { to: { x: 900, y: 0 } } },
    { command_id: "b4", actor: attacker, verb: "wait", args: { ticks: 2 } },
  ]);
  deepStrictEqual(results.map((result) => [result.status, result.snapshot.tick]), [
    ["ok", 1],
    ["ok", 2],
    ["refused", 2],
    ["ok", 4],
  ]);
  strictEqual(world.snapshot().tick, 4);
});

test("a clock at its limit refuses what would take time, and still takes edits", () => {
  const { snapshot, attacker } = duel();
  const late: Snapshot = { ...snapshot, tick: Number.MAX_SAFE_INTEGER };
  const moved = run(late, { actor: attacker, verb: "move", args: { to: { x: -50, y: 0 } } });
  deepStrictEqual([moved.status, moved.reason_code], ["invalid", "clock_overflow"]);
  strictEqual(run(late, { actor: attacker, verb: "wait", args: { ticks: 1 } }).reason_code, "clock_overflow");
  const edited = run(late, {
    actor: "world",
    verb: "edit",
    target: attacker,
    args: { edit: { kind: "update_props", target: attacker, props: { hunger: 10 } } },
  });
  strictEqual(edited.status, "ok");
});
