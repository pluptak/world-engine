import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  WorldError,
  type Coverage,
  type ObservedEntity,
  type Scenario,
  type World,
} from "../src/index.js";
import { ProjectionSchema } from "../src/contract.js";
import { loadTemplates } from "../src/templates.js";
import { presetRegistry } from "./presets.js";
import { fileURLToPath } from "node:url";

const presets = presetRegistry(loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))));

const FULL: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "smell", "touch"],
  properties: ["integrity", "residue", "pos"],
};

// A lit hall and a dark cellar joined by an open door. In the hall: a table with a cup, a book
// hiding a note, a shut chest holding a coin, ann with a key in her hand, and bob. In the cellar: a
// stone, and cal with a ring in his pocket.
const house: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "cellar", template: "room", overrides: { name: "cellar" } },
  {
    id: "door",
    template: "door",
    overrides: { name: "door", props: { open: true, from: "hall", to: "cellar" } },
  },
  { id: "table", template: "table", overrides: { name: "table", location: "hall", support: "hall", pos: { x: 100, y: 0 } } },
  { id: "cup", template: "cup", overrides: { name: "cup", location: "hall", support: "table" } },
  { id: "book", template: "book", overrides: { name: "book", location: "hall", support: "hall", pos: { x: -100, y: 0 } } },
  {
    id: "note",
    template: "note",
    overrides: { name: "note", location: "hall", support: "hall", pos: { x: -100, y: 0 }, concealed_by: "book" },
  },
  {
    id: "chest",
    template: "shut_chest",
    overrides: {
      name: "chest",
      location: "hall",
      support: "hall",
      pos: { x: 0, y: -100 },
    },
  },
  { id: "coin", template: "key", overrides: { name: "coin", location: "hall", contained_in: "chest" } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "key", template: "key", overrides: { name: "key", location: "hall", contained_in: "ann", in_part: "hand_r" } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 50, y: 50 } } },
  { id: "stone", template: "stone", overrides: { name: "stone", location: "cellar", support: "cellar", pos: { x: 0, y: 0 } } },
  { id: "cal", template: "human", overrides: { name: "cal", location: "cellar", support: "cellar", pos: { x: 50, y: 0 } } },
  { id: "ring", template: "key", overrides: { name: "ring", location: "cellar", contained_in: "cal", in_part: "pocket" } },
];

function worlds(t: { after(callback: () => void): void }, coverage: Coverage = FULL): World[] {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-projection-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createWorld(join(dir, "house"), house, presets, { coverage });
  const names: Record<string, string> = {};
  for (const entry of house) {
    const id = store.id(entry.id ?? "");
    ok(id !== null);
    names[entry.id ?? ""] = id;
  }
  return [store, memoryWorld(store.snapshot(), presets, names)];
}

function idOf(world: World, name: string): string {
  const id = world.id(name);
  ok(id !== null, name);
  return id;
}

function byName(world: World, entities: ObservedEntity[]): Map<string, ObservedEntity> {
  const names = new Map(Object.values(world.snapshot().entities).map((entity) => [entity.id, entity.name]));
  return new Map(entities.map((entity) => [names.get(entity.id) ?? entity.id, entity]));
}

test("bob in the lit hall sees what is in the open, and nothing hidden or shut away", (t) => {
  for (const world of worlds(t)) {
    const seen = byName(world, world.observe(idOf(world, "bob")).entities);
    deepStrictEqual(
      [...seen.keys()].sort(),
      ["ann", "bob", "book", "chest", "cup", "door", "key", "table"],
    );
    deepStrictEqual(seen.get("cup")?.facts?.support, idOf(world, "table"));
    deepStrictEqual(seen.get("table")?.facts?.location, idOf(world, "hall"));
    deepStrictEqual(seen.get("key")?.facts?.contained_in, idOf(world, "ann"));
    strictEqual(seen.get("key")?.facts?.in_part, "hand_r");
    deepStrictEqual(seen.get("cup")?.facts?.pos, { x: 100, y: 0 });
  }
});

test("cal in the dark feels only his own body, not even the ring in his pocket, and sees nothing", (t) => {
  for (const world of worlds(t)) {
    const projection = world.observe(idOf(world, "cal"));
    deepStrictEqual(
      projection.entities.map((entity) => [entity.name, entity.senses]),
      [["cal", ["touch"]]],
    );
  }
});

test("a reference to something the observer does not sense is left out, never leaked", (t) => {
  for (const world of worlds(t)) {
    // The coin is inside the shut chest: unseen, so the chest is listed and the coin is not.
    const seen = byName(world, world.observe(idOf(world, "bob")).entities);
    strictEqual(seen.has("coin"), false);
    // The door joins the hall to the cellar; it has no location of its own, which reads null.
    strictEqual(seen.get("door")?.facts?.location, null);
    // Light the cellar: bob sees the stone through the open door, but the cellar is not his room
    // and not a thing he senses, so where the stone stands is left out rather than named.
    strictEqual(
      world.edit({ kind: "set_props", target: idOf(world, "cellar"), props: { lit: true } }).status,
      "ok",
    );
    const stone = byName(world, world.observe(idOf(world, "bob")).entities).get("stone");
    deepStrictEqual(stone?.senses, ["sight"]);
    strictEqual(stone?.facts !== undefined && "location" in stone.facts, false);
    strictEqual(stone?.facts !== undefined && "support" in stone.facts, false);
  }
});

