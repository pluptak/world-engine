import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cli } from "./cli-run.js";
import { canonicalJson, createWorld, openWorld, WORLD_AUTHOR, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { presetRegistry } from "./presets.js";
import { tempDir } from "./harness.js";

// The schedule read (`docs/schedule-api.md`): what the world will do by itself, as stored, filtered and
// in run order. The door closes two ticks after it is opened; a lit candle burns from the start; a beat is
// queued by the author; a severed hand bleeds. Reading changes nothing, and the CLI answers the same.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));
const registry = presetRegistry(loadTemplates(templates));

// A human whose blow takes a hand off: a template of its own, since a scenario may not write `attack_damage`.
function bruteRegistry(t: { after(callback: () => void): void }): TemplateRegistry {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  writeFileSync(join(dir, "brute.json"), JSON.stringify({ id: "brute", extends: "human", props: { attack_damage: 100 } }));
  return presetRegistry(loadTemplates(dir));
}

function scenario(entries: Scenario = []): Scenario {
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "door", template: "self_closing_door", overrides: { name: "door", props: { open: false, from: "hall", to: "yard" } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    ...entries,
  ];
}

function open(t: { after(callback: () => void): void }, entries: Scenario = []): World {
  return createWorld(join(tempDir(t), "world"), scenario(entries), registry);
}

function id(world: World, name: string): Id {
  const found = world.id(name);
  ok(found !== null, name);
  return found;
}

let seq = 0;
function run(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `s${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

const candle: Scenario[number] = {
  id: "candle",
  template: "candle",
  overrides: { name: "candle", location: "hall", support: "hall", pos: { x: 100, y: 0 }, props: { burning: true } },
};

test("nothing pending reads as an empty list", (t) => {
  deepStrictEqual(open(t).schedule(), []);
});

test("an opened door lists its close, naming the opening, and a close by hand takes it off", (t) => {
  const world = open(t);
  const [ann, door] = [id(world, "ann"), id(world, "door")];
  const opened = run(world, ann, "open", "door");
  strictEqual(opened.status, "ok");
  const openedEvent = opened.events.find((event) => event.type === "opened");
  ok(openedEvent !== undefined);
  deepStrictEqual(world.schedule(), [{ due_tick: openedEvent.tick + 2, kind: "close", entity: door, cause_id: openedEvent.event_id }]);
  strictEqual(run(world, ann, "close", "door").status, "ok");
  deepStrictEqual(world.schedule(), []);
});

test("a burning candle, a queued beat and a severed hand are each listed with their own fields", (t) => {
  const world = createWorld(join(tempDir(t), "world"), scenario([
    candle,
    { id: "guard", template: "human", overrides: { name: "guard", location: "hall", support: "hall", pos: { x: 50, y: 0 } } },
    { id: "bob", template: "brute", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 0, y: 50 } } },
  ]), bruteRegistry(t));
  const [guard, bob, door, burner] = [id(world, "guard"), id(world, "bob"), id(world, "door"), id(world, "candle")];
  deepStrictEqual(world.schedule({ kind: "process" }), [{ due_tick: 1, kind: "process", entity: burner, cause_id: null, process: "burn" }]);

  const queued = world.edit({ kind: "schedule_beat", id: "knock", at_tick: 5, action: { kind: "sound", entity: door } });
  strictEqual(queued.status, "ok");
  deepStrictEqual(world.schedule({ kind: "beat" }).map((cause) => (cause.kind === "beat" ? [cause.due_tick, cause.id, cause.entity] : [])), [[5, "knock", door]]);

  // One blow takes a hand off, and the wound bleeds its three times, the first of them still to come.
  strictEqual(run(world, bob, "attack", `${guard}.hand_r`).status, "ok");
  const bleed = world.schedule({ kind: "bleed" });
  strictEqual(bleed.length, 1);
  strictEqual(bleed[0]?.kind, "bleed");
  strictEqual(bleed[0]?.remaining, 3);

  // The whole list is in run order: by due tick, then by when each was scheduled.
  const dues = world.schedule().map((cause) => cause.due_tick);
  deepStrictEqual(dues, [...dues].sort((a, b) => a - b));
});

test("a filter keeps the causes of one kind, of one entity, or due by one tick", (t) => {
  const world = open(t, [candle]);
  const [ann, door, burner] = [id(world, "ann"), id(world, "door"), id(world, "candle")];
  strictEqual(run(world, ann, "open", "door").status, "ok");
  const all = world.schedule();
  deepStrictEqual(all.map((cause) => cause.kind).sort(), ["close", "process"]);

  deepStrictEqual(world.schedule({ kind: "close" }).map((cause) => cause.entity), [door]);
  deepStrictEqual(world.schedule({ entity: burner }).map((cause) => cause.kind), ["process"]);
  deepStrictEqual(world.schedule({ entity: door }).map((cause) => cause.kind), ["close"]);
  deepStrictEqual(world.schedule({ kind: "beat" }), []);

  // `until_tick` keeps what is due at or before it: none before the first due tick, all at the last.
  const dues = all.map((cause) => cause.due_tick);
  const first = Math.min(...dues);
  const last = Math.max(...dues);
  deepStrictEqual(world.schedule({ until_tick: first - 1 }), []);
  deepStrictEqual(world.schedule({ until_tick: first }).map((cause) => cause.due_tick), dues.filter((due) => due === first));
  deepStrictEqual(world.schedule({ until_tick: last }), all);
  deepStrictEqual(world.schedule({ kind: "close", until_tick: first - 1 }), []);
});

test("reading the schedule changes nothing, and a copy handed back is not the world's own", (t) => {
  const world = open(t);
  strictEqual(run(world, id(world, "ann"), "open", "door").status, "ok");
  const before = world.snapshot();
  const [close] = world.schedule();
  ok(close !== undefined);
  (close as { due_tick: number }).due_tick = 999;
  deepStrictEqual(world.schedule(), before.schedule ?? []);
  deepStrictEqual(world.snapshot(), before);
});

test("a memory world lists the same causes as the world it was made from", (t) => {
  const world = open(t);
  strictEqual(run(world, id(world, "ann"), "open", "door").status, "ok");
  deepStrictEqual(world.fork().schedule(), world.schedule());
});

test("a store world reopened lists the same causes", (t) => {
  const dir = join(tempDir(t), "world");
  const world = createWorld(dir, scenario([candle]), registry);
  strictEqual(run(world, id(world, "ann"), "open", "door").status, "ok");
  deepStrictEqual(openWorld(dir).schedule(), world.schedule());
  strictEqual(world.schedule().length, 2);
});

test("the CLI's schedule op answers the same list, with its filter", (t) => {
  const dir = join(tempDir(t), "world");
  const world = createWorld(dir, scenario(), registry);
  strictEqual(run(world, id(world, "ann"), "open", "door").status, "ok");
  const answer = JSON.parse(cli(JSON.stringify({ op: "schedule", world: dir })).stdout) as { schedule: unknown };
  deepStrictEqual(answer.schedule, world.schedule());
  const onlyBeats = JSON.parse(cli(JSON.stringify({ op: "schedule", world: dir, filter: { kind: "beat" } })).stdout) as { schedule: unknown };
  deepStrictEqual(onlyBeats.schedule, []);
});

// `advance` with `stop_before` (`docs/time.md`): time ends one tick short of a pending beat's due tick.
function advance(world: World, args: Record<string, unknown>): Result {
  seq += 1;
  return world.command({ command_id: `adv${seq}`, actor: WORLD_AUTHOR, verb: "advance", args });
}
const soundedAt = (result: Result): number[] => result.events.filter((event) => event.type === "sounded").map((event) => event.tick);
const knock = (world: World, at: number, entity: Id, id = "knock"): Result =>
  world.edit({ kind: "schedule_beat", id, at_tick: at, action: { kind: "sound", entity } });

test("an advance stopped before a beat ends a tick short of it, the beat still pending, and a plain advance runs it", (t) => {
  const world = open(t);
  const door = id(world, "door");
  strictEqual(knock(world, 4, door).status, "ok");
  // `ticks` stays the upper bound: two ticks pass, short of the beat.
  const bounded = advance(world, { ticks: 2, stop_before: "knock" });
  deepStrictEqual([bounded.status, bounded.events[0]?.data], ["ok", { advanced: 2 }]);
  // From tick 2 the beat is due at 4: the advance ends at 3, with the beat pending.
  const stopped = advance(world, { ticks: 10, stop_before: "knock" });
  deepStrictEqual([stopped.status, stopped.events[0]?.data, world.snapshot().tick], ["ok", { advanced: 1 }, 3]);
  deepStrictEqual(world.schedule({ kind: "beat" }).map((cause) => cause.due_tick), [4]);
  // The beat is due at the very next tick, so there is no time to run up to it: refused, and nothing passes.
  const next = advance(world, { ticks: 1, stop_before: "knock" });
  deepStrictEqual([next.status, next.reason_code, world.snapshot().tick], ["refused", "beat_not_ahead", 3]);
  // A plain advance of one tick runs it.
  deepStrictEqual(soundedAt(advance(world, { ticks: 1 })), [4]);
  deepStrictEqual(world.schedule({ kind: "beat" }), []);
});

test("an advance refuses a beat nothing pending carries, and a stop that is not an id, and takes no time", (t) => {
  const world = open(t);
  strictEqual(knock(world, 1, id(world, "door")).status, "ok");
  const unknown = advance(world, { ticks: 5, stop_before: "nothing" });
  deepStrictEqual([unknown.status, unknown.reason_code, world.snapshot().tick], ["refused", "no_such_beat", 0]);
  const malformed = advance(world, { ticks: 5, stop_before: "not an id" });
  deepStrictEqual([malformed.status, malformed.reason_code, world.snapshot().tick], ["invalid", "invalid_args", 0]);
  // Due at tick 1, which is the very next tick from 0: refused beat_not_ahead, as the other two are.
  deepStrictEqual([advance(world, { ticks: 5, stop_before: "knock" }).reason_code, world.snapshot().tick], ["beat_not_ahead", 0]);
});

test("a beat pruned with its subject earlier in the span no longer stops the advance, which runs its full ticks", (t) => {
  const world = open(t, [{ id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 60, y: 0 } } }]);
  const stone = id(world, "stone");
  strictEqual(world.edit({ kind: "schedule_beat", id: "gone", at_tick: 2, action: { kind: "remove", target: stone } }).status, "ok");
  strictEqual(knock(world, 4, stone).status, "ok");
  const full = advance(world, { ticks: 10, stop_before: "knock" });
  deepStrictEqual([full.status, full.events[0]?.data, world.snapshot().tick], ["ok", { advanced: 10 }, 10]);
  deepStrictEqual(world.schedule(), []);
});

test("an earlier stop on what an agent senses wins over the beat, and the beat stays pending", (t) => {
  const world = open(t);
  const [door, ann] = [id(world, "door"), id(world, "ann")];
  strictEqual(knock(world, 8, door).status, "ok");
  strictEqual(knock(world, 3, door, "bang").status, "ok");
  const woken = advance(world, { ticks: 10, stop_on_perceived: [ann], stop_before: "knock" });
  deepStrictEqual([woken.status, woken.events[0]?.data, world.snapshot().tick], ["ok", { advanced: 3 }, 3]);
  deepStrictEqual(world.schedule({ kind: "beat" }).map((cause) => [cause.due_tick, cause.kind === "beat" ? cause.id : ""]), [[8, "knock"]]);
});

test("a repeating beat stops an advance before its next run only: the runs after it come in a plain advance", (t) => {
  const world = open(t);
  strictEqual(
    world.edit({ kind: "schedule_beat", id: "knock", at_tick: 3, action: { kind: "sound", entity: id(world, "door") }, repeat: { every_ticks: 2, times: 2 } }).status,
    "ok",
  );
  const stopped = advance(world, { ticks: 10, stop_before: "knock" });
  deepStrictEqual([stopped.status, stopped.events[0]?.data, world.snapshot().tick], ["ok", { advanced: 2 }, 2]);
  deepStrictEqual(soundedAt(advance(world, { ticks: 10 })), [3, 5, 7]);
});

test("two advances that end where one would have leave the same world", (t) => {
  const single = open(t);
  const split = open(t);
  for (const world of [single, split]) {
    strictEqual(knock(world, 4, id(world, "door")).status, "ok");
  }
  strictEqual(advance(single, { ticks: 10 }).status, "ok");
  strictEqual(advance(split, { ticks: 10, stop_before: "knock" }).status, "ok");
  strictEqual(advance(split, { ticks: 7 }).status, "ok");
  strictEqual(split.snapshot().tick, single.snapshot().tick);
  deepStrictEqual(split.schedule(), single.schedule());
  strictEqual(canonicalJson(split.snapshot().entities), canonicalJson(single.snapshot().entities));
});
