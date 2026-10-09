import { deepStrictEqual, notStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  actorWorld,
  canonicalJson,
  createWorld,
  memoryWorld,
  openWorld,
  WorldError,
  type Command,
  type Id,
  type Result,
  type Scenario,
  type World,
  type WorldEdit,
} from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { cli } from "./cli-run.js";
import { tempDir } from "./harness.js";

// A string that came from outside and is spelt like a member of Object.prototype is not an id, a
// template or a name: it gets exactly what an id nothing has gets, in every place that takes one.
const NAMES = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"] as const;
const ABSENT = "e999999";
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const at = (x: number) => ({ location: "hall", support: "hall", pos: { x, y: 0 } });
const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
  { id: "ann", template: "human", overrides: { name: "ann", ...at(0) } },
  { id: "bob", template: "human", overrides: { name: "bob", ...at(60) } },
  { id: "flask", template: "bottle", overrides: { name: "flask", ...at(10) } },
  { id: "rock", template: "stone", overrides: { name: "rock", ...at(30) } },
  { id: "chest", template: "chest", overrides: { name: "chest", ...at(70) } },
];

function worlds(t: { after(callback: () => void): void }): World[] {
  const store = createWorld(join(tempDir(t), "w"), scenario, registry);
  return [store, memoryWorld(store.snapshot(), registry, { ann: "e3", flask: "e5" })];
}

// What a caller can tell of a call: its verdict, or the code it threw. A TypeError is the bug.
function outcome(run: () => unknown): string {
  try {
    return canonicalJson(run() ?? null);
  } catch (error) {
    return `threw ${error instanceof WorldError ? error.code : (error as Error).constructor.name}`;
  }
}

function verdict(result: Result): unknown {
  const { status, resolved_target, candidates, reason_code, reason_data } = result;
  return { status, resolved_target, candidates, reason_code, reason_data };
}

function ordered(world: World, command: Omit<Command, "command_id">, index: number): Command {
  return { command_id: `probe-${index}-${world.snapshot().version}`, ...command };
}

// Every place a command carries a string from outside: the actor, the target, a part, and each id
// argument of a verb that takes one.
function commands(ann: Id, x: string): Array<Omit<Command, "command_id">> {
  const as = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>) => ({
    actor,
    verb,
    ...(target !== undefined && { target }),
    ...(args !== undefined && { args }),
  });
  return [
    as(x, "wait", undefined, { ticks: 1 }),
    as(ann, "wait", undefined, { ticks: 1, stop_on_perceived: [x] }),
    ...["take", "drop", "open", "close", "lock", "unlock", "attack", "light", "douse", "search"].flatMap((verb) => [
      as(ann, verb, x),
      as(ann, verb, `${x}.hand_l`),
      as(x, verb, "flask"),
    ]),
    as(ann, "push", x, { dir: "+x", distance_cm: 10 }),
    as(ann, "take", "flask", { part: x }),
    as(ann, "take", "flask", { part: `${x}.hand_l` }),
    as(ann, "give", "flask", { destination: x }),
    as(ann, "give", "flask", { destination: `${x}.hand_l` }),
    as(ann, "put", "flask", { relation: "in", destination: x }),
    as(ann, "put", "flask", { relation: "on", destination: `${x}.pocket` }),
    as(ann, "pour", "flask", { destination: x, amount: 1 }),
    as(ann, "move", undefined, { location: x }),
    as(ann, "move", undefined, { through: x }),
    as(ann, "move", undefined, { through: `${x}.hand_l` }),
    as(ann, "say", x, { utterance: "hello" }),
  ];
}

function edits(x: string): WorldEdit[] {
  return [
    { kind: "spawn", template: x },
    { kind: "spawn", template: "stone", overrides: { name: "pebble", location: x, support: x } },
    { kind: "spawn", template: "stone", overrides: { name: "pebble", location: "e1", contained_in: x } },
    { kind: "spawn", template: "stone", overrides: { name: "pebble", location: "e1", support: "e1", concealed_by: x } },
    { kind: "remove", target: x },
    { kind: "place", target: x, support: "e1" },
    { kind: "place", target: "e5", support: x },
    { kind: "place", target: "e5", contained_in: x },
    { kind: "place", target: "e5", concealed_by: x },
    { kind: "place", target: "e5", pos: { anchor: x, dx: 1, dy: 1 } },
    { kind: "set_props", target: x, props: {} },
    { kind: "update_props", target: x, props: { lit: true } },
    { kind: "set_part", target: x, part: "head", state: { integrity: 1, status: "damaged" } },
    { kind: "schedule_beat", id: "later", at_tick: 5, action: { kind: "remove", target: x } },
    { kind: "cancel_beat", id: x },
  ];
}

