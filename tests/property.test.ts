import { deepStrictEqual, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { apply } from "../src/engine/pipeline.js";
import { validateSnapshot } from "../src/engine/validate.js";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  openWorld,
  WORLD_AUTHOR,
  type Command,
  type World,
  type WorldEdit,
} from "../src/index.js";
import { readEvents, replayWithEvents } from "../src/store/file-store.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import {
  buildInitial,
  checkCauseChain,
  foldEntities,
  genStep,
  mulberry32,
  SCENARIO,
} from "./property-gen.js";

const registry: TemplateRegistry = loadTemplates(
  fileURLToPath(new URL("../templates/", import.meta.url)),
);

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-property-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function asEditCommand(edit: WorldEdit, commandId: string): Command {
  const command: Command = {
    command_id: commandId,
    actor: WORLD_AUTHOR,
    verb: "edit",
    args: { edit },
  };
  if ("target" in edit) {
    command.target = edit.target;
  }
  return command;
}

function runSequence(world: World, seed: number, steps: number): { snapshot: string; events: string } {
  const rand = mulberry32(seed);
  const initial = world.snapshot();
  for (let i = 0; i < steps; i += 1) {
    const before = world.snapshot();
    const beforeJson = canonicalJson(before);
    const step = genStep(rand, before, `s${seed}-${i}`);
    const asCommand = "verb" in step ? step : asEditCommand(step, `s${seed}-${i}`);
    const result = "verb" in step ? world.command(step) : world.edit(step);
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
    strictEqual(canonicalJson(before), beforeJson);
    if (result.status === "ok") {
      for (const event of result.events) {
        strictEqual(event.command_id, result.command_id);
      }
      checkCauseChain(world.since(0).events);
    }
    deepStrictEqual(
      canonicalJson(foldEntities(initial, world.since(0).deltas)),
      canonicalJson(world.snapshot().entities),
    );
    const frozen = deepFreeze(structuredClone(before));
    apply(frozen, registry, asCommand);
    strictEqual(canonicalJson(frozen), beforeJson);
  }
  return { snapshot: canonicalJson(world.snapshot()), events: canonicalJson(world.since(0).events) };
}

test("foldEntities replays raw deltas exactly", () => {
  const initial = buildInitial(registry);
  deepStrictEqual(
    foldEntities(initial, [
      { event_id: "ev1", entity: "e9", field: "pos", from: { x: -50, y: 0 }, to: { x: 1, y: 2 } },
    ]).e9?.pos,
    { x: 1, y: 2 },
  );
  const spawned = {
    id: "e99",
    template: "stone",
    name: "stone",
    aliases: [],
    location: "e1",
    support: "e1",
    contained_in: null,
    pos: { x: 0, y: 0 },
    detached_from: null,
    integrity: 100,
    status: "intact",
    parts: {},
    residue: {},
    modifiers: [],
    props: {},
  } as const;
  const withSpawn = foldEntities(initial, [
    { event_id: "ev1", entity: "e99", field: "entity", from: null, to: spawned },
  ]);
  deepStrictEqual(withSpawn.e99?.name, "stone");
  const removed = foldEntities(initial, [
    { event_id: "ev1", entity: "e99", field: "entity", from: null, to: spawned },
    { event_id: "ev2", entity: "e99", field: "entity", from: spawned, to: null },
  ]);
  strictEqual("e99" in removed, false);
});

test("same seed twice is byte-identical", () => {
  for (const seed of [0, 7, 499]) {
    const first = runSequence(memoryWorld(buildInitial(registry)), seed, 30);
    const second = runSequence(memoryWorld(buildInitial(registry)), seed, 30);
    deepStrictEqual(second, first);
  }
});

for (let seed = 0; seed < 500; seed += 1) {
  test(`property seed ${seed}`, () => {
    runSequence(memoryWorld(buildInitial(registry)), seed, 30);
  });
}

test("store subset matches memory and the event file", (t) => {
  for (let seed = 0; seed < 25; seed += 1) {
    const dir = join(tempDir(t), `seed-${seed}`);
    const fromStore = runSequence(createWorld(dir, SCENARIO), seed, 30);
    const fromMemory = runSequence(memoryWorld(buildInitial(registry)), seed, 30);
    deepStrictEqual(fromStore, fromMemory);
    strictEqual(
      canonicalJson(readEvents(dir)),
      canonicalJson(replayWithEvents(dir).events),
    );
    strictEqual(canonicalJson(openWorld(dir).snapshot()), fromStore.snapshot);
  }
});
