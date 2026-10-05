import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createWorld,
  memoryWorld,
  type Command,
  type Coverage,
  type Scenario,
  type World,
} from "../src/index.js";
import { EVENT_SENSES, query } from "../src/engine/query.js";
import { verbCatalog } from "../src/engine/verbs/index.js";
import { loadTemplates } from "../src/templates.js";
import { fileURLToPath } from "node:url";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

// Every TypeScript file under a directory, so the scan for `emit("…")` reads the whole source tree.
function sourceFiles(dir: URL): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(fileURLToPath(dir), entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(new URL(`${entry}/`, dir)));
    } else if (entry.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found.sort();
}

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-senses-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Three lit rooms: the hall, one through an open door, one through a shut door. A cat sits in the
// hall (it is the only one of the three that can smell), one in the next room, a dog behind the shut
// door, and ann acts in the hall.
const hall: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "side", template: "room", overrides: { name: "side", props: { lit: true } } },
  { id: "back", template: "room", overrides: { name: "back", props: { lit: true } } },
  {
    id: "open-door",
    template: "door",
    overrides: { name: "open-door", props: { openable: true, open: true, from: "hall", to: "side" } },
  },
  {
    id: "shut-door",
    template: "door",
    overrides: { name: "shut-door", props: { openable: true, open: false, from: "hall", to: "back" } },
  },
  {
    id: "table",
    template: "table",
    overrides: { name: "table", location: "hall", support: "hall", pos: { x: 30, y: 0 } },
  },
  {
    id: "chest",
    template: "chest",
    overrides: {
      name: "chest",
      location: "hall",
      support: "hall",
      pos: { x: -30, y: 0 },
      props: {
        container: true,
        topples: true,
        inner_w_cm: 55,
        inner_d_cm: 35,
        inner_h_cm: 35,
        openable: true,
        open: true,
      },
    },
  },
  {
    id: "bottle",
    template: "wine_bottle",
    overrides: { name: "bottle", location: "hall", support: "table" },
  },
  { id: "cup", template: "cup", overrides: { name: "cup", location: "hall", support: "table" } },
  {
    id: "book",
    template: "stone",
    overrides: { name: "book", location: "hall", support: "hall", pos: { x: 20, y: 0 } },
  },
  {
    id: "note",
    template: "stone",
    overrides: {
      name: "note",
      location: "hall",
      support: "hall",
      pos: { x: 20, y: 0 },
      concealed_by: "book",
    },
  },
  {
    id: "ann",
    template: "human",
    overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
  },
  {
    id: "kit",
    template: "cat",
    overrides: { name: "kit", location: "hall", support: "hall", pos: { x: -10, y: 0 } },
  },
  {
    id: "watcher",
    template: "cat",
    overrides: { name: "watcher", location: "side", support: "side", pos: { x: 0, y: 0 } },
  },
  {
    id: "rex",
    template: "dog",
    overrides: { name: "rex", location: "back", support: "back", pos: { x: 0, y: 0 } },
  },
  // A second bottle, emptied by its pour: the vessel no longer smells afterwards, so only the
  // `pour` row itself can say the pour was smelt.
  {
    id: "spare",
    template: "wine_bottle",
    overrides: { name: "spare", location: "hall", support: "table" },
  },
];

const ANN = "e12";
const IN_HALL = "e13";
const THROUGH_OPEN_DOOR = "e14";
const THROUGH_SHUT_DOOR = "e15";
const BOTTLE = "e8";
const SPARE = "e16";
const CUP = "e9";
const CHEST = "e7";
const TABLE = "e6";
const BOOK = "e10";

// One script that leaves behind an event of every class the table names.
const script: Command[] = [
  // Footsteps first: the `event` row is read off the first `moved`, and a move the hands caused
  // is silent, so the row needs one the feet made.
  { command_id: "step-out", actor: ANN, verb: "move", args: { to: { x: 5, y: 0 } } },
  { command_id: "open-chest", actor: ANN, verb: "open", target: "chest" },
  { command_id: "close-chest", actor: ANN, verb: "close", target: "chest" },
  { command_id: "search-book", actor: ANN, verb: "search", target: "book" },
  { command_id: "wait-a-tick", actor: ANN, verb: "wait", args: { ticks: 1 } },
  { command_id: "cut-0", actor: ANN, verb: "attack", target: `${ANN}.arm_r` },
  { command_id: "cut-1", actor: ANN, verb: "attack", target: `${ANN}.arm_r` },
  { command_id: "cut-2", actor: ANN, verb: "attack", target: `${ANN}.arm_r` },
  { command_id: "take-book", actor: ANN, verb: "take", target: "book" },
  // The book needs both hands, so it is set down again before the bottle: it cannot break, and a
  // 100 cm fall is loud like the bottle's, so no row reads differently.
  { command_id: "drop-book", actor: ANN, verb: "drop", target: "book" },
  { command_id: "take-bottle", actor: ANN, verb: "take", target: "bottle" },
  { command_id: "drop-bottle", actor: ANN, verb: "drop", target: "bottle" },
  { command_id: "take-spare", actor: ANN, verb: "take", target: "spare" },
];

