import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { OptionsResponseSchema } from "../src/contract.js";
import type { Command, Result } from "../src/engine/command.js";
import { listOptions } from "../src/options.js";
import { defaultCoverage } from "../src/model.js";
import { loadTemplates } from "../src/templates.js";
import {
  actorWorld,
  canonicalJson,
  createWorld,
  memoryWorld,
  WORLD_AUTHOR,
  WorldError,
  type Id,
  type Options,
  type Scenario,
  type World,
  verbs,
} from "../src/index.js";

// What an actor can try now, from a dry run of every verb against everything it could name: the
// commands that would be accepted, the verbs that need args to be judged at all, and with `refused`
// the ones that would be refused and why. A read: nothing is logged and nothing changes.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-options-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ann with a stone, a lantern and a shut chest within her reach, a second stone far across the hall,
// a book hiding a note beside her, an anchor (a mark, not a thing) at her side, and bob; the hall lit or not.
function hall(lit: boolean): Scenario {
  const at = (x: number, y = 0) => ({ location: "hall", support: "hall", pos: { x, y } });
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit } } },
    { id: "ann", template: "human", overrides: { name: "ann", ...at(0) } },
    { id: "bob", template: "human", overrides: { name: "bob", ...at(0, 60) } },
    { id: "stone", template: "stone", overrides: { name: "stone", ...at(30) } },
    { id: "lantern", template: "lantern", overrides: { name: "lantern", ...at(-30) } },
    {
      id: "chest",
      template: "chest",
      overrides: {
        name: "chest",
        ...at(0, -40),
        props: { container: true, openable: true, open: false, inner_w_cm: 55, inner_d_cm: 35, inner_h_cm: 35 },
      },
    },
    { id: "far", template: "stone", overrides: { name: "far", ...at(600) } },
    { id: "book", template: "book", overrides: { name: "book", ...at(-30, 30) } },
    { id: "note", template: "note", overrides: { name: "note", ...at(-30, 30), concealed_by: "book" } },
    { id: "mark", template: "anchor", overrides: { name: "mark", ...at(10) } },
    { id: "pebble", template: "stone", overrides: { name: "pebble", ...at(45, -20) } },
  ];
}

interface Hall {
  world: World;
  id: (name: string) => Id;
}

function open(t: { after(callback: () => void): void }, lit: boolean): Hall {
  const world = createWorld(join(tempDir(t), "hall"), hall(lit), undefined, { seed: 11 });
  return {
    world,
    id: (name) => {
      const found = world.id(name);
      ok(found !== null, name);
      return found;
    },
  };
}

const has = (options: Options, verb: string, target?: Id): boolean =>
  options.ready.some((entry) => entry.verb === verb && entry.target === target);

test("in a lit room: what is in reach is ready, what is far is blocked and absent unless asked for", (t) => {
  const { world, id } = open(t, true);
  const ann = id("ann");
  const options = world.options(ann);
  strictEqual(options.actor, ann);
  strictEqual(options.version, world.snapshot().version);
  ok(has(options, "take", id("stone")));
  ok(has(options, "open", id("chest")));
  ok(has(options, "light", id("lantern")));
  // A thing far off and a thing hiding are not ready; only the one it can tell is there can be refused.
  strictEqual(has(options, "take", id("far")), false);
  strictEqual(has(options, "take", id("note")), false);
  strictEqual("blocked" in options, false);

  const asked = world.options(ann, { refused: true });
  deepStrictEqual(asked.ready, options.ready);
  deepStrictEqual(asked.needs_args, options.needs_args);
  deepStrictEqual(
    asked.blocked?.filter((entry) => entry.verb === "take" && entry.target === id("far")),
    [{ verb: "take", target: id("far"), reason_code: "out_of_reach" }],
  );
  // A hidden thing is no more refused than it is ready: nothing here names the note, lit or not.
  strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.target === id("note")), false);
  // An anchor is a mark nothing can act on, so it is not offered, however near.
  strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.target === id("mark")), false);
  // The actor is not its own target.
  strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.target === ann), false);
  // A verb that takes args no list holds says so, once and sorted, and is neither ready nor blocked
  // without them; one whose args are all listed (give, put) does not, and nothing here is held to give.
  for (const verb of ["move", "pour", "say", "wait"]) {
    ok(options.needs_args.includes(verb), verb);
    strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.verb === verb && entry.args === undefined), false, verb);
  }
  for (const verb of ["give", "put"]) {
    strictEqual(options.needs_args.includes(verb), false, verb);
    strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.verb === verb), false, verb);
  }
  deepStrictEqual(options.needs_args, [...new Set(options.needs_args)].sort());
  // The author's verbs are no agent's to try.
  for (const verb of ["edit", "advance"]) {
    strictEqual(options.needs_args.includes(verb), false);
    strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.verb === verb), false);
  }
});

