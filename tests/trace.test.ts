import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fieldEventId, traceChain, traceQuery } from "../src/engine/trace.js";
import { WorldError } from "../src/errors.js";
import { createWorld, memoryWorld } from "../src/index.js";
import type { Delta, WorldEvent } from "../src/model.js";

function event(
  event_id: string,
  cause_id: string | null,
  type: string,
  command_id = "c1",
): WorldEvent {
  return { event_id, cause_id, command_id, tick: 0, type, entity: "e1", data: {} };
}

test("traceChain returns root-first chain", () => {
  const events = [
    event("ev1", null, "push"),
    event("ev2", "ev1", "moved"),
    event("ev3", "ev2", "broken"),
  ];
  deepStrictEqual(
    traceChain(events, "ev3").map((e) => e.type),
    ["push", "moved", "broken"],
  );
});

test("unknown event throws no_such_event", () => {
  const events = [event("ev1", null, "push")];
  throws(
    () => traceChain(events, "ev999"),
    (error: unknown) => error instanceof WorldError && error.code === "no_such_event",
  );
});

test("fieldEventId returns last exact match", () => {
  const deltas: Delta[] = [
    { event_id: "ev1", entity: "e1", field: "residue", from: {}, to: { glass: 1 } },
    { event_id: "ev2", entity: "e1", field: "pos", from: null, to: { x: 1, y: 0 } },
    { event_id: "ev3", entity: "e1", field: "residue", from: { glass: 1 }, to: { glass: 2 } },
  ];
  strictEqual(fieldEventId(deltas, "e1", "residue"), "ev3");
  strictEqual(fieldEventId(deltas, "e1", "missing"), null);
});

test("traceQuery field mode follows the last delta's event", () => {
  const events = [
    event("ev1", null, "push"),
    event("ev2", "ev1", "moved"),
    event("ev3", "ev2", "broken"),
  ];
  const deltas: Delta[] = [
    { event_id: "ev3", entity: "e1", field: "residue", from: {}, to: { glass: 5 } },
  ];
  deepStrictEqual(
    traceQuery(events, deltas, { entity: "e1", field: "residue" }).map((e) => e.type),
    ["push", "moved", "broken"],
  );
  throws(
    () => traceQuery(events, deltas, { entity: "e1", field: "never_set" }),
    (error: unknown) => error instanceof WorldError && error.code === "no_such_field",
  );
});

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-trace-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const bottleScenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  {
    template: "human",
    overrides: { name: "pusher", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
  // In the table's path, so the push stops short and the jolt knocks the bottle off.
  {
    template: "stone",
    overrides: { name: "doorstop", location: "e1", support: "e1", pos: { x: 129, y: 0 } },
  },
] as const;

test("store and memory trace event_id to its root command", (t) => {
  for (const world of [
    createWorld(join(tempDir(t), "store"), [...bottleScenario]),
    memoryWorld(createWorld(join(tempDir(t), "seed"), [...bottleScenario]).snapshot()),
  ]) {
    const result = world.command({
      command_id: "push-table",
      actor: "e4",
      verb: "push",
      target: "table",
    });
    strictEqual(result.status, "ok");
    const brokenId = result.events.find((e) => e.type === "broken")?.event_id;
    ok(brokenId);
    const chain = world.trace({ event_id: brokenId }).events;
    deepStrictEqual(
      chain.map((e) => e.type),
      ["push", "moved", "collided", "displaced", "dropped", "broken"],
    );
    for (const e of chain) {
      strictEqual(e.command_id, "push-table");
    }
  }
});

test("field mode uses the last delta that set it", (t) => {
  const world = memoryWorld(
    createWorld(join(tempDir(t), "seed"), [...bottleScenario]).snapshot(),
  );
  const first = world.command({
    command_id: "push-table",
    actor: "e4",
    verb: "push",
    target: "table",
  });
  strictEqual(first.status, "ok");
  const brokenId = first.events.find((e) => e.type === "broken")?.event_id;
  ok(brokenId);
  deepStrictEqual(
    world.trace({ entity: "e1", field: "residue" }).events.map((e) => e.event_id),
    world.trace({ event_id: brokenId }).events.map((e) => e.event_id),
  );
});

test("edit root traces to the edit command", (t) => {
  const world = memoryWorld(
    createWorld(join(tempDir(t), "seed"), [...bottleScenario]).snapshot(),
  );
  const spawned = world.edit(
    { kind: "spawn", template: "bottle", overrides: { name: "extra" } },
    { command_id: "edit-1" },
  );
  strictEqual(spawned.status, "ok");
  const spawnedEvent = spawned.events.find((e) => e.type === "spawned");
  ok(spawnedEvent);
  const chain = world.trace({ event_id: spawnedEvent.event_id }).events;
  deepStrictEqual(chain.map((e) => e.type), ["edit", "spawned"]);
  strictEqual(chain[0]?.command_id, "edit-1");
});

test("unknown event/entity/field throw distinct codes", (t) => {
  const world = memoryWorld(
    createWorld(join(tempDir(t), "seed"), [...bottleScenario]).snapshot(),
  );
  throws(
    () => world.trace({ event_id: "ev999" }),
    (error: unknown) => error instanceof WorldError && error.code === "no_such_event",
  );
  throws(
    () => world.trace({ entity: "e999", field: "residue" }),
    (error: unknown) => error instanceof WorldError && error.code === "no_such_entity",
  );
  throws(
    () => world.trace({ entity: "e1", field: "never_set_xyz" }),
    (error: unknown) => error instanceof WorldError && error.code === "no_such_field",
  );
});

test("CLI trace answers event_id and entity/field", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { TraceResponseSchema } = await import("../src/contract.js");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
  const dir = join(tempDir(t), "cli");
  const world = createWorld(dir, [...bottleScenario]);
  const pushed = world.command({
    command_id: "push-table",
    actor: "e4",
    verb: "push",
    target: "table",
  });
  strictEqual(pushed.status, "ok");
  const brokenId = pushed.events.find((e) => e.type === "broken")?.event_id;
  ok(brokenId);

  const byEvent = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ op: "trace", world: dir, query: { event_id: brokenId } }),
  });
  strictEqual(byEvent.status, 0, byEvent.stderr);
  const parsedEvent = TraceResponseSchema.parse(JSON.parse(byEvent.stdout));
  deepStrictEqual(
    parsedEvent.events.map((e) => e.type),
    ["push", "moved", "collided", "displaced", "dropped", "broken"],
  );

  const byField = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ op: "trace", world: dir, query: { entity: "e1", field: "residue" } }),
  });
  strictEqual(byField.status, 0, byField.stderr);
  const parsedField = TraceResponseSchema.parse(JSON.parse(byField.stdout));
  deepStrictEqual(
    parsedField.events.map((e) => e.type),
    ["push", "moved", "collided", "displaced", "dropped", "broken"],
  );
});

