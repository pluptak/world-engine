import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
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
      overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { openable: true, open: false, from: "hall", to: "yard" } },
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
