import { deepStrictEqual, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { commandDuration } from "../src/engine/clock.js";
import { apply } from "../src/engine/pipeline.js";
import { verbRegistry } from "../src/engine/verbs/index.js";
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
  checkPartTriggers,
  foldEntities,
  genStep,
  mulberry32,
  SCENARIO,
  withProcessFixtures,
} from "./property-gen.js";

const registry: TemplateRegistry = withProcessFixtures(
  loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))),
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
    checkPartTriggers(before, world.snapshot(), result.status === "ok" ? result.events : []);
    // Only an ok command takes time, exactly what its verb declares, and nothing due inside that
    // time is left behind.
    const after = world.snapshot();
    const verb = verbRegistry.get(asCommand.verb);
    const took = result.status === "ok" && verb !== undefined ? commandDuration(verb, asCommand)! : 0;
    strictEqual(after.tick, before.tick + took);
    for (const entity of Object.values(after.entities)) {
      for (const modifier of entity.modifiers) {
        const due = modifier.expires_at_tick;
        strictEqual(due !== null && due > before.tick && due <= after.tick, false, entity.id);
      }
    }
    // Observing is a read: what an agent could sense writes nothing, parts included.
    if ("verb" in step && world.snapshot().entities[step.actor] !== undefined) {
      const seen = canonicalJson(world.snapshot());
      world.observe(step.actor, { since: before.version });
      strictEqual(canonicalJson(world.snapshot()), seen);
    }
    if (result.status === "ok") {
      let last = before.tick;
      for (const event of result.events) {
        strictEqual(event.command_id, result.command_id);
        // A command's events run forward in time, from its start to its end.
        strictEqual(event.tick >= last && event.tick <= after.tick, true, event.event_id);
        last = event.tick;
      }
      checkCauseChain(world.since(0).events);
    }
    deepStrictEqual(
      canonicalJson(foldEntities(initial, world.since(0).deltas)),
      canonicalJson(world.snapshot().entities),
    );
    const frozen = deepFreeze(structuredClone(before));
    const raw = apply(frozen, registry, asCommand);
    strictEqual(canonicalJson(frozen), beforeJson);
    // Validation is a net for verb bugs, not a rule a verb leans on: what the engine accepts is
    // valid, so the world never has to downgrade it.
    strictEqual(raw.status === "ok" ? result.status : "ok", "ok", `${asCommand.verb} ${result.reason_code}`);
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
    // `concealed_by` is the one relation with four ways to be wrong; each is read off the snapshot.
    const concealer =
      step.kind === "spawn" ? (step.overrides?.concealed_by ?? null) : (step.concealed_by ?? null);
    if (step.kind === "place" && concealer !== null) {
      const concealerEntity = snapshot.entities[concealer];
      const room = snapshot.entities[step.target]?.location ?? null;
      const abstract = (id: string): boolean => snapshot.entities[id]?.template === "anchor";
      if (concealerEntity === undefined) {
        aims.push("concealed_by_dangling");
      } else if (concealer === step.target) {
        aims.push("concealed_by_cycle");
      } else if (abstract(concealer) || abstract(step.target)) {
        aims.push("concealed_by_abstract");
      } else if (concealerEntity.location !== room) {
        aims.push("concealed_by_other_room");
      }
    }
    if (step.kind === "place" && step.in_part !== undefined && step.in_part !== null) {
      // `in_part` names a part of whoever holds the target: a part set beside a support, or a
      // name the holder never declared, tries to break the holder rules.
      const holder =
        step.contained_in === undefined || step.contained_in === null
          ? undefined
          : snapshot.entities[step.contained_in];
      if (holder === undefined) {
        aims.push("in_part_mismatch");
      } else if (!(registry[holder.template]?.parts ?? []).some((part) => part.name === step.in_part)) {
        aims.push("in_part_unknown");
      }
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

test("random runs open wounds that bleed, and every step still validates", () => {
  // Bleeding is a chain of scheduled causes across commands; the generator aims half its blows at
  // parts that come off, so wounds open and bleed under every property, not only in the spec.
  let detached = 0;
  let bleeds = 0;
  for (let seed = 0; seed < 100; seed += 1) {
    const rand = mulberry32(seed);
    const world = memoryWorld(buildInitial(registry), registry);
    for (let i = 0; i < 60; i += 1) {
      const step = genStep(rand, world.snapshot(), `wound-${seed}-${i}`);
      const result = "verb" in step ? world.command(step) : world.edit(step);
      for (const event of result.status === "ok" ? result.events : []) {
        detached += event.type === "detached" ? 1 : 0;
        // A bleed is caused by an event of an earlier command: the wound's opening or its last bleed.
        const ownCause = result.events.some((other) => other.event_id === event.cause_id);
        bleeds += (event.type === "damaged" || event.type === "destroyed") && !ownCause ? 1 : 0;
      }
      deepStrictEqual(validateSnapshot(world.snapshot(), registry), [], `wound-${seed}-${i}`);
    }
  }
  strictEqual(detached >= 10, true, `detached ${detached}`);
  strictEqual(bleeds >= 10, true, `bleeds ${bleeds}`);
});

test("random runs run processes, start and stop them, and every step still validates", () => {
  // The scenario's candle burns while a prop edit has it burning, and its moss grows from the start;
  // the generator's prop edits flip `burning`, so runs start, withdraw and restart a process.
  let grown = 0;
  let burned = 0;
  let withdrawn = 0;
  for (let seed = 0; seed < 100; seed += 1) {
    const rand = mulberry32(seed);
    const world = memoryWorld(buildInitial(registry), registry);
    for (let i = 0; i < 60; i += 1) {
      const before = world.snapshot().schedule?.filter((cause) => cause.kind === "process").length ?? 0;
      const step = genStep(rand, world.snapshot(), `proc-${seed}-${i}`);
      const result = "verb" in step ? world.command(step) : world.edit(step);
      let ran = 0;
      for (const event of result.status === "ok" ? result.events : []) {
        if (event.type === "changed") {
          ran += 1;
          grown += event.data.process === "grow" ? 1 : 0;
          burned += event.data.process === "burn" ? 1 : 0;
        }
      }
      const after = world.snapshot().schedule?.filter((cause) => cause.kind === "process").length ?? 0;
      // A process pending before and gone after, with no run of it to explain it, was withdrawn.
      withdrawn += after < before && ran === 0 ? 1 : 0;
      deepStrictEqual(validateSnapshot(world.snapshot(), registry), [], `proc-${seed}-${i}`);
    }
  }
  strictEqual(grown >= 10, true, `grown ${grown}`);
  strictEqual(burned >= 5, true, `burned ${burned}`);
  strictEqual(withdrawn >= 1, true, `withdrawn ${withdrawn}`);
});

test("the generator aims an edit at every relation rule, and each step still validates", () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 100 && seen.size < 12; seed += 1) {
    const rand = mulberry32(seed);
    const world = memoryWorld(buildInitial(registry), registry);
    for (let i = 0; i < 30 && seen.size < 12; i += 1) {
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
  deepStrictEqual([...seen].sort(), [
    "both_relations",
    "concealed_by_abstract",
    "concealed_by_cycle",
    "concealed_by_dangling",
    "concealed_by_other_room",
    "door_side_not_room",
    "in_part_mismatch",
    "in_part_unknown",
    "opens_not_openable",
    "remove_live_target",
    "self_support",
    "wrong_location",
  ]);
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
    concealed_by: null,
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
    const first = runSequence(memoryWorld(buildInitial(registry), registry), seed, 30);
    const second = runSequence(memoryWorld(buildInitial(registry), registry), seed, 30);
    deepStrictEqual(second, first);
  }
});

