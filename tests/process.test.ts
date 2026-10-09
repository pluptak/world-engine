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
    props: { light_source: true, burning: false, fuel: 6 },
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
    fields: { size: { tier: "state", type: "integer" } },
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
      props: { light_source: true, fuel: 9 },
      fields: { glow: { tier: "state", type: "integer" } },
      processes: [
        { id: "burn", every_ticks: 2, effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } } },
        { id: "flicker", every_ticks: 5, effect: { adjust_prop: { prop: "glow", by: 1, max: 4 } } },
      ],
    },
    brass_lamp: {
      id: "brass_lamp",
      extends: "lamp",
      fields: { dull: { tier: "state", type: "integer" } },
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
  deepStrictEqual(Object.keys(parent.brass_lamp!.fields!), ["glow", "dull"]);
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
  const relight = (fuel: number) =>
    world.edit({ kind: "set_props", target: candle, props: { ...world.entity(candle)!.props, burning: true, fuel } });
  relight(1);
  const run = advance(world, 10);
  deepStrictEqual(changes(run).filter(([entity]) => entity === candle), [[candle, 2, 1, 0]]);
  strictEqual(pendingFor(world, candle), false);

  relight(2);
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

// What a process does on reaching its bound (`then`), under the run that reached it.

// A detachable part of a child of `human` needs a template of its own (the companion rule).
const starverParts = Object.fromEntries(
  ["arm_l", "arm_l.hand_l", "arm_r", "arm_r.hand_r", "hand_l", "hand_r"].map((part) => [
    `starver.${part}`,
    { id: `starver.${part}`, extends: `human.${part}` },
  ]),
);

const withThen = parseRegistry({
  ...base,
  ...starverParts,
  candle: {
    id: "candle",
    extends: "stone",
    props: { light_source: true, burning: false, fuel: 2 },
    processes: [
      {
        id: "burn",
        every_ticks: 2,
        while: { prop: "burning", op: "eq", value: true },
        effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } },
        then: { set_prop: { prop: "burning", value: false } },
      },
    ],
  },
  // A body that starves: hunger rises each tick and, at its cap, takes everything it has left.
  starver: {
    id: "starver",
    extends: "human",
    props: { hunger: 97 },
    processes: [
      {
        id: "hunger",
        every_ticks: 1,
        effect: { adjust_prop: { prop: "hunger", by: 1, max: 100 } },
        then: { damage: { amount: 100 } },
      },
    ],
  },
  // Fruit that spoils away to nothing.
  fruit: {
    id: "fruit",
    extends: "stone",
    props: { fresh: 2 },
    fields: { fresh: { tier: "state", type: "integer" } },
    processes: [
      {
        id: "spoil",
        every_ticks: 2,
        effect: { adjust_prop: { prop: "fresh", by: -1, min: 0 } },
        then: { remove: true },
      },
    ],
  },
});

type ThenIds = Record<"tent" | "starver" | "stone" | "candle" | "fruit" | "bowl", Id>;

function thenWorld(t: { after(callback: () => void): void }): { world: World; ids: ThenIds } {
  const root = mkdtempSync(join(tmpdir(), "world-engine-then-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const world = createWorld(
    join(root, "w"),
    [
      { id: "tent", template: "room", overrides: { name: "tent", props: { lit: true } } },
      { id: "starver", template: "starver", overrides: { name: "starver", location: "tent", support: "tent", pos: { x: 0, y: 0 } } },
      { id: "stone", template: "stone", overrides: { name: "pebble", location: "tent", contained_in: "starver", in_part: "hand_l" } },
      { id: "candle", template: "candle", overrides: { name: "candle", location: "tent", support: "tent", pos: { x: 100, y: 0 } } },
      { id: "fruit", template: "fruit", overrides: { name: "fruit", location: "tent", support: "tent", pos: { x: -100, y: 0 } } },
      { id: "bowl", template: "stone", overrides: { name: "bowl", location: "tent", support: "tent", pos: { x: -100, y: 60 } } },
    ],
    withThen,
  );
  const ids = {} as ThenIds;
  for (const name of ["tent", "starver", "stone", "candle", "fruit", "bowl"] as const) {
    const found = world.id(name);
    ok(found !== null, name);
    ids[name] = found;
  }
  return { world, ids };
}

test("a process's then is declared with the bound it waits for, and exactly one effect", () => {
  const bad = (process: Record<string, unknown>) => () =>
    parseRegistry({
      ...base,
      odd: { id: "odd", extends: "stone", processes: [{ id: "p", every_ticks: 1, effect: { adjust_prop: { prop: "x", by: -1, min: 0 } }, ...process }] },
    });
  throws(bad({ then: {} }), /exactly one/);
  throws(bad({ then: { remove: true, damage: { amount: 1 } } }), /exactly one/);
  throws(bad({ then: { remove: false } }), /remove must be true/);
  throws(bad({ then: { damage: { amount: 0 } } }), /at least 1/);
  throws(bad({ then: { set_prop: { prop: "", value: 1 } } }), /prop/);
  throws(bad({ then: { set_prop: { prop: "a", value: null } } }), /primitive/);
  // A negative `by` waits for `min`; with only a `max` it would never fire.
  throws(
    () =>
      parseRegistry({
        ...base,
        odd: { id: "odd", extends: "stone", processes: [{ id: "p", every_ticks: 1, effect: { adjust_prop: { prop: "x", by: -1, max: 9 } }, then: { remove: true } }] },
      }),
    /needs the bound/,
  );
  // A child that redeclares the process replaces its then along with the rest.
  const child = parseRegistry({
    ...withThen,
    stub: { id: "stub", extends: "candle", processes: [{ id: "burn", every_ticks: 2, while: { prop: "burning", op: "eq", value: true }, effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } } }] },
  });
  strictEqual(child.candle!.processes![0]!.then !== undefined, true);
  strictEqual(child.stub!.processes![0]!.then, undefined);
});

