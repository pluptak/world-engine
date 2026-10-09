import { deepStrictEqual, notStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  type Scenario,
  type World,
  type WorldEdit,
} from "../src/index.js";
import { WorldError } from "../src/errors.js";
import { NEAR_THRESHOLD_CM, query } from "../src/engine/query.js";
import { EntityOverridesSchema, ScenarioSchema, WorldEditSchema } from "../src/contract.js";
import { resolveScenario, type ScenarioOverrides } from "../src/scenario.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-space-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    ok(error instanceof WorldError, String(error));
    return error.code;
  }
  throw new Error("expected a WorldError");
}

// The bottle chain in the positions scenarios/bottle.json spells out.
const literalBottle: Scenario = [
  { id: "room", template: "room", overrides: { name: "room" } },
  {
    id: "table",
    template: "table",
    overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } },
  },
  {
    id: "bottle",
    template: "bottle",
    overrides: { name: "bottle", location: "room", support: "table" },
  },
  {
    id: "pusher",
    template: "human",
    overrides: { name: "pusher", location: "room", support: "room", pos: { x: -50, y: 0 } },
  },
  // In the table's path, so the push stops short and the jolt knocks the bottle off.
  {
    template: "stone",
    overrides: { name: "doorstop", location: "room", support: "room", pos: { x: 129, y: 0 } },
  },
];

// The same world with no literal pos at all: the table and the pusher are placed against anchors.
const anchoredBottle: Scenario = [
  { id: "room", template: "room", overrides: { name: "room" } },
  {
    id: "mid",
    template: "anchor",
    overrides: { name: "mid", location: "room", support: "room", pos: { x: 0, y: 0 } },
  },
  {
    id: "west",
    template: "anchor",
    overrides: { name: "west", location: "room", support: "room", pos: { x: 0, y: 0 } },
  },
  {
    id: "table",
    template: "table",
    overrides: { name: "table", pos: { anchor: "mid", dx: 30, dy: 0 } },
  },
  {
    id: "bottle",
    template: "bottle",
    overrides: { name: "bottle", location: "room", support: "table" },
  },
  {
    id: "pusher",
    template: "human",
    overrides: { name: "pusher", pos: { anchor: "west", dx: -50, dy: 0 } },
  },
  {
    id: "doorstop",
    template: "stone",
    overrides: { name: "doorstop", pos: { anchor: "mid", dx: 129, dy: 0 } },
  },
];

const pushTable = {
  command_id: "push-table",
  verb: "push",
  target: "table",
};

// What a chain left behind, by name and without ids: two worlds that spell the same positions
// differently number their entities differently, and that is not what "the same chain" means.
function named(world: World, names: string[]): unknown {
  return names.map((name) => {
    const entity = world.entity(world.id(name)!);
    ok(entity !== null, `no entity named ${name}`);
    const { id: _id, ...rest } = entity;
    return rest;
  });
}

test("an anchor in a scenario resolves to a stored pos and is recorded nowhere", () => {
  const resolved = resolveScenario([
    { id: "room", template: "room", overrides: { name: "room" } },
    {
      id: "table",
      template: "table",
      overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } },
    },
    {
      id: "corner",
      template: "anchor",
      overrides: { name: "corner", location: "room", support: "room", pos: { x: 90, y: 40 } },
    },
    {
      id: "bottle",
      template: "bottle",
      overrides: { name: "bottle", pos: { anchor: "corner", dx: -10, dy: 5 } },
    },
  ]);

  deepStrictEqual(resolved.scenario[3], {
    id: "bottle",
    template: "bottle",
    overrides: {
      name: "bottle",
      location: "e1",
      support: "e1",
      pos: { x: 80, y: 45 },
    },
  });
});

test("an entry naming both a holder and an anchor is refused", () => {
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "room", template: "room", overrides: { name: "room" } },
        {
          id: "corner",
          template: "anchor",
          overrides: { name: "corner", location: "room", support: "room", pos: { x: 90, y: 40 } },
        },
        {
          id: "bottle",
          template: "bottle",
          overrides: { name: "bottle", support: "room", pos: { anchor: "corner", dx: 1, dy: 1 } },
        },
      ]),
    ),
    "conflicting_placement",
  );
});

