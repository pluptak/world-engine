import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { canonicalJson, createWorld, openWorld, type Scenario, type World } from "../src/index.js";
import { verbRegistry } from "../src/engine/verbs/index.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";

// A store world keeps a checkpoint of its snapshot every 256 accepted commands, bound to the exact
// bytes of the log that made it, so a read that wants recent history replays the log after the
// checkpoint instead of from the start. A checkpoint is a cache: the answer is the same without it.

const scenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "table", template: "table", overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } } },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "table" } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: -50, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "room", support: "room", pos: { x: -150, y: 0 } } },
];

function root(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-checkpoint-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

let seq = 0;

// Each length of the workload is built once per file, by extending a copy of the longest shorter
// one, since every world here runs the same commands from the start; a test gets its own copy.
const LENGTHS = [300, 512, 600, 602];
const masters = new Map<number, string>();
const masterRoot = mkdtempSync(join(tmpdir(), "world-engine-checkpoint-master-"));
after(() => rmSync(masterRoot, { recursive: true, force: true }));

function master(count: number): string {
  const kept = masters.get(count);
  if (kept !== undefined) {
    return kept;
  }
  // The lengths the tests ask for are built as one chain, so asking for the longest first builds
  // the shorter ones on the way.
  for (const length of LENGTHS.filter((length) => length < count)) {
    master(length);
  }
  const dir = join(masterRoot, `w${count}`);
  const shorter = [...masters.keys()].filter((length) => length < count).sort((a, b) => b - a)[0];
  if (shorter !== undefined) {
    cpSync(masters.get(shorter)!, dir, { recursive: true });
  }
  const world = shorter === undefined ? createWorld(dir, scenario) : openWorld(dir);
  for (let index = shorter ?? 0; index < count; index += 1) {
    const result = world.command({
      command_id: `cp-${index + 2}`,
      actor: world.id("ann")!,
      verb: index % 2 === 0 ? "take" : "drop",
      target: "bottle",
    });
    strictEqual(result.status, "ok", `${index}`);
  }
  masters.set(count, dir);
  return dir;
}

// A world of exactly `count` accepted commands, every one a take or a drop.
function built(t: { after(callback: () => void): void }, count: number): { dir: string; world: World } {
  const dir = join(root(t), "w");
  cpSync(master(count), dir, { recursive: true });
  seq = count + 1;
  return { dir, world: openWorld(dir) };
}

function checkpointNames(dir: string): string[] {
  return existsSync(join(dir, "checkpoints")) ? readdirSync(join(dir, "checkpoints")).sort() : [];
}

// Every read a controller makes, over a spread of versions and events, as one comparable string.
function answers(dir: string): string {
  const world = openWorld(dir);
  const top = world.snapshot().version;
  const ann = world.id("ann")!;
  const bob = world.id("bob")!;
  const out: unknown[] = [];
  for (const from of [0, 200, 255, 256, 257, top - 90, top - 3, top]) {
    const read = world.since(Math.max(0, from));
    out.push([from, read.events.length, canonicalJson(read)]);
  }
  const all = world.since(Math.max(0, top - 300)).events;
  for (const event of [all[0], all[Math.floor(all.length / 2)], all[all.length - 1]]) {
    ok(event !== undefined);
    for (const observer of [ann, bob]) {
      for (const sense of ["sight", "hearing"]) {
        out.push(world.query({ kind: "perceive", observer, event_id: event.event_id, sense }));
      }
    }
    out.push(world.trace({ event_id: event.event_id }));
  }
  out.push(world.observe(bob, { since: top - 3 }));
  out.push(world.attempts(Math.max(0, top - 10)));
  out.push(world.snapshot());
  return canonicalJson(out);
}

// How many transitions a read runs, counted at the two verbs the workload uses.
function counting<T>(call: () => T): { value: T; applied: number } {
  let applied = 0;
  const wrapped: Array<() => void> = [];
  for (const name of ["take", "drop"]) {
    const verb = verbRegistry.get(name)!;
    const original = verb.transition;
    verb.transition = (context) => {
      applied += 1;
      original(context);
    };
    wrapped.push(() => {
      verb.transition = original;
    });
  }
  try {
    return { value: call(), applied };
  } finally {
    wrapped.forEach((restore) => restore());
  }
}

test("a checkpoint is written every 256 accepted commands, bound to the log that made it", (t) => {
  const { dir } = built(t, 600);
  const names = checkpointNames(dir);
  strictEqual(names.length, 2);
  deepStrictEqual(names.map((name) => name.split("-")[0]), ["256", "512"]);
  const stored = JSON.parse(readFileSync(join(dir, "checkpoints", names[1]!), "utf8"));
  strictEqual(stored.version, 512);
  strictEqual(stored.snapshot.version, 512);
  strictEqual(stored.templates_hash, stored.snapshot.templates_hash);
  strictEqual(stored.log_lines, 512);
  ok(stored.log_bytes > 0 && /^[0-9a-f]{64}$/.test(stored.log_sha256));
  // The snapshot is exactly what those 512 commands make.
  strictEqual(canonicalJson(stored.snapshot), canonicalJson(built(t, 512).world.snapshot()));
});

test("reads answer the same with checkpoints, without them, and with damaged ones", (t) => {
  const { dir } = built(t, 600);
  const expected = (() => {
    const bare = join(root(t), "bare");
    cpSync(dir, bare, { recursive: true });
    rmSync(join(bare, "checkpoints"), { recursive: true });
    return answers(bare);
  })();
  strictEqual(answers(dir), expected);

  const damaged = (name: string, damage: (copy: string, first: string) => void): void => {
    const copy = join(root(t), name);
    cpSync(dir, copy, { recursive: true });
    damage(copy, join(copy, "checkpoints", checkpointNames(copy).at(-1)!));
    strictEqual(answers(copy), expected, name);
  };
  // Every damaged checkpoint also carries a snapshot that is wrong (ann a step off where she stood),
  // so that one wrongly believed changes what a replay from it reports, and cannot pass unnoticed.
  const edited = (change: (value: Record<string, unknown>) => void) => (_copy: string, file: string): void => {
    const value = JSON.parse(readFileSync(file, "utf8")) as { snapshot: { entities: Record<string, { pos: { x: number } }> } } & Record<string, unknown>;
    value.snapshot.entities.e4!.pos.x -= 10;
    change(value);
    writeFileSync(file, JSON.stringify(value));
  };
  damaged("truncated", (_copy, file) => writeFileSync(file, readFileSync(file, "utf8").slice(0, 200)));
  damaged("garbage", (_copy, file) => writeFileSync(file, "not json"));
  damaged("other templates", edited((value) => (value.templates_hash = "0".repeat(64))));
  damaged("ahead of the log", edited((value) => (value.log_bytes = (value.log_bytes as number) + 5000)));
  damaged("wrong bytes", edited((value) => (value.log_sha256 = "f".repeat(64))));
  damaged("wrong version", edited((value) => (value.version = 511)));
  // A checkpoint from another world that agrees on every name, count and byte of the log: the same
  // commands from a starting point one step off, so the snapshot is plausible and wrong, and only
  // its initial snapshot can say so.
  damaged("planted from another world", (_copy, file) => {
    const otherDir = join(root(t), "other");
    const other = createWorld(
      otherDir,
      scenario.map((entry) =>
        entry.id === "ann" ? { ...entry, overrides: { ...entry.overrides, pos: { x: -40, y: 0 } } } : entry,
      ),
    );
    for (let index = 0; index < 600; index += 1) {
      const result = other.command({
        command_id: `cp-${index + 2}`,
        actor: other.id("ann")!,
        verb: index % 2 === 0 ? "take" : "drop",
        target: "bottle",
      });
      strictEqual(result.status, "ok");
    }
    const planted = checkpointNames(otherDir).find((name) => name.startsWith("512-"))!;
    strictEqual(planted, checkpointNames(dir).find((name) => name.startsWith("512-")));
    writeFileSync(file, readFileSync(join(otherDir, "checkpoints", planted), "utf8"));
  });
});

test("a read replays only the log after the checkpoint, not the whole history", (t) => {
  const { dir } = built(t, 600);
  const bare = join(root(t), "bare");
  cpSync(dir, bare, { recursive: true });
  rmSync(join(bare, "checkpoints"), { recursive: true });

  const recent = openWorld(dir).snapshot().version - 1;
  const withCheckpoints = counting(() => openWorld(dir).since(recent));
  const without = counting(() => openWorld(bare).since(recent));
  strictEqual(canonicalJson(withCheckpoints.value), canonicalJson(without.value));
  ok(without.applied >= 590, `without: ${without.applied}`);
  ok(withCheckpoints.applied <= 100, `with: ${withCheckpoints.applied}`);

  // An event-form query replays from the checkpoint before the event, and a second sense is free.
  const world = openWorld(dir);
  const latest = world.since(recent).events[0]!;
  const query = (sense: string) => world.query({ kind: "perceive", observer: world.id("bob")!, event_id: latest.event_id, sense });
  const first = counting(() => query("sight"));
  const second = counting(() => query("hearing"));
  ok(first.applied <= 100, `event: ${first.applied}`);
  strictEqual(second.applied, 0);
  const cold = counting(() => openWorld(bare).query({ kind: "perceive", observer: "e5", event_id: latest.event_id, sense: "sight" }));
  ok(cold.applied >= 590, `event without: ${cold.applied}`);
  strictEqual(canonicalJson(first.value), canonicalJson(cold.value));
});

test("a second handle uses the checkpoints and extends them", (t) => {
  const { dir, world } = built(t, 300);
  strictEqual(checkpointNames(dir).length, 1);
  const other = openWorld(dir);
  seq = 10_000;
  for (let index = 0; index < 300; index += 1) {
    seq += 1;
    const result = other.command({ command_id: `second-${seq}`, actor: other.id("ann")!, verb: index % 2 === 0 ? "take" : "drop", target: "bottle" });
    ok(result.status === "ok" || index === 0, result.status);
  }
  deepStrictEqual(checkpointNames(dir).map((name) => name.split("-")[0]), ["256", "512"]);
  // The first handle, which saw none of that written, reads it all.
  strictEqual(world.snapshot().version, 600);
  const bare = join(root(t), "bare");
  cpSync(dir, bare, { recursive: true });
  rmSync(join(bare, "checkpoints"), { recursive: true });
  strictEqual(answers(dir), answers(bare));
  strictEqual(canonicalJson(world.since(590)), canonicalJson(openWorld(bare).since(590)));
});

test("a new template set makes the old checkpoints go", (t) => {
  const { dir, world } = built(t, 300);
  strictEqual(checkpointNames(dir).length, 1);
  const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
  world.upgradeTemplates(parseRegistry({ ...base, pebble: { id: "pebble", extends: "stone" } }));
  deepStrictEqual(checkpointNames(dir), []);
  // Reads still answer, from the start of the log, and the next checkpoint is made under the new set.
  strictEqual(world.since(250).events.length > 0, true);
  const again = openWorld(dir);
  const result = again.command({ command_id: "after-upgrade", actor: again.id("ann")!, verb: "wait", args: { ticks: 1 } });
  strictEqual(result.status, "ok");
});

test("a stale command is judged against its base version from a checkpoint, with the same verdict", (t) => {
  const { dir } = built(t, 602);
  const bare = join(root(t), "bare");
  cpSync(dir, bare, { recursive: true });
  rmSync(join(bare, "checkpoints"), { recursive: true });
  // At 601 the bottle was held and a drop would have worked; at 602 it is already on the floor.
  const stale = (path: string) => {
    const world = openWorld(path);
    return world.command({ command_id: "late", actor: world.id("ann")!, verb: "drop", target: "bottle" }, { basedOn: 601 });
  };
  const withCheckpoints = counting(() => stale(dir));
  const without = counting(() => stale(bare));
  deepStrictEqual([withCheckpoints.value.status, withCheckpoints.value.reason_code], ["preempted", without.value.reason_code]);
  strictEqual(without.value.status, "preempted");
  ok(without.applied >= 590, `without: ${without.applied}`);
  ok(withCheckpoints.applied <= 110, `with: ${withCheckpoints.applied}`);
});