interface Answer {
  value: string;
  basis_code: string;
}

const no = (basis_code: string): Answer => ({ value: "false", basis_code });
const yes = (basis_code: string): Answer => ({ value: "true", basis_code });

// One row of the sense table in docs/perception.md, as the answers it promises. Each sense lists
// the same room, an open door, then a shut door.
interface Row {
  name: string;
  event?: string;
  entity?: string;
  answers: { sight: Answer[]; hearing: Answer[]; smell: Answer[]; touch: Answer[] };
}

const rows: Row[] = [
  {
    name: "authored",
    event: "placed",
    answers: {
      sight: [no("authored"), no("authored"), no("authored")],
      hearing: [no("authored"), no("authored"), no("authored")],
      smell: [no("authored"), no("authored"), no("authored")],
      touch: [no("authored"), no("authored"), no("authored")],
    },
  },
  {
    name: "pour",
    event: "poured",
    answers: {
      sight: [yes("same_location_lit"), yes("adjacent_open_door_lit"), no("not_perceptible")],
      hearing: [yes("same_location"), no("not_perceptible"), no("not_perceptible")],
      smell: [yes("same_location"), no("not_perceptible"), no("not_perceptible")],
      touch: [no("not_touching"), no("not_touching"), no("not_touching")],
    },
  },
  {
    name: "broken",
    event: "broken",
    answers: {
      sight: [yes("same_location_lit"), yes("adjacent_open_door_lit"), no("not_perceptible")],
      hearing: [yes("same_location"), yes("adjacent_loud_event"), yes("adjacent_loud_event")],
      smell: [yes("same_location"), yes("adjacent_loud_event"), yes("adjacent_loud_event")],
      touch: [no("not_touching"), no("not_touching"), no("not_touching")],
    },
  },
  {
    name: "event",
    event: "moved",
    answers: {
      sight: [yes("same_location_lit"), yes("adjacent_open_door_lit"), no("not_perceptible")],
      hearing: [yes("same_location"), no("not_perceptible"), no("not_perceptible")],
      smell: [no("odourless"), no("not_perceptible"), no("not_perceptible")],
      touch: [no("not_touching"), no("not_touching"), no("not_touching")],
    },
  },
  {
    name: "entity-odorous",
    entity: CUP,
    answers: {
      sight: [yes("same_location_lit"), yes("adjacent_open_door_lit"), no("not_perceptible")],
      hearing: [yes("same_location"), no("not_perceptible"), no("not_perceptible")],
      smell: [yes("same_location"), no("not_perceptible"), no("not_perceptible")],
      touch: [no("not_touching"), no("not_touching"), no("not_touching")],
    },
  },
  {
    name: "entity-odourless",
    entity: CHEST,
    answers: {
      sight: [yes("same_location_lit"), yes("adjacent_open_door_lit"), no("not_perceptible")],
      hearing: [yes("same_location"), no("not_perceptible"), no("not_perceptible")],
      smell: [no("odourless"), no("not_perceptible"), no("not_perceptible")],
      touch: [no("not_touching"), no("not_touching"), no("not_touching")],
    },
  },
];

// The `event` row is a class, so one member is not enough: these are the rest of them, all read the
// same way. The first `spawned` in the script is the severed arm, whose cause is the `detached`.
const alsoQuiet = [
  "opened",
  "closed",
  "search",
  "found",
  "wait",
  "attack",
  "damaged",
  "detached",
  "spawned",
  "dropped",
  "revealed",
];

function eventIdOf(world: World, type: string): string {
  const found = world.since(0).events.find((event) => event.type === type);
  ok(found !== undefined, `no ${type} event in the script`);
  return found.event_id;
}