test("options are sorted by verb and then by target", (t) => {
  const { world, id } = open(t, true);
  const asked = world.options(id("ann"), { refused: true });
  for (const list of [asked.ready, asked.blocked ?? []]) {
    const keys = list.map((entry) => `${entry.verb}\u0000${entry.target ?? ""}`);
    deepStrictEqual(keys, [...keys].sort());
  }
  ok(asked.ready.length > 3 && (asked.blocked?.length ?? 0) > 3);
});

test("in the dark: what the actor can only grope for is offered, what is out of reach is not even refused", (t) => {
  const { world, id } = open(t, false);
  const ann = id("ann");
  const asked = world.options(ann, { refused: true });
  ok(has(asked, "take", id("stone")));
  const named = new Set([...asked.ready, ...(asked.blocked ?? [])].map((entry) => entry.target));
  strictEqual(named.has(id("far")), false);
  strictEqual(named.has(id("note")), false);
  ok(has(asked, "take", id("book")), "a book in reach is groped for");
  // The same actor in the light is offered the far stone as out of reach, and so can tell it is there.
  strictEqual(world.edit({ kind: "set_props", target: id("hall"), props: { lit: true } }).status, "ok");
  const lit = world.options(ann, { refused: true });
  ok(lit.blocked?.some((entry) => entry.target === id("far") && entry.reason_code === "out_of_reach"));
});

test("a destroyed body, a thing that is no agent and an unknown actor", (t) => {
  const { world, id } = open(t, true);
  const snapshot = world.snapshot();
  const ann = id("ann");
  const fallen = memoryWorld(
    { ...snapshot, entities: { ...snapshot.entities, [ann]: { ...snapshot.entities[ann]!, integrity: 0, status: "destroyed" } } },
    undefined,
    { ann },
  );
  deepStrictEqual(fallen.options(ann, { refused: true }), {
    actor: ann,
    version: snapshot.version,
    ready: [],
    needs_args: [],
    blocked: [],
  });
  deepStrictEqual(world.options(id("stone")), { actor: id("stone"), version: snapshot.version, ready: [], needs_args: [] });
  for (const actor of ["e999", WORLD_AUTHOR]) {
    throws(() => world.options(actor), (error: unknown) => error instanceof WorldError && error.code === "no_such_entity");
  }
});

