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
  type Snapshot,
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

// The edits a step aims at each relation rule: what it tries to break, read off the snapshot the
// generator read. Nothing here needs the step to land: a refused step is the point.
function aimedAt(step: WorldEdit, snapshot: Snapshot): string[] {
  const targets = step.kind === "remove" ? [step.target] : [];
  if (step.kind === "set_props") {
    targets.push(step.target);
  }
  if (step.kind === "place") {
    targets.push(step.target);
  }
  const aims: string[] = [];
  if (step.kind === "spawn" || step.kind === "place") {
    const support = step.kind === "spawn" ? (step.overrides?.support ?? null) : (step.support ?? null);
    const contained =
      step.kind === "spawn" ? (step.overrides?.contained_in ?? null) : (step.contained_in ?? null);
    if (support !== null && contained !== null) {
      aims.push("both_relations");
    }
    if (step.kind === "place" && support !== null && support === step.target) {
      aims.push("self_support");
    }
    if (step.kind === "spawn") {
      const location = step.overrides?.location ?? null;
      if (
        location !== null &&
        support !== null &&
        location !== support &&
        snapshot.entities[location]?.template === "room" &&
        snapshot.entities[support]?.template === "room"
      ) {
        aims.push("wrong_location");
      }
    }
  }
  if (step.kind === "set_props") {
    const subject = snapshot.entities[step.target];
    for (const side of ["from", "to"] as const) {
      const ref = step.props[side];
      if (
        subject?.template === "door" &&
        typeof ref === "string" &&
        snapshot.entities[ref]?.template !== "room"
      ) {
        aims.push("door_side_not_room");
      }
    }
    const opens = step.props.opens;
    if (typeof opens === "string" && snapshot.entities[opens]?.props.openable !== true) {
      aims.push("opens_not_openable");
    }
  }
  for (const id of targets) {
    // `opens` is not here: a key outlives the lock it names, so removing one is not a broken rule.
    const named = Object.values(snapshot.entities).some(
      (entity) =>
        entity.support === id ||
        entity.contained_in === id ||
        entity.location === id ||
        entity.props.from === id ||
        entity.props.to === id,
    );
    if (named) {
      aims.push("remove_live_target");
    }
  }
  return aims;
}

test("the generator aims an edit at every relation rule, and each step still validates", () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 100 && seen.size < 6; seed += 1) {
    const rand = mulberry32(seed);
    const world = memoryWorld(buildInitial(registry));
    for (let i = 0; i < 30 && seen.size < 6; i += 1) {
      const step = genStep(rand, world.snapshot(), `aim-${seed}-${i}`);
      if (!("verb" in step)) {
        for (const aim of aimedAt(step, world.snapshot())) {
          seen.add(aim);
        }
      }
      const result = "verb" in step ? world.command(step) : world.edit(step);
      deepStrictEqual(validateSnapshot(world.snapshot(), registry), [], `aim-${seed}-${i}`);
    }
  }
  deepStrictEqual(
    [...seen].sort(),
    ["both_relations", "door_side_not_room", "opens_not_openable", "remove_live_target", "self_support", "wrong_location"],
  );
});

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
