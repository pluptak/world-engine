import { deepStrictEqual, notStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { VerifyResponseSchema } from "../src/contract.js";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  openWorld,
  verifyWorld,
  WorldError,
  type Scenario,
  type Verification,
  type World,
} from "../src/index.js";

// A stored world can prove itself: replay the log from initial.json, deciding every line again as
// submit did, and compare what that makes with the four files. It names the first difference, and it
// writes nothing, so a repair never hides what it was asked to find.

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

const scenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "table", template: "table", overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } } },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "table" } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: -50, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "room", support: "room", pos: { x: 400, y: 0 } } },
];

const WAITS = 260;

// Every kind of submission, an edit, and enough accepted commands to pass the checkpoint at 256:
// ann pushes the table (ok); a take written against version 0 finds the bottle gone (preempted); bob
// is too far (refused); a verb nobody knows (invalid); a name nobody has (unresolved); the author sets
// a prop; then the waits, and one more refusal after the checkpoint.
function mixed(world: World): void {
  const ann = world.id("ann")!;
  const bob = world.id("bob")!;
  const room = world.id("room")!;
  const run = (command_id: string, actor: string, verb: string, target?: string, basedOn?: number, args?: Record<string, unknown>) =>
    world.command(
      { command_id, actor, verb, ...(target === undefined ? {} : { target }), ...(args === undefined ? {} : { args }) },
      basedOn === undefined ? undefined : { basedOn },
    );
  run("push", ann, "push", "table");
  run("late-take", ann, "take", "bottle", 0);
  run("far-take", bob, "take", "bottle");
  run("fly", ann, "fly");
  run("ghost", ann, "take", "ghost");
  world.edit({ kind: "set_props", target: room, props: { ...world.entity(room)!.props, hush: true } });
  for (let index = 0; index < WAITS; index += 1) {
    run(`rest-${index}`, ann, "wait", undefined, undefined, { ticks: 1 });
  }
  run("late-far", bob, "take", "bottle");
}

interface Built {
  dir: string;
  world: World;
  base: string;
}

function built(t: { after(callback: () => void): void }): Built {
  const base = mkdtempSync(join(tmpdir(), "world-engine-verify-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "w");
  const world = createWorld(dir, scenario);
  mixed(world);
  return { dir, world, base };
}

// A world per test is expensive (hundreds of commands), so each test copies one and tampers with it.
let template: { base: string; dir: string } | null = null;
function copyOfBuilt(t: { after(callback: () => void): void }): { dir: string; world: World } {
  if (template === null) {
    const base = mkdtempSync(join(tmpdir(), "world-engine-verify-template-"));
    const dir = join(base, "w");
    mixed(createWorld(dir, scenario));
    template = { base, dir };
    process.on("exit", () => rmSync(base, { recursive: true, force: true }));
  }
  const base = mkdtempSync(join(tmpdir(), "world-engine-verify-copy-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "w");
  cpSync(template.dir, dir, { recursive: true });
  return { dir, world: openWorld(dir) };
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");
const write = (dir: string, file: string, text: string) => writeFileSync(join(dir, file), text, "utf8");
const linesOf = (text: string) => text.split("\n").slice(0, -1);
const withLines = (lines: string[]) => lines.map((line) => `${line}\n`).join("");

// Every file of the world, by relative path, with its bytes.
function bytesOf(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      Object.assign(out, bytesOf(path, `${prefix}${name}/`));
    } else {
      out[`${prefix}${name}`] = readFileSync(path, "utf8");
    }
  }
  return out;
}

function logIndex(dir: string, commandId: string): number {
  const index = linesOf(read(dir, "log.jsonl")).findIndex((line) => line.includes(`"command_id":"${commandId}"`));
  ok(index >= 0, commandId);
  return index;
}

const failed = (verification: Verification) => {
  strictEqual(verification.ok, false);
  return verification.ok ? null : verification.divergence;
};

test("a world after a mixed run verifies against its own log, past a checkpoint", (t) => {
  const { dir, world } = built(t);
  const attempts = world.attempts(0);
  deepStrictEqual(
    attempts.slice(0, 6).map((attempt) => attempt.status),
    ["ok", "preempted", "refused", "invalid", "unresolved", "ok"],
  );
  ok(existsSync(join(dir, "checkpoints")) && readdirSync(join(dir, "checkpoints")).length > 0);
  const verified = world.verify();
  deepStrictEqual(verified, { ok: true, entries: attempts.length, version: world.snapshot().version });
  strictEqual(attempts.length, 6 + WAITS + 1);
  strictEqual(world.snapshot().version, 2 + WAITS);
  // A new handle says the same, and so does the CLI, which answers with the schema's own shape.
  deepStrictEqual(openWorld(dir).verify(), verified);
  const run = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ op: "verify", world: dir }),
  });
  strictEqual(run.status, 0, run.stderr);
  deepStrictEqual(VerifyResponseSchema.parse(JSON.parse(run.stdout)), verified);
});

