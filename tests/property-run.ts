// The property runner the property-*.test.ts files share: one seeded sequence of generated commands
// and edits against a world, every invariant checked after each step. The seeds are split across
// files so the test runner works on them in parallel.
import { deepStrictEqual, strictEqual } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { commandDuration } from "../src/engine/clock.js";
import { apply } from "../src/engine/pipeline.js";
import { addressable } from "../src/engine/query.js";
import { verbRegistry } from "../src/engine/verbs/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import {
  actorWorld,
  canonicalJson,
  createWorld,
  memoryWorld,
  openWorld,
  verifyWorld,
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
  SEED,
  withProcessFixtures,
} from "./property-gen.js";

export const registry: TemplateRegistry = withProcessFixtures(
  loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))),
);

import { deepFreeze, tempDir } from "./harness.js";

export function asEditCommand(edit: WorldEdit, commandId: string): Command {
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

export function runSequence(world: World, seed: number, steps: number): { snapshot: string; events: string } {
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
    const declared = result.status === "ok" && verb !== undefined ? commandDuration(verb, asCommand)! : 0;
    // A command that asked to be woken may end early, and then says how long it ran; the declared
    // time is its upper bound.
    const advanced = result.status === "ok" ? result.events[0]?.data.advanced : undefined;
    if (advanced !== undefined) {
      strictEqual(typeof advanced === "number" && advanced >= 1 && advanced <= declared, true, `advanced ${advanced}`);
    }
    const took = typeof advanced === "number" ? advanced : declared;
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

// Seeds `from` to `to - 1`, one test each, against a memory world.
export function seedTests(from: number, to: number): void {
  for (let seed = from; seed < to; seed += 1) {
    test(`property seed ${seed}`, () => {
      runSequence(memoryWorld(buildInitial(registry), registry), seed, 30);
    });
  }
}

// Seeds `from` to `to - 1` against a store world and a memory world, which must agree byte for byte.
export function storeSubsetTest(from: number, to: number): void {
  test(`store subset matches memory and the event file, seeds ${from} to ${to - 1}`, (t) => {
    for (let seed = from; seed < to; seed += 1) {
      const dir = join(tempDir(t), `seed-${seed}`);
      const fromStore = runSequence(createWorld(dir, SCENARIO, registry, { seed: SEED }), seed, 30);
      const fromMemory = runSequence(memoryWorld(buildInitial(registry), registry), seed, 30);
      deepStrictEqual(fromStore, fromMemory);
      strictEqual(
        canonicalJson(readEvents(dir)),
        canonicalJson(replayWithEvents(dir).events),
      );
      strictEqual(canonicalJson(openWorld(dir).snapshot()), fromStore.snapshot);
      // Whatever the run did, accepted or not, the log replays to the files it left.
      deepStrictEqual(verifyWorld(dir), { ok: true, entries: 30, version: openWorld(dir).snapshot().version });
    }
  });
}