test("an anchor may be named forward, and by id beside a name", () => {
  const forward = resolveScenario([
    { template: "bottle", overrides: { name: "bottle", pos: { anchor: "corner", dx: 1, dy: 2 } } },
    { id: "room", template: "room", overrides: { name: "room" } },
    {
      id: "corner",
      template: "anchor",
      overrides: { name: "corner", location: "room", support: "room", pos: { x: 90, y: 40 } },
    },
  ]);
  deepStrictEqual(forward.scenario[0]?.overrides?.pos, { x: 91, y: 42 });
  deepStrictEqual(forward.scenario[0]?.overrides?.support, "e2");

  const byId = resolveScenario([
    { id: "room", template: "room", overrides: { name: "room" } },
    {
      template: "anchor",
      overrides: { name: "corner", location: "room", support: "room", pos: { x: 90, y: 40 } },
    },
    { template: "bottle", overrides: { name: "bottle", pos: { anchor: "e2", dx: 0, dy: -40 } } },
  ]);
  deepStrictEqual(byId.scenario[2]?.overrides?.pos, { x: 90, y: 0 });
});

test("an anchor that is not a fixed point in a room is refused", () => {
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "room", template: "room", overrides: { name: "room" } },
        {
          id: "table",
          template: "table",
          overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } },
        },
        { id: "corner", template: "anchor", overrides: { name: "corner", location: "room", support: "table", pos: { x: 30, y: 0 } } },
        { id: "bottle", template: "bottle", overrides: { name: "bottle", pos: { anchor: "corner", dx: 1, dy: 1 } } },
      ]),
    ),
    "anchor_not_room_supported",
  );

  // An anchor placed against another anchor is not a fixed point either.
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "room", template: "room", overrides: { name: "room" } },
        {
          id: "corner",
          template: "anchor",
          overrides: { name: "corner", location: "room", support: "room", pos: { x: 90, y: 40 } },
        },
        {
          id: "other",
          template: "anchor",
          overrides: { name: "other", pos: { anchor: "corner", dx: 1, dy: 1 } },
        },
        { id: "bottle", template: "bottle", overrides: { name: "bottle", pos: { anchor: "other", dx: 1, dy: 1 } } },
      ]),
    ),
    "anchor_not_room_supported",
  );

  // An anchor whose own position is not a position has nothing to offset from either. The type says
  // a pos is one or the other, so the mistake needs the cast a JSON scenario would not.
  const halfAPos = { x: 90 } as unknown as ScenarioOverrides["pos"];
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "room", template: "room", overrides: { name: "room" } },
        {
          id: "corner",
          template: "anchor",
          overrides: { name: "corner", location: "room", support: "room", pos: halfAPos },
        },
        { id: "bottle", template: "bottle", overrides: { name: "bottle", pos: { anchor: "corner", dx: 1, dy: 1 } } },
      ]),
    ),
    "anchor_not_room_supported",
  );
});

test("an anchor that names nothing is refused", () => {
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "room", template: "room", overrides: { name: "room" } },
        { id: "bottle", template: "bottle", overrides: { name: "bottle", pos: { anchor: "corner", dx: 1, dy: 1 } } },
      ]),
    ),
    "unknown_anchor",
  );
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "room", template: "room", overrides: { name: "room" } },
        { id: "bottle", template: "bottle", overrides: { name: "bottle", pos: { anchor: "e9", dx: 1, dy: 1 } } },
      ]),
    ),
    "unknown_anchor",
  );
});

test("the bottle scenario authored against anchors runs the same chain", (t) => {
  const literal = createWorld(join(tempDir(t), "literal"), literalBottle);
  const anchored = createWorld(join(tempDir(t), "anchored"), anchoredBottle);
  const memory = memoryWorld(
    anchored.snapshot(),
    undefined,
    { room: "e1", mid: "e2", west: "e3", table: "e4", bottle: "e5", pusher: "e6" },
  );

  for (const world of [literal, anchored, memory]) {
    const result = world.command({ ...pushTable, actor: world.id("pusher")! });
    strictEqual(result.status, "ok", canonicalJson(result.snapshot.coverage));
    deepStrictEqual(
      result.events.map((event) => event.type),
      ["push", "moved", "collided", "displaced", "dropped", "broken", "spawned", "spawned", "spawned"],
    );
  }

  const pushed = createWorld(join(tempDir(t), "literal-chain"), literalBottle);
  strictEqual(pushed.command({ ...pushTable, actor: pushed.id("pusher")! }).status, "ok");
  for (const world of [anchored, memory]) {
    strictEqual(
      canonicalJson(named(world, ["room", "table", "bottle", "pusher"])),
      canonicalJson(named(pushed, ["room", "table", "bottle", "pusher"])),
    );
  }
});

const editScenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room" } },
  {
    id: "table",
    template: "table",
    overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } },
  },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "table" } },
  {
    id: "pusher",
    template: "human",
    overrides: { name: "pusher", location: "room", support: "room", pos: { x: -50, y: 0 } },
  },
  { id: "yard", template: "room", overrides: { name: "yard" } },
];

// Both a store world and a memory one, so every edit below is asserted twice.
function bothWorlds(t: { after(callback: () => void): void }): [World, World] {
  const store = createWorld(join(tempDir(t), "store"), editScenario);
  return [
    store,
    memoryWorld(store.snapshot(), undefined, {
      room: "e1",
      table: "e2",
      bottle: "e3",
      pusher: "e4",
      yard: "e5",
    }),
  ];
}

function spawnCorner(world: World): string {
  const result = world.edit({
    kind: "spawn",
    template: "anchor",
    overrides: { name: "corner", location: "e1", support: "e1", pos: { x: 90, y: 40 } },
  });
  strictEqual(result.status, "ok");
  const id = result.events[1]?.entity;
  ok(typeof id === "string");
  return id;
}

// A stone out in the yard, so placing it by an anchor in the room moves every placement field.
function spawnInYard(world: World): string {
  const result = world.edit({
    kind: "spawn",
    template: "stone",
    overrides: { name: "pebble", location: "e5", support: "e5", pos: { x: 0, y: 0 } },
  });
  strictEqual(result.status, "ok");
  const id = result.events[1]?.entity;
  ok(typeof id === "string");
  return id;
}

const inertScenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    id: "corner",
    template: "anchor",
    overrides: { name: "corner", location: "room", support: "room", pos: { x: 300, y: 300 } },
  },
  {
    id: "ann",
    template: "human",
    overrides: { name: "ann", location: "room", support: "room", pos: { x: 0, y: 0 } },
  },
  {
    id: "bottle",
    template: "bottle",
    overrides: { name: "bottle", location: "room", support: "room", pos: { x: 40, y: 0 } },
  },
];

function inertWorlds(t: { after(callback: () => void): void }): [World, World] {
  const store = createWorld(join(tempDir(t), "inert"), inertScenario);
  const names = { room: "e1", corner: "e2", ann: "e3", bottle: "e4" };
  return [store, memoryWorld(store.snapshot(), undefined, names)];
}

test("take, push and attack on an anchor are all unresolved", (t) => {
  for (const world of inertWorlds(t)) {
    const before = canonicalJson(world.snapshot());
    const ann = world.id("ann")!;
    const attempts = [
      { command_id: "take-name", actor: ann, verb: "take", target: "corner" },
      { command_id: "take-id", actor: ann, verb: "take", target: "e2" },
      { command_id: "push-name", actor: ann, verb: "push", target: "corner" },
      { command_id: "push-id", actor: ann, verb: "push", target: "e2" },
      { command_id: "attack-name", actor: ann, verb: "attack", target: "corner" },
      { command_id: "attack-id", actor: ann, verb: "attack", target: "e2" },
      { command_id: "open-anchor", actor: ann, verb: "open", target: "corner" },
    ];
    for (const attempt of attempts) {
      const result = world.command(attempt);
      strictEqual(result.status, "unresolved", canonicalJson(attempt));
      deepStrictEqual(result.deltas, []);
      deepStrictEqual(result.events, []);
    }
    strictEqual(canonicalJson(world.snapshot()), before);
    strictEqual(world.entity("e2")?.pos?.x, 300);
  }
});

