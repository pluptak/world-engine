import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, openWorld, WorldError, type Scenario, type World } from "../src/index.js";
import { traceQuery, VALID_ENTITY_FIELDS, type TraceQuery } from "../src/engine/trace.js";
import { verbRegistry } from "../src/engine/verbs/index.js";
import { readDeltas, replayWithEvents } from "../src/store/file-store.js";
import { loadTemplates, parseRegistry, templatesHash } from "../src/templates.js";
import { genStep, mulberry32, SCENARIO, SEED, withProcessFixtures } from "./property-gen.js";
import { tempDir } from "./harness.js";

// A store world keeps every accepted command's deltas in deltas.jsonl beside its events, so the
// history of a field is read, not replayed. The file is a cache of the log: with it missing, short,
// or never kept, the answer is the same, because the log rebuilds it.

const scenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "table", template: "table", overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } } },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "table" } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: -50, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "room", support: "room", pos: { x: -80, y: 0 } } },
];

interface Aged {
  dir: string;
  world: World;
  accepted: number;
  deltaCount: number;
  // The files as they stood one accepted command before the end.
  before: { head: string; snapshot: string };
}

// A short life with every kind of outcome: a push that breaks the bottle, a refusal, blows, an
// author's spawn and removal.
function aged(t: { after(callback: () => void): void }): Aged {
  const dir = join(tempDir(t), "w");
  const world = createWorld(dir, scenario, undefined, { seed: 7 });
  const ann = world.id("ann")!;
  const bob = world.id("bob")!;
  const room = world.id("room")!;
  const steps: Array<() => { status: string; deltas: unknown[] }> = [
    () => world.command({ command_id: "c1", actor: ann, verb: "push", target: "table" }),
    () => world.command({ command_id: "c2", actor: ann, verb: "take", target: "unicorn" }),
    () => world.command({ command_id: "c3", actor: ann, verb: "attack", target: "bob" }),
    () => world.command({ command_id: "c4", actor: ann, verb: "attack", target: "bob" }),
    () => world.command({ command_id: "c5", actor: bob, verb: "wait", args: { ticks: 3 } }),
    () => world.edit({ kind: "spawn", template: "stone", overrides: { name: "stone", location: room, support: room, pos: { x: 100, y: 0 } } }),
    () => world.command({ command_id: "c6", actor: bob, verb: "say", args: { utterance: "hi", volume: "normal" } }),
    () => world.edit({ kind: "remove", target: world.id("table")! }),
  ];
  let accepted = 0;
  let deltaCount = 0;
  const statuses: string[] = [];
  let before = { head: "", snapshot: "" };
  for (const [index, step] of steps.entries()) {
    if (index === steps.length - 1) {
      before = {
        head: readFileSync(join(dir, "head.json"), "utf8"),
        snapshot: readFileSync(join(dir, "snapshot.json"), "utf8"),
      };
    }
    const result = step();
    statuses.push(result.status);
    if (result.status === "ok") {
      accepted += 1;
      deltaCount += result.deltas.length;
    }
  }
  deepStrictEqual(statuses, ["ok", "unresolved", "ok", "ok", "ok", "ok", "ok", "ok"]);
  return { dir, world, accepted, deltaCount, before };
}

type Answer = string;

// What the replay of the log says about a trace: the chain as canonical JSON, or the refusal's code.
function replayAnswers(dir: string): (query: TraceQuery) => Answer {
  const folded = replayWithEvents(dir);
  return (query) => {
    try {
      if ("entity" in query) {
        const known =
          folded.snapshot.entities[query.entity] !== undefined ||
          folded.deltas.some((delta) => delta.entity === query.entity) ||
          folded.events.some((event) => event.entity === query.entity);
        if (!known) {
          throw new WorldError("no_such_entity", query.entity);
        }
      }
      return canonicalJson({ events: traceQuery(folded.events, folded.deltas, query) });
    } catch (error) {
      if (error instanceof WorldError) {
        return error.code;
      }
      throw error;
    }
  };
}

function storedAnswer(world: World, query: TraceQuery): Answer {
  try {
    return canonicalJson(world.trace(query));
  } catch (error) {
    if (error instanceof WorldError) {
      return error.code;
    }
    throw error;
  }
}

// Every entity the world has ever had, one that never was, every field and one that is none.
function queries(dir: string): TraceQuery[] {
  const folded = replayWithEvents(dir);
  const ids = new Set([
    ...Object.keys(folded.snapshot.entities),
    ...folded.deltas.map((delta) => delta.entity),
    "e999",
  ]);
  return [...ids].sort().flatMap((entity) => [...VALID_ENTITY_FIELDS, "nonsense"].map((field) => ({ entity, field })));
}