test("it finds a byte the head still trusts: a snapshot changed to the same length", (t) => {
  const { dir } = copyOfBuilt(t);
  const tick = openWorld(dir).snapshot().tick;
  strictEqual(String(tick + 1).length, String(tick).length);
  write(dir, "snapshot.json", read(dir, "snapshot.json").replace(`"tick":${tick}`, `"tick":${tick + 1}`));
  // The files agree in size and version, so opening it believes the snapshot...
  strictEqual(openWorld(dir).snapshot().tick, tick + 1);
  // ...and the log does not.
  deepStrictEqual(failed(verifyWorld(dir)), { file: "snapshot.json", line: 0, code: "differs" });
});

test("it names the line of an event file that lost, kept or gained a line", (t) => {
  const { dir } = copyOfBuilt(t);
  const events = linesOf(read(dir, "events.jsonl"));
  ok(events.length > 100);

  const middle = copyOfBuilt(t).dir;
  write(middle, "events.jsonl", withLines(events.filter((_, index) => index !== 4)));
  deepStrictEqual(failed(verifyWorld(middle)), { file: "events.jsonl", line: 5, code: "differs" });

  const last = copyOfBuilt(t).dir;
  write(last, "events.jsonl", withLines(events.slice(0, -1)));
  deepStrictEqual(failed(verifyWorld(last)), { file: "events.jsonl", line: events.length, code: "missing" });

  const doubled = copyOfBuilt(t).dir;
  write(doubled, "events.jsonl", withLines([...events, events[0]!]));
  deepStrictEqual(failed(verifyWorld(doubled)), { file: "events.jsonl", line: events.length + 1, code: "extra" });

  const cut = copyOfBuilt(t).dir;
  write(cut, "events.jsonl", `${withLines(events)}{"event_id":"ev`);
  deepStrictEqual(failed(verifyWorld(cut)), { file: "events.jsonl", line: events.length + 1, code: "extra" });
});

test("it names the line of a delta file with an extra line, a changed one, or none", (t) => {
  const { dir } = copyOfBuilt(t);
  const deltas = linesOf(read(dir, "deltas.jsonl"));
  strictEqual(deltas.length, 2);

  const extra = copyOfBuilt(t).dir;
  write(extra, "deltas.jsonl", withLines([...deltas, deltas[deltas.length - 1]!]));
  deepStrictEqual(failed(verifyWorld(extra)), { file: "deltas.jsonl", line: deltas.length + 1, code: "extra" });

  const changed = copyOfBuilt(t).dir;
  write(changed, "deltas.jsonl", withLines(deltas.map((line, index) => (index === 1 ? line.replace(/"to":/, '"too":') : line))));
  deepStrictEqual(failed(verifyWorld(changed)), { file: "deltas.jsonl", line: 2, code: "differs" });

  const gone = copyOfBuilt(t).dir;
  rmSync(join(gone, "deltas.jsonl"));
  deepStrictEqual(failed(verifyWorld(gone)), { file: "deltas.jsonl", line: 1, code: "missing" });
});