// Each probe runs against `x`, and the same probe against the id nothing has.
function probes(world: World, x: string): Array<[string, () => unknown]> {
  const ann = world.id("ann")!;
  const rows: Array<[string, () => unknown]> = [
    ["observe", () => world.observe(x)],
    ["observe as ann", () => world.observe(ann, { since: 0 })],
    ["inspect observer", () => world.inspect(x, ann)],
    ["inspect entity", () => world.inspect(ann, x)],
    ["inspect part", () => world.inspect(ann, `${x}.hand_l`)],
    ["options", () => world.options(x)],
    ["options refused", () => world.options(x, { refused: true })],
    ["entity", () => world.entity(x)],
    ["id", () => world.id(x)],
    ["actorWorld", () => actorWorld(world, x)],
    ["fact subject", () => world.query({ kind: "fact", subject: x, relation: "support" })],
    ["fact part", () => world.query({ kind: "fact", subject: `${x}.hand_l`, relation: "status" })],
    ["fact object", () => world.query({ kind: "fact", subject: ann, relation: "near", object: x })],
    ["fact reachable", () => world.query({ kind: "fact", subject: ann, relation: "reachable", object: x })],
    ["perceive observer", () => world.query({ kind: "perceive", observer: x, entity: ann, sense: "sight" })],
    ["perceive entity", () => world.query({ kind: "perceive", observer: ann, entity: x, sense: "sight" })],
    ["perceive event", () => world.query({ kind: "perceive", observer: ann, event_id: x, sense: "hearing" })],
    ["perceive event observer", () => world.query({ kind: "perceive", observer: x, event_id: "ev1", sense: "hearing" })],
    ["trace entity", () => world.trace({ entity: x, field: "pos" })],
    ["trace event", () => world.trace({ event_id: x })],
  ];
  commands(ann, x).forEach((command, index) => {
    const label = `${command.verb} ${command.actor === x ? "actor" : (command.target ?? "")} ${canonicalJson(command.args ?? null)}`;
    rows.push([`command ${label}`, () => verdict(world.command(ordered(world, command, index)))]);
    rows.push([`check ${label}`, () => world.check(ordered(world, command, index))]);
  });
  edits(x).forEach((edit, index) => {
    rows.push([`edit ${edit.kind} ${index}`, () => verdict(world.edit(edit, { command_id: `edit-probe-${index}` }))]);
  });
  return rows.map(([label, run]) => [label.replaceAll(x, "X"), run]);
}

test("a name spelt like an Object member gets what an absent id gets, everywhere an id, template or name goes in", (t) => {
  // Every submission to a store world writes a log line, so it is asked with two of the names; the
  // memory world, which has the same lookups without the files, with all five.
  for (const [index, world] of worlds(t).entries()) {
    for (const name of index === 0 ? NAMES.slice(0, 2) : NAMES) {
      const bad = probes(world, name);
      const good = probes(world, ABSENT);
      deepStrictEqual(
        bad.map(([label]) => label),
        good.map(([label]) => label),
      );
      bad.forEach(([label, run], row) => {
        // Only a command or an edit can change a world.
        const writes = label.startsWith("command") || label.startsWith("edit");
        const read = (): string => (writes ? canonicalJson(world.snapshot()) : "");
        const start = read();
        const absent = outcome(good[row]![1]);
        const middle = read();
        const found = outcome(run);
        // Whatever the absent id did to the world, a name that is a member does the same: a `wait`
        // that listens for an id nothing has is accepted, and so is one that listens for `constructor`.
        strictEqual(read() === middle, middle === start, `${name}: ${label}: effect`);
        // A name spelt like a member is the absent id's twin; the absent id is not in the subject itself.
        strictEqual(found.replaceAll(name, ABSENT), absent, `${name}: ${label}`);
        ok(!found.startsWith("threw TypeError"), `${name}: ${label}: ${found}`);
      });
    }
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
    // Still a world one can look at and act in.
    const ann = world.id("ann")!;
    ok(world.observe(ann).entities.length > 0);
    ok(world.options(ann).ready.length > 0);
  }
});

test("entity and id answer null for a name that is a member, and a spawn of such a template is refused", (t) => {
  for (const world of worlds(t)) {
    for (const name of NAMES) {
      strictEqual(world.entity(name), null, name);
      strictEqual(world.id(name), null, name);
      strictEqual(world.edit({ kind: "spawn", template: name }).reason_code, "unknown_template", name);
      strictEqual(world.edit({ kind: "spawn", template: name }).status, "invalid", name);
    }
    ok(world.observe(world.id("ann")!).entities.length > 0);
    ok(world.options(world.id("ann")!).ready.length > 0);
  }
});

