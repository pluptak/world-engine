import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  type Coverage,
  type Id,
  type Perceivers,
  type Result,
  type Scenario,
  type Status,
  type World,
  type WorldEvent,
} from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const inn = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/inn.json", import.meta.url)), "utf8"),
) as Scenario;

// The default coverage plus smell: without it the dog's nose answers unknown for ever, which is why
// `createWorld` takes the coverage the world declares. Touch rides along so every perceiver list
// is complete.
const SMELLING: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "smell", "touch"],
  properties: ["integrity", "residue", "pos"],
};

const UNSMELLING: Coverage = { ...SMELLING, senses: ["sight", "hearing"] };

// The names the inn is written with, in the order the scenario declares them: an entry's name is the
// id `e<n>` its position in the file allocates.
const DECLARED = {
  common: "e1",
  cellar: "e2",
  door: "e3",
  hearth: "e4",
  window: "e5",
  table: "e6",
  chair: "e7",
  bottle: "e8",
  cup: "e9",
  book: "e10",
  note: "e11",
  chest: "e12",
  key: "e13",
  ann: "e14",
  bob: "e15",
  rex: "e16",
} as const;

type InnName = keyof typeof DECLARED;
type Ids = Record<InnName, Id>;

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-inn-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A store world on disk and a memory world over the same initial snapshot, both declaring smell.
function innWorlds(
  t: { after(callback: () => void): void },
): { store: World; memory: World; ids: Ids } {
  const store = createWorld(join(tempDir(t), "inn"), inn, undefined, { coverage: SMELLING });
  const ids: Ids = { ...DECLARED };
  for (const name of Object.keys(DECLARED) as InnName[]) {
    strictEqual(store.id(name), ids[name], `${name} is the id its entry allocates`);
  }
  return { store, memory: memoryWorld(store.snapshot(), undefined, ids), ids };
}

// What one result of one step must say. The events are named in order; a refusal names its code.
interface Expect {
  status: Status;
  code?: string;
  events: string[];
}

// Who sensed an event, by name: `perceivers` answers in id order, which is not the order these read in.
interface Perceived {
  sight?: string[];
  hearing?: string[];
  smell?: string[];
  touch?: string[];
}

interface Step {
  note: string;
  run: (world: World, marks: Record<string, number>) => Result[];
  expect: Expect[];
  // Checked on the first result that has an event of that type.
  perceivers?: Record<string, Perceived>;
  // A version this step's world is left at, for a later step's `basedOn`.
  mark?: string;
  // What holds of the world immediately after this step.
  then?: (world: World) => void;
}

function namesOf(ids: Ids, values: Id[] | undefined): string[] {
  const byId = new Map(Object.entries(ids).map(([name, id]) => [id, name]));
  return (values ?? []).map((id) => byId.get(id) ?? id).sort();
}

function perceiversOf(result: Result, type: string, note: string): Perceivers {
  const event: WorldEvent | undefined = result.events.find((candidate) => candidate.type === type);
  ok(event !== undefined, `${note}: no ${type} event`);
  ok(event.perceivers !== undefined, `${note}: ${type} carries no perceivers`);
  return event.perceivers;
}

// Every step's verdict, its events, and its perceivers, then the invariant that must hold whatever
// the step did: the snapshot still holds together.
function play(world: World, ids: Ids, steps: Step[]): Result[] {
  const marks: Record<string, number> = {};
  const results: Result[] = [];
  for (const step of steps) {
    const run = step.run(world, marks);
    strictEqual(run.length, step.expect.length, step.note);
    run.forEach((result, index) => {
      const expected = step.expect[index];
      ok(expected !== undefined, step.note);
      const at = `${step.note} [${index}]`;
      strictEqual(result.status, expected.status, at);
      strictEqual(result.reason_code, expected.code, at);
      deepStrictEqual(
        result.events.map((event) => event.type),
        expected.events,
        at,
      );
      results.push(result);
    });
    for (const [type, sensed] of Object.entries(step.perceivers ?? {})) {
      const [first] = run;
      ok(first !== undefined, `${step.note}: perceivers are read off its first result`);
      const found = perceiversOf(first, type, step.note);
      deepStrictEqual(found.unknown_senses, [], `${step.note} / ${type}: nothing is an unknown sense`);
      for (const sense of ["sight", "hearing", "smell"] as const) {
        deepStrictEqual(
          namesOf(ids, found[sense]),
          sensed[sense] ?? [],
          `${step.note} / ${type} / ${sense}`,
        );
      }
      // Touch is asserted only where a step names it: most steps never say who felt what.
      if (sensed.touch !== undefined) {
        deepStrictEqual(
          namesOf(ids, found.touch),
          sensed.touch,
          `${step.note} / ${type} / touch`,
        );
      }
    }
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), [], `${step.note}: snapshot holds`);
    step.then?.(world);
    if (step.mark !== undefined) {
      marks[step.mark] = world.snapshot().version;
    }
  }
  return results;
}