function runScript(world: World): void {
  for (const command of script) {
    const result = world.command(command);
    strictEqual(result.status, "ok", `${command.command_id} (${result.status})`);
  }
  // The world author's own work, which leaves a `placed` event behind, and then a table removed from
  // under the cup, which displaces it.
  const placed = world.edit(
    { kind: "place", target: CHEST, support: "e1", pos: { x: -35, y: 0 } },
    { command_id: "place-chest" },
  );
  strictEqual(placed.status, "ok");
  const removed = world.edit({ kind: "remove", target: TABLE }, { command_id: "remove-table" });
  strictEqual(removed.status, "ok");
  // The pour comes last: the cup falls empty when the table goes (an empty fall spills nothing),
  // so it still holds its wine when the rows are walked.
  const poured = world.command({
    command_id: "pour-spare",
    actor: ANN,
    verb: "pour",
    target: "spare",
    args: { destination: "cup", amount: 75 },
  });
  strictEqual(poured.status, "ok", `pour-spare (${poured.status})`);
}

// Coverage that includes smell and touch.
const SMELLING: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "smell", "touch"],
  properties: ["integrity", "residue", "pos"],
};

function walkTable(world: World, senses: readonly string[]): void {
  const situations = [
    { observer: IN_HALL, label: "same room" },
    { observer: THROUGH_OPEN_DOOR, label: "open door" },
    { observer: THROUGH_SHUT_DOOR, label: "shut door" },
  ];
  for (const row of rows) {
    const eventId = row.event === undefined ? undefined : eventIdOf(world, row.event);
    row.answers.sight.forEach((expected, index) => {
      const sense = "sight";
      if (!senses.includes(sense)) {
        return;
      }
      const situation = situations[index];
      ok(situation);
      const answer = world.query({
        kind: "perceive",
        observer: situation.observer,
        sense,
        ...(row.entity === undefined ? { event_id: eventId } : { entity: row.entity }),
      });
      deepStrictEqual(answer, expected, `${row.name} / ${sense} / ${situation.label}`);
    });
    for (const sense of ["hearing", "smell", "touch"] as const) {
      if (!senses.includes(sense)) {
        continue;
      }
      row.answers[sense].forEach((expected, index) => {
        const situation = situations[index];
        ok(situation);
        const answer = world.query({
          kind: "perceive",
          observer: situation.observer,
          sense,
          ...(row.entity === undefined ? { event_id: eventId } : { entity: row.entity }),
        });
        deepStrictEqual(answer, expected, `${row.name} / ${sense} / ${situation.label}`);
      });
    }
  }

  // The rest of the `event` row's members, heard next door only when loud and smelt never.
  // Hand acts are the exception: the ear reports them nowhere, near or far.
  const silent = new Set(["search", "found", "wait", "revealed"]);
  for (const type of alsoQuiet) {
    const eventId = eventIdOf(world, type);
    const loud = type === "broken" || type === "detached" || type === "dropped";
    for (const sense of senses) {
      const same = world.query({ kind: "perceive", observer: IN_HALL, event_id: eventId, sense });
      const far = world.query({
        kind: "perceive",
        observer: THROUGH_OPEN_DOOR,
        event_id: eventId,
        sense,
      });
      const expectedSame =
        sense === "smell"
          ? no("odourless")
          : sense === "touch"
            ? no("not_touching")
            : sense === "hearing" && silent.has(type)
              ? no("quiet")
              : sense === "sight"
                ? yes("same_location_lit")
                : yes("same_location");
      const expectedFar =
        sense === "sight"
          ? yes("adjacent_open_door_lit")
          : sense === "touch"
            ? no("not_touching")
            : sense === "hearing" && loud
              ? yes("adjacent_loud_event")
              : no("not_perceptible");
      deepStrictEqual(same, expectedSame, `${type} / ${sense} / same room`);
      deepStrictEqual(far, expectedFar, `${type} / ${sense} / open door`);
    }
  }
}