test("no part of an abstract entity is addressable, and a real part still is", (t) => {
  // No template declares an abstract part today, so the rule is checked against a set that does.
  const parted: TemplateRegistry = {
    ...registry,
    anchor: {
      ...registry.anchor!,
      parts: [{ name: "mark", parent: null, contributes: {}, detachable: false, max_integrity: 100 }],
    },
  };
  const world = createWorld(join(tempDir(t), "parted"), inertScenario, parted);
  const ann = world.id("ann")!;

  const abstract = world.command({ command_id: "attack-mark", actor: ann, verb: "attack", target: "e2.mark" });
  strictEqual(abstract.status, "unresolved");

  // A part of an ordinary entity is untouched by the rule.
  const ordinary = world.command({ command_id: "attack-hand", actor: ann, verb: "attack", target: "e3.hand_r" });
  notStrictEqual(ordinary.status, "unresolved");
});

test("an anchor is no put or give destination for agents, but the world can edit one", (t) => {
  for (const world of inertWorlds(t)) {
    const ann = world.id("ann")!;
    const held = world.command({ command_id: "take-bottle", actor: ann, verb: "take", target: "bottle" });
    strictEqual(held.status, "ok");

    const onAnchor = world.command({
      command_id: "put-on-anchor",
      actor: ann,
      verb: "put",
      target: "bottle",
      args: { relation: "on", destination: "corner" },
    });
    strictEqual(onAnchor.status, "unresolved");

    const toAnchor = world.command({
      command_id: "give-to-anchor",
      actor: ann,
      verb: "give",
      target: "bottle",
      args: { destination: "corner" },
    });
    strictEqual(toAnchor.status, "unresolved");

    // The world author can edit anchors: remove, place to a position, and set_props all succeed.
    const removed = world.edit({ kind: "remove", target: "e2" }, { command_id: "remove-anchor" });
    strictEqual(removed.status, "ok");
    strictEqual(world.entity("e2"), null);

    // Spawn another anchor for further edits.
    const spawned = world.edit(
      {
        kind: "spawn",
        template: "anchor",
        overrides: { name: "corner2", location: "e1", support: "e1", pos: { x: 350, y: 350 } },
      },
      { command_id: "spawn-anchor" },
    );
    strictEqual(spawned.status, "ok");
    const corner2 = spawned.events[1]?.entity;
    ok(typeof corner2 === "string");

    const placed = world.edit(
      { kind: "place", target: corner2, pos: { x: 360, y: 360 } },
      { command_id: "place-anchor" },
    );
    strictEqual(placed.status, "ok");
    strictEqual(world.entity(corner2)?.pos?.x, 360);

    const propsSet = world.edit(
      { kind: "set_props", target: corner2, props: { abstract: true, some_prop: "value" } },
      { command_id: "set-props-anchor" },
    );
    strictEqual(propsSet.status, "ok");
    strictEqual(world.entity(corner2)?.props.some_prop, "value");
  }
});