function yes(basis_code: string) {
  return { value: "true", basis_code };
}

function no(basis_code: string) {
  return { value: "false", basis_code };
}

// The script. Every expectation here was written before the step was run; the reason each one is
// what it is sits beside it.
function script(ids: Ids): Step[] {
  const cmd =
    (command_id: string, actor: InnName, verb: string, target?: string, args?: Record<string, unknown>) =>
    (world: World): Result[] => [
      world.command({
        command_id,
        actor: ids[actor],
        verb,
        ...(target === undefined ? {} : { target }),
        ...(args === undefined ? {} : { args }),
        // Every command asks who sensed what, so a step's perceivers are the world's answer.
        perceivers: true,
      }),
    ];

  const steps: Step[] = [];
  const step = (value: Step): void => {
    steps.push(value);
  };

  // A. the door, and a chest whose key one of the two humans is holding.
  step({
    note: "ann opens the cellar door",
    run: cmd("A1-open-door", "ann", "open", "cellar door"),
    expect: [{ status: "ok", events: ["open", "opened"] }],
    // The door stands in no room of its own, so all three of them are in the room it joins.
    perceivers: { open: { sight: ["ann", "bob", "rex"], hearing: ["ann", "bob", "rex"] } },
  });
  step({
    note: "ann walks to the chest, which is out of reach where she stood",
    run: cmd("A2-to-chest", "ann", "move", undefined, { to: { x: 200, y: -25 } }),
    expect: [{ status: "ok", events: ["move", "moved"] }],
  });
  step({
    note: "ann unlocks the chest with the key in her hands",
    run: cmd("A3-unlock", "ann", "unlock", "chest"),
    expect: [{ status: "ok", events: ["unlock", "unlocked"] }],
  });
  step({
    note: "ann opens the chest",
    run: cmd("A4-open-chest", "ann", "open", "chest"),
    expect: [{ status: "ok", events: ["open", "opened"] }],
  });
  step({
    note: "ann closes the chest again",
    run: cmd("A5-close-chest", "ann", "close", "chest"),
    expect: [{ status: "ok", events: ["close", "closed"] }],
    mark: "chest-shut",
  });
  step({
    note: "bob cannot unlock it: he is in reach and has hands, but no key",
    run: cmd("A6-bob-no-key", "bob", "unlock", "chest"),
    expect: [{ status: "refused", code: "no_key", events: [] }],
  });
  step({
    note: "ann hands the key to bob",
    run: cmd("A7-give-key", "ann", "give", "key", { destination: "bob" }),
    expect: [{ status: "ok", events: ["give", "moved"] }],
  });
  step({
    note: "bob locks the chest he can now turn",
    run: cmd("A8-lock", "bob", "lock", "chest"),
    expect: [{ status: "ok", events: ["lock", "locked"] }],
  });
  step({
    // Stale: ann's unlock would have been ok at that version, and is no_key now that bob holds the
    // key and has locked the chest, so it comes back preempted rather than refused.
    note: "ann's unlock, sent against the version before the key changed hands",
    run: (world, marks) => [
      world.command(
        {
          command_id: "A9-stale-unlock",
          actor: ids.ann,
          verb: "unlock",
          target: "chest",
          perceivers: true,
        },
        { basedOn: marks["chest-shut"] as number },
      ),
    ],
    expect: [{ status: "preempted", code: "no_key", events: [] }],
  });
  step({
    note: "ann opens a locked chest: refused before anything is checked about the key",
    run: cmd("A10-open-locked", "ann", "open", "chest"),
    expect: [{ status: "refused", code: "locked", events: [] }],
  });
  step({
    note: "bob unlocks it again",
    run: cmd("A11-bob-unlock", "bob", "unlock", "chest"),
    expect: [{ status: "ok", events: ["unlock", "unlocked"] }],
  });
  step({
    note: "bob hands the key back to ann",
    run: cmd("A12-give-back", "bob", "give", "key", { destination: "ann" }),
    expect: [{ status: "ok", events: ["give", "moved"] }],
  });
  step({
    note: "ann locks the chest with the key in her hands",
    run: cmd("A13-lock", "ann", "lock", "chest"),
    expect: [{ status: "ok", events: ["lock", "locked"] }],
  });

  // B. the bottle: two hands, a beat, a pour into a cup, and the rest onto the floor.
  step({
    note: "ann walks back to the table",
    run: cmd("B1-to-table", "ann", "move", undefined, { to: { x: 140, y: 60 } }),
    expect: [{ status: "ok", events: ["move", "moved"] }],
  });
  step({
    note: "one beat: ann takes the bottle, and bob's identical take is stale",
    run: (world) =>
      world.beat([
        { command_id: "B2a-take-bottle", actor: ids.ann, verb: "take", target: "bottle", perceivers: true },
        { command_id: "B2b-take-bottle", actor: ids.bob, verb: "take", target: "bottle", perceivers: true },
      ]),
    expect: [
      { status: "ok", events: ["take", "moved"] },
      { status: "preempted", code: "held_by_another", events: [] },
    ],
  });
  step({
    note: "ann pockets the key, which frees the hand it sat in",
    run: cmd("B2b-pocket-key", "ann", "put", "key", { relation: "in", destination: `${ids.ann}.pocket` }),
    expect: [{ status: "ok", events: ["put", "moved"] }],
    then: (world) => {
      strictEqual(world.entity(ids.key)?.contained_in, ids.ann);
      strictEqual(world.entity(ids.key)?.in_part, "pocket");
    },
  });
  step({
    note: "bob takes the key out of ann's pocket: a pocket is just a container",
    run: cmd("B2c-steal-key", "bob", "take", "key"),
    expect: [{ status: "ok", events: ["take", "moved"] }],
    perceivers: {
      // Bob's grip closes on it, so he feels both; the act is silent, so nobody hears it, though
      // in the lit room everyone sees it happen like everything else.
      take: { sight: ["ann", "bob", "rex"], hearing: [], touch: ["bob"] },
      moved: { sight: ["ann", "bob", "rex"], hearing: [], touch: ["bob"] },
    },
    then: (world) => {
      strictEqual(world.entity(ids.key)?.contained_in, ids.bob);
      strictEqual(world.entity(ids.key)?.in_part, "hand_l");
    },
  });
  step({
    note: "bob hands the key back",
    run: cmd("B2d-give-back", "bob", "give", "key", { destination: "ann" }),
    expect: [{ status: "ok", events: ["give", "moved"] }],
  });
  step({
    note: "ann pockets the key again",
    run: cmd("B2e-pocket-key", "ann", "put", "key", { relation: "in", destination: `${ids.ann}.pocket` }),
    expect: [{ status: "ok", events: ["put", "moved"] }],
    then: (world) => {
      strictEqual(world.entity(ids.key)?.in_part, "pocket");
    },
  });
  step({
    note: "ann takes the cup with the freed hand: two grips hold two one-handed things",
    run: cmd("B3-take-cup", "ann", "take", "cup"),
    expect: [{ status: "ok", events: ["take", "moved"] }],
  });
  step({
    note: "ann sets the cup on the table",
    run: cmd("B4-put-cup", "ann", "put", "cup", { relation: "on", destination: "table" }),
    expect: [{ status: "ok", events: ["put", "moved"] }],
  });
  step({
    note: "ann pours 30 of the bottle's 75 into the cup",
    run: cmd("B5-pour-cup", "ann", "pour", "bottle", { destination: "cup", amount: 30 }),
    expect: [{ status: "ok", events: ["pour", "poured"] }],
    // The pour row of the sense table: seen and heard by the room, smelt by the only nose in it.
    perceivers: {
      poured: { sight: ["ann", "bob", "rex"], hearing: ["ann", "bob", "rex"], smell: ["rex"] },
    },
    then: (world) => {
      strictEqual(world.entity(ids.cup)?.props.liquid_amount, 30);
      // The vessel's own odour is the entity form of the same question, and the cup now smells.
      deepStrictEqual(
        world.query({ kind: "perceive", observer: ids.rex, entity: ids.cup, sense: "smell" }),
        yes("same_location"),
      );
      // A human has no nose at all, which is `no_sense_capacity` rather than `odourless`.
      deepStrictEqual(
        world.query({ kind: "perceive", observer: ids.bob, entity: ids.cup, sense: "smell" }),
        no("no_sense_capacity"),
      );
    },
  });
  step({
    note: "ann pours what is left onto the floor of the room",
    run: cmd("B6-pour-floor", "ann", "pour", "bottle", { destination: ids.common }),
    expect: [{ status: "ok", events: ["pour", "poured"] }],
    perceivers: {
      poured: { sight: ["ann", "bob", "rex"], hearing: ["ann", "bob", "rex"], smell: ["rex"] },
    },
    then: (world) => {
      strictEqual(world.entity(ids.bottle)?.props.liquid_amount, 0);
      // The floor keeps the residue; the vessel declares no material at all once it is empty.
      strictEqual(world.entity(ids.bottle)?.props.liquid_material, "");
      strictEqual(world.entity(ids.common)?.residue.grape_wine, 45);
    },
  });
  step({
    note: "an emptied bottle has nothing to pour, and says so as no_liquid",
    run: cmd("B7-pour-again", "ann", "pour", "bottle", { destination: "cup" }),
    expect: [{ status: "refused", code: "no_liquid", events: [] }],
  });
  step({
    note: "ann hands the empty bottle to bob: the book will want both of her hands",
    run: cmd("B7b-give-bottle", "ann", "give", "bottle", { destination: "bob" }),
    expect: [{ status: "ok", events: ["give", "moved"] }],
    then: (world) => {
      strictEqual(world.entity(ids.bottle)?.contained_in, ids.bob);
      strictEqual(world.entity(ids.bottle)?.in_part, "hand_l");
    },
  });
  // C. concealment: a search finds the note, and lifting the book uncovers it.
  step({
    note: "ann searches the book, which is still hiding the note",
    run: cmd("C1-search", "ann", "search", "book"),
    expect: [{ status: "ok", events: ["search", "found"] }],
    // A `found` is read where the search happened, so it names the book: everyone in the lit room
    // sees it, and the search itself is silent.
    perceivers: {
      found: { sight: ["ann", "bob", "rex"], hearing: [], smell: [] },
    },
  });
  step({
    note: "ann lifts the two-handed book, which uncovers the note",
    run: cmd("C2-lift-book", "ann", "take", "book"),
    expect: [{ status: "ok", events: ["take", "moved", "revealed"] }],
    perceivers: {
      revealed: { sight: ["ann", "bob", "rex"], hearing: [], smell: [] },
    },
    then: (world) => {
      strictEqual(world.entity(ids.note)?.concealed_by, null);
      // The note is out from under the book now, and the whole room can see that it is there.
      deepStrictEqual(
        world.query({ kind: "perceive", observer: ids.bob, entity: ids.note, sense: "sight" }),
        yes("same_location_lit"),
      );
    },
  });
  step({
    note: "the book will not go on the chair: furniture is not a surface",
    run: cmd("C3-put-chair", "ann", "put", "book", { relation: "on", destination: "chair" }),
    expect: [{ status: "refused", code: "not_a_surface", events: [] }],
  });
  step({
    note: "rex takes the note in his mouth, which is a carrier like any other",
    run: cmd("C4-rex-take-note", "rex", "take", "note"),
    expect: [{ status: "ok", events: ["take", "moved"] }],
    then: (world) => {
      strictEqual(world.entity(ids.note)?.contained_in, ids.rex);
    },
  });
  step({
    note: "rex walks up to ann",
    run: cmd("C5-rex-approach", "rex", "move", undefined, { to: { x: 80, y: 60 } }),
    expect: [{ status: "ok", events: ["move", "moved"] }],
  });
  step({
    note: "rex cannot take the book too: a mouth holds one thing and never a two-handed one",
    run: cmd("C6-rex-take-book", "rex", "take", "book"),
    expect: [{ status: "refused", code: "two_hands_required", events: [] }],
  });
  step({
    note: "ann sets the book on the table: her hands are needed for what comes next",
    run: cmd("C6b-put-book", "ann", "put", "book", { relation: "on", destination: "table" }),
    expect: [{ status: "ok", events: ["put", "moved"] }],
  });
  step({
    note: "rex hands the note back to ann out of his mouth",
    run: cmd("C7-rex-give-note", "rex", "give", "note", { destination: "ann" }),
    expect: [{ status: "ok", events: ["give", "moved"] }],
  });
  step({
    note: "ann pockets the note beside the key",
    run: cmd("C7b-pocket-note", "ann", "put", "note", { relation: "in", destination: `${ids.ann}.pocket` }),
    expect: [{ status: "ok", events: ["put", "moved"] }],
    then: (world) => {
      strictEqual(world.entity(ids.note)?.in_part, "pocket");
    },
  });
  step({
    note: "ann lifts the book again, with both hands free for it",
    run: cmd("D0-take-book", "ann", "take", "book"),
    expect: [{ status: "ok", events: ["take", "moved"] }],
    then: (world) => {
      strictEqual(world.entity(ids.book)?.contained_in, ids.ann);
      strictEqual(world.entity(ids.book)?.in_part, "hand_l");
    },
  });

  // D. a fight: a torso that costs moving, an arm that comes off, and the wait that undoes the rest.
  step({
    note: "bob hits ann's torso, which costs her moving for three ticks",
    run: cmd("D1-torso-1", "bob", "attack", `${ids.ann}.torso`),
    expect: [{ status: "ok", events: ["attack", "damaged", "capability_changed"] }],
  });
  step({
    note: "and again: a second modifier, on the same capacity, due at the same tick",
    run: cmd("D2-torso-2", "bob", "attack", `${ids.ann}.torso`),
    expect: [{ status: "ok", events: ["attack", "damaged", "capability_changed"] }],
  });
  step({
    note: "bob cuts ann's arm: a part that contributes no capacity adds no modifier",
    run: cmd("D3-arm-1", "bob", "attack", `${ids.ann}.arm_r`),
    expect: [{ status: "ok", events: ["attack", "damaged"] }],
  });
  step({
    note: "and again",
    run: cmd("D4-arm-2", "bob", "attack", `${ids.ann}.arm_r`),
    expect: [{ status: "ok", events: ["attack", "damaged"] }],
  });
  step({
    note: "and the arm comes off, which takes ann's hand with it",
    run: cmd("D5-arm-off", "bob", "attack", `${ids.ann}.arm_r`),
    expect: [
      { status: "ok", events: ["attack", "detached", "spawned", "capability_changed", "dropped"] },
    ],
    // `detached` and a 100 cm `dropped` are loud, so the whole inn hears the arm and the book.
    perceivers: {
      detached: { sight: ["ann", "bob", "rex"], hearing: ["ann", "bob", "rex"], smell: [] },
      dropped: { sight: ["ann", "bob", "rex"], hearing: ["ann", "bob", "rex"], smell: [] },
    },
    then: (world) => {
      // The book needed both hands, so losing one drops it; what sits elsewhere stays: the
      // pocketed key with ann, the bottle with bob, the tabled cup where it was put.
      strictEqual(world.entity(ids.book)?.support, ids.common);
      strictEqual(world.entity(ids.book)?.in_part, null);
      strictEqual(world.entity(ids.key)?.contained_in, ids.ann);
      strictEqual(world.entity(ids.key)?.in_part, "pocket");
      strictEqual(world.entity(ids.bottle)?.contained_in, ids.bob);
    },
  });
  step({
    note: "bob waits three ticks, and both moving modifiers expire in tick order",
    run: cmd("D6-wait", "bob", "wait", undefined, { ticks: 3 }),
    expect: [{ status: "ok", events: ["wait", "capability_changed", "capability_changed"] }],
    perceivers: {
      // Waiting makes no sound, and neither does a modifier fading: the room hears nothing.
      wait: { sight: ["ann", "bob", "rex"], hearing: [] },
      capability_changed: { sight: ["ann", "bob", "rex"], hearing: [] },
    },
    then: (world) => {
      deepStrictEqual(world.entity(ids.ann)?.modifiers, []);
      strictEqual(world.snapshot().tick, 3);
    },
  });
  step({
    note: "ann cannot pick the book up with one hand left",
    run: cmd("D7-one-hand", "ann", "take", "book"),
    expect: [{ status: "refused", code: "insufficient_manipulation", events: [] }],
    then: (world) => {
      const refused = world.check({
        command_id: "D7-probe",
        actor: ids.ann,
        verb: "take",
        target: "book",
      });
      deepStrictEqual(refused.reason_data, { capacity: "manipulation", have: 50, need: 100 });
    },
  });

  // E. the cellar: an observer behind the open door, then behind a shut one, during a loud event.
  step({
    note: "bob hands the bottle back: ann will want it within reach",
    run: cmd("E0-give-back", "bob", "give", "bottle", { destination: "ann" }),
    expect: [{ status: "ok", events: ["give", "moved"] }],
  });
  step({
    note: "bob goes down to the cellar through the open door",
    run: cmd("E1-bob-down", "bob", "move", undefined, { location: ids.cellar }),
    expect: [{ status: "ok", events: ["move", "moved"] }],
    // He was seen in the lit room before the move, and is not seen in the dark cellar after it.
    perceivers: { moved: { sight: ["ann", "bob", "rex"], hearing: ["ann", "bob", "rex"] } },
  });
  step({
    note: "the world author takes the table out from under the cup",
    run: (world) => [
      world.edit({ kind: "remove", target: ids.table }, { command_id: "E2-remove-table", perceivers: true }),
    ],
    expect: [{ status: "ok", events: ["edit", "removed", "displaced", "dropped", "spilled"] }],
    perceivers: {
      // The author's own work is nobody's: the world writes it, nobody senses it.
      edit: { sight: [], hearing: [], smell: [] },
      removed: { sight: [], hearing: [], smell: [] },
      // The knock of the cup off the table is quiet, so the cellar does not hear it.
      displaced: { sight: ["ann", "rex"], hearing: ["ann", "rex"] },
      // The 75 cm fall is loud: heard next door through the open door, and the cellar is dark.
      dropped: { sight: ["ann", "rex"], hearing: ["ann", "bob", "rex"] },
      // The spill reads the pour row: seen and heard in the room, smelt only by the nose in it.
      spilled: { sight: ["ann", "rex"], hearing: ["ann", "rex"], smell: ["rex"] },
    },
    then: (world) => {
      strictEqual(world.entity(ids.table), null);
      strictEqual(world.entity(ids.cup)?.support, ids.common);
      // The fall spills the cup: an unbroken fall empties the vessel onto its landing, on top
      // of what the earlier pour left on the floor.
      strictEqual(world.entity(ids.cup)?.props.liquid_material, "");
      strictEqual(world.entity(ids.cup)?.props.liquid_amount, 0);
      strictEqual(world.entity(ids.common)?.residue.grape_wine, 75);
      // Existence is modelled: what is gone answers false rather than unknown.
      deepStrictEqual(
        world.query({ kind: "fact", subject: ids.ann, relation: "near", object: ids.table }),
        no("no_such_entity"),
      );
    },
  });
  step({
    note: "ann shuts the cellar door on bob",
    run: cmd("E3-shut-door", "ann", "close", "cellar door"),
    expect: [{ status: "ok", events: ["close", "closed"] }],
    // A shut door is still a door the cellar belongs to, so bob hears it shut; it is dark, so he
    // does not see it.
    perceivers: {
      closed: { sight: ["ann", "rex"], hearing: ["ann", "bob", "rex"] },
    },
  });
  step({
    note: "ann drops the empty bottle, and it breaks on the floor",
    run: cmd("E4-drop-bottle", "ann", "drop", "bottle"),
    expect: [{ status: "ok", events: ["drop", "dropped", "broken", "spawned", "spawned", "spawned"] }],
    perceivers: {
      // Loud: heard through the shut door, which a loud event crosses.
      broken: { sight: ["ann", "rex"], hearing: ["ann", "bob", "rex"] },
      // A dropped thing is a quiet row, so nothing smells it, here or next door.
      dropped: { sight: ["ann", "rex"], hearing: ["ann", "bob", "rex"], smell: [] },
    },
    then: (world) => {
      strictEqual(world.entity(ids.bottle)?.status, "broken");
      // The break products land where the bottle did, and the glass stays as residue.
      strictEqual(world.entity(ids.bottle)?.support, ids.common);
      strictEqual(world.entity(ids.common)?.residue.glass, 5);
    },
  });

  // F. the key into the chest, which is what a lock is worth.
  step({
    note: "ann walks to the chest again",
    run: cmd("F1-to-chest", "ann", "move", undefined, { to: { x: 190, y: -25 } }),
    expect: [{ status: "ok", events: ["move", "moved"] }],
  });
  step({
    note: "ann unlocks the chest",
    run: cmd("F2-unlock", "ann", "unlock", "chest"),
    expect: [{ status: "ok", events: ["unlock", "unlocked"] }],
  });
  step({
    note: "ann opens it",
    run: cmd("F3-open", "ann", "open", "chest"),
    expect: [{ status: "ok", events: ["open", "opened"] }],
  });
  step({
    note: "ann puts the key inside",
    run: cmd("F4-key-in", "ann", "put", "key", { relation: "in", destination: "chest" }),
    expect: [{ status: "ok", events: ["put", "moved"] }],
  });
  step({
    note: "and shuts it on the key",
    run: cmd("F5-shut", "ann", "close", "chest"),
    expect: [{ status: "ok", events: ["close", "closed"] }],
  });
  step({
    note: "now nobody can unlock the chest, because nobody is carrying its key",
    run: cmd("F6-locked-in", "ann", "unlock", "chest"),
    expect: [{ status: "refused", code: "no_key", events: [] }],
    then: (world) => {
      // The key is still in the world, and it is not seen through a shut lid.
      strictEqual(world.entity(ids.key)?.contained_in, ids.chest);
      deepStrictEqual(
        world.query({ kind: "perceive", observer: ids.ann, entity: ids.key, sense: "sight" }),
        no("enclosed"),
      );
    },
  });
  step({
    note: "and it cannot be locked again either",
    run: cmd("F8-lock-again", "ann", "lock", "chest"),
    expect: [{ status: "refused", code: "no_key", events: [] }],
  });

  // G. the mouth that carried it cannot take it back off her.
  step({
    note: "rex walks over to ann",
    run: cmd("G1-rex-to-ann", "rex", "move", undefined, { to: { x: 190, y: 30 } }),
    expect: [{ status: "ok", events: ["move", "moved"] }],
  });
  step({
    note: "ann takes the note out of her pocket",
    run: cmd("G1b-take-note", "ann", "take", "note"),
    expect: [{ status: "ok", events: ["take", "moved"] }],
  });
  step({
    note: "rex cannot take the note out of ann's hands",
    run: cmd("G2-take-held", "rex", "take", "note"),
    expect: [{ status: "refused", code: "held_by_another", events: [] }],
  });

  return steps;
}

