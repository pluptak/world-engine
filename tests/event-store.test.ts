import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { appendFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld, openWorld, WorldError, type Scenario } from "../src/index.js";
import { replayUntilEvent, replayWithEvents } from "../src/store/file-store.js";
import { readEvents } from "../src/store/file-store.js";
import { canonicalJson } from "../src/index.js";
import { tempDir } from "./harness.js";

const bottleScenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  {
    template: "human",
    overrides: { name: "actor", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
];

test("submitted events land in events.jsonl in order", (t) => {
  const dir = join(tempDir(t), "w");
  const world = createWorld(dir, bottleScenario);
  const pushed = world.command({ command_id: "push", actor: "e4", verb: "push", target: "table" });
  strictEqual(pushed.status, "ok");
  const lines = readFileSync(join(dir, "events.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  strictEqual(lines.length, pushed.events.length);
  deepStrictEqual(lines.map((line) => JSON.parse(line)), pushed.events);
});

test("readEvents is byte-identical to the replay path", (t) => {
  const dir = join(tempDir(t), "w");
  const world = createWorld(dir, bottleScenario);
  strictEqual(world.command({ command_id: "push", actor: "e4", verb: "push", target: "table" }).status, "ok");
  strictEqual(
    world.command({ command_id: "wait", actor: "e4", verb: "wait", args: { ticks: 1 } }).status,
    "ok",
  );
  strictEqual(canonicalJson(readEvents(dir)), canonicalJson(replayWithEvents(dir).events));
});

test("perceiver-annotated events round-trip", (t) => {
  const dir = join(tempDir(t), "w");
  const world = createWorld(dir, bottleScenario);
  const pushed = world.command(
    { command_id: "push", actor: "e4", verb: "push", target: "table", perceivers: true },
    {},
  );
  strictEqual(pushed.status, "ok");
  deepStrictEqual(readEvents(dir), pushed.events);
  strictEqual(pushed.events.every((event) => event.perceivers !== undefined), true);
});

test("a world without events.jsonl fails to open", (t) => {
  const dir = join(tempDir(t), "w");
  createWorld(dir, bottleScenario);
  unlinkSync(join(dir, "events.jsonl"));
  throws(
    () => openWorld(dir).snapshot(),
    (error: unknown) =>
      error instanceof WorldError &&
      error.code === "no_such_world" &&
      /events\.jsonl/.test(error.message),
  );
});

test("version-skew recovery rewrites a short event file", (t) => {
  const dir = join(tempDir(t), "w");
  const world = createWorld(dir, bottleScenario);
  strictEqual(world.command({ command_id: "wait-1", actor: "e4", verb: "wait", args: { ticks: 1 } }).status, "ok");
  strictEqual(world.command({ command_id: "wait-2", actor: "e4", verb: "wait", args: { ticks: 1 } }).status, "ok");
  // Simulate a crash after the log append: a third ok entry with no events and a stale snapshot.
  const entry = { command: { command_id: "wait-3", actor: "e4", verb: "wait", args: { ticks: 1 } }, based_on_version: 2, version: 2, status: "ok" };
  appendFileSync(join(dir, "log.jsonl"), `${canonicalJson(entry)}\n`, "utf8");
  // The next open detects the version skew and replays: snapshot and event file both recover.
  const recovered = openWorld(dir).snapshot();
  strictEqual(recovered.version, 3);
  deepStrictEqual(canonicalJson(readEvents(dir)), canonicalJson(replayWithEvents(dir).events));
});

test("an event appended after the event index was first built is found by its id, from a checkpoint", (t) => {
  const dir = join(tempDir(t), "w");
  createWorld(dir, bottleScenario);
  const handle = openWorld(dir, { checkpointEvery: 2 });
  const actor = Object.values(handle.snapshot().entities).find((entity) => entity.name === "actor")!.id;
  // The first events are looked up, which builds the index over the events stored so far.
  for (let index = 0; index < 4; index += 1) {
    strictEqual(handle.command({ command_id: `w${index}`, actor, verb: "wait", args: { ticks: 1 } }).status, "ok");
  }
  const early = readEvents(dir)[0]!.event_id;
  ok(replayUntilEvent(dir, early) !== null);
  // Events appended after that lookup are found through the same index, which is extended rather than rebuilt.
  for (let index = 4; index < 7; index += 1) {
    strictEqual(handle.command({ command_id: `w${index}`, actor, verb: "wait", args: { ticks: 1 } }).status, "ok");
  }
  const stored = readEvents(dir);
  const last = stored[stored.length - 1]!.event_id;
  const found = replayUntilEvent(dir, last);
  deepStrictEqual(found?.events, stored);
});
