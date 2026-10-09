import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, openWorld, type Id, type Result, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import type { ScheduledCause, Snapshot } from "../src/model.js";
import { CAUSE_KINDS } from "../src/engine/schedule.js";
import { SnapshotSchema } from "../src/contract.js";
import { loadTemplates } from "../src/templates.js";
import { presetRegistry } from "./presets.js";

// The self-closing door is the spec for scheduled causes. A door with `closes_after: 2` swings shut
// two ticks after it is opened, by itself, during whatever command spans that tick; the `closed`
// names the `opened` that set it going. Shutting it by hand withdraws the close, opening it again
// starts the count over, and a close the world has overtaken does nothing.

const registry = presetRegistry(loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))));

interface Hall {
  dir: string;
  world: World;
  ann: Id;
  bob: Id;
  door: Id;
  yard: Id;
}

function hall(t: { after(callback: () => void): void }): Hall {
  const base = mkdtempSync(join(tmpdir(), "world-engine-schedule-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "hall");
  const world = createWorld(dir, [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    {
      id: "door",
      template: "self_closing_door",
      overrides: { name: "door", props: { open: false, from: "hall", to: "yard" } },
    },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 100, y: 0 } } },
  ], registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, ann: id("ann"), bob: id("bob"), door: id("door"), yard: id("yard") };
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

const kinds = (result: Result) => result.events.map((event) => [event.type, event.tick]);

test("an opened door shuts itself two ticks later, and the close names the opening", (t) => {
  const { world, ann, bob, door, yard } = hall(t);
  const opened = run(world, ann, "open", "door");
  const openedEvent = opened.events.find((event) => event.type === "opened");
  ok(openedEvent);
  deepStrictEqual(world.snapshot().schedule, [
    { due_tick: 2, kind: "close", entity: door, cause_id: openedEvent.event_id },
  ]);

  // Ann steps through at tick 1, while it stands open; the door swings shut behind her at 2.
  const through = run(world, ann, "move", undefined, { location: yard });
  deepStrictEqual(kinds(through), [
    ["move", 1],
    ["moved", 1],
    ["closed", 2],
  ]);
  strictEqual(through.events[2]?.cause_id, openedEvent.event_id);
  strictEqual(world.entity(door)?.props.open, false);
  strictEqual(world.snapshot().schedule, undefined);
  strictEqual(world.entity(ann)?.location, yard);
  // Bob, a tick behind, finds it shut.
  strictEqual(run(world, bob, "move", undefined, { location: yard }).reason_code, "no_open_door");

  const chain = world.trace({ entity: door, field: "props" }).events;
  deepStrictEqual(chain.map((event) => event.type), ["open", "opened", "closed"]);
});

test("shut by hand, nothing is left to come; opened again while open it is refused, and the count stands", (t) => {
  const { world, ann, door } = hall(t);
  run(world, ann, "open", "door");
  deepStrictEqual(kinds(run(world, ann, "close", "door")), [
    ["close", 1],
    ["closed", 1],
  ]);
  strictEqual(world.snapshot().schedule, undefined);

  strictEqual(run(world, ann, "open", "door").snapshot.tick, 3);
  deepStrictEqual(world.snapshot().schedule?.map((cause) => cause.due_tick), [4]);
  // Opened again while open, at tick 3: refused, so the close stays due at 4 and no tick passes.
  const again = run(world, ann, "open", "door");
  strictEqual(again.reason_code, "already_open");
  strictEqual(again.snapshot.tick, 3);
  deepStrictEqual(world.snapshot().schedule?.map((cause) => cause.due_tick), [4]);
  strictEqual(world.entity(door)?.props.open, true);
  deepStrictEqual(kinds(run(world, ann, "wait", undefined, { ticks: 1 })), [
    ["wait", 3],
    ["closed", 4],
  ]);
});