test("the inn's names are the ids its entries allocate, and its anchors resolved", (t) => {
  const { store, ids } = innWorlds(t);
  deepStrictEqual(ids, DECLARED);
  // Every position but the anchors' own is written against an anchor, and the offset is what
  // resolved: the table is 110 cm off the hearth and the chair 120 below the window.
  deepStrictEqual(store.entity(ids.hearth)?.pos, { x: 200, y: 0 });
  deepStrictEqual(store.entity(ids.window)?.pos, { x: 200, y: 260 });
  deepStrictEqual(store.entity(ids.table)?.pos, { x: 90, y: 0 });
  deepStrictEqual(store.entity(ids.chair)?.pos, { x: 160, y: 140 });
  deepStrictEqual(store.entity(ids.ann)?.pos, { x: 140, y: 60 });
  // An anchor records nothing: it is a mark, not a relation, and the room holds the thing instead.
  strictEqual(store.entity(ids.table)?.support, ids.common);
  strictEqual(store.entity(ids.table)?.contained_in, null);
  // A mark is a thing `near` reads and nothing perceives.
  deepStrictEqual(
    store.query({ kind: "fact", subject: ids.bob, relation: "near", object: ids.hearth }),
    yes("derived_near"),
  );
  deepStrictEqual(
    store.query({ kind: "perceive", observer: ids.rex, entity: ids.hearth, sense: "sight" }),
    no("abstract"),
  );
  // 110 cm is just outside the threshold, and the answer is a fact, not a stored relation.
  deepStrictEqual(
    store.query({ kind: "fact", subject: ids.hearth, relation: "near", object: ids.table }),
    no("derived_near"),
  );
  deepStrictEqual(
    store.query({ kind: "fact", subject: ids.ann, relation: "near", object: ids.table }),
    yes("derived_near"),
  );
});

