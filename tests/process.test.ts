import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, memoryWorld, openWorld, WORLD_AUTHOR, type Id, type Result, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import type { Snapshot } from "../src/model.js";
import { loadTemplates, parseRegistry, templatesHash, type TemplateRegistry } from "../src/templates.js";

// A template's process moves an integer prop by itself, every few ticks, while a condition on the
// entity's props holds. It is scheduled when the condition becomes true and withdrawn when it stops
// being true, never polled; each run is a `changed` event naming the event that set the process going.

const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const registry: TemplateRegistry = parseRegistry({
  ...base,
  // A light that burns down while it is lit.
  candle: {
    id: "candle",
    extends: "stone",
    props: { burning: false, fuel: 6 },
    processes: [
      {
        id: "burn",
        every_ticks: 2,
        while: { prop: "burning", op: "eq", value: true },
        effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } },
      },
    ],
  },
  // Something that grows from the moment it exists, with no condition, up to a cap.
  moss: {
    id: "moss",
    extends: "stone",
    props: { size: 1 },
    processes: [{ id: "grow", every_ticks: 3, effect: { adjust_prop: { prop: "size", by: 1, max: 3 } } }],
  },
});

interface Camp {
  dir: string;
  world: World;
  candle: Id;
  moss: Id;
  ann: Id;
}

