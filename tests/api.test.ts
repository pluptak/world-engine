import { deepStrictEqual, ok, strictEqual, throws as assertThrows } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  openWorld,
  WorldError,
  type Command,
  type Scenario,
  type World,
} from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
// Self-reference: the package's own exports map, not a path into src/.
import { createWorld as createWorldByName } from "world-engine";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));
const registry = loadTemplates(templatesDir);

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-api-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const bottleScenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  {
    template: "bottle",
    overrides: { name: "bottle", location: "e1", support: "e2" },
  },
  {
    template: "human",
    overrides: { name: "pusher", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
];

const pushTable: Command = {
  command_id: "push-table",
  actor: "e4",
  verb: "push",
  target: "table",
};

function bottleWorld(t: { after(callback: () => void): void }): World {
  return createWorld(join(tempDir(t), "bottle-world"), bottleScenario);
}

test("a command through the API reproduces the causal bottle chain", (t) => {
  const world = bottleWorld(t);
  const result = world.command(pushTable);

  strictEqual(result.status, "ok");
  deepStrictEqual(
    result.events.map((event) => event.type),
    ["push", "moved", "displaced", "dropped", "broken", "spawned", "spawned", "spawned"],
  );
  const positions = new Map(result.events.map((event, index) => [event.event_id, index]));
  for (const [index, event] of result.events.entries()) {
    let current = event;
    let currentIndex = index;
    while (current.cause_id !== null) {
      const parent = positions.get(current.cause_id);
      ok(parent !== undefined && parent < currentIndex);
      current = result.events[parent]!;
      currentIndex = parent;
    }
    strictEqual(current.command_id, "push-table");
  }

  strictEqual(world.snapshot().version, 1);
  strictEqual(world.entity("e3")?.status, "broken");
  deepStrictEqual(world.entity("e1")?.residue, { glass: 5, wine: 75 });
  strictEqual(world.entity("e99"), null);
});

test("a second handle sees what the first one wrote", (t) => {
  const dir = join(tempDir(t), "shared-world");
  const first = createWorld(dir, bottleScenario);
  strictEqual(first.command(pushTable).status, "ok");

  const second = openWorld(dir);
  strictEqual(second.snapshot().version, 1);
  strictEqual(second.entity("e3")?.status, "broken");
  deepStrictEqual(second.query({ kind: "fact", subject: "e3", relation: "status" }), {
    value: "true",
    basis_code: "relation_state",
  });

  const log = readFileSync(join(dir, "log.jsonl"), "utf8").trim();
  strictEqual(log.split("\n").length, 1);
});

test("queries and entities come from the same snapshot", (t) => {
  const world = bottleWorld(t);
  deepStrictEqual(world.query({ kind: "perceive", observer: "e4", entity: "e3", sense: "sight" }), {
    value: "true",
    basis_code: "same_location_lit",
  });

  strictEqual(world.command(pushTable).status, "ok");

  deepStrictEqual(world.query({ kind: "fact", subject: "e3", relation: "status" }), {
    value: "true",
    basis_code: "relation_state",
  });
  const bottle = world.entity("e3");
  ok(bottle);
  strictEqual(bottle.status, "broken");
  deepStrictEqual(world.entity("e1")?.residue, { glass: 5, wine: 75 });
});

test("a stale command through the API is preempted", (t) => {
  const world = bottleWorld(t);
  strictEqual(world.command(pushTable).status, "ok");

  const stale = world.command(
    { command_id: "stale-take", actor: "e4", verb: "take", target: "bottle" },
    { basedOn: 0 },
  );
  strictEqual(stale.status, "preempted");
  strictEqual(world.snapshot().version, 1);

  const future = world.command(pushTable, { basedOn: 9 });
  strictEqual(future.status, "invalid");
  strictEqual(future.reason_code, "future_version");
});

test("a stale command in a memory world is preempted like on disk", (t) => {
  const stored = bottleWorld(t);
  const world = memoryWorld(stored.snapshot());
  strictEqual(world.command(pushTable).status, "ok");

  const stale = world.command(
    { command_id: "stale-take", actor: "e4", verb: "take", target: "bottle" },
    { basedOn: 0 },
  );
  strictEqual(stale.status, "preempted");
  strictEqual(world.snapshot().version, 1);
});

test("the package's exports map is the API a caller imports", (t) => {
  strictEqual(createWorldByName, createWorld);
  const world = createWorldByName(join(tempDir(t), "self-referenced"), bottleScenario);
  strictEqual(world.snapshot().version, 0);
  strictEqual(world.command(pushTable).status, "ok");
  strictEqual(world.entity("e3")?.status, "broken");
});

test("a memory world runs the same commands to the same state", (t) => {
  const stored = bottleWorld(t);
  const inMemory = memoryWorld(stored.snapshot());

  const fromDisk = stored.command(pushTable);
  const fromMemory = inMemory.command(pushTable);

  strictEqual(fromMemory.status, "ok");
  deepStrictEqual(
    fromMemory.events.map((event) => event.type),
    fromDisk.events.map((event) => event.type),
  );
  strictEqual(canonicalJson(fromMemory.snapshot), canonicalJson(fromDisk.snapshot));
  strictEqual(inMemory.entity("e1")?.residue.wine, 75);
});

test("a memory world keeps no directory and rejects foreign templates", () => {
  const stored = createWorld(
    mkdtempSync(join(tmpdir(), "world-engine-api-seed-")),
    bottleScenario,
  );
  const seeded = stored.snapshot();

  const inMemory = memoryWorld(seeded);
  strictEqual(canonicalJson(inMemory.snapshot()), canonicalJson(seeded));
  strictEqual(inMemory.command({ command_id: "wait", actor: "e4", verb: "wait", args: { ticks: 2 } }).status, "ok");

  const changed: TemplateRegistry = { ...registry, bottle: { ...registry.bottle!, mass_g: 1 } };
  assertThrows(
    () => memoryWorld(seeded, changed),
    (error: unknown) => error instanceof WorldError && error.code === "templates_changed",
  );
});

test("an unknown world and a missing directory report through WorldError", (t) => {
  const dir = join(tempDir(t), "never-created");
  for (const read of [
    () => openWorld(dir).snapshot(),
    () => openWorld(dir).entity("e1"),
    () => openWorld(dir).query({ kind: "fact", subject: "e1", relation: "status" }),
    () => openWorld(dir).command(pushTable),
  ]) {
    assertThrows(
      read,
      (error: unknown) => error instanceof WorldError && error.code === "no_such_world",
    );
  }
});

test("a world whose templates changed will not open", (t) => {
  const dir = join(tempDir(t), "changed-world");
  createWorld(dir, bottleScenario);

  const changed: TemplateRegistry = { ...registry, bottle: { ...registry.bottle!, mass_g: 1 } };
  assertThrows(
    () => openWorld(dir, changed).snapshot(),
    (error: unknown) => error instanceof WorldError && error.code === "templates_changed",
  );
  strictEqual(openWorld(dir).snapshot().version, 0);

  writeFileSync(join(dir, "log.jsonl"), "", "utf8");
  strictEqual(openWorld(dir).snapshot().version, 0);
});