test("the script runs step by step in a store world and in a memory world", (t) => {
  const { store, memory, ids } = innWorlds(t);
  const steps = script(ids);
  // 57 steps, one beat of two among them: 58 submissions, 47 of which move the world.
  strictEqual(steps.length, 57);
  const fromStore = play(store, ids, steps);
  const fromMemory = play(memory, ids, steps);

  // One version per ok result, whichever world ran it.
  const oks = (results: Result[]): number => results.filter((result) => result.status === "ok").length;
  strictEqual(store.snapshot().version, oks(fromStore));
  strictEqual(memory.snapshot().version, oks(fromMemory));
  strictEqual(store.snapshot().version, 47);
  // and the rest of them are one refusal, one stale version, and one beat.
  strictEqual(fromStore.length, 58);
  strictEqual(store.snapshot().version, fromStore.length - 11);

  // The two worlds agree byte for byte, and they hold the same templates.
  strictEqual(canonicalJson(memory.snapshot()), canonicalJson(store.snapshot()));
  strictEqual(memory.snapshot().templates_hash, store.snapshot().templates_hash);
});

test("the inn's history folds to the steps that made it", (t) => {
  const { store, memory, ids } = innWorlds(t);
  const results = play(store, ids, script(ids));
  // `since(0)` is the log's own fold: every ok result's events, in the order they were produced.
  deepStrictEqual(
    store.since(0).events.map((event) => event.type),
    results.flatMap((result) => result.events.map((event) => event.type)),
  );
  // And the memory world, which has no log, folds its own records to the same list.
  const memoryResults = play(memory, ids, script(ids));
  deepStrictEqual(
    memory.since(0).events.map((event) => event.type),
    memoryResults.flatMap((result) => result.events.map((event) => event.type)),
  );
  // Deltas fold the same way: nothing was lost between the log and the snapshot.
  strictEqual(store.since(0).deltas.length, results.flatMap((result) => result.deltas).length);
});