test("CLI trace rejects a missing query as invalid", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
  const dir = join(tempDir(t), "cli-invalid");
  createWorld(dir, [...bottleScenario]);
  const bad = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ op: "trace", world: dir }),
  });
  strictEqual(bad.status, 2);
  ok(/"status":"invalid"/.test(bad.stdout));
});

test("field mode across two writes returns the second chain", (t) => {
  const world = memoryWorld(
    createWorld(join(tempDir(t), "seed"), [...bottleScenario]).snapshot(),
  );
  const first = world.edit(
    { kind: "set_props", target: "e1", props: { lit: true } },
    { command_id: "edit-1" },
  );
  strictEqual(first.status, "ok");
  const second = world.edit(
    { kind: "set_props", target: "e1", props: { lit: false } },
    { command_id: "edit-2" },
  );
  strictEqual(second.status, "ok");
  const editedId = second.events.find((e) => e.type === "edited")?.event_id;
  ok(editedId);
  const byField = world.trace({ entity: "e1", field: "props" }).events;
  deepStrictEqual(
    byField.map((e) => e.event_id),
    world.trace({ event_id: editedId }).events.map((e) => e.event_id),
  );
  strictEqual(byField[0]?.command_id, "edit-2");
});

test("done: room residue and spawned shard cover the bottle chain", (t) => {
  const world = createWorld(join(tempDir(t), "done"), [...bottleScenario]);
  const pushed = world.command({
    command_id: "push-table",
    actor: "e4",
    verb: "push",
    target: "table",
  });
  strictEqual(pushed.status, "ok");
  deepStrictEqual(
    world.trace({ entity: "e1", field: "residue" }).events.map((e) => e.type),
    ["push", "moved", "collided", "displaced", "dropped", "broken"],
  );
  const spawnedEvent = pushed.events.find((e) => e.type === "spawned");
  ok(spawnedEvent);
  deepStrictEqual(
    world.trace({ event_id: spawnedEvent.event_id }).events.map((e) => e.type),
    ["push", "moved", "collided", "displaced", "dropped", "broken", "spawned"],
  );
  const spawnedEntity = spawnedEvent.entity;
  deepStrictEqual(
    world.trace({ entity: spawnedEntity, field: "entity" }).events.map((e) => e.type),
    ["push", "moved", "collided", "displaced", "dropped", "broken", "spawned"],
  );
});

test("field mode: unchanged scenario field returns empty chain (store)", (t) => {
  const world = createWorld(join(tempDir(t), "unchanged-field"), [...bottleScenario]);
  const chain = world.trace({ entity: "e1", field: "pos" });
  deepStrictEqual(chain.events, []);
});

test("field mode: misspelled field throws no_such_field (store)", (t) => {
  const world = createWorld(join(tempDir(t), "misspelled-field"), [...bottleScenario]);
  throws(
    () => world.trace({ entity: "e1", field: "poss" }),
    (error: unknown) => error instanceof WorldError && error.code === "no_such_field",
  );
});

test("field mode: misspelled field throws no_such_field (memory)", (t) => {
  const world = memoryWorld(
    createWorld(join(tempDir(t), "misspelled-memory"), [...bottleScenario]).snapshot(),
  );
  throws(
    () => world.trace({ entity: "e1", field: "poss" }),
    (error: unknown) => error instanceof WorldError && error.code === "no_such_field",
  );
});

test("field mode: entity spawned by command but never changed traces to spawn event (store)", (t) => {
  const storeWorld = createWorld(join(tempDir(t), "spawned-never-changed"), [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
  ]);
  const edit = storeWorld.edit(
    { kind: "spawn", template: "bottle", overrides: { name: "shard" } },
    { command_id: "edit-1" },
  );
  strictEqual(edit.status, "ok");
  const shardId = edit.events.find((e) => e.type === "spawned")?.entity;
  ok(shardId);
  const chain = storeWorld.trace({ entity: shardId, field: "pos" });
  const eventTypes = chain.events.map((e) => e.type);
  deepStrictEqual(eventTypes[eventTypes.length - 1], "spawned");
});

test("field mode: memory world with entity from initial snapshot throws history_unavailable", (t) => {
  const seedWorld = createWorld(join(tempDir(t), "seed-history"), [...bottleScenario]);
  const memWorld = memoryWorld(seedWorld.snapshot());
  const push = memWorld.command({
    command_id: "push-table",
    actor: "e4",
    verb: "push",
    target: "table",
  });
  strictEqual(push.status, "ok");
  throws(
    () => memWorld.trace({ entity: "e1", field: "pos" }),
    (error: unknown) => error instanceof WorldError && error.code === "history_unavailable",
  );
});


