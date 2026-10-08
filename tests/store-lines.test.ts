import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, createWorld, openWorld, type Scenario, type World } from "../src/index.js";
import {
  readDeltas,
  readEvents,
  readLogEntries,
  readWorldTemplates,
  replayStart,
} from "../src/store/file-store.js";

// The log, events and deltas are read without the writer's turn, so a read can find a last line
// a writer has only half appended. That fragment is not yet a line: each reader answers as if it
// were absent and picks the line up, whole, once its newline is written.

const scenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "table", template: "table", overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } } },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "table" } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: -50, y: 0 } } },
];

function built(t: { after(callback: () => void): void }, count: number): { dir: string; world: World } {
  const root = mkdtempSync(join(tmpdir(), "world-engine-lines-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "w");
  const world = createWorld(dir, scenario);
  for (let index = 0; index < count; index += 1) {
    const result = world.command({
      command_id: `c${index}`,
      actor: world.id("ann")!,
      verb: index % 2 === 0 ? "take" : "drop",
      target: "bottle",
    });
    strictEqual(result.status, "ok");
  }
  return { dir, world };
}

function lastLine(path: string): string {
  return readFileSync(path, "utf8").trimEnd().split("\n").at(-1)!;
}

for (const [file, read] of [
  ["events.jsonl", readEvents],
  ["deltas.jsonl", readDeltas],
] as const) {
  test(`${file}: a half-written last line reads as absent until its newline, and the cache extends`, (t) => {
    const { dir } = built(t, 2);
    const path = join(dir, file);
    const before = read(dir);
    const line = lastLine(path);
    appendFileSync(path, line.slice(0, 20));

    const first = read(dir);
    const second = read(dir);
    strictEqual(first.length, before.length);
    strictEqual(second.length, before.length);
    // The records are the handle's own, shared between reads: kept, not parsed again.
    strictEqual(second[0], before[0]);

    appendFileSync(path, `${line.slice(20)}\n`);
    const completed = read(dir);
    strictEqual(completed.length, before.length + 1);
    strictEqual(completed[0], before[0]);
    deepStrictEqual(completed.at(-1), JSON.parse(line));
  });

  test(`${file}: a file that is all fragment reads as empty`, (t) => {
    const { dir } = built(t, 1);
    const path = join(dir, file);
    const line = lastLine(path);
    writeFileSync(path, line.slice(0, 10));
    deepStrictEqual(read(dir), []);
    deepStrictEqual(read(dir), []);
    appendFileSync(path, `${line.slice(10)}\n`);
    deepStrictEqual(read(dir), [JSON.parse(line)]);
  });

  test(`${file}: a malformed line before the end still fails with its line number`, (t) => {
    const { dir } = built(t, 1);
    const path = join(dir, file);
    const line = lastLine(path);
    for (const bad of ["{}", "{bad"]) {
      writeFileSync(path, `${line}\n${bad}\n${line}\n${line.slice(0, 5)}`);
      throws(() => read(dir), /line 2\b/);
    }
  });
}

test("log.jsonl: a half-written last line reads as absent, from the start and after a checkpoint", (t) => {
  const { dir } = built(t, 257);
  const path = join(dir, "log.jsonl");
  const templates = readWorldTemplates(dir);
  const entries = readLogEntries(dir);
  const fromCheckpoint = replayStart(dir, templates, (version) => version <= 256);
  strictEqual(fromCheckpoint.fromInitial, false);
  strictEqual(fromCheckpoint.entries.length, 1);
  const line = lastLine(path);

  appendFileSync(path, line.slice(0, 30));
  for (let read = 0; read < 2; read += 1) {
    strictEqual(canonicalJson(readLogEntries(dir)), canonicalJson(entries));
    strictEqual(canonicalJson(replayStart(dir, templates, (version) => version <= 256)), canonicalJson(fromCheckpoint));
  }

  appendFileSync(path, `${line.slice(30)}\n`);
  strictEqual(readLogEntries(dir).length, entries.length + 1);
  const extended = replayStart(dir, templates, (version) => version <= 256);
  deepStrictEqual(extended.entries.map((entry) => entry.line), [257, 258]);
});

test("log.jsonl: a malformed line before the end still fails with its line number", (t) => {
  const { dir } = built(t, 2);
  const path = join(dir, "log.jsonl");
  const line = lastLine(path);
  writeFileSync(path, `${line}\n{bad\n${line}\n${line.slice(0, 5)}`);
  throws(() => readLogEntries(dir), /line 2\b/);
});

test("opening a world whose log ends inside a line refuses to settle past it", (t) => {
  const { dir } = built(t, 2);
  const path = join(dir, "log.jsonl");
  appendFileSync(path, lastLine(path).slice(0, 30));
  throws(() => openWorld(dir).snapshot(), /Log ends inside line 3/);
});
