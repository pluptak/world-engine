import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, WORLD_AUTHOR, type Id, type Result, type WorldEdit, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A pending beat is brought forward or put back (`docs/beats.md`): `retime_beat` moves its tick and nothing
// else about it. A knock on the door is sensed in the hall and not the yard, so the tick it sounds at is
// what the tests read.
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function inn(t: { after(callback: () => void): void }): { world: World; door: Id; ann: Id; bob: Id } {
  const world = createWorld(join(tempDir(t), "w"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    {
      id: "door",
      template: "door",
      overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } },
    },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
  ], registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, door: id("door"), ann: id("ann"), bob: id("bob") };
}

let seq = 0;
function edit(world: World, wanted: WorldEdit): Result {
  seq += 1;
  return world.edit(wanted, { command_id: `retime-edit-${seq}` });
}
function advance(world: World, ticks: number): Result {
  seq += 1;
  return world.command({ command_id: `retime-adv-${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });
}
// The ticks at which the door sounded in the advance, and the ids of the beats still pending.
const soundedAt = (result: Result): number[] => result.events.filter((event) => event.type === "sounded").map((event) => event.tick);
const beatIds = (world: World): string[] =>
  world.schedule({ kind: "beat" }).flatMap((cause) => (cause.kind === "beat" ? [cause.id] : []));

test("a knock brought forward sounds at the new tick and not at the old; put back, it sounds later", (t) => {
  const forward = inn(t);
  const knock = { kind: "schedule_beat", id: "knock", at_tick: 5, action: { kind: "sound", entity: forward.door } } as const;
  strictEqual(edit(forward.world, knock).status, "ok");
  strictEqual(edit(forward.world, { kind: "retime_beat", id: "knock", at_tick: 3 }).status, "ok");
  deepStrictEqual(soundedAt(advance(forward.world, 10)), [3]);

  const back = inn(t);
  strictEqual(edit(back.world, knock).status, "ok");
  strictEqual(edit(back.world, { kind: "retime_beat", id: "knock", at_tick: 8 }).status, "ok");
  deepStrictEqual(soundedAt(advance(back.world, 10)), [8]);
});

test("a repeating beat retimed keeps its count and its spacing from its new first run", (t) => {
  const { world, door } = inn(t);
  strictEqual(
    edit(world, { kind: "schedule_beat", id: "knock", at_tick: 3, action: { kind: "sound", entity: door }, repeat: { every_ticks: 2, times: 2 } }).status,
    "ok",
  );
  strictEqual(edit(world, { kind: "retime_beat", id: "knock", at_tick: 6 }).status, "ok");
  // The first run at 6, then two more, two ticks apart: three knocks in all, and none at the old tick.
  deepStrictEqual(soundedAt(advance(world, 12)), [6, 8, 10]);
  deepStrictEqual(beatIds(world), []);
});

test("a chain's followers fall due from when the parent runs, and a follower is not pending to retime", (t) => {
  const { world, door } = inn(t);
  const sound = { kind: "sound", entity: door } as const;
  strictEqual(
    edit(world, { kind: "schedule_beat", id: "parent", at_tick: 4, action: sound, then: [{ id: "echo", delay_ticks: 2, action: sound }] }).status,
    "ok",
  );
  deepStrictEqual(beatIds(world), ["parent"]);
  strictEqual(edit(world, { kind: "retime_beat", id: "echo", at_tick: 3 }).reason_code, "no_such_beat");
  strictEqual(edit(world, { kind: "retime_beat", id: "parent", at_tick: 6 }).status, "ok");
  // The echo is still scheduled by the parent's run, so it comes two ticks after that run at 6.
  deepStrictEqual(soundedAt(advance(world, 10)), [6, 8]);
});

test("two beats due at one tick keep the order rule: a beat brought forward to a tick runs after what is due then", (t) => {
  const { world, door } = inn(t);
  const sound = { kind: "sound", entity: door } as const;
  strictEqual(edit(world, { kind: "schedule_beat", id: "first", at_tick: 9, action: sound }).status, "ok");
  strictEqual(edit(world, { kind: "schedule_beat", id: "second", at_tick: 4, action: sound }).status, "ok");
  strictEqual(edit(world, { kind: "retime_beat", id: "second", at_tick: 9 }).status, "ok");
  deepStrictEqual(world.schedule({ kind: "beat" }).map((cause) => [cause.due_tick, cause.kind === "beat" ? cause.id : ""]), [
    [9, "first"],
    [9, "second"],
  ]);
  ok(validateSnapshot(world.snapshot(), registry).length === 0);
});

test("an id nothing pending carries, and a tick not ahead of the clock, are each refused and change nothing", (t) => {
  const { world, door } = inn(t);
  strictEqual(edit(world, { kind: "schedule_beat", id: "knock", at_tick: 5, action: { kind: "sound", entity: door } }).status, "ok");
  const before = world.snapshot();
  const version = before.version;
  const unknown = edit(world, { kind: "retime_beat", id: "nothing", at_tick: 3 });
  deepStrictEqual([unknown.status, unknown.reason_code], ["refused", "no_such_beat"]);
  strictEqual(advance(world, 2).status, "ok");
  // The clock is at 2 now; a beat at 2 is not ahead of it, and one already run is no longer pending.
  const past = edit(world, { kind: "retime_beat", id: "knock", at_tick: 2 });
  deepStrictEqual([past.status, past.reason_code], ["refused", "beat_in_past"]);
  strictEqual(world.snapshot().version, version + 1);
  deepStrictEqual(world.schedule({ kind: "beat" }).map((cause) => cause.due_tick), [5]);
});

test("a refused retime writes nothing: the version and the schedule stay as they were", (t) => {
  const { world, door } = inn(t);
  strictEqual(edit(world, { kind: "schedule_beat", id: "knock", at_tick: 5, action: { kind: "sound", entity: door } }).status, "ok");
  const before = world.snapshot();
  strictEqual(edit(world, { kind: "retime_beat", id: "nothing", at_tick: 3 }).status, "refused");
  deepStrictEqual(world.snapshot(), before);
});

test("a retime is recorded by its own edit, which nobody senses", (t) => {
  const { world, door, ann } = inn(t);
  strictEqual(edit(world, { kind: "schedule_beat", id: "knock", at_tick: 5, action: { kind: "sound", entity: door } }).status, "ok");
  const version = world.snapshot().version;
  const retimed = edit(world, { kind: "retime_beat", id: "knock", at_tick: 3 });
  strictEqual(retimed.status, "ok");
  deepStrictEqual(retimed.events.map((event) => event.type), ["edit"]);
  deepStrictEqual(world.attempts(version).map((attempt) => attempt.status), ["ok"]);
  const since = world.since(version);
  strictEqual(since.deltas.length, 0);
  strictEqual(since.events.length, 1);
  strictEqual(world.query({ kind: "perceive", observer: ann, sense: "hearing", event_id: since.events[0]!.event_id }).value, "false");
});