function camp(t: { after(callback: () => void): void }): Camp {
  const root = mkdtempSync(join(tmpdir(), "world-engine-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "camp");
  const world = createWorld(
    dir,
    [
      { id: "tent", template: "room", overrides: { name: "tent", props: { lit: true } } },
      { id: "ann", template: "human", overrides: { name: "ann", location: "tent", support: "tent", pos: { x: 0, y: 0 } } },
      { id: "candle", template: "candle", overrides: { name: "candle", location: "tent", support: "tent", pos: { x: 100, y: 0 } } },
      { id: "moss", template: "moss", overrides: { name: "moss", location: "tent", support: "tent", pos: { x: -100, y: 0 } } },
    ],
    registry,
  );
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, candle: id("candle"), moss: id("moss"), ann: id("ann") };
}

let seq = 0;
function advance(world: World, ticks: number): Result {
  seq += 1;
  return world.command({ command_id: `a${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });
}

function light(world: World, candle: Id, burning: boolean): Result {
  const props = world.entity(candle)!.props;
  return world.edit({ kind: "set_props", target: candle, props: { ...props, burning } });
}

function pendingFor(world: World, entity: Id): boolean {
  return world.snapshot().schedule?.some((cause) => cause.entity === entity) ?? false;
}

const changes = (result: Result) =>
  result.events.filter((event) => event.type === "changed").map((event) => [event.entity, event.tick, event.data.from, event.data.to]);

test("a template without processes hashes as it did, and processes merge by id through extends", () => {
  strictEqual(Object.hasOwn(base.stone!, "processes"), false);
  strictEqual(templatesHash(parseRegistry(base)), templatesHash(base));

  const parent = parseRegistry({
    ...base,
    lamp: {
      id: "lamp",
      extends: "stone",
      props: { fuel: 9 },
      processes: [
        { id: "burn", every_ticks: 2, effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } } },
        { id: "flicker", every_ticks: 5, effect: { adjust_prop: { prop: "glow", by: 1, max: 4 } } },
      ],
    },
    brass_lamp: {
      id: "brass_lamp",
      extends: "lamp",
      processes: [
        { id: "burn", every_ticks: 4, effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } } },
        { id: "tarnish", every_ticks: 7, effect: { adjust_prop: { prop: "dull", by: 1, max: 9 } } },
      ],
    },
  });
  deepStrictEqual(
    parent.brass_lamp!.processes!.map((p) => [p.id, p.every_ticks]),
    [["burn", 4], ["flicker", 5], ["tarnish", 7]],
  );
  deepStrictEqual(parent.lamp!.processes!.map((p) => p.every_ticks), [2, 5]);
  strictEqual(Object.hasOwn(parent.stone!, "processes"), false);
});

test("a malformed process is refused by template and process id", () => {
  const bad = (process: unknown) => () =>
    parseRegistry({ ...base, odd: { id: "odd", extends: "stone", processes: [process] } });
  const effect = { adjust_prop: { prop: "x", by: 1 } };
  throws(bad({ id: "", every_ticks: 1, effect }), /odd.*id/);
  throws(bad({ id: "p", every_ticks: 0, effect }), /every_ticks/);
  throws(bad({ id: "p", every_ticks: 1.5, effect }), /every_ticks/);
  throws(bad({ id: "p", every_ticks: 1, effect: { adjust_prop: { prop: "x", by: 0 } } }), /by/);
  throws(bad({ id: "p", every_ticks: 1, effect: { adjust_prop: { prop: "x", by: 1, min: 5, max: 2 } } }), /min/);
  throws(bad({ id: "p", every_ticks: 1, effect: {} }), /adjust_prop/);
  throws(bad({ id: "p", every_ticks: 1, effect, while: { prop: "x", op: "near", value: 1 } }), /op/);
  throws(bad({ id: "p", every_ticks: 1, effect, while: { prop: "x", op: "lt", value: "a" } }), /number/);
  throws(bad({ id: "p", every_ticks: 1, effect, extra: true }), /unknown field extra/);
  throws(
    () => parseRegistry({ ...base, odd: { id: "odd", extends: "stone", processes: [{ id: "p", every_ticks: 1, effect }, { id: "p", every_ticks: 2, effect }] } }),
    /twice/,
  );
});

test("a process with no condition starts with the world, and its first run is a root", (t) => {
  const { world, moss } = camp(t);
  deepStrictEqual(world.snapshot().schedule, [
    { due_tick: 3, kind: "process", entity: moss, cause_id: null, process: "grow" },
  ]);

  // Two runs, at 3 and 6; at its cap of 3 the moss stops and nothing is left pending.
  const result = advance(world, 10);
  deepStrictEqual(changes(result), [
    [moss, 3, 1, 2],
    [moss, 6, 2, 3],
  ]);
  strictEqual(world.entity(moss)?.props.size, 3);
  strictEqual(world.snapshot().schedule, undefined);
  strictEqual(world.snapshot().tick, 10);

  const [first, second] = result.events.filter((event) => event.type === "changed");
  ok(first !== undefined && second !== undefined);
  strictEqual(first.cause_id, null);
  strictEqual(second.cause_id, first.event_id);
  deepStrictEqual(first.data, { prop: "size", from: 1, to: 2, process: "grow" });
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("a condition made true by an edit starts a process, and made false stops it", (t) => {
  const { world, candle } = camp(t);
  strictEqual(pendingFor(world, candle), false);

  const lit = light(world, candle, true);
  strictEqual(lit.status, "ok");
  const edited = lit.events.find((event) => event.type === "edited");
  ok(edited);
  const burn = world.snapshot().schedule?.find((cause) => cause.entity === candle);
  deepStrictEqual(burn, { due_tick: 2, kind: "process", entity: candle, cause_id: edited.event_id, process: "burn" });

  // Two runs fit in five ticks (at 2 and 4); the third is due at 6.
  deepStrictEqual(changes(advance(world, 5)).filter(([entity]) => entity === candle), [
    [candle, 2, 6, 5],
    [candle, 4, 5, 4],
  ]);

  // Snuffed with a run pending: it is withdrawn, and nothing more happens however long we wait.
  strictEqual(light(world, candle, false).status, "ok");
  strictEqual(pendingFor(world, candle), false);
  deepStrictEqual(changes(advance(world, 20)).filter(([entity]) => entity === candle), []);
  strictEqual(world.entity(candle)?.props.fuel, 4);
});

test("a process stops at its bound and starts again when an edit lifts the prop off it", (t) => {
  const { world, candle } = camp(t);
  world.edit({ kind: "set_props", target: candle, props: { burning: true, fuel: 1 } });
  const run = advance(world, 10);
  deepStrictEqual(changes(run).filter(([entity]) => entity === candle), [[candle, 2, 1, 0]]);
  strictEqual(pendingFor(world, candle), false);

  world.edit({ kind: "set_props", target: candle, props: { burning: true, fuel: 2 } });
  ok(pendingFor(world, candle));
  deepStrictEqual(changes(advance(world, 10)).filter(([entity]) => entity === candle), [
    [candle, 12, 2, 1],
    [candle, 14, 1, 0],
  ]);
});

test("a removed entity's process goes with it, and a spawned one starts", (t) => {
  const { world, candle } = camp(t);
  light(world, candle, true);
  ok(pendingFor(world, candle));
  strictEqual(world.edit({ kind: "remove", target: candle }).status, "ok");
  strictEqual(pendingFor(world, candle), false);

  const spawned = world.edit({
    kind: "spawn",
    template: "candle",
    overrides: { name: "stub", location: world.id("tent")!, support: world.id("tent")!, pos: { x: 50, y: 50 }, props: { burning: true, fuel: 3 } },
  });
  strictEqual(spawned.status, "ok");
  const spawnEvent = spawned.events.find((event) => event.type === "spawned");
  ok(spawnEvent);
  const stub = world.snapshot().schedule?.find((cause) => cause.entity === spawnEvent.entity && cause.kind === "process");
  ok(stub);
  strictEqual(stub.cause_id, spawnEvent.event_id);
});

test("a run is seen by those who can see the thing, and heard by no one", (t) => {
  const { world, ann, moss } = camp(t);
  const result = advance(world, 3);
  const changed = result.events.find((event) => event.type === "changed");
  ok(changed);
  strictEqual(changed.entity, moss);
  strictEqual(world.query({ kind: "perceive", observer: ann, sense: "sight", event_id: changed.event_id }).value, "true");
  deepStrictEqual(world.query({ kind: "perceive", observer: ann, sense: "hearing", event_id: changed.event_id }), {
    value: "false",
    basis_code: "quiet",
  });
});

test("the schedule of processes replays: a reopened world, and a memory world, equal the live one", (t) => {
  const { world, candle, dir } = camp(t);
  const memory = memoryWorld(JSON.parse(canonicalJson(world.snapshot())) as Snapshot, registry);
  for (const target of [world, memory]) {
    light(target, candle, true);
    advance(target, 3);
    light(target, candle, false);
    advance(target, 4);
    light(target, candle, true);
    advance(target, 1);
  }
  const live = canonicalJson(world.snapshot());
  strictEqual(canonicalJson(openWorld(dir).snapshot()), live);
  strictEqual(canonicalJson(memory.snapshot()), live);
  strictEqual(canonicalJson(memory.since(0).events.map((event) => [event.type, event.tick, event.entity, event.cause_id === null])), canonicalJson(
    world.since(0).events.map((event) => [event.type, event.tick, event.entity, event.cause_id === null]),
  ));
});

test("validation refuses a second run of one process and a nameless one", (t) => {
  const { world, moss } = camp(t);
  const snapshot = world.snapshot();
  const cause = snapshot.schedule![0]!;
  const twice: Snapshot = { ...snapshot, schedule: [cause, { ...cause, due_tick: cause.due_tick + 1 }] };
  deepStrictEqual(validateSnapshot(twice, registry).map((issue) => issue.code), ["duplicate_process"]);
  const nameless: Snapshot = { ...snapshot, schedule: [{ due_tick: 3, kind: "process", entity: moss, cause_id: null, process: "" }] };
  deepStrictEqual(validateSnapshot(nameless, registry).map((issue) => issue.code), ["invalid_process"]);
});
