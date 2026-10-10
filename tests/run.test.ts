import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, memoryWorld, openWorld, WORLD_AUTHOR, type Id, type Result, type Scene, type World } from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A run (`docs/run.md`) is one simulation made from a scene: it registers, is started by an edit, runs, and
// ends for a reason. A world with no run is not touched by any of this. Ann is the run's slot; bob is the
// one who can kill her, from a template of his own, since a scenario may not write `attack_damage`.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));
const base = loadTemplates(templates);

function bruteRegistry(t: { after(callback: () => void): void }): TemplateRegistry {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  writeFileSync(join(dir, "brute.json"), JSON.stringify({ id: "brute", extends: "human", props: { attack_damage: 100 } }));
  return loadTemplates(dir);
}

function scene(extra: Partial<Scene> = {}, bob = false): Scene {
  return {
    entities: [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
      { id: "door", template: "door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
      { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
      { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
      ...(bob ? [{ id: "bob", template: "brute", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 0, y: 50 } } }] : []),
    ],
    run: { tick_limit: 10, slots: ["ann"] },
    ...extra,
  };
}

function open(t: { after(callback: () => void): void }, extra: Partial<Scene> = {}, bob = false): { dir: string; world: World; id: (name: string) => Id; registry: TemplateRegistry } {
  const dir = join(tempDir(t), "run");
  const registry = bob ? bruteRegistry(t) : base;
  const world = createWorld(dir, scene(extra, bob), registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, id, registry };
}

let seq = 0;
function run(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `r${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}
function edit(world: World, wanted: Parameters<World["edit"]>[0]): Result {
  seq += 1;
  return world.edit(wanted, { command_id: `r${seq}` });
}
const advance = (world: World, ticks: number): Result => run(world, WORLD_AUTHOR, "advance", undefined, { ticks });
const reason = (result: Result): [string | undefined, string | undefined] => [result.status, result.reason_code];

test("a fresh run refuses an agent's command and the author's advance, taking no time; the edits still go through", (t) => {
  const { world, id } = open(t);
  deepStrictEqual(reason(run(world, id("ann"), "take", "stone")), ["refused", "run_not_running"]);
  deepStrictEqual(reason(advance(world, 2)), ["refused", "run_not_running"]);
  strictEqual(world.snapshot().tick, 0);
  strictEqual(world.snapshot().run?.state, "registering");
  // The author may still set the scene up: a beat is queued, and a run is not yet ended.
  strictEqual(edit(world, { kind: "schedule_beat", id: "knock", at_tick: 3, action: { kind: "sound", entity: id("door") } }).status, "ok");
  deepStrictEqual(reason(edit(world, { kind: "end_run" })), ["refused", "run_not_running"]);
});

test("start_run lets commands and time through, and a second start is refused run_not_registering", (t) => {
  const { world, id } = open(t);
  strictEqual(edit(world, { kind: "start_run" }).status, "ok");
  strictEqual(world.snapshot().run?.state, "running");
  strictEqual(run(world, id("ann"), "take", "stone").status, "ok");
  strictEqual(advance(world, 1).status, "ok");
  deepStrictEqual(reason(edit(world, { kind: "start_run" })), ["refused", "run_not_registering"]);
});

test("end_run ends the run for the director, and then every command and edit is refused run_ended while reads answer", (t) => {
  const { world, id } = open(t);
  strictEqual(edit(world, { kind: "start_run" }).status, "ok");
  strictEqual(advance(world, 2).status, "ok");
  const ended = edit(world, { kind: "end_run" });
  strictEqual(ended.status, "ok");
  deepStrictEqual(world.snapshot().run?.ended, { reason: "director", tick: 2 });
  deepStrictEqual(reason(run(world, id("ann"), "take", "stone")), ["refused", "run_ended"]);
  deepStrictEqual(reason(advance(world, 1)), ["refused", "run_ended"]);
  deepStrictEqual(reason(edit(world, { kind: "schedule_beat", id: "late", at_tick: 5, action: { kind: "sound", entity: id("door") } })), ["refused", "run_ended"]);
  deepStrictEqual(reason(edit(world, { kind: "end_run" })), ["refused", "run_ended"]);
  // Reads still answer as they did: the observer sees the stone it could see before.
  strictEqual(world.query({ kind: "perceive", observer: id("ann"), sense: "sight", entity: id("stone") }).value, "true");
});

test("a wait across the limit passes only the ticks left, runs what falls due at the limit, and ends the run there", (t) => {
  const { world, id } = open(t, { run: { tick_limit: 5, slots: ["ann"] } });
  strictEqual(edit(world, { kind: "start_run" }).status, "ok");
  strictEqual(edit(world, { kind: "schedule_beat", id: "knock", at_tick: 5, action: { kind: "sound", entity: id("door") } }).status, "ok");
  strictEqual(edit(world, { kind: "schedule_beat", id: "late", at_tick: 7, action: { kind: "sound", entity: id("door") } }).status, "ok");
  const waited = run(world, id("ann"), "wait", undefined, { ticks: 9 });
  deepStrictEqual([waited.status, waited.events[0]?.data], ["ok", { advanced: 5 }]);
  deepStrictEqual(waited.events.filter((event) => event.type === "sounded").map((event) => event.tick), [5]);
  deepStrictEqual(world.snapshot().run?.ended, { reason: "tick_limit", tick: 5 });
  // What was due after the limit is dropped with the run: nothing is pending, and no time passes again.
  deepStrictEqual(world.schedule(), []);
  deepStrictEqual(reason(run(world, id("ann"), "wait", undefined, { ticks: 1 })), ["refused", "run_ended"]);
  strictEqual(world.snapshot().tick, 5);
});

test("a slot that bleeds out ends the run in that command, for no live players", (t) => {
  // The scene's ann has her full integrity, which a scenario may not write, so the snapshot is set frail
  // here, as the bleeding tests set theirs: bob severs her hand, and her wound bleeds her out in the wait.
  const { world, id, registry } = open(t, {}, true);
  const [bob, ann] = [id("bob"), id("ann")];
  const seeded = structuredClone(world.snapshot());
  const entity = seeded.entities[ann];
  ok(entity !== undefined);
  entity.integrity = 8;
  const frail = memoryWorld(seeded, registry, { ann, bob } as Record<string, Id>);
  strictEqual(edit(frail, { kind: "start_run" }).status, "ok");
  strictEqual(run(frail, bob, "attack", `${ann}.hand_r`).status, "ok");
  strictEqual(frail.snapshot().run?.state, "running");
  const waited = run(frail, bob, "wait", undefined, { ticks: 7 });
  strictEqual(waited.status, "ok");
  ok(waited.events.some((event) => event.type === "destroyed" && event.entity === ann));
  strictEqual(frail.entity(ann)?.status, "destroyed");
  deepStrictEqual(frail.snapshot().run?.ended, { reason: "no_live_players", tick: frail.snapshot().tick });
  deepStrictEqual(reason(run(frail, bob, "wait", undefined, { ticks: 1 })), ["refused", "run_ended"]);
});

test("a slot removed by the author ends the run at the edit, for no live players", (t) => {
  const { world, id } = open(t);
  strictEqual(edit(world, { kind: "start_run" }).status, "ok");
  strictEqual(edit(world, { kind: "remove", target: id("ann") }).status, "ok");
  deepStrictEqual(world.snapshot().run?.ended, { reason: "no_live_players", tick: 0 });
  deepStrictEqual(reason(advance(world, 1)), ["refused", "run_ended"]);
});

test("a world with no run takes every command and time untouched, and refuses start_run and end_run no_run", (t) => {
  const dir = join(tempDir(t), "plain");
  const world = createWorld(dir, { entities: scene().entities });
  const ann = world.id("ann");
  ok(ann !== null);
  strictEqual(run(world, ann, "take", "stone").status, "ok");
  strictEqual(advance(world, 3).status, "ok");
  strictEqual(world.snapshot().run, undefined);
  deepStrictEqual(reason(edit(world, { kind: "start_run" })), ["refused", "no_run"]);
  deepStrictEqual(reason(edit(world, { kind: "end_run" })), ["refused", "no_run"]);
});

test("a run's state is stored: a store world reopened is in the state it was left in", (t) => {
  const { dir, world, id } = open(t);
  strictEqual(edit(world, { kind: "start_run" }).status, "ok");
  strictEqual(advance(world, 2).status, "ok");
  deepStrictEqual(openWorld(dir).snapshot().run, world.snapshot().run);
  strictEqual(openWorld(dir).snapshot().run?.state, "running");
  strictEqual(run(openWorld(dir), id("ann"), "take", "stone").status, "ok");
});