test("an anchor is not perceived, in the entity form or the event form", (t) => {
  for (const world of inertWorlds(t)) {
    const ann = world.id("ann")!;
    for (const sense of ["sight", "hearing"] as const) {
      deepStrictEqual(
        world.query({ kind: "perceive", observer: ann, entity: "e2", sense }),
        { value: "false", basis_code: "abstract" },
      );
    }
    // An anchor as observer: it has no sense capacity either, so it perceives nothing.
    deepStrictEqual(
      world.query({ kind: "perceive", observer: "e2", entity: world.id("bottle")!, sense: "sight" }),
      { value: "false", basis_code: "no_sense_capacity" },
    );

    const born = world.edit(
      {
        kind: "spawn",
        template: "anchor",
        overrides: { name: "far", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
      },
      { command_id: "spawn-anchor", perceivers: true },
    );
    strictEqual(born.status, "ok");
    const eventId = born.events[1]?.event_id;
    ok(typeof eventId === "string");
    deepStrictEqual(
      world.query({ kind: "perceive", observer: ann, event_id: eventId, sense: "sight" }),
      { value: "false", basis_code: "abstract" },
    );
    // Nobody sensed it, by any covered sense.
    deepStrictEqual(born.events[1]?.perceivers, {
      sight: [],
      hearing: [],
      smell: [],
      touch: [],
      unknown_senses: ["smell", "touch"],
    });
  }
});

test("an abstract anchor still resolves an offset and answers near", (t) => {
  for (const world of inertWorlds(t)) {
    const bottle = world.id("bottle")!;
    // The anchor is a positioned entity even though nothing may act on it.
    // Abstract status comes from the template, not from entity.props.
    strictEqual(world.entity("e2")?.template, "anchor");
    deepStrictEqual(
      world.query({ kind: "fact", subject: "e2", relation: "support", object: "e1" }),
      { value: "true", basis_code: "relation_state" },
    );
    deepStrictEqual(
      world.query({ kind: "fact", subject: bottle, relation: "near", object: "e2" }),
      { value: "false", basis_code: "derived_near" },
    );
    const moved = world.edit(
      { kind: "place", target: bottle, pos: { anchor: "e2", dx: 5, dy: 5 } },
      { command_id: "place-near-anchor" },
    );
    strictEqual(moved.status, "ok");
    deepStrictEqual(
      world.query({ kind: "fact", subject: bottle, relation: "near", object: "e2" }),
      { value: "true", basis_code: "derived_near" },
    );
  }
});

test("an edit place against an anchor writes a position and nothing else", (t) => {
  for (const world of bothWorlds(t)) {
    const corner = spawnCorner(world);
    const pebble = spawnInYard(world);
    const placed = world.edit(
      { kind: "place", target: pebble, pos: { anchor: corner, dx: -10, dy: 5 } },
      { command_id: "place-by-anchor" },
    );

    strictEqual(placed.status, "ok");
    deepStrictEqual(world.entity(pebble)?.pos, { x: 80, y: 45 });
    strictEqual(world.entity(pebble)?.support, "e1");
    strictEqual(world.entity(pebble)?.location, "e1");
    // pos, support and location, and no delta anywhere naming the anchor.
    deepStrictEqual([...new Set(placed.deltas.map((delta) => delta.field))].sort(), [
      "location",
      "pos",
      "support",
    ]);
    deepStrictEqual(Object.keys(world.entity(pebble)?.props ?? {}), []);
    strictEqual(world.entity(corner)?.pos?.x, 90);
  }
});

test("an anchor beside a named holder is refused rather than resolved", (t) => {
  for (const world of bothWorlds(t)) {
    const corner = spawnCorner(world);
    const before = canonicalJson(world.snapshot());

    for (const edit of [
      { kind: "place", target: "e3", support: "e2", pos: { anchor: corner, dx: 0, dy: 0 } },
      { kind: "place", target: "e3", contained_in: "e4", pos: { anchor: corner, dx: 0, dy: 0 } },
    ] as WorldEdit[]) {
      const result = world.edit(edit, { command_id: "anchor-beside-holder" });
      strictEqual(result.status, "refused", canonicalJson(edit));
      strictEqual(result.reason_code, "conflicting_placement");
    }
    strictEqual(canonicalJson(world.snapshot()), before);
  }
});

test("an anchor that names nothing is invalid, and one off the floor is refused", (t) => {
  for (const world of bothWorlds(t)) {
    const before = canonicalJson(world.snapshot());

    const missing = world.edit(
      { kind: "place", target: "e3", pos: { anchor: "e99", dx: 0, dy: 0 } },
      { command_id: "missing-anchor" },
    );
    strictEqual(missing.status, "invalid");
    strictEqual(missing.reason_code, "no_such_entity");

    // A bottle on a table is not standing in a room, so it is not a fixed point to offset from.
    const unsupported = world.edit(
      { kind: "place", target: "e2", pos: { anchor: "e3", dx: 5, dy: 5 } },
      { command_id: "bottle-anchor" },
    );
    strictEqual(unsupported.status, "refused");
    strictEqual(unsupported.reason_code, "anchor_not_room_supported");

    // A room has nothing under it, so it cannot be its own reference point either.
    const room = world.edit(
      { kind: "place", target: "e2", pos: { anchor: "e1", dx: 5, dy: 5 } },
      { command_id: "room-anchor" },
    );
    strictEqual(room.status, "refused");
    strictEqual(room.reason_code, "anchor_not_room_supported");

    strictEqual(canonicalJson(world.snapshot()), before);
  }
});

test("a malformed anchor position is invalid_args", (t) => {
  const malformed: unknown[] = [
    { anchor: "e1", dx: 1 },
    { anchor: "e1", dx: 1, dy: 2, x: 3 },
    { anchor: 6, dx: 1, dy: 2 },
    { anchor: "e1", dx: 1.5, dy: 2 },
    { x: 1, y: 2, anchor: "e1" },
  ];
  for (const world of bothWorlds(t)) {
    for (const pos of malformed) {
      const result = world.edit(
        { kind: "place", target: "e3", pos } as unknown as WorldEdit,
        { command_id: "malformed-anchor" },
      );
      strictEqual(result.status, "invalid", canonicalJson(pos));
      strictEqual(result.reason_code, "invalid_args");
    }
  }
});

test("the JSON boundary takes an anchor in a scenario and in a place edit", () => {
  const anchor = { anchor: "corner", dx: -10, dy: 5 };
  strictEqual(
    ScenarioSchema.safeParse([
      { id: "room", template: "room", overrides: { name: "room" } },
      {
        id: "corner",
        template: "anchor",
        overrides: { name: "corner", location: "room", support: "room", pos: { x: 90, y: 40 } },
      },
      { id: "bottle", template: "bottle", overrides: { name: "bottle", pos: anchor } },
    ]).success,
    true,
  );
  strictEqual(
    WorldEditSchema.safeParse({ kind: "place", target: "e3", pos: anchor }).success,
    true,
  );
  // A spawn edit places through its overrides, which stay a position and nothing else.
  strictEqual(
    WorldEditSchema.safeParse({ kind: "spawn", template: "bottle", overrides: { pos: anchor } }).success,
    false,
  );
  strictEqual(EntityOverridesSchema.safeParse({ pos: anchor }).success, false);
});

const nearScenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall" } },
  { id: "yard", template: "room", overrides: { name: "yard" } },
  {
    id: "table",
    template: "table",
    overrides: { name: "table", location: "hall", support: "hall", pos: { x: 30, y: 0 } },
  },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "hall", support: "table" } },
  {
    id: "corner",
    template: "anchor",
    overrides: { name: "corner", location: "hall", support: "hall", pos: { x: 90, y: 40 } },
  },
  {
    id: "touching",
    template: "stone",
    overrides: { name: "touching", location: "hall", support: "hall", pos: { x: 130, y: 0 } },
  },
  {
    id: "beyond",
    template: "stone",
    overrides: { name: "beyond", location: "hall", support: "hall", pos: { x: 131, y: 0 } },
  },
  {
    id: "outside",
    template: "stone",
    overrides: { name: "outside", location: "yard", support: "yard", pos: { x: 31, y: 0 } },
  },
  {
    id: "carried",
    template: "stone",
    overrides: { name: "carried", location: "hall", contained_in: "bottle" },
  },
];