// How many verb transitions a call runs: a replay applies the log's commands one by one.
function counting<T>(call: () => T): { value: T; applied: number } {
  let applied = 0;
  const restore: Array<() => void> = [];
  for (const verb of verbRegistry.values()) {
    const original = verb.transition;
    verb.transition = (context) => {
      applied += 1;
      original(context);
    };
    restore.push(() => {
      verb.transition = original;
    });
  }
  try {
    return { value: call(), applied };
  } finally {
    restore.forEach((undo) => undo());
  }
}

function head(dir: string): { deltas_bytes?: number } & Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "head.json"), "utf8")) as { deltas_bytes?: number } & Record<string, unknown>;
}

const deltasFile = (dir: string): string => join(dir, "deltas.jsonl");

test("deltas.jsonl holds what the accepted commands changed, in order, and nothing a refusal did", (t) => {
  const { dir, accepted, deltaCount } = aged(t);
  ok(accepted > 0 && deltaCount > 10);
  const lines = readFileSync(deltasFile(dir), "utf8").split("\n").filter((line) => line.length > 0);
  strictEqual(lines.length, deltaCount);
  strictEqual(canonicalJson(readDeltas(dir)), canonicalJson(replayWithEvents(dir).deltas));
  strictEqual(head(dir).deltas_bytes, statSync(deltasFile(dir)).size);

  // A refusal and an invalid command leave the file as it was.
  const world = openWorld(dir);
  const size = statSync(deltasFile(dir)).size;
  strictEqual(world.command({ command_id: "nope", actor: world.id("ann")!, verb: "take", target: "unicorn" }).status, "unresolved");
  strictEqual(world.command({ command_id: "bad", actor: world.id("ann")!, verb: "wait", args: { ticks: -1 } }).status === "ok", false);
  strictEqual(statSync(deltasFile(dir)).size, size);
  strictEqual(head(dir).deltas_bytes, size);
});

test("the history of a field is answered as a replay of the log answers it", (t) => {
  const { dir } = aged(t);
  const expected = replayAnswers(dir);
  const world = openWorld(dir);
  const all = queries(dir);
  const seen = new Set<string>();
  for (const query of all) {
    const answer = storedAnswer(world, query);
    strictEqual(answer, expected(query), `${(query as { entity: string }).entity} ${(query as { field: string }).field}`);
    seen.add(answer.startsWith("{") ? (answer.includes('"events":[]') ? "empty" : "chain") : answer);
  }
  // The comparison reaches a chain, an empty answer and both refusals.
  deepStrictEqual([...seen].sort(), ["chain", "empty", "no_such_entity", "no_such_field"]);
});

test("a trace of a field runs no transition: nothing is replayed", (t) => {
  const dir = join(tempDir(t), "w");
  const world = createWorld(dir, scenario);
  for (let index = 0; index < 400; index += 1) {
    const result = world.command({
      command_id: `loop-${index}`,
      actor: world.id("ann")!,
      verb: index % 2 === 0 ? "take" : "drop",
      target: "bottle",
    });
    strictEqual(result.status, "ok");
  }
  const bottle = world.id("bottle")!;
  const expected = replayAnswers(dir);
  const query = (field: string): TraceQuery => ({ entity: bottle, field });
  const reopened = openWorld(dir);
  const run = counting(() => VALID_ENTITY_FIELDS.map((field) => storedAnswer(reopened, query(field))));
  strictEqual(run.applied, 0);
  deepStrictEqual(run.value, VALID_ENTITY_FIELDS.map((field) => expected(query(field))));
  ok(run.value.some((answer) => answer.startsWith('{"events":[{')));
  // The replay it replaces does apply the commands.
  ok(counting(() => replayAnswers(dir)).applied >= 400);
});

test("a second handle's commands reach a first handle's next trace", (t) => {
  const { dir, world } = aged(t);
  const bottle = world.id("bottle")!;
  const first = storedAnswer(world, { entity: bottle, field: "status" });
  const other = openWorld(dir);
  strictEqual(other.command({ command_id: "late", actor: other.id("bob")!, verb: "attack", target: "ann" }).status, "ok");
  const expected = replayAnswers(dir);
  for (const query of queries(dir)) {
    strictEqual(storedAnswer(world, query), expected(query));
  }
  ok(first.length > 0);
});