test("every ready option is accepted, every refused one is refused as listed, and a read writes nothing", (t) => {
  const { world, id } = open(t, true);
  const ann = id("ann");
  const before = canonicalJson(world.snapshot());
  const submissions = world.attempts(0).length;
  const asked = world.options(ann, { refused: true });
  strictEqual(canonicalJson(world.snapshot()), before);
  strictEqual(world.attempts(0).length, submissions);
  const probe = (entry: { verb: string; target?: Id; args?: Record<string, unknown> }) =>
    world.check({
      command_id: "probe",
      actor: ann,
      verb: entry.verb,
      ...(entry.target === undefined ? {} : { target: entry.target }),
      ...(entry.args === undefined ? {} : { args: entry.args }),
    });
  for (const entry of asked.ready) {
    strictEqual(probe(entry).status, "ok", `${entry.verb} ${entry.target}`);
  }
  for (const entry of asked.blocked ?? []) {
    const verdict = probe(entry);
    strictEqual(verdict.reason_code ?? verdict.status, entry.reason_code, `${entry.verb} ${entry.target}`);
  }
  // A verb that needs a target is asked of one, as the listing asked it.
  for (const verb of asked.needs_args) {
    const target = verbs().find((entry) => entry.verb === verb)?.requires_target === true ? { target: id("stone") } : {};
    const verdict = world.check({ command_id: "probe", actor: ann, verb, ...target });
    strictEqual(verdict.reason_code, "invalid_args", verb);
  }
  // And one of them, done for real, is accepted and changes the world.
  const take = world.command({ command_id: "do-take", actor: ann, verb: "take", target: id("stone") });
  strictEqual(take.status, "ok");
  const after = world.options(ann);
  strictEqual(after.version, take.snapshot.version);
  // It is in her hand now, so she can put it down; not before.
  ok(has(after, "drop", id("stone")));
  strictEqual(has(asked, "drop", id("stone")), false);
});

test("a store world, a reopened one and a memory world answer alike", (t) => {
  const { world, id } = open(t, true);
  const ann = id("ann");
  const names = Object.fromEntries(hall(true).map((entry) => [entry.id ?? "", id(entry.id ?? "")]));
  const memory = memoryWorld(world.snapshot(), undefined, names);
  const expected = canonicalJson(world.options(ann, { refused: true }));
  strictEqual(canonicalJson(memory.options(ann, { refused: true })), expected);
  strictEqual(canonicalJson(world.fork().options(ann, { refused: true })), expected);
  // A stored snapshot has its keys sorted as strings (e1, e10, e2); one built in memory has them in
  // the order things were made (e1, e2, ... e10). The listing is the same either way.
  const snapshot = world.snapshot();
  const numeric = Object.fromEntries(
    Object.entries(snapshot.entities).sort(([left], [right]) => Number(left.slice(1)) - Number(right.slice(1))),
  );
  deepStrictEqual(Object.keys(numeric).slice(0, 3), ["e1", "e2", "e3"]);
  strictEqual(canonicalJson(memoryWorld({ ...snapshot, entities: numeric }, undefined, names).options(ann, { refused: true })), expected);
});

test("an actor's own view offers the same options", (t) => {
  const { world, id } = open(t, false);
  const ann = id("ann");
  deepStrictEqual(actorWorld(world, ann).options({ refused: true }), world.options(ann, { refused: true }));
  deepStrictEqual(actorWorld(world, ann).options(), world.options(ann));
});

test("the CLI's options op answers what the library does, and the contract holds it", (t) => {
  const dir = join(tempDir(t), "hall");
  const world = createWorld(dir, hall(true), undefined, { seed: 11 });
  const ann = world.id("ann")!;
  const cli = (request: object): unknown => {
    const run = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      input: JSON.stringify(request),
    });
    // A request the contract refuses exits 2 with its issues on stdout.
    ok(run.status === 0 || run.status === 2, run.stderr);
    return JSON.parse(run.stdout) as unknown;
  };
  const plain = OptionsResponseSchema.parse(cli({ op: "options", world: dir, actor: ann }));
  deepStrictEqual(plain, world.options(ann));
  const asked = OptionsResponseSchema.parse(cli({ op: "options", world: dir, actor: ann, refused: true }));
  deepStrictEqual(asked, world.options(ann, { refused: true }));
  const missing = cli({ op: "options", world: dir, actor: "e999" }) as { status: string; issues: Array<{ code: string }> };
  strictEqual(missing.status, "invalid");
  strictEqual(missing.issues[0]?.code, "no_such_entity");
  strictEqual((cli({ op: "options", world: dir }) as { status: string }).status, "invalid");
});