test("reaching the bound writes a prop, under the run that reached it", (t) => {
  const { world, ids } = thenWorld(t);
  const relight = (fuel: number) =>
    world.edit({ kind: "set_props", target: ids.candle!, props: { ...world.entity(ids.candle!)!.props, burning: true, fuel } });
  const edited = relight(2);
  strictEqual(edited.status, "ok");
  const run = advance(world, 10);
  const changed = run.events.filter((event) => event.type === "changed" && event.entity === ids.candle);
  deepStrictEqual(
    changed.map((event) => [event.tick, event.data.prop, event.data.from, event.data.to]),
    [
      [2, "fuel", 2, 1],
      [4, "fuel", 1, 0],
      [4, "burning", true, false],
    ],
  );
  strictEqual(changed[2]?.cause_id, changed[1]?.event_id);
  deepStrictEqual(
    [world.entity(ids.candle!)?.props.burning, world.entity(ids.candle!)?.props.fuel],
    [false, 0],
  );
  // The write stopped the process through the condition, so nothing is pending for it.
  strictEqual(pendingFor(world, ids.candle!), false);
  // Lit again with fuel, it burns once more: the end of one burn is not the end of the candle.
  relight(1);
  strictEqual(pendingFor(world, ids.candle!), true);
});

test("reaching the bound can take integrity: a starved body drops what it held", (t) => {
  const { world, ids } = thenWorld(t);
  strictEqual(world.entity(ids.stone!)?.contained_in, ids.starver);
  const run = advance(world, 6);
  const types = run.events.filter((event) => event.entity === ids.starver || event.entity === ids.stone).map((event) => [event.type, event.tick]);
  deepStrictEqual(types, [
    ["changed", 1],
    ["changed", 2],
    ["changed", 3],
    ["destroyed", 3],
    ["dropped", 3],
  ]);
  const [third, destroyed, dropped] = run.events.filter((event) => ["changed", "destroyed", "dropped"].includes(event.type) && event.tick === 3 && (event.entity === ids.starver || event.entity === ids.stone));
  strictEqual(destroyed?.cause_id, third?.event_id);
  strictEqual(dropped?.cause_id, destroyed?.event_id);
  strictEqual(world.entity(ids.starver)?.status, "destroyed");
  strictEqual(world.entity(ids.stone)?.contained_in, null);
  // A destroyed body is not run on: its hunger stays where it ended.
  strictEqual(world.entity(ids.starver)?.props.hunger, 100);
  strictEqual(pendingFor(world, ids.starver!), false);
  deepStrictEqual(validateSnapshot(world.snapshot(), withThen), []);
  // The chain from the first run to the fall reads back through trace.
  const trace = world.trace({ entity: ids.stone!, field: "contained_in" }).events.map((event) => event.type);
  strictEqual(trace.includes("dropped"), true);
});

test("reaching the bound can take the entity out of the world, with its other causes", (t) => {
  const { world, ids } = thenWorld(t);
  const run = advance(world, 5);
  const spoil = run.events.filter((event) => event.entity === ids.fruit);
  deepStrictEqual(spoil.map((event) => [event.type, event.tick]), [
    ["changed", 2],
    ["changed", 4],
    ["removed", 4],
  ]);
  strictEqual(spoil[2]?.cause_id, spoil[1]?.event_id);
  strictEqual(world.entity(ids.fruit!), null);
  strictEqual(pendingFor(world, ids.fruit!), false);
  deepStrictEqual(validateSnapshot(world.snapshot(), withThen), []);
  // The bowl beside it is untouched, and the starver kept running.
  ok(world.entity(ids.bowl!) !== null);
});

