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
  // A verb that cannot be judged without args says so, once and sorted, and is neither ready nor blocked.
  for (const verb of ["give", "put", "move", "say", "wait"]) {
    ok(options.needs_args.includes(verb), verb);
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
  for (const entry of asked.ready) {
    const verdict = world.check({ command_id: "probe", actor: ann, verb: entry.verb, ...(entry.target === undefined ? {} : { target: entry.target }) });
    strictEqual(verdict.status, "ok", `${entry.verb} ${entry.target}`);
  }
  for (const entry of asked.blocked ?? []) {
    const verdict = world.check({ command_id: "probe", actor: ann, verb: entry.verb, ...(entry.target === undefined ? {} : { target: entry.target }) });
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
    give: { status: "invalid", reason_code: "invalid_args" },
    attack: { status: "invalid", reason_code: "invalid_attack_target" },
    push: { status: "unresolved" },
    pull: { status: "ambiguous" },
    open: { status: "preempted" },
  };
  const dry = (command: Command): Result => (verdicts[command.verb] ?? { status: "refused", reason_code: "other" }) as Result;
  const listed = listOptions(world.snapshot(), registry, ann, { refused: true }, dry);
  deepStrictEqual(listed.ready.filter((entry) => entry.target === stone).map((entry) => entry.verb), ["take"]);
  deepStrictEqual(listed.needs_args, ["give"]);
  const at = (verb: string) => listed.blocked?.find((entry) => entry.verb === verb && entry.target === stone);
  deepStrictEqual(at("drop")?.reason_code, "not_carried");
  deepStrictEqual(at("attack")?.reason_code, "invalid_attack_target");
  deepStrictEqual(at("push")?.reason_code, "unresolved");
  deepStrictEqual(at("pull")?.reason_code, "ambiguous");
  deepStrictEqual(at("open")?.reason_code, "preempted");
});