test("a log line whose status is not the one its command is decided to, or whose bytes changed, is named", (t) => {
  // Refused in the log, though the replay accepts it: bob's far take.
  const far = copyOfBuilt(t).dir;
  const at = logIndex(far, "far-take");
  let lines = linesOf(read(far, "log.jsonl"));
  lines[at] = lines[at]!.replace('"status":"refused"', '"status":"ok"');
  write(far, "log.jsonl", withLines(lines));
  deepStrictEqual(failed(verifyWorld(far)), { file: "log.jsonl", line: at + 1, code: "status_differs" });

  // Ok in the log, though the replay refuses it, and later lines no longer fit the version.
  const rest = copyOfBuilt(t).dir;
  const restAt = logIndex(rest, "rest-3");
  lines = linesOf(read(rest, "log.jsonl"));
  lines[restAt] = lines[restAt]!.replace('"status":"ok"', '"status":"refused"');
  write(rest, "log.jsonl", withLines(lines));
  deepStrictEqual(failed(verifyWorld(rest)), { file: "log.jsonl", line: restAt + 1, code: "status_differs" });

  // A preempted line is judged against the version it was based on: based on 1, it is merely refused.
  const late = copyOfBuilt(t).dir;
  const lateAt = logIndex(late, "late-take");
  lines = linesOf(read(late, "log.jsonl"));
  ok(lines[lateAt]!.includes('"status":"preempted"'));
  lines[lateAt] = lines[lateAt]!.replace('"based_on_version":0', '"based_on_version":1');
  write(late, "log.jsonl", withLines(lines));
  deepStrictEqual(failed(verifyWorld(late)), { file: "log.jsonl", line: lateAt + 1, code: "status_differs" });

  // The same outcome with other bytes: a space the engine does not write.
  const spaced = copyOfBuilt(t).dir;
  const spacedAt = logIndex(spaced, "far-take");
  lines = linesOf(read(spaced, "log.jsonl"));
  lines[spacedAt] = lines[spacedAt]!.replace('"status":"refused"', '"status": "refused"');
  write(spaced, "log.jsonl", withLines(lines));
  deepStrictEqual(failed(verifyWorld(spaced)), { file: "log.jsonl", line: spacedAt + 1, code: "differs" });

  // A refused line renamed is a faithful record of another command, and nothing else holds its id; an
  // accepted one renamed shows in the events it made.
  const renamed = copyOfBuilt(t).dir;
  lines = linesOf(read(renamed, "log.jsonl"));
  const renamedAt = logIndex(renamed, "rest-5");
  lines[renamedAt] = lines[renamedAt]!.replace('"command_id":"rest-5"', '"command_id":"rest-five"');
  write(renamed, "log.jsonl", withLines(lines));
  const eventAt = linesOf(read(renamed, "events.jsonl")).findIndex((line) => line.includes('"command_id":"rest-5"'));
  deepStrictEqual(failed(verifyWorld(renamed)), { file: "events.jsonl", line: eventAt + 1, code: "differs" });

  // An accepted line taken out: the next one was written against a version that no longer comes,
  // which the replay refuses as a future one.
  const dropped = copyOfBuilt(t).dir;
  const droppedAt = logIndex(dropped, "rest-100");
  lines = linesOf(read(dropped, "log.jsonl"));
  write(dropped, "log.jsonl", withLines(lines.filter((_, index) => index !== droppedAt)));
  deepStrictEqual(failed(verifyWorld(dropped)), { file: "log.jsonl", line: droppedAt + 1, code: "status_differs" });

  // A line cut off, and one that is no entry at all.
  const cut = copyOfBuilt(t).dir;
  write(cut, "log.jsonl", `${read(cut, "log.jsonl")}{"command":{"comm`);
  deepStrictEqual(failed(verifyWorld(cut)), { file: "log.jsonl", line: lines.length + 1, code: "differs" });
  const junk = copyOfBuilt(t).dir;
  lines = linesOf(read(junk, "log.jsonl"));
  lines[10] = "not json";
  write(junk, "log.jsonl", withLines(lines));
  deepStrictEqual(failed(verifyWorld(junk)), { file: "log.jsonl", line: 11, code: "differs" });
});