test("a close the world has overtaken does nothing, and a removed door takes its close with it", (t) => {
  const { world, ann, door } = hall(t);
  run(world, ann, "open", "door");
  // The author shuts it outright: the close stays pending, finds the door shut, and says nothing.
  const props = { ...world.entity(door)!.props, open: false } as Record<string, string | number | boolean>;
  strictEqual(world.edit({ kind: "set_props", target: door, props }).status, "ok");
  deepStrictEqual(kinds(run(world, ann, "wait", undefined, { ticks: 3 })), [["wait", 1]]);
  strictEqual(world.snapshot().schedule, undefined);

  run(world, ann, "open", "door");
  ok(world.snapshot().schedule !== undefined);
  strictEqual(world.edit({ kind: "remove", target: door }).status, "ok");
  strictEqual(world.snapshot().schedule, undefined);
});

test("what is pending is saved with the world and runs after reopening", (t) => {
  const { dir, world, ann, door } = hall(t);
  run(world, ann, "open", "door");
  const pending = world.snapshot().schedule;
  ok(pending !== undefined);

  const reopened = openWorld(dir);
  deepStrictEqual(reopened.snapshot().schedule, pending);
  deepStrictEqual(kinds(run(reopened, ann, "wait", undefined, { ticks: 1 })), [
    ["wait", 1],
    ["closed", 2],
  ]);
  strictEqual(reopened.entity(door)?.props.open, false);
});

test("the schedule is stored one way: ahead of the clock, in due order, on entities that exist", (t) => {
  const { world, door } = hall(t);
  const base = world.snapshot();
  const cause = { due_tick: 5, kind: "close" as const, entity: door, cause_id: "ev1" };
  const codes = (schedule: Snapshot["schedule"]) =>
    validateSnapshot({ ...base, schedule }, registry).map((issue) => issue.code);
  deepStrictEqual(codes([cause]), []);
  deepStrictEqual(codes([]), ["empty_schedule"]);
  deepStrictEqual(codes([{ ...cause, due_tick: base.tick }]), ["schedule_not_ahead"]);
  deepStrictEqual(codes([cause, { ...cause, due_tick: 3 }]), ["schedule_unordered"]);
  deepStrictEqual(codes([{ ...cause, entity: "e999" }]), ["schedule_dangling"]);
  deepStrictEqual(codes([{ ...cause, kind: "explode" as "close" }]), ["unknown_cause_kind"]);
});

// The table in `src/engine/schedule.ts` is the one place a cause kind lives; the response schema
// repeats the stored shapes, so this holds the two in step: each kind the engine runs is accepted
// there, and a kind it does not run is not.
test("every cause kind the engine runs is a shape the snapshot schema accepts", () => {
  const samples: { [K in ScheduledCause["kind"]]: Extract<ScheduledCause, { kind: K }> } = {
    close: { due_tick: 3, kind: "close", entity: "e1", cause_id: "ev1" },
    bleed: { due_tick: 3, kind: "bleed", entity: "e1", cause_id: "ev1", remaining: 2 },
    process: { due_tick: 3, kind: "process", entity: "e1", cause_id: null, process: "burn" },
    beat: {
      due_tick: 3,
      kind: "beat",
      entity: "e1",
      cause_id: "ev1",
      id: "knock",
      action: { kind: "sound", entity: "e1", loud: true },
      then: [{ id: "answer", delay_ticks: 2, action: { kind: "sound", entity: "e1" } }],
    },
  };
  deepStrictEqual([...CAUSE_KINDS].sort(), Object.keys(samples).sort());
  const base = { version: 0, tick: 0, next_seq: 2, templates_hash: "h", coverage: { relations: [], senses: [], properties: [] }, entities: {} };
  for (const sample of Object.values(samples)) {
    strictEqual(SnapshotSchema.safeParse({ ...base, schedule: [sample] }).success, true, sample.kind);
  }
  strictEqual(
    SnapshotSchema.safeParse({ ...base, schedule: [{ due_tick: 3, kind: "tide", entity: "e1", cause_id: "ev1" }] }).success,
    false,
  );
});