test("the dry run's verdicts are sorted: ok is ready, invalid_args needs args, anything else is blocked", (t) => {
  const { world, id } = open(t, true);
  const ann = id("ann");
  const stone = id("stone");
  const verdicts: Record<string, Partial<Result>> = {
    take: { status: "ok" },
    drop: { status: "refused", reason_code: "not_carried" },
    say: { status: "invalid", reason_code: "invalid_args" },
    attack: { status: "invalid", reason_code: "invalid_attack_target" },
    push: { status: "unresolved" },
    pull: { status: "ambiguous" },
    open: { status: "preempted" },
  };
  const dry = (command: Command): Result => (verdicts[command.verb] ?? { status: "refused", reason_code: "other" }) as Result;
  const listed = listOptions(world.snapshot(), registry, ann, { refused: true }, dry);
  deepStrictEqual(listed.ready.filter((entry) => entry.target === stone).map((entry) => entry.verb), ["take"]);
  deepStrictEqual(listed.needs_args, ["say"]);
  const at = (verb: string) => listed.blocked?.find((entry) => entry.verb === verb && entry.target === stone);
  deepStrictEqual(at("drop")?.reason_code, "not_carried");
  deepStrictEqual(at("attack")?.reason_code, "invalid_attack_target");
  deepStrictEqual(at("push")?.reason_code, "unresolved");
  deepStrictEqual(at("pull")?.reason_code, "ambiguous");
  deepStrictEqual(at("open")?.reason_code, "preempted");
});

// ann in the hall holding a stone and a bottle of wine, bob beside her, a table, an open chest and a
// shut one, an open door to the yard and one beyond it to the cellar, a note hiding under a book.
// She can name the yard, not the cellar, and not the note.
function house(): Scenario {
  const at = (x: number, y = 0, room = "hall") => ({ location: room, support: room, pos: { x, y } });
  const room = (name: string) => ({ id: name, template: "room", overrides: { name, props: { lit: true } } });
  const door = (name: string, from: string, to: string) => ({
    id: name,
    template: "door",
    overrides: { name, props: { openable: true, open: true, from, to } },
  });
  const chest = (name: string, x: number, open: boolean) => ({
    id: name,
    template: "chest",
    overrides: {
      name,
      ...at(x, 40),
      props: { container: true, openable: true, open, inner_w_cm: 55, inner_d_cm: 35, inner_h_cm: 35 },
    },
  });
  return [
    room("hall"),
    room("yard"),
    room("cellar"),
    door("gate", "hall", "yard"),
    door("hatch", "yard", "cellar"),
    { id: "ann", template: "human", overrides: { name: "ann", ...at(0) } },
    { id: "bob", template: "human", overrides: { name: "bob", ...at(0, 60) } },
    { id: "stone", template: "stone", overrides: { name: "stone", ...at(30) } },
    { id: "flask", template: "bottle", overrides: { name: "flask", ...at(30, 30) } },
    { id: "table", template: "table", overrides: { name: "table", ...at(0, -60) } },
    chest("open_chest", 40, true),
    chest("shut_chest", -40, false),
    { id: "book", template: "book", overrides: { name: "book", ...at(-30, 30) } },
    { id: "note", template: "note", overrides: { name: "note", ...at(-30, 30), concealed_by: "book" } },
    { id: "rat", template: "stone", overrides: { name: "rat", ...at(0, 0, "cellar") } },
  ];
}

// The house with ann holding the stone and the flask.
function holding(t: { after(callback: () => void): void }): Hall & { dir: string } {
  const dir = join(tempDir(t), "house");
  const world = createWorld(dir, house(), undefined, { seed: 11 });
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  for (const name of ["stone", "flask"]) {
    const taken = world.command({ command_id: `take-${name}`, actor: id("ann"), verb: "take", target: id(name) });
    strictEqual(taken.status, "ok", name);
  }
  return { world, id, dir };
}

type Entry = { verb: string; target?: Id; args?: Record<string, unknown> };