// Structure no command reaches leaves no trace: the same sequences against a set whose bodies declare
// extra latent parts (contributing nothing, never a default hit part, so only a command naming one
// could reach it, and the generator names only the parts of the set on disk) give byte-identical
// snapshots and events, the template hash aside.
test("latent structure nothing touches changes nothing", () => {
  const latent = (template: string, parent: string, name: string) => {
    const base = registry[template]!;
    return {
      ...base,
      parts: [...base.parts, { name, parent, contributes: {}, detachable: false, max_integrity: 10 }],
    };
  };
  const enriched: TemplateRegistry = {
    ...registry,
    human: latent("human", "head", "hair"),
    dog: latent("dog", "head", "whiskers"),
    chair: latent("chair", "seat", "cushion"),
  };
  // The deeper set is the one the world answers from: the hair is there to ask about.
  const initial = buildInitial(enriched);
  const human = Object.values(initial.entities).find((entity) => entity.template === "human")!;
  const hair = { kind: "fact" as const, subject: `${human.id}.hair`, relation: "status" };
  strictEqual(memoryWorld(initial, enriched).query(hair).value, "true");
  strictEqual(memoryWorld(buildInitial(registry), registry).query(hair).basis_code, "no_such_part");
  const unhashed = (snapshot: string) => canonicalJson({ ...(JSON.parse(snapshot) as object), templates_hash: "" });
  for (let seed = 0; seed < 100; seed += 1) {
    const plain = runSequence(memoryWorld(buildInitial(registry), registry), seed, 30);
    const deeper = runSequence(memoryWorld(buildInitial(enriched), enriched), seed, 30);
    strictEqual(deeper.events, plain.events, `seed ${seed}`);
    strictEqual(unhashed(deeper.snapshot), unhashed(plain.snapshot), `seed ${seed}`);
  }
});

for (let seed = 0; seed < 500; seed += 1) {
  test(`property seed ${seed}`, () => {
    runSequence(memoryWorld(buildInitial(registry), registry), seed, 30);
  });
}

test("store subset matches memory and the event file", (t) => {
  for (let seed = 0; seed < 25; seed += 1) {
    const dir = join(tempDir(t), `seed-${seed}`);
    const fromStore = runSequence(createWorld(dir, SCENARIO, registry), seed, 30);
    const fromMemory = runSequence(memoryWorld(buildInitial(registry), registry), seed, 30);
    deepStrictEqual(fromStore, fromMemory);
    strictEqual(
      canonicalJson(readEvents(dir)),
      canonicalJson(replayWithEvents(dir).events),
    );
    strictEqual(canonicalJson(openWorld(dir).snapshot()), fromStore.snapshot);
  }
});