test("every event type the engine can emit has a row of the sense table", (t) => {
// A verb's root event carries the verb's name, and everything else is named where it is emitted:
  // a literal at the call, or — for the openable verbs — as the `event` of a declared change.
  const sources = sourceFiles(new URL("../src/", import.meta.url));
  const emitted = new Set<string>();
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const pattern of [/\.emit\(\s*"([^"]+)"/g, /\bevent: "([^"]+)"/g]) {
      for (const match of text.matchAll(pattern)) {
        const type = match[1];
        ok(type !== undefined, file);
        emitted.add(type);
      }
    }
  }
  for (const entry of verbCatalog()) {
    emitted.add(entry.verb);
  }
  const types = [...emitted].sort();

  const missing = types.filter((type) => !Object.hasOwn(EVENT_SENSES, type));
  deepStrictEqual(missing, [], `no sense row for: ${missing.join(", ")}`);
  const listed = Object.keys(EVENT_SENSES).sort();
  deepStrictEqual(
    listed.filter((type) => !emitted.has(type)),
    [],
    "sense rows for types the engine never emits",
  );
  strictEqual(listed.length, types.length);

  // Every row also says whether touch can feel it: the table, not a chain of conditionals, is
  // what the sense reads.
  for (const type of listed) {
    ok(Object.hasOwn(EVENT_SENSES[type] ?? {}, "touch"), `no touch column for: ${type}`);
  }

  // And the types a world really produces are all of them: a store world and a memory world over the
  // same script, so a type emitted through something the scan cannot see is caught too.
const store = createWorld(join(tempDir(t), "every-type"), hall);
  const initial = store.snapshot();
  runScript(store);
  const smelly = memoryWorld(initial, undefined, { ann: ANN }, { coverage: SMELLING });
  runScript(smelly);
  for (const world of [store, smelly]) {
    const seen = [...new Set(world.since(0).events.map((event) => event.type))].sort();
    deepStrictEqual(
      seen.filter((type) => !Object.hasOwn(EVENT_SENSES, type)),
      [],
      "events a world produced with no sense row",
    );
  }
});

test("the sense table holds row by row in a store world and in a memory world", (t) => {
  const store = createWorld(join(tempDir(t), "senses"), hall);
  const initial = store.snapshot();
  runScript(store);
  // A store world declares sight and hearing only, so that is what its rows can answer.
  walkTable(store, ["sight", "hearing"]);

  const smelly = memoryWorld(initial, undefined, {
    ann: ANN,
    kit: IN_HALL,
    watcher: THROUGH_OPEN_DOOR,
    rex: THROUGH_SHUT_DOOR,
    book: BOOK,
    cup: CUP,
    chest: CHEST,
  }, { coverage: SMELLING });
  runScript(smelly);
  walkTable(smelly, ["sight", "hearing", "smell", "touch"]);

  // The `pour` row is the only row a vessel's own emptiness cannot argue with: the spare bottle is
  // empty by the end of its pour, so read against the present — not the either-end rule — only the
  // `pour` row says the pour was smelt. This is the cell a swap of `always` to `odorous` breaks.
  strictEqual(smelly.entity(SPARE)?.props.liquid_material, "");
  deepStrictEqual(
    query(smelly.snapshot(), registry, smelly.since(0).events, {
      kind: "perceive",
      observer: IN_HALL,
      event_id: eventIdOf(smelly, "poured"),
      sense: "smell",
    }),
    yes("same_location"),
    "pour / smell / same room",
  );
  // And the cup now holds what was poured, which is what the entity-odorous row reads.
  strictEqual(smelly.entity(CUP)?.props.liquid_material, "grape_wine");
  strictEqual(smelly.snapshot().templates_hash, store.snapshot().templates_hash);
});