test("give, put, move and pour name the arguments they can, and only ones the actor could already name", (t) => {
  const { world, id } = holding(t);
  const ann = id("ann");
  const stone = id("stone");
  const flask = id("flask");
  const asked = world.options(ann, { refused: true });
  const argsOf = (verb: string, target: Id) =>
    asked.ready.filter((entry) => entry.verb === verb && entry.target === target).map((entry) => entry.args);

  // give: each agent she can name but herself, for what is in her hand.
  deepStrictEqual(argsOf("give", stone), [{ destination: id("bob") }]);
  strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.verb === "give" && entry.target === id("table")), false);
  // put: on each surface, in each container, then in her own pocket; the shut chest is refused, and
  // the pocket is too small for a stone, each with its code.
  deepStrictEqual(argsOf("put", stone), [
    { relation: "on", destination: id("table") },
    { relation: "in", destination: id("open_chest") },
  ]);
  deepStrictEqual(
    asked.blocked?.filter((entry) => entry.verb === "put" && entry.target === stone),
    [
      { verb: "put", target: stone, args: { relation: "in", destination: id("shut_chest") }, reason_code: "container_closed" },
      { verb: "put", target: stone, args: { relation: "in", destination: `${ann}.pocket` }, reason_code: "too_large" },
    ],
  );
  // move: the yard through its open door, not the cellar behind it, and not the room she stands in.
  deepStrictEqual(asked.ready.filter((entry) => entry.verb === "move"), [{ verb: "move", args: { location: id("yard") } }]);
  // pour: the whole of the wine onto what could take it; a stone has none to pour.
  deepStrictEqual(
    argsOf("pour", flask),
    [id("hall"), id("open_chest"), id("table")].sort().map((destination) => ({ destination, amount: 75 })),
  );
  strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.verb === "pour" && entry.target === stone), false);
  // What no list can hold stays named; give and put are not, since their args are all listed.
  deepStrictEqual(asked.needs_args, ["move", "pour", "say", "wait"]);
  // Nothing she could not name is ever an argument: not the cellar, the rat in it, or the hidden note.
  const offered = [...asked.ready, ...(asked.blocked ?? [])].flatMap((entry) =>
    Object.values(entry.args ?? {}).filter((value): value is string => typeof value === "string"),
  );
  for (const hidden of ["cellar", "rat", "note"]) {
    strictEqual(offered.some((value) => value.split(".")[0] === id(hidden)), false, hidden);
  }
  // Ready and blocked are apart, args included, and every door answers alike.
  const key = (entry: Entry) => canonicalJson({ verb: entry.verb, target: entry.target, args: entry.args });
  const ready = new Set(asked.ready.map(key));
  strictEqual((asked.blocked ?? []).some((entry) => ready.has(key(entry))), false);
  const expected = canonicalJson(asked);
  strictEqual(canonicalJson(world.fork().options(ann, { refused: true })), expected);
  strictEqual(canonicalJson(actorWorld(world, ann).options({ refused: true })), expected);
  deepStrictEqual(OptionsResponseSchema.parse(JSON.parse(expected)), asked);
});

test("every suggestion check accepts is ready, every other is blocked with its code, and each ready one is done for real", (t) => {
  const { world, id } = holding(t);
  const ann = id("ann");
  const asked = world.options(ann, { refused: true });
  const command = (entry: Entry) => ({
    command_id: "probe",
    actor: ann,
    verb: entry.verb,
    ...(entry.target === undefined ? {} : { target: entry.target }),
    args: entry.args,
  });
  const ready = asked.ready.filter((entry) => entry.args !== undefined);
  const blocked = (asked.blocked ?? []).filter((entry) => entry.args !== undefined);
  ok(ready.length >= 8 && blocked.length >= 3, `${ready.length} ready and ${blocked.length} blocked carry args`);
  for (const entry of ready) {
    strictEqual(world.check(command(entry)).status, "ok", canonicalJson(entry));
    // On a copy, so each starts from the same world.
    strictEqual(world.fork().command(command(entry)).status, "ok", canonicalJson(entry));
  }
  for (const entry of blocked) {
    const verdict = world.check(command(entry));
    strictEqual(verdict.reason_code ?? verdict.status, entry.reason_code, canonicalJson(entry));
  }
});