// A rate that follows the body: the delay of the next run is read from a prop when it is scheduled.
const withRate = parseRegistry({
  ...base,
  ember: {
    id: "ember",
    extends: "stone",
    props: { glow: 0, rate: 4 },
    fields: { glow: { tier: "state", type: "integer" }, rate: { tier: "state", type: "integer" } },
    processes: [{ id: "glow", every_ticks: 5, every_ticks_prop: "rate", effect: { adjust_prop: { prop: "glow", by: 1, max: 100 } } }],
  },
});

function ember(t: { after(callback: () => void): void }, props?: Record<string, number | string | boolean>): { world: World; ember: Id } {
  const root = mkdtempSync(join(tmpdir(), "world-engine-rate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const world = createWorld(
    join(root, "w"),
    [
      { id: "tent", template: "room", overrides: { name: "tent", props: { lit: true } } },
      { id: "ember", template: "ember", overrides: { name: "ember", location: "tent", support: "tent", pos: { x: 0, y: 0 }, ...(props === undefined ? {} : { props }) } },
    ],
    withRate,
  );
  return { world, ember: world.id("ember")! };
}

test("a process's delay follows the prop it names, and a pending run is not retimed", (t) => {
  const { world, ember: id } = ember(t);
  // The prop says 4: runs at 4 and 8.
  deepStrictEqual(changes(advance(world, 8)).map((row) => row[1]), [4, 8]);
  // Speeding it up changes the run after the pending one: the pending run (due 12) keeps its delay.
  strictEqual(world.edit({ kind: "set_props", target: id, props: { ...world.entity(id)!.props, rate: 1 } }).status, "ok");
  deepStrictEqual(changes(advance(world, 5)).map((row) => row[1]), [12, 13]);
});

test("a prop that is not a positive integer falls back to every_ticks", (t) => {
  const { world, ember: id } = ember(t);
  strictEqual(world.edit({ kind: "set_props", target: id, props: { glow: 0, rate: 0 } }).status, "ok");
  // The run pending from the start (due 4) is not retimed; the next ones wait every_ticks.
  deepStrictEqual(changes(advance(world, 10)).map((row) => row[1]), [4, 9]);
  // A declared integer may still be negative: the process falls back, and the entity-props rule is
  // content because the value's type is right.
  strictEqual(world.edit({ kind: "set_props", target: id, props: { glow: 0, rate: -1 } }).status, "ok");
  deepStrictEqual(changes(advance(world, 5)).map((row) => row[1]), [14]);
  strictEqual(world.edit({ kind: "set_props", target: id, props: { glow: 0 } }).status, "ok");
  deepStrictEqual(changes(advance(world, 5)).map((row) => row[1]), [19]);
  deepStrictEqual(validateSnapshot(world.snapshot(), withRate), []);
});

test("every_ticks_prop must name a prop", () => {
  const effect = { adjust_prop: { prop: "x", by: 1 } };
  for (const bad of ["", 3, null]) {
    throws(
      () => parseRegistry({ ...base, odd: { id: "odd", extends: "stone", processes: [{ id: "p", every_ticks: 1, every_ticks_prop: bad, effect }] } }),
      /every_ticks_prop/,
    );
  }
});

test("a hungry body's rate follows hunger_every: a resting body hungers at half the pace", (t) => {
  const root = mkdtempSync(join(tmpdir(), "world-engine-rate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // A body that hungers at half the pace: its rate is a definition, so it is a preset of its own.
  const slowParts = Object.fromEntries(
    ["arm_l", "arm_l.hand_l", "arm_r", "arm_r.hand_r", "hand_l", "hand_r"].map((part) => [
      `slow_hungry.${part}`,
      { id: `slow_hungry.${part}`, extends: `human.${part}` },
    ]),
  );
  const slow = parseRegistry({
    ...base,
    ...slowParts,
    slow_hungry: { id: "slow_hungry", extends: "human_hungry", props: { hunger_every: 20 } },
  });
  const world = createWorld(
    join(root, "w"),
    [
      { id: "tent", template: "room", overrides: { name: "tent", props: { lit: true } } },
      { id: "busy", template: "human_hungry", overrides: { name: "busy", location: "tent", support: "tent", pos: { x: 0, y: 0 } } },
      {
        id: "rest",
        template: "slow_hungry",
        overrides: { name: "rest", location: "tent", support: "tent", pos: { x: 100, y: 0 }, props: { hunger: 0, starvation: 0 } },
      },
    ],
    slow,
  );
  advance(world, 100);
  strictEqual(world.entity(world.id("busy")!)?.props.hunger, 10);
  strictEqual(world.entity(world.id("rest")!)?.props.hunger, 5);
});
