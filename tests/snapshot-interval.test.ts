import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, createWorld, openWorld, type Scenario, type World } from "../src/index.js";
import { submit } from "../src/store/file-store.js";
import { tempDir } from "./harness.js";

// A store world writes snapshot.json only every so many accepted commands, and says in head.json
// which version and which log byte that file holds. A fresh open folds the logged commands after
// it, so the state read is the state the writer holds, and a crash between the two writes loses
// nothing.

const scenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "room", support: "room", pos: { x: -80, y: 0 } } },
];

function world(t: { after(callback: () => void): void }): { dir: string; handle: World; bob: string } {
  const dir = join(tempDir(t), "w");
  const handle = createWorld(dir, scenario, undefined, { seed: 3 });
  return { dir, handle, bob: handle.id("bob")! };
}

function head(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "head.json"), "utf8")) as Record<string, unknown>;
}

function stored(dir: string): { version: number } {
  return JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")) as { version: number };
}

function wait(handle: World, bob: string, n: number): void {
  for (let index = 0; index < n; index += 1) {
    const result = handle.command({ command_id: `w${handle.snapshot().version}-${index}`, actor: bob, verb: "wait", args: { ticks: 1 } });
    strictEqual(result.status, "ok");
  }
}

test("snapshot.json is written every 32 accepted commands, and a fresh open reads the writer's state", (t) => {
  const { dir, handle, bob } = world(t);
  wait(handle, bob, 100);
  strictEqual(handle.snapshot().version, 100);
  strictEqual(stored(dir).version, 96);
  strictEqual(head(dir).snapshot_version, 96);
  strictEqual(canonicalJson(openWorld(dir).snapshot()), canonicalJson(handle.snapshot()));
});

test("a crash after the log and deltas are written, before the head, recovers", (t) => {
  const { dir, handle, bob } = world(t);
  wait(handle, bob, 31);
  const beforeHead = readFileSync(join(dir, "head.json"), "utf8");
  // The 32nd command writes the snapshot and then the head; the head is put back as the crash left it.
  wait(handle, bob, 1);
  writeFileSync(join(dir, "head.json"), beforeHead);
  strictEqual(canonicalJson(openWorld(dir).snapshot()), canonicalJson(handle.snapshot()));
  strictEqual(handle.snapshot().version, 32);
});

test("a crash after the snapshot is written, before the head, recovers", (t) => {
  const { dir, handle, bob } = world(t);
  wait(handle, bob, 31);
  const beforeHead = readFileSync(join(dir, "head.json"), "utf8");
  wait(handle, bob, 1);
  writeFileSync(join(dir, "head.json"), beforeHead);
  strictEqual(stored(dir).version, 32);
  strictEqual(canonicalJson(openWorld(dir).snapshot()), canonicalJson(handle.snapshot()));
});

test("a world whose head predates the snapshot fields opens, and gains them", (t) => {
  const { dir, handle, bob } = world(t);
  wait(handle, bob, 5);
  const current = handle.snapshot();
  const { snapshot_version: _version, snapshot_log_bytes: _bytes, ...older } = head(dir);
  writeFileSync(join(dir, "head.json"), canonicalJson(older));
  strictEqual(canonicalJson(openWorld(dir).snapshot()), canonicalJson(current));
  // The snapshot was not the current one, so settle rebuilt it at the current version and named it.
  strictEqual(head(dir).snapshot_version, 5);
  strictEqual(stored(dir).version, 5);
});

test("a world whose head predates the fields, at a version the snapshot holds, opens unchanged", (t) => {
  const { dir, handle, bob } = world(t);
  wait(handle, bob, 32);
  const current = handle.snapshot();
  const { snapshot_version: _version, snapshot_log_bytes: _bytes, ...older } = head(dir);
  writeFileSync(join(dir, "head.json"), canonicalJson(older));
  strictEqual(canonicalJson(openWorld(dir).snapshot()), canonicalJson(current));
});

test("the interval is a parameter of the write: a small one exercises the same reads", (t) => {
  const { dir, handle, bob } = world(t);
  for (let index = 0; index < 7; index += 1) {
    const result = submit(
      dir,
      { command_id: `s${index}`, actor: bob, verb: "wait", args: { ticks: 1 } },
      undefined,
      undefined,
      undefined,
      undefined,
      { snapshotEvery: 3 },
    );
    strictEqual(result.status, "ok");
  }
  strictEqual(stored(dir).version, 6);
  strictEqual(handle.snapshot().version, 7);
  strictEqual(canonicalJson(openWorld(dir).snapshot()), canonicalJson(handle.snapshot()));
});

test("verify names a stored snapshot that differs from the replay at its own version", (t) => {
  const { dir, handle, bob } = world(t);
  wait(handle, bob, 40);
  ok(handle.verify().ok);
  const snapshot = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")) as { tick: number };
  writeFileSync(join(dir, "snapshot.json"), canonicalJson({ ...snapshot, tick: snapshot.tick + 1 }));
  const verdict = handle.verify();
  deepStrictEqual(verdict.ok, false);
  if (!verdict.ok) {
    strictEqual(verdict.divergence.file, "snapshot.json");
  }
});