test("the room's residue and the note's uncovering both trace to their root", (t) => {
  const { store, memory, ids } = innWorlds(t);
  const steps = script(ids);
  const results = play(store, ids, steps);
  // The memory world traces its own commands, so both are asked the same two questions.
  play(memory, ids, steps);
  const broke = results
    .flatMap((result) => result.events)
    .find((event) => event.type === "broken" && event.entity === ids.bottle);
  ok(broke !== undefined, "the bottle ann dropped broke");

  // The last thing to write residue on the room is that break, and the chain reads root-first: the
  // verb, the fall, the break.
  const residue = store.trace({ entity: ids.common, field: "residue" }).events;
  strictEqual(residue[residue.length - 1]?.event_id, broke.event_id, "the break wrote the last of it");
  deepStrictEqual(
    residue.map((event) => event.type),
    ["drop", "dropped", "broken"],
  );
  deepStrictEqual(
    memory.trace({ entity: ids.common, field: "residue" }).events.map((event) => event.type),
    ["drop", "dropped", "broken"],
  );

  // The note's concealment ended with the book lifted, so the event that cleared it traces to the
  // take that lifted it. `trace` follows the `concealed_by` field like any other Entity field.
  const revealed = store
    .since(0)
    .events.find((event) => event.type === "revealed" && event.entity === ids.note);
  ok(revealed !== undefined, "the note was uncovered");
  deepStrictEqual(
    store.trace({ event_id: revealed.event_id }).events.map((event) => event.type),
    ["take", "moved", "revealed"],
  );
  deepStrictEqual(
    memory.trace({ event_id: revealed.event_id }).events.map((event) => event.type),
    ["take", "moved", "revealed"],
  );
});

