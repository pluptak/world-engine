import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { apply } from "../src/engine/pipeline.js";
import { addressable } from "../src/engine/query.js";
import { validateSnapshot } from "../src/engine/validate.js";
import {
  actorWorld,
  aliasOf,
  canonicalJson,
  memoryWorld,
  WORLD_AUTHOR,
  type Command,
  type Snapshot,
  type WorldEdit,
} from "../src/index.js";
import type { TemplateRegistry } from "../src/templates.js";
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
import { deepFreeze } from "./harness.js";
import { asEditCommand, registry, runSequence } from "./property-run.js";

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
    const sides = subject !== undefined && typeof subject.props.from === "string" && typeof subject.props.to === "string";
    for (const side of ["from", "to"] as const) {
      const ref = step.props[side];
      if (
        sides &&
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
  for (let seed = 0; seed < 200; seed += 1) {
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
  let snuffed = 0;
  let hurt = 0;
  let gone = 0;
  let eaten = 0;
  let drunk = 0;
  let starved = 0;
  let rolled = 0;
  let missed = 0;
  let sounded = 0;
  let skippedBeats = 0;
  let followed = 0;
  let scheduledBeats = 0;
  let repeating = 0;
  let bites = 0;
  let recovered = 0;
  for (let seed = 0; seed < 100; seed += 1) {
    const rand = mulberry32(seed);
    const world = memoryWorld(buildInitial(registry), registry);
    for (let i = 0; i < 60; i += 1) {
      const dice = world.snapshot().rng;
      const before = world.snapshot().schedule?.filter((cause) => cause.kind === "process").length ?? 0;
      const step = genStep(rand, world.snapshot(), `proc-${seed}-${i}`);
      const result = "verb" in step ? world.command(step) : world.edit(step);
      let ran = 0;
      for (const event of result.status === "ok" ? result.events : []) {
        if (event.type === "changed") {
          ran += 1;
          grown += event.data.process === "grow" ? 1 : 0;
          burned += event.data.process === "burn" ? 1 : 0;
          // A `then` write is a `changed` under the `changed` of its own run.
          const cause = result.events.find((other) => other.event_id === event.cause_id);
          snuffed += cause?.type === "changed" && event.data.prop === "burning" ? 1 : 0;
        }
        sounded += event.type === "sounded" ? 1 : 0;
        skippedBeats += event.type === "beat_skipped" ? 1 : 0;
        // A follower names the event its parent beat wrote, which an earlier command may have.
        followed += (event.type === "sounded" || event.type === "edited") && event.cause_id !== null && !result.events.some((other) => other.event_id === event.cause_id) ? 1 : 0;
        bites += event.type === "consumed" && event.data.portions_left !== undefined ? 1 : 0;
        recovered += event.type === "changed" && event.data.process === "recover" ? 1 : 0;
        eaten += event.type === "consumed" && event.data.amount === undefined ? 1 : 0;
        drunk += event.type === "consumed" && event.data.amount !== undefined ? 1 : 0;
        starved += event.type === "changed" && event.data.process === "starve" ? 1 : 0;
        // Integrity taken, or an entity removed, under a process's run.
        const parent = result.events.find((other) => other.event_id === event.cause_id);
        if (parent?.type === "changed") {
          hurt += event.type === "damaged" || event.type === "destroyed" ? 1 : 0;
          gone += event.type === "removed" ? 1 : 0;
        }
      }
      // The dice move only in a step that rolled, and only when it landed; a roll that missed
      // moved them and wrote nothing.
      const moved = world.snapshot().rng !== dice;
      const edited = "kind" in step && step.kind === "set_seed";
      strictEqual(moved && result.status !== "ok", false, `rolled without landing ${i}`);
      rolled += moved && !edited ? 1 : 0;
      missed += moved && !edited && ran === 0 ? 1 : 0;
      scheduledBeats += world.snapshot().schedule?.some((cause) => cause.kind === "beat") === true ? 1 : 0;
      repeating += world.snapshot().schedule?.some((cause) => cause.kind === "beat" && cause.repeat !== undefined) === true ? 1 : 0;
      const after = world.snapshot().schedule?.filter((cause) => cause.kind === "process").length ?? 0;
      // A process pending before and gone after, with no run of it to explain it, was withdrawn.
      withdrawn += after < before && ran === 0 ? 1 : 0;
      deepStrictEqual(validateSnapshot(world.snapshot(), registry), [], `proc-${seed}-${i}`);
    }
  }
  strictEqual(grown >= 10, true, `grown ${grown}`);
  strictEqual(burned >= 5, true, `burned ${burned}`);
  strictEqual(withdrawn >= 1, true, `withdrawn ${withdrawn}`);
  strictEqual(snuffed >= 1, true, `snuffed ${snuffed}`);
  strictEqual(hurt >= 5, true, `hurt ${hurt}`);
  strictEqual(gone >= 5, true, `gone ${gone}`);
  strictEqual(eaten >= 3, true, `eaten ${eaten}`);
  strictEqual(drunk >= 3, true, `drunk ${drunk}`);
  strictEqual(starved >= 3, true, `starved ${starved}`);
  strictEqual(rolled >= 20, true, `rolled ${rolled}`);
  strictEqual(missed >= 1, true, `missed ${missed}`);
  strictEqual(sounded >= 5, true, `sounded ${sounded}`);
  strictEqual(skippedBeats >= 3, true, `skipped beats ${skippedBeats}`);
  strictEqual(followed >= 5, true, `beat events under an earlier command ${followed}`);
  strictEqual(bites >= 3, true, `bites ${bites}`);
  strictEqual(recovered >= 1, true, `recovered ${recovered}`);
  strictEqual(repeating >= 5, true, `steps with a repeating beat pending ${repeating}`);
  strictEqual(scheduledBeats >= 20, true, `steps with a beat pending ${scheduledBeats}`);
});

test("the generator aims an edit at every relation rule, and each step still validates", () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 300 && seen.size < 12; seed += 1) {
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

test("nobody learns words they did not hear: a projection carries a token exactly when its observer heard it", () => {
  const volumes = ["whisper", "normal", "normal", "shout"] as const;
  let heardSays = 0;
  let onlySeen = 0;
  let ownViews = 0;
  for (let seed = 0; seed < 60; seed += 1) {
    const rand = mulberry32(seed + 7000);
    const world = memoryWorld(buildInitial(registry), registry);
    for (let i = 0; i < 50; i += 1) {
      const snapshot = world.snapshot();
      const agents = Object.keys(snapshot.entities)
        .sort()
        .filter((id) => snapshot.entities[id]?.props.agent === true && snapshot.entities[id]?.detached_from === null);
      // A third of the steps are a speech act by a random agent, so there is something to hear; the
      // rest are the generator's own, which move the speakers and listeners about.
      const speaks = agents.length > 0 && rand() < 0.35;
      const actor = agents[Math.floor(rand() * agents.length)] ?? "e999";
      const volume = volumes[Math.floor(rand() * volumes.length)]!;
      const step: Command | WorldEdit = speaks
        ? { command_id: `leak-${seed}-${i}`, actor, verb: "say", args: { utterance: `w${seed}x${i}`, volume } }
        : genStep(rand, snapshot, `leak-${seed}-${i}`);
      const before = snapshot.version;
      const result = "verb" in step ? world.command(step, { observe: true }) : world.edit(step);
      if (result.status !== "ok") {
        continue;
      }
      const says = result.events.filter((event) => event.type === "say");
      if (says.length === 0) {
        continue;
      }
      const after = world.snapshot();
      const views: [string, { events: { event_id: string; senses: string[]; utterance?: string; volume?: string }[] }][] = [];
      for (const id of Object.keys(after.entities).sort()) {
        if (after.entities[id]?.props.agent === true) {
          views.push([id, world.observe(id, { since: before })]);
        }
      }
      // The view a command hands back to its actor obeys the same rule.
      if ("observation" in result && result.observation !== undefined) {
        views.push([(step as Command).actor, result.observation]);
        ownViews += 1;
      }
      for (const [observer, view] of views) {
        let withWords = 0;
        for (const say of says) {
          const heard = world.query({ kind: "perceive", observer, event_id: say.event_id, sense: "hearing" }).value === "true";
          const shown = view.events.find((event) => event.event_id === say.event_id);
          if (heard) {
            heardSays += 1;
            strictEqual(shown?.utterance, say.data.utterance, `${observer} heard ${say.event_id}`);
            strictEqual(shown?.volume, say.data.volume);
            withWords += 1;
          } else if (shown !== undefined) {
            // Seen, or felt, and not heard: the event is there and the words are not.
            onlySeen += 1;
            strictEqual("utterance" in shown, false, `${observer} was told ${say.event_id}`);
            strictEqual("volume" in shown, false);
          }
        }
        // Nothing in the view carries a token but what was heard, however it is nested.
        strictEqual(JSON.stringify(view).split('"utterance"').length - 1, withWords, `${observer} view at ${i}`);
      }
    }
  }
  strictEqual(heardSays >= 100, true, `heard ${heardSays}`);
  strictEqual(onlySeen >= 20, true, `only seen ${onlySeen}`);
  strictEqual(ownViews >= 20, true, `own views ${ownViews}`);
});

// The step as a controller sends it to its view: each id it names is that actor's alias of the id, as
// a raw world id would name nothing there.
function aliased(step: Command, before: Snapshot): Command {
  const alias = (value: string): string => {
    const dot = value.indexOf(".");
    const entity = dot < 0 ? value : value.slice(0, dot);
    return Object.hasOwn(before.entities, entity) ? `${aliasOf(step.actor, entity)}${value.slice(entity.length)}` : value;
  };
  return {
    ...step,
    ...(step.target !== undefined && { target: alias(step.target) }),
    ...(step.args !== undefined && {
      args: Object.fromEntries(Object.entries(step.args).map(([key, value]) => [key, typeof value === "string" ? alias(value) : value])),
    }),
  };
}

test("an actor is told only of what it can sense or address: an actor view names nothing else", () => {
  let named = 0;
  let groped = 0;
  let withheld = 0;
  // 800 sequences: the generated world's self-closing door and chest start open and shut themselves
  // within three ticks, so a refusal naming something out of the actor's reach is rare.
  for (let seed = 0; seed < 800; seed += 1) {
    const rand = mulberry32(seed + 8000);
    const world = memoryWorld(buildInitial(registry), registry);
    for (let i = 0; i < 50; i += 1) {
      const before = world.snapshot();
      const step = genStep(rand, before, `view-${seed}-${i}`);
      if (!("verb" in step) || step.actor === WORLD_AUTHOR || before.entities[step.actor] === undefined) {
        "verb" in step ? world.command(step) : world.edit(step);
        continue;
      }
      const raw = world.check(step);
      const result = actorWorld(world, step.actor).command(aliased(step, before));
      strictEqual(["snapshot", "deltas", "events"].some((key) => key in result), false);
      // What it named resolved by the resolution rule, read independently of the view; what else it
      // is told is in its own observation or is one it could name by that same rule. The view names
      // each by the actor's alias, read back here through every id the world has held.
      const alias = (id: string) => aliasOf(step.actor, id);
      const real = new Map(
        [...Object.keys(before.entities), ...Object.keys(world.snapshot().entities)].map((id) => [alias(id), id]),
      );
      const idOf = (address: string) => real.get(address.split(".")[0]!) ?? `unknown ${address}`;
      const told = new Set([step.actor, ...result.observation.entities.map((entity) => idOf(entity.id))]);
      const room = before.entities[step.actor]?.location;
      for (const address of [result.resolved_target, ...(result.candidates ?? [])]) {
        if (address !== null) {
          const id = idOf(address);
          strictEqual(addressable(before, registry, step.actor, id), true, `${step.command_id} named ${id}`);
          told.add(id);
        }
      }
      for (const [key, value] of Object.entries(raw.reason_data ?? {})) {
        if (typeof value !== "string" || before.entities[value] === undefined) {
          continue;
        }
        if (told.has(value) || value === room || addressable(before, registry, step.actor, value)) {
          strictEqual(result.reason_data?.[key], alias(value), `${step.command_id} kept ${key}`);
          named += 1;
          if (!told.has(value) && value !== room) {
            groped += 1;
          }
        } else {
          strictEqual(result.reason_data?.[key], undefined, `${step.command_id} told of ${value}`);
          withheld += 1;
        }
      }
    }
  }
  strictEqual(named >= 100, true, `named ${named}`);
  strictEqual(groped >= 1, true, `groped ${groped}`);
  strictEqual(withheld >= 5, true, `withheld ${withheld}`);
});