test("a scenario with such a template is refused as one with an unknown template is", (t) => {
  // By its message too: both are the spawn's own error, not some other throw that happens to share a type.
  const refusal = (template: string): string => {
    try {
      createWorld(join(tempDir(t), template), [{ template }], registry);
      return "built";
    } catch (error) {
      return `${error instanceof WorldError ? error.code : (error as Error).constructor.name}: ${(error as Error).message}`;
    }
  };
  for (const name of NAMES) {
    notStrictEqual(refusal(name), "built", name);
    strictEqual(refusal(name).replaceAll(name, "nonesuch"), refusal("nonesuch"), name);
  }
});

test("a scenario may name an entity __proto__ or constructor, and refer to it", (t) => {
  for (const name of NAMES) {
    const named: Scenario = [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: name, template: "table", overrides: { name: "table", ...at(30) } },
      { id: "cup", template: "cup", overrides: { name: "cup", location: "hall", support: name } },
    ];
    for (const world of [createWorld(join(tempDir(t), name), named, registry), memoryWorld(createWorld(join(tempDir(t), `${name}-2`), named, registry).snapshot(), registry)]) {
      const snapshot = world.snapshot();
      deepStrictEqual(Object.keys(snapshot.entities).sort(), ["e1", "e2", "e3"]);
      strictEqual(snapshot.entities.e3?.support, "e2", name);
      deepStrictEqual(validateSnapshot(snapshot, registry), []);
    }
    const dir = join(tempDir(t), `${name}-3`);
    const store = createWorld(dir, named, registry);
    strictEqual(store.id(name), "e2", name);
    // The names are written beside the world, and a handle opened later reads them back.
    strictEqual(openWorld(dir).id(name), "e2", name);
    strictEqual(store.entity("e2")?.name, "table");
    strictEqual(store.id("hall"), "e1");
  }
});

test("the CLI answers such a name as it answers an absent id, never an internal error", (t) => {
  const dir = join(tempDir(t), "w");
  createWorld(dir, scenario, registry);
  const ask = (request: unknown): string => {
    const run = cli(JSON.stringify(request));
    ok(!run.stdout.includes("internal_error"), run.stdout);
    return run.stdout;
  };
  for (const name of NAMES) {
    const requests = (x: string): unknown[] => [
      { op: "observe", world: dir, observer: x },
      { op: "inspect", world: dir, observer: "e3", entity: x },
      { op: "inspect", world: dir, observer: x, entity: "e3" },
      { op: "options", world: dir, actor: x },
      { op: "query", world: dir, query: { kind: "perceive", observer: x, entity: "e3", sense: "sight" } },
      { op: "query", world: dir, query: { kind: "fact", subject: x, relation: "support" } },
      { op: "command", world: dir, command: { command_id: "c1", actor: x, verb: "wait", args: { ticks: 1 } } },
      { op: "command", world: dir, command: { command_id: "c2", actor: "e3", verb: "take", target: x } },
      { op: "edit", world: dir, edit: { kind: "spawn", template: x } },
      { op: "edit", world: dir, edit: { kind: "place", target: "e5", support: x } },
      { op: "actor_observe", world: dir, actor: x },
    ];
    const bad = requests(name);
    const good = requests(ABSENT);
    bad.forEach((request, index) => {
      // A logged edit takes the next default id, so the two asks differ only there.
      const same = (text: string): string => text.replace(/edit-[0-9]+/g, "edit-N");
      strictEqual(same(ask(request).replaceAll(name, ABSENT)), same(ask(good[index])), `${name}: ${canonicalJson(request)}`);
    });
  }
});

test("validateSnapshot refuses an entity of a template the registry does not own, and a reference to a name that is no entity", (t) => {
  const snapshot = createWorld(join(tempDir(t), "w"), scenario, registry).snapshot();
  const codes = (changed: Record<string, unknown>): string[] =>
    validateSnapshot(
      { ...snapshot, entities: { ...snapshot.entities, e5: { ...snapshot.entities.e5!, ...changed } } },
      registry,
    ).map((issue) => issue.code);
  deepStrictEqual(codes({}), []);
  for (const name of [...NAMES, "nonesuch"]) {
    ok(codes({ template: name }).includes("unknown_template"), `template ${name}`);
    for (const field of ["support", "contained_in", "location", "concealed_by"]) {
      ok(codes({ [field]: name }).includes("dangling_reference"), `${field} ${name}`);
    }
  }
  // The same two refusals when a world is built from such a snapshot.
  for (const name of NAMES) {
    const bad = { ...snapshot, entities: { ...snapshot.entities, e5: { ...snapshot.entities.e5!, template: name } } };
    strictEqual(outcome(() => memoryWorld(bad, registry)), "threw invalid_snapshot", name);
  }
});
