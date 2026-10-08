import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, openWorld, WorldError, type Scenario } from "../src/index.js";
import { ResponseSchema } from "../src/contract.js";
import { readEvents, replay, withWorldLock } from "../src/store/file-store.js";

// Writers take turns: a world directory has no server, so two processes writing it at once would
// each decide against a version the other had already left and rename each other's temporary files.
// The turn is the file `lock` in the world (src/store/lock.ts).

const root = fileURLToPath(new URL("../", import.meta.url));
const childPath = fileURLToPath(new URL("./store-lock-child.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

type Cleanup = { after(callback: () => void): void };

const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 30, y: 0 } } },
];

function newWorld(t: Cleanup): string {
  const base = mkdtempSync(join(tmpdir(), "world-engine-lock-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "w");
  createWorld(dir, scenario);
  return dir;
}

interface Child {
  exit: Promise<number>;
  output(): string;
  said(text: string): Promise<void>;
}

function child(...args: string[]): Child {
  const process_ = spawn(process.execPath, ["--import", "tsx", childPath, ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  const waiting: Array<{ text: string; resolve: () => void }> = [];
  process_.stdout.setEncoding("utf8");
  process_.stdout.on("data", (chunk: string) => {
    out += chunk;
    for (const entry of waiting.splice(0)) {
      if (out.includes(entry.text)) {
        entry.resolve();
      } else {
        waiting.push(entry);
      }
    }
  });
  return {
    // "close", not "exit": by then everything the child wrote has been read.
    exit: new Promise((resolve) => process_.on("close", (code) => resolve(code ?? -1))),
    output: () => out,
    said: (text) => (out.includes(text) ? Promise.resolve() : new Promise((resolve) => waiting.push({ text, resolve }))),
  };
}

function logOf(dir: string): Array<{ version: number; status: string; command: { command_id: string } }> {
  return readFileSync(join(dir, "log.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { version: number; status: string; command: { command_id: string } });
}

function leftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => name === "lock" || name.includes(".tmp") || name.includes(".stale-"));
}

const lockPath = (dir: string) => join(dir, "lock");

function holdAs(dir: string, owner: { pid: number; since_ms: number }): void {
  writeFileSync(lockPath(dir), canonicalJson(owner));
}

function withTimeout<T>(ms: number, body: () => T): T {
  const kept = process.env.WORLD_LOCK_TIMEOUT_MS;
  process.env.WORLD_LOCK_TIMEOUT_MS = String(ms);
  try {
    return body();
  } finally {
    if (kept === undefined) {
      delete process.env.WORLD_LOCK_TIMEOUT_MS;
    } else {
      process.env.WORLD_LOCK_TIMEOUT_MS = kept;
    }
  }
}

function isBusy(error: unknown): boolean {
  return error instanceof WorldError && error.code === "store_busy";
}

function takeStone(dir: string, id: string, ann: string) {
  return openWorld(dir).command({ command_id: id, actor: ann, verb: "take", target: "stone" });
}

test("six processes writing one world take turns: every command is logged once, at the version before it", async (t) => {
  const dir = newWorld(t);
  // Two more only read, which takes no turn, and must not break the writers' replacements.
  const writers = ["a", "b", "c", "d", "e", "f"].map((who) => child("commands", dir, who, "20"));
  const readers = ["g", "h"].map((who) => child("reads", dir, who, "150"));
  deepStrictEqual(await Promise.all([...writers, ...readers].map((kid) => kid.exit)), [0, 0, 0, 0, 0, 0, 0, 0]);

  const log = logOf(dir);
  strictEqual(log.length, 120);
  // Conflicting commands are refused, so not all are ok; the ones that are each follow the last.
  const accepted = log.filter((entry) => entry.status === "ok").map((entry) => entry.version);
  deepStrictEqual(accepted, accepted.map((_, index) => index));

  const world = openWorld(dir);
  strictEqual(world.snapshot().version, accepted.length);
  strictEqual(canonicalJson(world.snapshot()), canonicalJson(replay(dir)));
  deepStrictEqual(readEvents(dir), world.since(0).events);
  deepStrictEqual(leftovers(dir), []);
});

test("three processes editing at once name distinct next edits", async (t) => {
  const dir = newWorld(t);
  const codes = await Promise.all(["a", "b", "c"].map((who) => child("edits", dir, who, "10").exit));
  deepStrictEqual(codes, [0, 0, 0]);
  deepStrictEqual(
    logOf(dir).map((entry) => entry.command.command_id),
    Array.from({ length: 30 }, (_, index) => `edit-${index + 1}`),
  );
  deepStrictEqual(leftovers(dir), []);
});

test("a writer that cannot get its turn fails store_busy and changes nothing", (t) => {
  const dir = newWorld(t);
  const world = openWorld(dir);
  const ann = world.id("ann")!;
  holdAs(dir, { pid: process.pid, since_ms: Date.now() });

  const started = Date.now();
  withTimeout(150, () => {
    throws(() => world.command({ command_id: "c1", actor: ann, verb: "take", target: "stone" }), isBusy);
    throws(() => world.edit({ kind: "set_seed", seed: 3 }), isBusy);
  });
  const waited = Date.now() - started;
  ok(waited >= 250, "waited out the timeout each time");
  ok(waited < 3000, "gave up at the timeout asked for, not the 5 s default");
  strictEqual(statSync(join(dir, "log.jsonl")).size, 0);
  ok(existsSync(lockPath(dir)), "a lock that is not stale is left to its holder");

  rmSync(lockPath(dir));
  strictEqual(world.command({ command_id: "c2", actor: ann, verb: "take", target: "stone" }).status, "ok");
  deepStrictEqual(leftovers(dir), []);
});

test("a read of a world that is whole takes no turn", (t) => {
  const dir = newWorld(t);
  const world = openWorld(dir);
  holdAs(dir, { pid: process.pid, since_ms: Date.now() });
  withTimeout(100, () => {
    strictEqual(world.snapshot().version, 0);
    ok(world.entity(world.id("stone")!) !== null);
    strictEqual(openWorld(dir).snapshot().version, 0);
  });
});

test("changing the templates takes the turn too", (t) => {
  const dir = newWorld(t);
  const world = openWorld(dir);
  const before = readFileSync(join(dir, "templates.json"), "utf8");
  holdAs(dir, { pid: process.pid, since_ms: Date.now() });
  withTimeout(100, () => throws(() => world.upgradeTemplates(), isBusy));
  strictEqual(readFileSync(join(dir, "templates.json"), "utf8"), before);
});

test("a read that must repair the world waits for the writer rather than repairing under it", async (t) => {
  const dir = newWorld(t);
  const ann = openWorld(dir).id("ann")!;
  strictEqual(takeStone(dir, "c1", ann).status, "ok");
  rmSync(join(dir, "head.json"));

  const holder = child("hold", dir, "400");
  await holder.said("locked");
  const started = Date.now();
  const world = openWorld(dir);
  ok(Date.now() - started >= 250, "the open waited");
  strictEqual(await holder.exit, 0);
  ok(holder.output().includes("head_missing=true"), "nothing was rebuilt while the writer held the turn");

  ok(existsSync(join(dir, "head.json")), "then it was rebuilt");
  strictEqual(world.snapshot().version, 1);
  deepStrictEqual(leftovers(dir), []);
});

test("a read that waited finds the world whole and writes nothing", async (t) => {
  const dir = newWorld(t);
  rmSync(join(dir, "head.json"));
  const holder = child("hold", dir, "300", "repair");
  await holder.said("locked");
  openWorld(dir);
  strictEqual(await holder.exit, 0);
  const rebuilt = /head_mtime=(\S+)/.exec(holder.output())?.[1];
  ok(rebuilt !== undefined, holder.output());
  strictEqual(String(statSync(join(dir, "head.json")).mtimeMs), rebuilt, "the head was not written again");
});

for (const [name, owner] of [
  ["a process that is gone", () => ({ pid: deadPid(), since_ms: Date.now() })],
  ["a holder that has kept it over a minute", () => ({ pid: process.pid, since_ms: Date.now() - 61_000 })],
] as const) {
  test(`a turn left behind by ${name} is taken over, and its temporary files swept`, (t) => {
    const dir = newWorld(t);
    const ann = openWorld(dir).id("ann")!;
    const holder = owner();
    holdAs(dir, holder);
    // Named for the holder that is being put out, whose half-written file nobody else will finish.
    writeFileSync(join(dir, `snapshot.json.${holder.pid}.tmp`), "half a snapshot");
    strictEqual(takeStone(dir, "c1", ann).status, "ok");
    deepStrictEqual(leftovers(dir), []);
    strictEqual(openWorld(dir).snapshot().version, 1);
  });
}

test("a turn whose owner was never written is waited for while young and taken over once old", (t) => {
  const dir = newWorld(t);
  const world = openWorld(dir);
  const ann = world.id("ann")!;
  writeFileSync(lockPath(dir), "");
  withTimeout(100, () => throws(() => world.command({ command_id: "c1", actor: ann, verb: "take", target: "stone" }), isBusy));

  const old = new Date(Date.now() - 120_000);
  utimesSync(lockPath(dir), old, old);
  strictEqual(world.command({ command_id: "c2", actor: ann, verb: "take", target: "stone" }).status, "ok");
  deepStrictEqual(leftovers(dir), []);
});

test("the turn is given back when the work throws, and a nested call does not wait for its own", (t) => {
  const dir = newWorld(t);
  throws(() => withWorldLock(dir, () => withWorldLock(dir, () => { throw new Error("boom"); })), /boom/);
  deepStrictEqual(leftovers(dir), []);
  strictEqual(withWorldLock(dir, () => withWorldLock(dir, () => 7)), 7);
  deepStrictEqual(leftovers(dir), []);
});

test("a directory that is no world is no_such_world, not a lock error", (t) => {
  const base = mkdtempSync(join(tmpdir(), "world-engine-lock-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  throws(() => withWorldLock(join(base, "nowhere"), () => 1), (error) => error instanceof WorldError && error.code === "no_such_world");
});

test("through the CLI a writer that waits too long is an invalid response with the code store_busy", (t) => {
  const dir = newWorld(t);
  const ann = openWorld(dir).id("ann")!;
  holdAs(dir, { pid: process.pid, since_ms: Date.now() });
  const run = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WORLD_LOCK_TIMEOUT_MS: "100" },
    input: JSON.stringify({ op: "command", world: dir, command: { command_id: "c1", actor: ann, verb: "take", target: "stone" } }),
  });
  strictEqual(run.status, 2, run.stdout + run.stderr);
  const response = ResponseSchema.parse(JSON.parse(run.stdout));
  ok("issues" in response);
  deepStrictEqual(response.issues.map((issue) => issue.code), ["store_busy"]);
});

// The pid of a process that has finished, which nothing else is likely to have taken since.
function deadPid(): number {
  const run = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(run.stdout);
}

test("a takeover sweeps the leftovers of a dead process and of this one, and never of another that is alive", (t) => {
  const dir = newWorld(t);
  const ann = openWorld(dir).id("ann")!;
  const dead = deadPid();
  // The parent of this process is the test runner, which is alive for as long as the test runs.
  const live = process.ppid;
  holdAs(dir, { pid: dead, since_ms: Date.now() });
  mkdirSync(join(dir, "checkpoints"));
  const gone = [
    `snapshot.json.${dead}.tmp`,
    `lock.stale-${dead}`,
    // What this process could not remove itself, or left when a write was interrupted.
    `lock.stale-${process.pid}`,
    `log.jsonl.${process.pid}.tmp`,
    // A temporary no pid is named in.
    "head.json.tmp",
    join("checkpoints", `256-1.json.${dead}.tmp`),
  ];
  const kept = [`events.jsonl.${live}.tmp`, `lock.stale-${live}`, join("checkpoints", `256-1.json.${live}.tmp`)];
  for (const name of [...gone, ...kept]) {
    writeFileSync(join(dir, name), "left behind");
  }
  strictEqual(takeStone(dir, "c1", ann).status, "ok");
  for (const name of gone) {
    ok(!existsSync(join(dir, name)), `${name} was swept`);
  }
  for (const name of kept) {
    ok(existsSync(join(dir, name)), `${name} belongs to a process that is alive`);
  }
  strictEqual(existsSync(lockPath(dir)), false, "and the turn was given back");
});