test("an actor holding nothing is offered no arguments but a room; on a table she can step down", (t) => {
  const { world, id } = open(t, true);
  const asked = world.options(id("ann"), { refused: true });
  strictEqual([...asked.ready, ...(asked.blocked ?? [])].some((entry) => entry.args !== undefined), false);

  const house = holding(t);
  const ann = house.id("ann");
  // Ready or refused, a move to a room is suggested; the room she stands on the floor of is not.
  const moves = () => {
    const asked = house.world.options(ann, { refused: true });
    return [...asked.ready, ...(asked.blocked ?? [])].filter((entry) => entry.verb === "move").map((entry) => entry.args?.location).sort();
  };
  deepStrictEqual(moves(), [house.id("yard")]);
  const placed = house.world.edit({ kind: "place", target: ann, support: house.id("table"), pos: null });
  strictEqual(placed.status, "ok");
  deepStrictEqual(moves(), [house.id("hall"), house.id("yard")].sort());
});

test("the CLI's options op carries the arguments the library suggests", (t) => {
  const { world, id, dir } = holding(t);
  const ann = id("ann");
  const run = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
    input: JSON.stringify({ op: "options", world: dir, actor: ann, refused: true }),
  });
  strictEqual(run.status, 0, run.stderr);
  deepStrictEqual(OptionsResponseSchema.parse(JSON.parse(run.stdout)), world.options(ann, { refused: true }));
});

test("a verb with suggestions is tried with each one, and one that also takes free args stays named", (t) => {
  const { world, id } = holding(t);
  const bob = id("bob");
  const dry = (command: Command): Result => {
    const bare = command.args === undefined;
    if (command.verb === "give" || command.verb === "move") {
      return bare ? ({ status: "invalid", reason_code: "invalid_args" } as Result) : ({ status: command.args!.destination === bob ? "ok" : "refused", reason_code: "other" } as Result);
    }
    return { status: "refused", reason_code: "other" } as Result;
  };
  const listed = listOptions(world.snapshot(), registry, id("ann"), { refused: true }, dry);
  deepStrictEqual(
    listed.ready,
    [id("flask"), id("stone")].sort().map((target) => ({ verb: "give", target, args: { destination: bob } })),
  );
  // give lists all it takes; move also takes a position, so it stays named.
  deepStrictEqual(listed.needs_args, ["move"]);
  deepStrictEqual(
    listed.blocked?.filter((entry) => entry.verb === "move"),
    [{ verb: "move", args: { location: id("yard") }, reason_code: "other" }],
  );
});

const BODY = ["head", "torso", "arm_l", "hand_l", "thumb_l", "arm_r", "hand_r", "thumb_r", "pocket"];

test("a body shows its parts, and attack is offered at each part that is still on it", (t) => {
  const { world, id } = open(t, true);
  const ann = id("ann");
  const bob = id("bob");
  const shown = world.inspect(ann, bob)?.parts;
  deepStrictEqual(shown?.map((part) => part.name), BODY);
  ok(shown?.every((part) => part.status === "intact" && typeof part.integrity === "number"));

  const aimed = (list: Array<{ verb: string; target?: Id }> | undefined) =>
    (list ?? []).filter((entry) => entry.verb === "attack" && entry.target?.startsWith(`${bob}.`)).map((entry) => entry.target);
  const asked = world.options(ann, { refused: true });
  deepStrictEqual([...aimed(asked.ready), ...aimed(asked.blocked)].sort(), BODY.map((name) => `${bob}.${name}`).sort());
  ok(has(asked, "attack", bob), "the whole body is still offered");
  // Each part is an address a command accepts, and a ready one is done for real.
  for (const target of aimed(asked.ready)) {
    strictEqual(world.check({ command_id: "probe", actor: ann, verb: "attack", target }).status, "ok", target);
  }

  // Three blows at his right arm take it off, and the hand and thumb on it.
  for (const blow of [0, 1, 2]) {
    strictEqual(world.command({ command_id: `cut-${blow}`, actor: ann, verb: "attack", target: `${bob}.arm_r` }).status, "ok");
  }
  const after = world.inspect(ann, bob)?.parts;
  deepStrictEqual(
    after?.filter((part) => part.status === "detached").map((part) => part.name),
    ["arm_r", "hand_r", "thumb_r"],
  );
  const left = world.options(ann, { refused: true });
  deepStrictEqual(
    [...aimed(left.ready), ...aimed(left.blocked)].sort(),
    BODY.filter((name) => !["arm_r", "hand_r", "thumb_r"].includes(name)).map((name) => `${bob}.${name}`).sort(),
  );
});