test("coverage decides whether smell is answered at all", (t) => {
  const { store, ids } = innWorlds(t);
  strictEqual(store.snapshot().coverage.senses.includes("smell"), true);
  const smelled = store.query({
    kind: "perceive",
    observer: ids.rex,
    entity: ids.cup,
    sense: "smell",
  });
  deepStrictEqual(smelled, no("odourless"), "an empty cup smells of nothing");

  // The same world handed to a memory world that declares the default coverage: the empty cup now
  // reads `unknown`, which is the category the snapshot does not cover, never `false`.
  const { store: seed } = innWorlds(t);
  const plain = memoryWorld(seed.snapshot(), undefined, ids, { coverage: UNSMELLING });
  deepStrictEqual(plain.snapshot().coverage.senses, ["sight", "hearing"]);
  deepStrictEqual(
    plain.query({ kind: "perceive", observer: ids.rex, entity: ids.cup, sense: "smell" }),
    { value: "unknown", basis_code: "uncovered_sense" },
  );
  // Everything else still answers: coverage is per category, not a switch.
  deepStrictEqual(
    plain.query({ kind: "perceive", observer: ids.ann, entity: ids.cup, sense: "sight" }),
    yes("same_location_lit"),
  );
  // And a coverage that is not lists of names is a caller's mistake, not a world.
  throws(
    () =>
      createWorld(join(tempDir(t), "bad-coverage"), inn, undefined, {
        coverage: { relations: "support", senses: [], properties: [] } as unknown as Coverage,
      }),
    /Coverage relations is not a list of names/,
  );
});

test(
  "an open door is crossed in both directions",
  (t) => {
    const { store, ids } = innWorlds(t);
    const opened = store.command({ command_id: "open", actor: ids.ann, verb: "open", target: "cellar door" });
    strictEqual(opened.status, "ok");
    const down = store.command({
      command_id: "down",
      actor: ids.bob,
      verb: "move",
      args: { location: ids.cellar },
    });
    strictEqual(down.status, "ok");
    // Bob is below, looking back at a room the engine says is connected to his by the open door.
    strictEqual(store.entity(ids.bob)?.location, ids.cellar);
    const up = store.command({
      command_id: "up",
      actor: ids.bob,
      verb: "move",
      args: { location: ids.common },
    });
    strictEqual(up.status, "ok", "the open door joins the two rooms, so he can go back up");
    strictEqual(store.entity(ids.bob)?.location, ids.common);
  },
);

test(
  "trace follows the concealed_by field the way it follows every other",
  (t) => {
    const { store, ids } = innWorlds(t);
    play(store, ids, script(ids));
    const chain = store.trace({ entity: ids.note, field: "concealed_by" }).events;
    deepStrictEqual(chain.map((event) => event.type), ["take", "moved", "revealed"]);
  },
);
