import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cli } from "./cli-run.js";
import { createWorld, openWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
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
