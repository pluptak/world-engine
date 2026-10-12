import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { canonicalJson, createWorld, openWorld, type Scenario } from "../src/index.js";
import { tempDir } from "./harness.js";

// A crash at every write of `submit`, over seven commands with snapshot.json every 3 accepted commands and a
// checkpoint every 2, so the crash falls on and off each boundary. A submit writes, in order, the log line, the
// events, the deltas, snapshot.json when it is due, head.json, and a checkpoint when one is due. Each crash is the
// directory with the writes before it done and the rest not: the state a process that died there leaves. The next
// open must give the state the uninterrupted run gives, and verify.

const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 30, y: 0 } } },
];

const COMMANDS = 7;
const STORE = { snapshotEvery: 3, checkpointEvery: 2 };

function copy(from: string, to: string): string {
  cpSync(from, to, { recursive: true });
  return to;
}

function copyOver(from: string, to: string, name: string): void {
  if (existsSync(join(from, name))) {
    mkdirSync(dirname(join(to, name)), { recursive: true });
    copyFileSync(join(from, name), join(to, name));
  }
}

// The files one submit writes, in the order it writes them. A checkpoint is a new file, so only those the submit
// added are in the order.
function writeOrder(before: string, after: string): string[] {
  const checkpoints = "checkpoints";
  const known = existsSync(join(before, checkpoints)) ? new Set(readdirSync(join(before, checkpoints))) : new Set<string>();
  const added = existsSync(join(after, checkpoints))
    ? readdirSync(join(after, checkpoints)).filter((name) => !known.has(name)).map((name) => `${checkpoints}/${name}`)
    : [];
  return ["log.jsonl", "events.jsonl", "deltas.jsonl", "snapshot.json", "head.json", ...added];
}

test("a crash after each write of each of seven submits opens to the state the uninterrupted run gives, and verifies", (t) => {
  const root = tempDir(t);
  const live = join(root, "live");
  createWorld(live, scenario, undefined, { seed: 3 });
  const ann = openWorld(live).id("ann")!;

  // states[k] is the directory after k accepted commands, which the uninterrupted run leaves.
  const states = [copy(live, join(root, "after-0"))];
  for (let k = 1; k <= COMMANDS; k += 1) {
    const verb = k % 2 === 1 ? "take" : "drop";
    const result = openWorld(live, STORE).command({ command_id: `c${k}`, actor: ann, verb, target: "stone" });
    strictEqual(result.status, "ok");
    states.push(copy(live, join(root, `after-${k}`)));
  }

  const expected = states.map((dir) => canonicalJson(openWorld(dir).snapshot()));
  for (let k = 1; k <= COMMANDS; k += 1) {
    const before = states[k - 1]!;
    const after = states[k]!;
    const order = writeOrder(before, after);
    // Crash after `done` writes: none written leaves the command unlogged, and any write after the log line leaves it
    // accepted, so the next open must have it.
    for (let done = 0; done <= order.length; done += 1) {
      const crashed = copy(before, join(root, `crash-${k}-${done}`));
      for (const name of order.slice(0, done)) {
        copyOver(after, crashed, name);
      }
      const reopened = openWorld(crashed);
      const want = done === 0 ? expected[k - 1] : expected[k];
      strictEqual(canonicalJson(reopened.snapshot()), want, `submit ${k}, crash after ${done} of ${order.length} writes`);
      ok(reopened.verify().ok, `submit ${k}, crash after ${done} writes verifies`);
    }
  }
});

test("the crash points cover a snapshot write and a checkpoint write, not only log and head", (t) => {
  const root = tempDir(t);
  const live = join(root, "live");
  createWorld(live, scenario, undefined, { seed: 3 });
  const ann = openWorld(live).id("ann")!;
  const states = [copy(live, join(root, "after-0"))];
  for (let k = 1; k <= 6; k += 1) {
    openWorld(live, STORE).command({ command_id: `c${k}`, actor: ann, verb: k % 2 === 1 ? "take" : "drop", target: "stone" });
    states.push(copy(live, join(root, `after-${k}`)));
  }
  // The sixth submit is due both a snapshot and a checkpoint: its order names both, and each is written after the log.
  const order = writeOrder(states[5]!, states[6]!);
  deepStrictEqual(
    order.filter((name) => name === "snapshot.json" || name.startsWith("checkpoints/")),
    ["snapshot.json", "checkpoints/6-" + openWorld(states[6]!).snapshot().next_seq + ".json"],
  );
});