function nearWorld(t: { after(callback: () => void): void }): [World, World] {
  const store = createWorld(join(tempDir(t), "near"), nearScenario);
  const names = {
    hall: "e1",
    yard: "e2",
    table: "e3",
    bottle: "e4",
    corner: "e5",
    touching: "e6",
    beyond: "e7",
    outside: "e8",
    carried: "e9",
  };
  return [store, memoryWorld(store.snapshot(), undefined, names)];
}

test("near is true within the declared threshold and false outside it", (t) => {
  for (const world of nearWorld(t)) {
    const table = world.id("table")!;
    const ask = (object: string) =>
      world.query({ kind: "fact", subject: table, relation: "near", object: world.id(object)! });

    deepStrictEqual(ask("corner"), { value: "true", basis_code: "derived_near" });
    // A bottle on the table has the table's position, so it is near whatever the table is near.
    deepStrictEqual(
      world.query({ kind: "fact", subject: world.id("bottle")!, relation: "near", object: world.id("corner")! }),
      { value: "true", basis_code: "derived_near" },
    );
    deepStrictEqual(ask("touching"), { value: "true", basis_code: "derived_near" });
    deepStrictEqual(ask("beyond"), { value: "false", basis_code: "derived_near" });
    deepStrictEqual(ask("outside"), { value: "false", basis_code: "derived_near" });
    deepStrictEqual(ask("carried"), { value: "true", basis_code: "derived_near" });
    deepStrictEqual(ask("table"), { value: "true", basis_code: "derived_near" });

    // The threshold is exactly NEAR_THRESHOLD_CM away, and the room reads 1000 cm across.
    strictEqual(NEAR_THRESHOLD_CM, 100);
  }
});