test("in the dark ann feels her own parts and none of bob's; a world that does not cover status shows none", (t) => {
  const touching = { ...defaultCoverage(), senses: ["sight", "hearing", "touch"] };
  const dark = createWorld(join(tempDir(t), "dark"), hall(false), undefined, { seed: 11, coverage: touching });
  const ann = dark.id("ann")!;
  const bob = dark.id("bob")!;
  strictEqual(dark.inspect(ann, ann)?.parts?.length, BODY.length);
  strictEqual(dark.inspect(ann, bob), null);
  const named = (options: Options) => [...options.ready, ...(options.blocked ?? [])].filter((entry) => entry.target?.includes("."));
  deepStrictEqual(named(dark.options(ann, { refused: true })).filter((entry) => entry.target?.startsWith(`${bob}.`)), []);

  const unsaid = { ...defaultCoverage(), relations: defaultCoverage().relations.filter((relation) => relation !== "status") };
  const lit = createWorld(join(tempDir(t), "lit"), hall(true), undefined, { seed: 11, coverage: unsaid });
  const body = lit.inspect(lit.id("ann")!, lit.id("bob")!);
  ok(body !== null);
  strictEqual(body.parts, undefined);
  deepStrictEqual(named(lit.options(lit.id("ann")!, { refused: true })), []);
});

test("a blow at what is destroyed already is refused, whole or part, and options lists it as blocked", (t) => {
  const { world, id } = open(t, true);
  const ann = id("ann");
  const bob = id("bob");
  const stone = id("stone");
  let blows = 0;
  const blow = (target: string) => world.command({ command_id: `blow-${(blows += 1)}`, actor: ann, verb: "attack", target });
  const asks = (target: string) =>
    world.options(ann, { refused: true }).blocked?.filter((entry) => entry.verb === "attack" && entry.target === target);

  // A stone takes three fists; the third destroys it, and a fourth is refused with nothing emitted.
  for (const target of [stone, `${bob}.torso`]) {
    for (let index = 0; index < 3; index += 1) {
      strictEqual(blow(target).status, "ok", `${target} ${index}`);
    }
    const before = canonicalJson(world.snapshot());
    const again = blow(target);
    deepStrictEqual([again.status, again.reason_code, again.events, again.deltas], ["refused", "already_destroyed", [], []]);
    strictEqual(canonicalJson(world.snapshot()), before);
    deepStrictEqual(asks(target), [{ verb: "attack", target, reason_code: "already_destroyed" }]);
    strictEqual(has(world.options(ann), "attack", target), false);
  }
  strictEqual(world.entity(stone)?.status, "destroyed");
  // A part under a destroyed one (the pocket is sewn to the torso) is destroyed with it, and refused
  // alike; the whole body is a blow at its torso.
  for (const target of [`${bob}.pocket`, bob]) {
    const under = blow(target);
    deepStrictEqual([under.status, under.reason_code], ["refused", "already_destroyed"], target);
  }
  // What is whole is still struck: the other arm.
  strictEqual(blow(`${bob}.arm_r`).status, "ok");
});