// The files a crash or an older engine can leave, each opened by a fresh handle that had already read
// the file whole: the answers are the replay's, and the head says what the file now holds.
function reopened(
  t: { after(callback: () => void): void },
  base: Aged,
  damage: (copy: string) => void,
): { applied: number; copy: string } {
  const copy = join(tempDir(t), "copy");
  cpSync(base.dir, copy, { recursive: true });
  const expected = replayAnswers(base.dir);
  const all = queries(base.dir);
  const warm = openWorld(copy);
  for (const query of all) {
    storedAnswer(warm, query);
  }
  damage(copy);
  const run = counting(() => openWorld(copy));
  const world = run.value;
  for (const query of all) {
    strictEqual(storedAnswer(world, query), expected(query), JSON.stringify(query));
  }
  strictEqual(canonicalJson(readDeltas(copy)), canonicalJson(replayWithEvents(base.dir).deltas));
  strictEqual(head(copy).deltas_bytes, statSync(deltasFile(copy)).size);
  strictEqual(canonicalJson(world.snapshot()), canonicalJson(openWorld(base.dir).snapshot()));
  return { applied: run.applied, copy };
}

test("a missing, short or never-kept deltas file is rebuilt from the log", (t) => {
  const base = aged(t);
  // Opening reads the log, so a rebuild is told by the file coming back whole, not by a count.
  reopened(t, base, (copy) => rmSync(deltasFile(copy)));
  reopened(t, base, (copy) => {
    const text = readFileSync(deltasFile(copy), "utf8");
    writeFileSync(deltasFile(copy), text.slice(0, Math.floor(text.length / 2)));
  });
  reopened(t, base, (copy) => {
    const lines = readFileSync(deltasFile(copy), "utf8").split("\n").filter((line) => line.length > 0);
    writeFileSync(deltasFile(copy), lines.slice(0, 3).map((line) => `${line}\n`).join(""));
  });
  reopened(t, base, (copy) => writeFileSync(deltasFile(copy), ""));
  // A world made before the file existed: no file, and a head that has no size for it.
  const { copy } = reopened(t, base, (copy) => {
    rmSync(deltasFile(copy));
    const { deltas_bytes: _gone, ...older } = head(copy);
    writeFileSync(join(copy, "head.json"), canonicalJson(older));
  });
  ok(existsSync(deltasFile(copy)));
  // A head from before the file, beside a file that is there and wrong, is not believed either.
  reopened(t, base, (copy) => {
    writeFileSync(deltasFile(copy), "");
    const { deltas_bytes: _gone, ...older } = head(copy);
    writeFileSync(join(copy, "head.json"), canonicalJson(older));
  });
  // A lost head cannot say the file was kept, so it is not believed either.
  reopened(t, base, (copy) => {
    writeFileSync(deltasFile(copy), "");
    rmSync(join(copy, "head.json"));
  });
});

test("a crash leaves the deltas whole or the snapshot behind, and either is settled from what is there", (t) => {
  const base = aged(t);
  // After the snapshot, before the head: the deltas are all there, so nothing is replayed.
  const late = reopened(t, base, (copy) => writeFileSync(join(copy, "head.json"), base.before.head));
  strictEqual(late.applied, 0);
  // After the deltas, before the snapshot: the snapshot is a command behind the log, so all of it is
  // rebuilt by replay.
  const early = reopened(t, base, (copy) => {
    writeFileSync(join(copy, "head.json"), base.before.head);
    writeFileSync(join(copy, "snapshot.json"), base.before.snapshot);
  });
  ok(early.applied > 0);
  // After the events, before the deltas were whole: the file stops where the old head said, or a few
  // bytes into the last command's lines, and the log rebuilds it.
  const kept = (head(base.dir).deltas_bytes as number) - (JSON.parse(base.before.head) as { deltas_bytes: number }).deltas_bytes;
  ok(kept > 20);
  for (const torn of [0, 17]) {
    const behind = reopened(t, base, (copy) => {
      const bytes = readFileSync(deltasFile(copy));
      const oldSize = (JSON.parse(base.before.head) as { deltas_bytes: number }).deltas_bytes;
      writeFileSync(deltasFile(copy), bytes.subarray(0, oldSize + torn));
      writeFileSync(join(copy, "head.json"), base.before.head);
      writeFileSync(join(copy, "snapshot.json"), base.before.snapshot);
    });
    ok(behind.applied > 0);
  }
});