test("an edit's own events are nobody's, and its fall and break are", (t) => {
  const scenario: Scenario = [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    {
      id: "table",
      template: "table",
      overrides: { name: "table", location: "hall", support: "hall", pos: { x: 30, y: 0 } },
    },
    {
      id: "bottle",
      template: "wine_bottle",
      overrides: { name: "bottle", location: "hall", support: "table" },
    },
    {
      id: "ann",
      template: "human",
      overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
    },
    {
      id: "kit",
      template: "cat",
      overrides: { name: "kit", location: "hall", support: "hall", pos: { x: -10, y: 0 } },
    },
  ];
  const store = createWorld(join(tempDir(t), "edit-bottle"), scenario);
  const world = store;
  const initial = store.snapshot();
  const removed = world.edit(
    { kind: "remove", target: "e2" },
    { command_id: "remove-table", perceivers: true },
  );
  strictEqual(removed.status, "ok");
  const byType = new Map(removed.events.map((event) => [event.type, event]));
  deepStrictEqual(
    removed.events.map((event) => event.type),
    ["edit", "removed", "displaced", "dropped", "broken", "spawned", "spawned", "spawned"],
  );

  // The world author's own work: nobody sensed it, by any sense.
  for (const type of ["edit", "removed"]) {
    const event = byType.get(type);
    ok(event);
    deepStrictEqual(event.perceivers?.sight, [], type);
    deepStrictEqual(event.perceivers?.hearing, [], type);
    deepStrictEqual(event.perceivers?.smell, [], type);
    deepStrictEqual(
      world.query({ kind: "perceive", observer: "e5", event_id: event.event_id, sense: "sight" }),
      no("authored"),
      type,
    );
  }

  // Its consequences happened in front of the room, so they are seen and heard.
  for (const type of ["displaced", "dropped", "broken"]) {
    const event = byType.get(type);
    ok(event);
    deepStrictEqual(event.perceivers?.sight, ["e4", "e5"], type);
    deepStrictEqual(event.perceivers?.hearing, ["e4", "e5"], type);
  }
  // The break released what was in the bottle, so with smell declared the nose gets it too.
  const broken = byType.get("broken");
  ok(broken);
  deepStrictEqual(broken.perceivers?.smell, []);
  deepStrictEqual(broken.perceivers?.unknown_senses, ["smell", "touch"]);

  const smelly = memoryWorld(initial, undefined, { ann: "e4", kit: "e5" }, { coverage: SMELLING });
  const again = smelly.edit(
    { kind: "remove", target: "e2" },
    { command_id: "remove-table", perceivers: true },
  );
  strictEqual(again.status, "ok");
  const smellyByType = new Map(again.events.map((event) => [event.type, event]));
  const smellyBreak = smellyByType.get("broken");
  ok(smellyBreak);
  deepStrictEqual(smellyBreak.perceivers?.sight, ["e4", "e5"]);
  deepStrictEqual(smellyBreak.perceivers?.hearing, ["e4", "e5"]);
  deepStrictEqual(smellyBreak.perceivers?.smell, ["e5"]);
  deepStrictEqual(smellyBreak.perceivers?.unknown_senses, []);
  const smellyDrop = smellyByType.get("dropped");
  ok(smellyDrop);
  deepStrictEqual(smellyDrop.perceivers?.smell, []);
  const smellyEdit = smellyByType.get("edit");
  ok(smellyEdit);
  deepStrictEqual(smellyEdit.perceivers?.smell, []);
  deepStrictEqual(smellyEdit.perceivers?.touch, []);
});

test("a search and an open are never smelled", (t) => {
  const store = createWorld(join(tempDir(t), "quiet-roots"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    {
      id: "chest",
      template: "chest",
      overrides: {
        name: "chest",
        location: "hall",
        support: "hall",
        pos: { x: 30, y: 0 },
        props: {
          container: true,
          inner_w_cm: 55,
          inner_d_cm: 35,
          inner_h_cm: 35,
          openable: true,
          open: true,
        },
      },
    },
    // Ann acts, and the cat with a nose is what senses it: a human cannot smell at all.
    {
      id: "ann",
      template: "human",
      overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
    },
    {
      id: "kit",
      template: "cat",
      overrides: { name: "kit", location: "hall", support: "hall", pos: { x: 10, y: 0 } },
    },
  ]);
  const world = memoryWorld(store.snapshot(), undefined, { chest: "e2" }, { coverage: SMELLING });
  const searched = world.command({ command_id: "search-chest", actor: "e3", verb: "search", target: "chest" });
  strictEqual(searched.status, "ok");
  const opened = world.command({ command_id: "open-chest", actor: "e3", verb: "open", target: "chest" });
  strictEqual(opened.status, "ok");

  for (const result of [searched, opened]) {
    const root = result.events[0];
    ok(root);
    for (const sense of ["sight", "hearing", "smell"]) {
      const answer = world.query({
        kind: "perceive",
        observer: "e4",
        event_id: root.event_id,
        sense,
      });
      // A search is a hand act: heard nowhere, while an open is heard in the room.
      const expected: Answer =
        sense === "sight"
          ? yes("same_location_lit")
          : sense === "hearing"
            ? root.type === "search"
              ? no("quiet")
              : yes("same_location")
            : no("odourless");
      deepStrictEqual(answer, expected, `${root.type} / ${sense}`);
    }
  }
});