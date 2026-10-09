import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  WORLD_AUTHOR,
  type Id,
  type Result,
  type WorldEdit,
  type World,
} from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { replay } from "../src/store/file-store.js";
import { fileURLToPath } from "node:url";
import { buildInitial, genStep, mulberry32, withProcessFixtures } from "./property-gen.js";

// A scheduled beat is the architect's intention kept in the snapshot: "at tick 5 someone knocks".
// When it falls due it becomes ordinary events, sensed (or not) like any others.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

interface Inn {
  dir: string;
  world: World;
  ann: Id;
  bob: Id;
  door: Id;
  note: Id;
  hall: Id;
}

// ann in the hall with a note and a door; bob in the yard on the other side; the door starts shut.
function inn(t: { after(callback: () => void): void }): Inn {
  const root = mkdtempSync(join(tmpdir(), "world-engine-beat-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "w");
  const world = createWorld(dir, [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    {
      id: "door",
      template: "door",
      overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } },
    },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
    { id: "note", template: "note", overrides: { name: "note", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
  ]);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, ann: id("ann"), bob: id("bob"), door: id("door"), note: id("note"), hall: id("hall") };
}

let seq = 0;
function edit(world: World, wanted: WorldEdit, perceivers = false): Result {
  seq += 1;
  return world.edit(wanted, { command_id: `beat-edit-${seq}`, ...(perceivers ? { perceivers: true } : {}) });
}
function advance(world: World, ticks: number): Result {
  seq += 1;
  return world.command({ command_id: `beat-adv-${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });
}
function heard(world: World, observer: Id, event: string, sense = "hearing"): string {
  return world.query({ kind: "perceive", observer, event_id: event, sense }).value;
}
function basis(world: World, observer: Id, event: string, sense: string): string | undefined {
  return world.query({ kind: "perceive", observer, event_id: event, sense }).basis_code;
}
const types = (result: Result): string[] => result.events.map((event) => event.type);

test("a knock is heard in the room, never seen, and next door only when loud", (t) => {
  const h = inn(t);
  strictEqual(edit(h.world, { kind: "schedule_beat", id: "knock", at_tick: 5, action: { kind: "sound", entity: h.door } }).status, "ok");
  strictEqual(
    edit(h.world, { kind: "schedule_beat", id: "bang", at_tick: 8, action: { kind: "sound", entity: h.door, loud: true } }).status,
    "ok",
  );
  const run = advance(h.world, 10);
  strictEqual(run.status, "ok");
  const sounds = run.events.filter((event) => event.type === "sounded");
  deepStrictEqual(sounds.map((event) => [event.tick, event.data]), [[5, { loud: false }], [8, { loud: true }]]);
  const [knock, bang] = sounds as [typeof sounds[number], typeof sounds[number]];
  // The door stands between the hall and the yard, which is "in" neither room's footprint.
  const world = h.world;
  strictEqual(heard(world, h.ann, knock.event_id), "true");
  strictEqual(heard(world, h.bob, knock.event_id), "false");
  strictEqual(heard(world, h.bob, bang.event_id), "true");
  strictEqual(basis(world, h.bob, bang.event_id, "hearing"), "adjacent_loud_event");
  for (const sound of sounds) {
    strictEqual(heard(world, h.ann, sound.event_id, "sight"), "false");
    strictEqual(basis(world, h.ann, sound.event_id, "sight"), "unseen");
    ok(heard(world, h.ann, sound.event_id, "smell") !== "true", "smell is not covered by default, and never true for a sound");
  }
});

test("a beat that changes a prop darkens the room, and an observer then cannot see the note", (t) => {
  const h = inn(t);
  strictEqual(h.world.query({ kind: "perceive", observer: h.ann, entity: h.note, sense: "sight" }).value, "true");
  strictEqual(
    edit(h.world, {
      kind: "schedule_beat",
      id: "lights",
      at_tick: 3,
      action: { kind: "set_props", target: h.hall, props: { lit: false } },
    }).status,
    "ok",
  );
  const run = advance(h.world, 5);
  strictEqual(run.status, "ok");
  const darkened = run.events.find((event) => event.type === "edited");
  ok(darkened !== undefined);
  strictEqual(darkened.tick, 3);
  const after = h.world.query({ kind: "perceive", observer: h.ann, entity: h.note, sense: "sight" });
  deepStrictEqual([after.value, after.basis_code], ["false", "location_unlit"]);
});

test("a condition is read at the due tick: false skips the beat and says so", (t) => {
  const h = inn(t);
  const only = { entity: h.hall, prop: "lit", op: "eq" as const, value: false };
  strictEqual(
    edit(h.world, { kind: "schedule_beat", id: "knock", at_tick: 2, action: { kind: "sound", entity: h.door }, only_if: only }).status,
    "ok",
  );
  const run = advance(h.world, 3);
  deepStrictEqual(types(run).filter((type) => type !== "advance"), ["beat_skipped"]);
  const skipped = run.events.find((event) => event.type === "beat_skipped")!;
  deepStrictEqual(skipped.data, { id: "knock", reason: "condition" });
  strictEqual(heard(h.world, h.ann, skipped.event_id), "false");
  strictEqual(basis(h.world, h.ann, skipped.event_id, "hearing"), "authored");
  // The beat is spent: nothing is left pending.
  strictEqual(h.world.snapshot().schedule, undefined);

  // The same beat with the condition true runs.
  const other = inn(t);
  strictEqual(edit(other.world, { kind: "set_props", target: other.hall, props: { lit: false } }).status, "ok");
  strictEqual(
    edit(other.world, { kind: "schedule_beat", id: "knock", at_tick: 2, action: { kind: "sound", entity: other.door }, only_if: only }).status,
    "ok",
  );
  ok(types(advance(other.world, 3)).includes("sounded"));
  // An ordering needs a number; a missing prop is false.
  strictEqual(
    edit(other.world, {
      kind: "schedule_beat",
      id: "ordered",
      at_tick: 9,
      action: { kind: "sound", entity: other.door },
      only_if: { entity: other.hall, prop: "lit", op: "gt", value: 1 },
    }).status,
    "ok",
  );
  deepStrictEqual(advance(other.world, 10).events.find((event) => event.type === "beat_skipped")?.data, {
    id: "ordered",
    reason: "condition",
  });
});

test("an action that is refused when it runs skips with its code and changes nothing", (t) => {
  const h = inn(t);
  // Placing the door on a shelf that is not there at the due tick: the target is removed first.
  strictEqual(
    edit(h.world, {
      kind: "schedule_beat",
      id: "move-note",
      at_tick: 4,
      action: { kind: "place", target: h.note, contained_in: h.ann },
    }).status,
    "ok",
  );
  const before = h.world.snapshot();
  const run = advance(h.world, 5);
  const skipped = run.events.find((event) => event.type === "beat_skipped");
  ok(skipped !== undefined, "a place into a body that is no container is refused");
  strictEqual(skipped.data.reason, "failed");
  strictEqual(typeof skipped.data.code, "string");
  deepStrictEqual(h.world.entity(h.note), before.entities[h.note]);
  deepStrictEqual(validateSnapshot(h.world.snapshot(), registry), []);
  strictEqual(h.world.snapshot().schedule, undefined);
});

test("followers run after their parent's delay, and a cancelled parent schedules none", (t) => {
  const h = inn(t);
  const chain = (id: string, at: number): WorldEdit => ({
    kind: "schedule_beat",
    id,
    at_tick: at,
    action: { kind: "sound", entity: h.door },
    then: [
      {
        id: `${id}-answer`,
        delay_ticks: 3,
        action: { kind: "sound", entity: h.door, loud: true },
        then: [{ id: `${id}-echo`, delay_ticks: 2, action: { kind: "set_props", target: h.hall, props: { lit: false } } }],
      },
    ],
  });
  strictEqual(edit(h.world, chain("a", 2)).status, "ok");
  strictEqual(edit(h.world, chain("b", 3)).status, "ok");
  strictEqual(edit(h.world, { kind: "cancel_beat", id: "b" }).status, "ok");
  // One long advance runs the whole chain: 2, then +3, then +2.
  const run = advance(h.world, 20);
  const sounds = run.events.filter((event) => event.type === "sounded");
  deepStrictEqual(sounds.map((event) => event.tick), [2, 5]);
  const echo = run.events.find((event) => event.type === "edited")!;
  strictEqual(echo.tick, 7);
  // Each follower names the event its parent wrote.
  strictEqual(sounds[1]!.cause_id, sounds[0]!.event_id);
  strictEqual(echo.cause_id, sounds[1]!.event_id);
  strictEqual(h.world.snapshot().schedule, undefined);
});

test("two beats due at one tick run in the order they were scheduled", (t) => {
  const h = inn(t);
  for (const [id, loud] of [["first", false], ["second", true]] as const) {
    strictEqual(edit(h.world, { kind: "schedule_beat", id, at_tick: 4, action: { kind: "sound", entity: h.door, loud } }).status, "ok");
  }
  const sounds = advance(h.world, 6).events.filter((event) => event.type === "sounded");
  deepStrictEqual(sounds.map((event) => event.data.loud), [false, true]);
});

test("a beat whose subject is removed goes with it and records nothing", (t) => {
  const h = inn(t);
  strictEqual(edit(h.world, { kind: "schedule_beat", id: "knock", at_tick: 4, action: { kind: "sound", entity: h.note } }).status, "ok");
  strictEqual(edit(h.world, { kind: "remove", target: h.note }).status, "ok");
  strictEqual(h.world.snapshot().schedule, undefined);
  deepStrictEqual(types(advance(h.world, 6)), ["advance"]);
});

test("the edits refuse what cannot be scheduled", (t) => {
  const h = inn(t);
  const sound = { kind: "sound" as const, entity: h.door };
  const codes = (wanted: WorldEdit): [string, string | undefined] => {
    const result = edit(h.world, wanted);
    return [result.status, result.reason_code];
  };
  deepStrictEqual(codes({ kind: "schedule_beat", id: "x", at_tick: 0, action: sound }), ["refused", "beat_in_past"]);
  deepStrictEqual(codes({ kind: "schedule_beat", id: "x", at_tick: 3, action: { kind: "sound", entity: "e999" } }), ["invalid", "no_such_entity"]);
  deepStrictEqual(codes({ kind: "schedule_beat", id: "bad id", at_tick: 3, action: sound }), ["invalid", "invalid_args"]);
  deepStrictEqual(codes({ kind: "schedule_beat", id: "x", at_tick: 3, action: { kind: "set_seed", seed: 1 } as never }), ["invalid", "invalid_args"]);
  deepStrictEqual(codes({ kind: "schedule_beat", id: "x", at_tick: 3, action: { kind: "spawn", template: "stone" } as never }), ["invalid", "invalid_args"]);
  deepStrictEqual(codes({ kind: "cancel_beat", id: "nothing" }), ["refused", "no_such_beat"]);
  strictEqual(codes({ kind: "schedule_beat", id: "x", at_tick: 3, action: sound })[0], "ok");
  deepStrictEqual(codes({ kind: "schedule_beat", id: "x", at_tick: 4, action: sound }), ["refused", "duplicate_beat"]);
  // A follower's id lives in the same namespace, and so does one repeated inside a single beat.
  deepStrictEqual(
    codes({ kind: "schedule_beat", id: "y", at_tick: 4, action: sound, then: [{ id: "x", delay_ticks: 1, action: sound }] }),
    ["refused", "duplicate_beat"],
  );
  deepStrictEqual(
    codes({ kind: "schedule_beat", id: "y", at_tick: 4, action: sound, then: [{ id: "y", delay_ticks: 1, action: sound }] }),
    ["refused", "duplicate_beat"],
  );
  // Four levels is the most; a fifth is malformed.
  const deep = (levels: number): WorldEdit["kind"] extends never ? never : unknown => {
    let then: unknown;
    for (let level = levels; level >= 2; level -= 1) {
      then = [{ id: `d${level}`, delay_ticks: 1, action: sound, ...(then === undefined ? {} : { then }) }];
    }
    return { kind: "schedule_beat", id: "d1", at_tick: 6, action: sound, ...(then === undefined ? {} : { then }) };
  };
  strictEqual(codes(deep(4) as WorldEdit)[0], "ok");
  const fifth = (deep(5) as { then: { id: string }[] });
  fifth.then[0]!.id = "e2";
  deepStrictEqual(codes({ ...(fifth as unknown as WorldEdit), id: "e1" } as WorldEdit), ["invalid", "invalid_args"]);
  // A beat is an author's act, and an agent cannot issue it.
  const refusedForAgent = h.world.command({
    command_id: "agent-edit",
    actor: h.ann,
    verb: "edit",
    args: { edit: { kind: "cancel_beat", id: "x" } },
  });
  deepStrictEqual([refusedForAgent.status, refusedForAgent.reason_code], ["invalid", "invalid_author"]);
});

test("the number of pending beats is bounded", (t) => {
  const h = inn(t);
  const sound = { kind: "sound" as const, entity: h.door };
  for (let index = 0; index < 256; index += 1) {
    strictEqual(edit(h.world, { kind: "schedule_beat", id: `b${index}`, at_tick: 100, action: sound }).status, "ok");
  }
  const over = edit(h.world, { kind: "schedule_beat", id: "one-more", at_tick: 100, action: sound });
  deepStrictEqual([over.status, over.reason_code], ["refused", "too_many_beats"]);
  // Followers count too, since they will be pending in turn.
  strictEqual(edit(h.world, { kind: "cancel_beat", id: "b0" }).status, "ok");
  const withFollowers = edit(h.world, {
    kind: "schedule_beat",
    id: "pair",
    at_tick: 100,
    action: sound,
    then: [{ id: "pair-2", delay_ticks: 1, action: sound }],
  });
  deepStrictEqual([withFollowers.status, withFollowers.reason_code], ["refused", "too_many_beats"]);
  deepStrictEqual(validateSnapshot(h.world.snapshot(), registry), []);
});

test("the snapshot validator holds a stored beat to its shape", (t) => {
  const h = inn(t);
  strictEqual(edit(h.world, { kind: "schedule_beat", id: "knock", at_tick: 5, action: { kind: "sound", entity: h.door } }).status, "ok");
  const base = h.world.snapshot();
  const [cause] = base.schedule!;
  ok(cause !== undefined && cause.kind === "beat");
  const codes = (schedule: NonNullable<typeof base.schedule>): string[] =>
    validateSnapshot({ ...base, schedule }, registry).map((issue) => issue.code);
  deepStrictEqual(codes([cause]), []);
  deepStrictEqual(codes([{ ...cause, id: "no good" }]), ["invalid_beat"]);
  deepStrictEqual(codes([{ ...cause, entity: h.note }]), ["invalid_beat"]);
  deepStrictEqual(codes([cause, { ...cause, due_tick: 9 }]), ["duplicate_beat"]);
});

test("replaying the log reproduces a world with beats, and perceivers name who heard a knock", (t) => {
  const h = inn(t);
  strictEqual(
    edit(h.world, {
      kind: "schedule_beat",
      id: "knock",
      at_tick: 3,
      action: { kind: "sound", entity: h.door, loud: true },
      then: [{ id: "dark", delay_ticks: 2, action: { kind: "set_props", target: h.hall, props: { lit: false } } }],
    }).status,
    "ok",
  );
  seq += 1;
  const run = h.world.command({
    command_id: `beat-adv-${seq}`,
    actor: WORLD_AUTHOR,
    verb: "advance",
    args: { ticks: 8 },
    perceivers: true,
  });
  const knock = run.events.find((event) => event.type === "sounded")!;
  deepStrictEqual(knock.perceivers?.hearing, [h.ann, h.bob]);
  deepStrictEqual(knock.perceivers?.sight, []);
  strictEqual(canonicalJson(replay(h.dir)), canonicalJson(h.world.snapshot()));
  // A fork carries what is pending and runs it just the same.
  const pending = inn(t);
  edit(pending.world, { kind: "schedule_beat", id: "knock", at_tick: 4, action: { kind: "sound", entity: pending.door } });
  const copy = pending.world.fork();
  ok(types(advance(copy, 5)).includes("sounded"));
  strictEqual(pending.world.snapshot().schedule?.length, 1);
});

test("a repeating beat comes round on its own and stops after its runs", (t) => {
  const h = inn(t);
  const sound = { kind: "sound" as const, entity: h.door };
  strictEqual(
    edit(h.world, { kind: "schedule_beat", id: "bell", at_tick: 10, action: sound, repeat: { every_ticks: 10, times: 2 } }).status,
    "ok",
  );
  // One id, one pending beat, however many runs are left.
  strictEqual(h.world.snapshot().schedule?.length, 1);
  const rung = advance(h.world, 60).events.filter((event) => event.type === "sounded");
  deepStrictEqual(rung.map((event) => event.tick), [10, 20, 30]);
  strictEqual(h.world.snapshot().schedule, undefined);
  // Each run names the event that scheduled the beat.
  deepStrictEqual(new Set(rung.map((event) => event.cause_id)).size, 1);
});

test("a skipped or refused run still schedules the next, and cancel withdraws the rest", (t) => {
  const h = inn(t);
  strictEqual(
    edit(h.world, {
      kind: "schedule_beat",
      id: "check",
      at_tick: 3,
      action: { kind: "sound", entity: h.door },
      only_if: { entity: h.hall, prop: "lit", op: "eq", value: false },
      repeat: { every_ticks: 2, times: 3 },
    }).status,
    "ok",
  );
  const skipped = advance(h.world, 4).events.filter((event) => event.type === "beat_skipped");
  deepStrictEqual(skipped.map((event) => event.tick), [3]);
  // The condition holds from here on: the second run, at 5, sounds.
  strictEqual(edit(h.world, { kind: "set_props", target: h.hall, props: { lit: false } }).status, "ok");
  const next = advance(h.world, 2);
  ok(types(next).includes("sounded"));
  strictEqual(h.world.snapshot().schedule?.length, 1);
  strictEqual(edit(h.world, { kind: "cancel_beat", id: "check" }).status, "ok");
  strictEqual(h.world.snapshot().schedule, undefined);
  deepStrictEqual(types(advance(h.world, 20)), ["advance"]);
});

test("a repeat that is out of range, or has followers, is invalid_args; a removed subject ends it", (t) => {
  const h = inn(t);
  const sound = { kind: "sound" as const, entity: h.note };
  const code = (repeat: unknown, then?: unknown): string | undefined =>
    edit(h.world, { kind: "schedule_beat", id: "r", at_tick: 3, action: sound, repeat, ...(then === undefined ? {} : { then }) } as never).reason_code;
  strictEqual(code({ every_ticks: 0, times: 2 }), "invalid_args");
  strictEqual(code({ every_ticks: 2, times: 0 }), "invalid_args");
  strictEqual(code({ every_ticks: 2, times: 1001 }), "invalid_args");
  strictEqual(code({ every_ticks: 2 }), "invalid_args");
  strictEqual(code({ every_ticks: 2, times: 2 }, [{ id: "f", delay_ticks: 1, action: sound }]), "invalid_args");
  strictEqual(code({ every_ticks: 2, times: 1000 }), undefined);
  strictEqual(edit(h.world, { kind: "remove", target: h.note }).status, "ok");
  strictEqual(h.world.snapshot().schedule, undefined);
});

test("a repeating beat whose action removes its own subject runs once more at most", (t) => {
  const h = inn(t);
  strictEqual(
    edit(h.world, {
      kind: "schedule_beat",
      id: "gone",
      at_tick: 2,
      action: { kind: "remove", target: h.note },
      repeat: { every_ticks: 2, times: 5 },
    }).status,
    "ok",
  );
  const run = advance(h.world, 20);
  deepStrictEqual(types(run).filter((type) => type !== "advance"), ["removed"]);
  strictEqual(h.world.snapshot().schedule, undefined);
  deepStrictEqual(validateSnapshot(h.world.snapshot(), registry), []);
});

test("a beat can ask who is where: a knock sounds only while the yard is occupied", (t) => {
  const h = inn(t);
  const yard = h.world.id("yard")!;
  const sound = { kind: "sound" as const, entity: h.door };
  const schedule = (id: string, at_tick: number, only_if: unknown, then?: unknown) =>
    edit(h.world, { kind: "schedule_beat", id, at_tick, action: sound, only_if, ...(then === undefined ? {} : { then }) } as WorldEdit);
  // bob is in the yard, so the knock sounds; ann is in the hall, so the echo that wants it empty is skipped.
  strictEqual(
    schedule("knock", 2, { room: yard, occupied: true }, [
      { id: "echo", delay_ticks: 1, action: sound, only_if: { room: h.hall, occupied: false } },
    ]).status,
    "ok",
  );
  const first = advance(h.world, 4);
  deepStrictEqual(types(first).filter((type) => type !== "advance"), ["sounded", "beat_skipped"]);
  deepStrictEqual(first.events.find((event) => event.type === "beat_skipped")?.data, { id: "echo", reason: "condition" });

  // Two beats are waiting when bob leaves the yard: the one that wanted it occupied is skipped, and
  // the one that wanted it empty sounds.
  strictEqual(schedule("while-there", 8, { room: yard, occupied: true }).status, "ok");
  strictEqual(schedule("once-gone", 8, { room: yard, occupied: false }).status, "ok");
  strictEqual(edit(h.world, { kind: "place", target: h.bob, support: h.hall, pos: { x: 200, y: 0 } }).status, "ok");
  strictEqual(h.world.entity(h.bob)?.location, h.hall);
  const second = advance(h.world, 6);
  deepStrictEqual(
    second.events.filter((event) => event.type === "sounded" || event.type === "beat_skipped").map((event) => [event.type, event.data.id]),
    [
      ["beat_skipped", "while-there"],
      ["sounded", undefined],
    ],
  );
  strictEqual(h.world.snapshot().schedule, undefined);
  strictEqual(canonicalJson(replay(h.dir)), canonicalJson(h.world.snapshot()));
});

test("a beat can ask where an entity is, and follows it to another room", (t) => {
  const h = inn(t);
  const yard = h.world.id("yard")!;
  const sound = { kind: "sound" as const, entity: h.door };
  const outcome = (result: Result, id: string): "ran" | "skipped" =>
    result.events.some((event) => event.type === "beat_skipped" && event.data.id === id) ? "skipped" : "ran";
  const ask = (id: string, only_if: unknown, at_tick: number) =>
    strictEqual(edit(h.world, { kind: "schedule_beat", id, at_tick, action: sound, only_if } as WorldEdit).status, "ok");
  ask("note-in-hall", { entity: h.note, in: h.hall }, 2);
  ask("note-in-yard", { entity: h.note, in: yard }, 2);
  const before = advance(h.world, 3);
  deepStrictEqual([outcome(before, "note-in-hall"), outcome(before, "note-in-yard")], ["ran", "skipped"]);

  // ann picks the note up and is set down in the yard: what she carries is where she is.
  strictEqual(h.world.command({ command_id: "take-note", actor: h.ann, verb: "take", target: "note" }).status, "ok");
  strictEqual(edit(h.world, { kind: "place", target: h.ann, support: yard, pos: { x: 100, y: 0 } }).status, "ok");
  strictEqual(h.world.entity(h.note)?.location, yard);
  ask("carried-in-hall", { entity: h.note, in: h.hall }, 8);
  ask("carried-in-yard", { entity: h.note, in: yard }, 8);
  const after = advance(h.world, 6);
  deepStrictEqual([outcome(after, "carried-in-hall"), outcome(after, "carried-in-yard")], ["skipped", "ran"]);
});

test("a missing entity or room is false, and a destroyed body does not occupy a room", (t) => {
  const h = inn(t);
  const sound = { kind: "sound" as const, entity: h.door };
  const forms: Array<[string, unknown]> = [
    ["no-entity", { entity: "e999", in: h.hall }],
    ["no-room", { entity: h.note, in: "e999" }],
    ["no-room-occupied", { room: "e999", occupied: true }],
    ["no-room-empty", { room: "e999", occupied: false }],
  ];
  for (const [id, only_if] of forms) {
    strictEqual(edit(h.world, { kind: "schedule_beat", id, at_tick: 2, action: sound, only_if } as WorldEdit).status, "ok");
  }
  const run = advance(h.world, 3);
  deepStrictEqual(
    run.events.filter((event) => event.type === "beat_skipped").map((event) => [event.data.id, event.data.reason]),
    forms.map(([id]) => [id, "condition"]),
  );
  strictEqual(types(run).includes("sounded"), false);

  // The same hall with ann's body destroyed holds no one: only "empty" is true of it.
  const snapshot = h.world.snapshot();
  const fallen = memoryWorld(
    { ...snapshot, entities: { ...snapshot.entities, [h.ann]: { ...snapshot.entities[h.ann]!, integrity: 0, status: "destroyed" } } },
    registry,
  );
  const room = (id: string, occupied: boolean) =>
    fallen.edit({ kind: "schedule_beat", id, at_tick: snapshot.tick + 2, action: sound, only_if: { room: h.hall, occupied } });
  strictEqual(room("hall-occupied", true).status, "ok");
  strictEqual(room("hall-empty", false).status, "ok");
  const result = fallen.command({ command_id: "wait-on", actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 3 } });
  deepStrictEqual(
    result.events.filter((event) => event.type === "sounded" || event.type === "beat_skipped").map((event) => [event.type, event.data.id]),
    [
      ["beat_skipped", "hall-occupied"],
      ["sounded", undefined],
    ],
  );
});

test("a condition of two forms, or of none, is malformed; the validator holds a stored one to the same shapes", (t) => {
  const h = inn(t);
  const sound = { kind: "sound" as const, entity: h.door };
  const code = (only_if: unknown, where: "beat" | "follower" = "beat"): [string, string | undefined] => {
    const wanted =
      where === "beat"
        ? { kind: "schedule_beat", id: "x", at_tick: 3, action: sound, only_if }
        : { kind: "schedule_beat", id: "x", at_tick: 3, action: sound, then: [{ id: "y", delay_ticks: 1, action: sound, only_if }] };
    const result = edit(h.world, wanted as WorldEdit);
    if (result.status === "ok") {
      strictEqual(edit(h.world, { kind: "cancel_beat", id: "x" }).status, "ok");
    }
    return [result.status, result.reason_code];
  };
  const bad: unknown[] = [
    {},
    { entity: h.note },
    { entity: h.note, in: h.hall, prop: "lit", op: "eq", value: true },
    { entity: h.note, in: h.hall, occupied: true },
    { entity: h.note, in: "" },
    { entity: h.note, in: 7 },
    { in: h.hall },
    { entity: h.note, in: h.hall, extra: 1 },
    { room: h.hall },
    { occupied: true },
    { room: h.hall, occupied: "yes" },
    { room: "", occupied: true },
    { room: h.hall, occupied: true, entity: h.note },
    { room: h.hall, occupied: true, prop: "lit" },
  ];
  for (const only_if of bad) {
    deepStrictEqual(code(only_if), ["invalid", "invalid_args"], JSON.stringify(only_if));
    deepStrictEqual(code(only_if, "follower"), ["invalid", "invalid_args"], JSON.stringify(only_if));
  }
  deepStrictEqual(code({ entity: h.note, in: h.hall }), ["ok", undefined]);
  deepStrictEqual(code({ room: h.hall, occupied: false }, "follower"), ["ok", undefined]);

  strictEqual(edit(h.world, { kind: "schedule_beat", id: "knock", at_tick: 5, action: sound }).status, "ok");
  const base = h.world.snapshot();
  const [cause] = base.schedule!;
  ok(cause !== undefined && cause.kind === "beat");
  const codes = (only_if: unknown): string[] =>
    validateSnapshot({ ...base, schedule: [{ ...cause, only_if } as typeof cause] }, registry).map((issue) => issue.code);
  deepStrictEqual(codes({ entity: h.note, in: h.hall }), []);
  deepStrictEqual(codes({ room: h.hall, occupied: true }), []);
  deepStrictEqual(codes({ room: h.hall }), ["invalid_beat"]);
  deepStrictEqual(codes({ entity: h.note, in: h.hall, occupied: true }), ["invalid_beat"]);
});

// The truth of a presence condition, asked of the states the generator reaches: every entity against
// every room, and every room occupied and empty, each as a beat due next tick that sounds or is skipped.
test("property: a presence condition holds exactly when the snapshot says so, over random worlds", () => {
  const fixtures = withProcessFixtures(registry);
  const seen: Record<"in" | "occupied", [number, number]> = { in: [0, 0], occupied: [0, 0] };
  let worlds = 0;
  for (let seed = 0; seed < 60; seed += 1) {
    const rand = mulberry32(seed + 9500);
    const world = memoryWorld(buildInitial(fixtures), fixtures);
    for (let i = 0; i < 25; i += 1) {
      const step = genStep(rand, world.snapshot(), `pc-${seed}-${i}`);
      if ("verb" in step) {
        world.command(step);
      } else {
        world.edit(step);
      }
    }
    const snapshot = world.snapshot();
    // Anything already due next tick could change the world before these are read.
    if (snapshot.schedule?.some((cause) => cause.due_tick <= snapshot.tick + 1)) {
      continue;
    }
    const everything = Object.values(snapshot.entities);
    const rooms = everything.filter((entity) => entity.template === "room").map((entity) => entity.id);
    if (rooms.length === 0) {
      continue;
    }
    // A world holds at most 256 beats, those already pending counted.
    const entities = everything.slice(0, Math.max(1, Math.floor((250 - (snapshot.schedule?.length ?? 0)) / rooms.length) - 2));
    worlds += 1;
    const sound = { kind: "sound" as const, entity: rooms[0]! };
    const wanted: Array<{ id: string; form: "in" | "occupied"; only_if: Record<string, unknown>; expected: boolean }> = [];
    for (const room of rooms) {
      for (const entity of entities) {
        wanted.push({ id: `in-${room}-${entity.id}`, form: "in", only_if: { entity: entity.id, in: room }, expected: entity.location === room });
      }
      const standing = everything.some(
        (entity) => entity.location === room && entity.props.agent === true && entity.detached_from === null && entity.status !== "destroyed",
      );
      for (const occupied of [true, false]) {
        wanted.push({ id: `room-${room}-${occupied}`, form: "occupied", only_if: { room, occupied }, expected: standing === occupied });
      }
    }
    for (const { id, only_if } of wanted) {
      const scheduled = world.edit({ kind: "schedule_beat", id, at_tick: snapshot.tick + 1, action: sound, only_if } as unknown as WorldEdit);
      strictEqual(scheduled.status, "ok", id);
    }
    const run = world.command({ command_id: `pc-adv-${seed}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 1 } });
    strictEqual(run.status, "ok");
    const skipped = new Set(
      run.events.filter((event) => event.type === "beat_skipped").map((event) => `${String(event.data.id)}:${String(event.data.reason)}`),
    );
    strictEqual(run.events.filter((event) => event.type === "beat_skipped").length, skipped.size);
    for (const { id, form, only_if, expected } of wanted) {
      strictEqual(skipped.has(`${id}:condition`), !expected, `seed ${seed} ${JSON.stringify(only_if)}`);
      seen[form][expected ? 0 : 1] += 1;
    }
    strictEqual(run.events.filter((event) => event.type === "sounded").length, wanted.filter((one) => one.expected).length);
    strictEqual(world.snapshot().schedule?.some((cause) => cause.kind === "beat") ?? false, false);
  }
  ok(worlds >= 20, `worlds ${worlds}`);
  ok(seen.in[0] >= 40 && seen.in[1] >= 200, `in ${seen.in}`);
  ok(seen.occupied[0] >= 40 && seen.occupied[1] >= 40, `occupied ${seen.occupied}`);
});