test("coverage decides the fields and the senses", (t) => {
  const narrow: Coverage = { relations: ["support"], senses: ["sight", "hearing"], properties: [] };
  for (const world of worlds(t, narrow)) {
    const projection = world.observe(idOf(world, "bob"));
    deepStrictEqual(projection.unknown_senses, ["smell", "touch"]);
    const cup = byName(world, projection.entities).get("cup");
    deepStrictEqual(cup?.facts, { support: idOf(world, "table") });
  }
});

test("events since a version: a push in the hall is seen and heard, a pocket theft in the dark is not sensed", (t) => {
  for (const world of worlds(t)) {
    const start = world.snapshot().version;
    strictEqual(
      world.command({ command_id: "push-cup", actor: idOf(world, "ann"), verb: "push", target: "table", args: { distance_cm: 10 } }).status,
      "ok",
    );
    const bob = world.observe(idOf(world, "bob"), { since: start });
    deepStrictEqual(
      bob.events.map((event) => [event.type, event.senses]),
      [
        ["push", ["sight", "hearing"]],
        ["moved", ["sight", "hearing"]],
      ],
    );
    strictEqual(world.command({ command_id: "go-down", actor: idOf(world, "bob"), verb: "move", args: { location: idOf(world, "cellar") } }).status, "ok");
    strictEqual(world.command({ command_id: "to-cal", actor: idOf(world, "bob"), verb: "move", args: { to: { x: 50, y: 30 } } }).status, "ok");
    const before = world.snapshot().version;
    strictEqual(world.command({ command_id: "lift-ring", actor: idOf(world, "bob"), verb: "take", target: "ring" }).status, "ok");
    deepStrictEqual(world.observe(idOf(world, "cal"), { since: before }).events, []);
  }
});

test("footsteps heard in the dark name no walker; in the light the walker is named", (t) => {
  for (const world of worlds(t)) {
    const ann = idOf(world, "ann");
    const bob = idOf(world, "bob");
    const cal = idOf(world, "cal");
    const row = (event: { type: string; senses: string[]; entity?: string; from?: string }) => [
      event.type,
      event.senses,
      "entity" in event ? event.entity : null,
      "from" in event ? event.from : null,
    ];
    const walk = (actor: string, to: { x: number; y: number }, id: string) =>
      strictEqual(world.command({ command_id: id, actor, verb: "move", args: { to } }).status, "ok");

    // In the lit hall bob sees ann walk, so the steps are hers.
    let since = world.snapshot().version;
    walk(ann, { x: -30, y: 0 }, "ann-steps");
    const lit = world.observe(bob, { since }).events;
    ok(lit.length > 0);
    deepStrictEqual(
      lit.map(row),
      lit.map((event) => [event.type, ["sight", "hearing"], ann, null]),
    );

    // In the dark cellar bob hears cal's steps and cannot see him: they came from the room, from nobody.
    strictEqual(world.command({ command_id: "go-down", actor: bob, verb: "move", args: { location: idOf(world, "cellar") } }).status, "ok");
    walk(bob, { x: 50, y: 30 }, "to-cal");
    since = world.snapshot().version;
    walk(cal, { x: 90, y: 0 }, "cal-steps");
    const dark = ProjectionSchema.parse(world.observe(bob, { since }));
    ok(dark.events.length > 0);
    deepStrictEqual(
      dark.events.map(row),
      dark.events.map((event) => [event.type, ["hearing"], null, "here"]),
    );
    // The omniscient record still says whose they were.
    ok(world.since(since).events.every((event) => event.entity === cal || event.type === "move"));
  }
});

test("store and memory worlds project byte for byte alike, and the CLI contract accepts it", (t) => {
  const [store, memory] = worlds(t);
  ok(store !== undefined && memory !== undefined);
  const bob = idOf(store, "bob");
  strictEqual(canonicalJson(store.observe(bob, { since: 0 })), canonicalJson(memory.observe(bob, { since: 0 })));
  ProjectionSchema.parse(store.observe(bob, { since: 0 }));
});

test("an unknown observer is refused", (t) => {
  for (const world of worlds(t)) {
    throws(
      () => world.observe("e999"),
      (error: unknown) => error instanceof WorldError && error.code === "no_such_entity",
    );
  }
});

test("the CLI contract holds an observed event to naming its entity or saying where it was heard from", () => {
  const view = (event: Record<string, unknown>) =>
    ProjectionSchema.safeParse({
      observer: "e1",
      version: 1,
      unknown_senses: [],
      entities: [],
      events: [{ event_id: "ev1", tick: 0, type: "moved", senses: ["hearing"], ...event }],
    }).success;
  strictEqual(view({ entity: "e2" }), true);
  strictEqual(view({ from: "here" }), true);
  strictEqual(view({ from: "next_door" }), true);
  strictEqual(view({}), false);
  strictEqual(view({ entity: "e2", from: "here" }), false);
  strictEqual(view({ from: "far_away" }), false);
});