test("an upgrade holds the stored deltas to the replay as it does the events", (t) => {
  const base = aged(t);
  const upgraded = (copy: string) => {
    const world = openWorld(copy);
    const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
    world.upgradeTemplates(parseRegistry({ ...registry, pebble: { id: "pebble", extends: "stone" } }));
    return world;
  };
  const sound = join(tempDir(t), "sound");
  cpSync(base.dir, sound, { recursive: true });
  strictEqual(upgraded(sound).snapshot().version, base.world.snapshot().version);
  strictEqual(canonicalJson(readDeltas(sound)), canonicalJson(replayWithEvents(base.dir).deltas));

  // The same length with one entity named another, so only a comparison of the contents can tell.
  const forged = join(tempDir(t), "forged");
  cpSync(base.dir, forged, { recursive: true });
  const text = readFileSync(deltasFile(forged), "utf8");
  const swapped = text.replace('"entity":"e2"', '"entity":"e3"');
  ok(swapped !== text && swapped.length === text.length);
  writeFileSync(deltasFile(forged), swapped);
  throws(() => upgraded(forged), (error: unknown) => error instanceof WorldError && error.code === "replay_diverges");
});

test("an interrupted upgrade is adopted only over deltas that replay", (t) => {
  const base = aged(t);
  const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
  const next = parseRegistry({ ...registry, pebble: { id: "pebble", extends: "stone" } });
  // The set and the initial snapshot were written; the current snapshot and the head were not.
  const interrupted = (name: string, damage: (copy: string) => void): string => {
    const copy = join(tempDir(t), name);
    cpSync(base.dir, copy, { recursive: true });
    const current = JSON.parse(readFileSync(join(copy, "snapshot.json"), "utf8")) as { templates_hash: string };
    const initial = JSON.parse(readFileSync(join(copy, "initial.json"), "utf8")) as object;
    writeFileSync(join(copy, "templates.json"), canonicalJson(next));
    writeFileSync(join(copy, "initial.json"), canonicalJson({ ...initial, templates_hash: templatesHash(next) }));
    writeFileSync(join(copy, "head.json"), canonicalJson({ ...head(copy), templates_hash: current.templates_hash }));
    damage(copy);
    return copy;
  };
  const sound = interrupted("sound", () => undefined);
  strictEqual(openWorld(sound).snapshot().templates_hash, templatesHash(next));
  strictEqual(canonicalJson(readDeltas(sound)), canonicalJson(replayWithEvents(base.dir).deltas));

  const forged = interrupted("forged", (copy) => {
    const text = readFileSync(deltasFile(copy), "utf8");
    const swapped = text.replace('"entity":"e2"', '"entity":"e3"');
    ok(swapped !== text);
    writeFileSync(deltasFile(copy), swapped);
  });
  throws(() => openWorld(forged).snapshot(), (error: unknown) => error instanceof WorldError && error.code === "templates_changed");
});

test("property: random store worlds keep deltas and field histories equal to the replay, intact, deleted and cut", (t) => {
  const registry = withProcessFixtures(loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))));
  let chains = 0;
  for (let seed = 0; seed < 12; seed += 1) {
    const dir = join(tempDir(t), `seed-${seed}`);
    const world = createWorld(dir, SCENARIO, registry, { seed: SEED });
    const rand = mulberry32(seed + 3100);
    for (let index = 0; index < 30; index += 1) {
      const step = genStep(rand, world.snapshot(), `d${seed}-${index}`);
      if ("verb" in step) {
        world.command(step);
      } else {
        world.edit(step);
      }
    }
    const agrees = (state: string): void => {
      const expected = replayAnswers(dir);
      const reader = openWorld(dir);
      // A trace reads the head and the snapshot, so a sample of the entities and fields keeps this quick.
      const all = queries(dir);
      for (let pick = 0; pick < 45; pick += 1) {
        const query = all[Math.floor(rand() * all.length)]!;
        const answer = storedAnswer(reader, query);
        strictEqual(answer, expected(query), `seed ${seed} ${state} ${JSON.stringify(query)}`);
        chains += answer.startsWith('{"events":[{') ? 1 : 0;
      }
      strictEqual(canonicalJson(readDeltas(dir)), canonicalJson(replayWithEvents(dir).deltas), `seed ${seed} ${state}`);
    };
    agrees("intact");
    rmSync(deltasFile(dir));
    agrees("deleted");
    const text = readFileSync(deltasFile(dir), "utf8");
    writeFileSync(deltasFile(dir), text.slice(0, Math.floor(text.length * rand())));
    agrees("cut");
  }
  // The runs reached histories to compare, not only refusals.
  ok(chains > 40, `${chains}`);
});