test("near answers false without an object, and for one that does not exist", (t) => {
  for (const world of nearWorld(t)) {
    deepStrictEqual(
      world.query({ kind: "fact", subject: world.id("table")!, relation: "near" }),
      { value: "false", basis_code: "no_object" },
    );
    deepStrictEqual(
      world.query({ kind: "fact", subject: world.id("table")!, relation: "near", object: "e99" }),
      { value: "false", basis_code: "no_such_entity" },
    );
    deepStrictEqual(
      world.query({ kind: "fact", subject: "e99", relation: "near", object: world.id("table")! }),
      { value: "false", basis_code: "no_such_entity" },
    );
  }
});

test("near answers unknown where the world's coverage does not declare it", (t) => {
  const [world] = nearWorld(t);
  ok(world.snapshot().coverage.relations.includes("near"));
  const without = {
    ...world.snapshot(),
    coverage: {
      ...world.snapshot().coverage,
      relations: world.snapshot().coverage.relations.filter((relation) => relation !== "near"),
    },
  };
  deepStrictEqual(
    query(without, registry, [], {
      kind: "fact",
      subject: world.id("table")!,
      relation: "near",
      object: world.id("corner")!,
    }),
    { value: "unknown", basis_code: "uncovered_category" },
  );
});

test("near never writes and never produces a position", (t) => {
  for (const world of nearWorld(t)) {
    const before = canonicalJson(world.snapshot());
    const answer = world.query({
      kind: "fact",
      subject: world.id("beyond")!,
      relation: "near",
      object: world.id("table")!,
    });
    strictEqual(answer.value, "false");
    strictEqual(canonicalJson(world.snapshot()), before);
    deepStrictEqual(world.entity(world.id("beyond")!)?.pos, { x: 131, y: 0 });
  }
});

test("when a template gains abstract: true, existing entities become abstract", (t) => {
  // Create a registry where anchor is not abstract.
  const nonAbstractRegistry: TemplateRegistry = {
    ...registry,
    anchor: {
      ...registry.anchor!,
      props: { ...registry.anchor!.props },
    },
  };
  delete nonAbstractRegistry.anchor!.props.abstract;

  // Create a simple scenario with anchor near the actor.
  const upgradeScenario: Scenario = [
    { id: "room", template: "room", overrides: { name: "room" } },
    {
      id: "ann",
      template: "human",
      overrides: { name: "ann", location: "room", support: "room", pos: { x: 0, y: 0 } },
    },
    {
      id: "corner",
      template: "anchor",
      overrides: { name: "corner", location: "room", support: "room", pos: { x: 50, y: 0 } },
    },
  ];

  // Spawn the initial world to get the snapshot, then create a memory world.
  const dir = join(tempDir(t), "abstract-upgrade");
  const snapshot = createWorld(dir, upgradeScenario, nonAbstractRegistry).snapshot();
  const world = memoryWorld(snapshot, nonAbstractRegistry, { room: "e1", ann: "e2", corner: "e3" });
  const ann = world.id("ann")!;
  const cornerEntity = world.id("corner")!;

  // Before upgrade: anchor can be targeted by agents.
  const takeBefore = world.command({
    command_id: "take-before",
    actor: ann,
    verb: "take",
    target: cornerEntity,
  });
  strictEqual(takeBefore.status, "ok", `anchor take should succeed, but got ${takeBefore.status} ${takeBefore.reason_code}`);

  // Undo the take to keep the world clean.
  world.command({ command_id: "drop-anchor", actor: ann, verb: "drop", target: cornerEntity });

  // Upgrade templates to where anchor is abstract.
  world.upgradeTemplates(registry);

  // After upgrade: anchor cannot be targeted by agents.
  const takeAfter = world.command({
    command_id: "take-after",
    actor: ann,
    verb: "take",
    target: cornerEntity,
  });
  strictEqual(takeAfter.status, "unresolved");

  // Perception: anchor is not perceived.
  deepStrictEqual(
    world.query({ kind: "perceive", observer: ann, entity: cornerEntity, sense: "sight" }),
    { value: "false", basis_code: "abstract" },
  );
});