test("the first difference is the one reported: the log before the events, the events before the snapshot", (t) => {
  const { dir } = copyOfBuilt(t);
  const tick = openWorld(dir).snapshot().tick;
  write(dir, "snapshot.json", read(dir, "snapshot.json").replace(`"tick":${tick}`, `"tick":${tick + 1}`));
  write(dir, "events.jsonl", withLines(linesOf(read(dir, "events.jsonl")).slice(1)));
  deepStrictEqual(failed(verifyWorld(dir)), { file: "events.jsonl", line: 1, code: "differs" });
  const lines = linesOf(read(dir, "log.jsonl"));
  lines[3] = lines[3]!.replace('"status":"invalid"', '"status":"refused"');
  write(dir, "log.jsonl", withLines(lines));
  deepStrictEqual(failed(verifyWorld(dir)), { file: "log.jsonl", line: 4, code: "status_differs" });
});

test("it changes no file's bytes, repairs nothing, and a damaged world stays as it was found", (t) => {
  const { dir } = copyOfBuilt(t);
  const before = bytesOf(dir);
  const handle = openWorld(dir);
  strictEqual(verifyWorld(dir).ok, true);
  strictEqual(handle.verify().ok, true);
  deepStrictEqual(bytesOf(dir), before);

  // Without its last event line the head disagrees, which opening the world would settle by
  // rewriting the file; verify leaves it for whoever asked, from a handle opened earlier or none.
  const events = linesOf(read(dir, "events.jsonl"));
  write(dir, "events.jsonl", withLines(events.slice(0, -1)));
  const damaged = bytesOf(dir);
  const found = { file: "events.jsonl", line: events.length, code: "missing" };
  deepStrictEqual(failed(verifyWorld(dir)), found);
  deepStrictEqual(failed(handle.verify()), found);
  deepStrictEqual(bytesOf(dir), damaged);
  // Opening it only brings the head in line with the file as it is, so what the head vouches for
  // is no proof; verifyWorld still finds it.
  openWorld(dir);
  strictEqual(JSON.parse(read(dir, "head.json")).events_bytes, statSync(join(dir, "events.jsonl")).size);
  deepStrictEqual(failed(verifyWorld(dir)), found);
});

test("it waits for the world's turn, and gives up with store_busy while a writer holds it", (t) => {
  const { dir } = copyOfBuilt(t);
  const before = bytesOf(dir);
  writeFileSync(join(dir, "lock"), "");
  const kept = process.env.WORLD_LOCK_TIMEOUT_MS;
  process.env.WORLD_LOCK_TIMEOUT_MS = "100";
  try {
    throws(() => verifyWorld(dir), (error) => error instanceof WorldError && error.code === "store_busy");
  } finally {
    if (kept === undefined) {
      delete process.env.WORLD_LOCK_TIMEOUT_MS;
    } else {
      process.env.WORLD_LOCK_TIMEOUT_MS = kept;
    }
  }
  deepStrictEqual({ ...bytesOf(dir), lock: "" }, { ...before, lock: "" });
});

test("a changed template set is templates_changed, as everywhere; a memory world has no log to verify", (t) => {
  const { dir, world } = copyOfBuilt(t);
  const templates = JSON.parse(read(dir, "templates.json")) as Record<string, { mass_g?: number }>;
  const list = Array.isArray(templates) ? templates : Object.values(templates);
  const bottle = (list as Array<{ id?: string; mass_g: number }>).find((entry) => entry.id === "bottle")!;
  bottle.mass_g += 1;
  write(dir, "templates.json", canonicalJson(templates));
  throws(() => verifyWorld(dir), (error) => error instanceof WorldError && error.code === "templates_changed");

  throws(
    () => memoryWorld(world.snapshot()).verify(),
    (error) => error instanceof WorldError && error.code === "history_unavailable",
  );
  throws(() => world.fork().verify(), (error) => error instanceof WorldError && error.code === "history_unavailable");
});

test("the CLI names a divergence the way the library does, and an unknown world is no_such_world", (t) => {
  const { dir } = copyOfBuilt(t);
  const lines = linesOf(read(dir, "log.jsonl"));
  const at = logIndex(dir, "far-take");
  lines[at] = lines[at]!.replace('"status":"refused"', '"status":"ok"');
  write(dir, "log.jsonl", withLines(lines));
  const ask = (world: string) =>
    spawnSync(process.execPath, ["--import", "tsx", cliPath], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify({ op: "verify", world }),
    });
  const run = ask(dir);
  strictEqual(run.status, 0, run.stderr);
  deepStrictEqual(VerifyResponseSchema.parse(JSON.parse(run.stdout)), {
    ok: false,
    divergence: { file: "log.jsonl", line: at + 1, code: "status_differs" },
  });
  const missing = ask(join(dir, "nowhere"));
  strictEqual(missing.status, 2, missing.stdout + missing.stderr);
  strictEqual(JSON.parse(missing.stdout).issues[0].code, "no_such_world");
});

test("a checkpoint is held to the replay: its snapshot, its binding, and a version the log has not reached", (t) => {
  const { dir, world: good } = copyOfBuilt(t);
  const name = readdirSync(join(dir, "checkpoints")).find((entry) => /^256-\d+\.json$/.test(entry))!;
  ok(name !== undefined);
  const file = `checkpoints/${name}` as const;
  const original = JSON.parse(read(dir, file)) as { snapshot: { tick: number }; log_sha256: string };
  const rewrite = (to: string, change: (value: typeof original) => void) => {
    const copy = copyOfBuilt(t).dir;
    const value = JSON.parse(read(copy, file)) as typeof original;
    change(value);
    write(copy, to, canonicalJson(value));
    return copy;
  };

  // A snapshot changed in one number: nothing else notices, but readers start from it.
  const shifted = rewrite(file, (value) => {
    value.snapshot.tick += 1;
  });
  deepStrictEqual(failed(verifyWorld(shifted)), { file, line: 0, code: "differs" });
  notStrictEqual(canonicalJson(openWorld(shifted).since(256)), canonicalJson(good.since(256)));

  // Its binding to the log or to the starting snapshot changed.
  const unbound = rewrite(file, (value) => {
    value.log_sha256 = "0".repeat(64);
  });
  deepStrictEqual(failed(verifyWorld(unbound)), { file, line: 0, code: "differs" });

  // A checkpoint for a version the log has not reached, and one for a version it has but never wrote.
  const ahead = copyOfBuilt(t).dir;
  writeFileSync(join(ahead, "checkpoints", "999-999.json"), read(ahead, file));
  deepStrictEqual(failed(verifyWorld(ahead)), { file: "checkpoints/999-999.json", line: 0, code: "extra" });
  const unwritten = copyOfBuilt(t).dir;
  writeFileSync(join(unwritten, "checkpoints", "257-300.json"), read(unwritten, file));
  deepStrictEqual(failed(verifyWorld(unwritten)), { file: "checkpoints/257-300.json", line: 0, code: "differs" });

  // What is no checkpoint's name is left alone, and a world may have lost its checkpoints: readers replay.
  const plain = copyOfBuilt(t).dir;
  writeFileSync(join(plain, "checkpoints", "notes.txt"), "kept by hand");
  strictEqual(verifyWorld(plain).ok, true);
  rmSync(join(plain, "checkpoints", name));
  strictEqual(verifyWorld(plain).ok, true);

  // The CLI's answer carries the file by name, and only a checkpoint's.
  const answer = { ok: false, divergence: { file, line: 0, code: "differs" } };
  deepStrictEqual(VerifyResponseSchema.parse(answer), answer);
  strictEqual(VerifyResponseSchema.safeParse({ ok: false, divergence: { ...answer.divergence, file: "checkpoints/../log.jsonl" } }).success, false);
});
