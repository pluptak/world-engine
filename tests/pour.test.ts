import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { apply } from "../src/engine/pipeline.js";
import { spawn } from "../src/engine/spawn.js";
import { canonicalJson, createWorld, memoryWorld, type Scenario } from "../src/index.js";
import type { Entity, Id, Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash, type TemplateRegistry } from "../src/templates.js";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));
const baseRegistry = loadTemplates(templatesDir);

type Props = Record<string, number | string | boolean>;

interface PourWorld {
  snapshot: Snapshot;
  registry: TemplateRegistry;
  roomId: Id;
  tableId: Id;
  cupId: Id;
  chestId: Id;
  stoneId: Id;
  actorId: Id;
  bottleId: Id;
}

function pourWorld(registry: TemplateRegistry = baseRegistry): PourWorld {
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(initial, registry, "room", { name: "room", residue: { glass: 5 } });
  const onFloor = (snapshot: Snapshot, templateId: string, name: string, x: number) =>
    spawn(snapshot, registry, templateId, {
      name,
      location: room.id,
      support: room.id,
      pos: { x, y: 0 },
    });

  const actor = onFloor(room.snapshot, "human", "actor", 0);
  const table = onFloor(actor.snapshot, "table", "table", 30);
  const cup = spawn(table.snapshot, registry, "cup", {
    name: "cup",
    location: room.id,
    support: table.id,
    pos: { x: 40, y: 0 },
  });
  const chest = spawn(cup.snapshot, registry, "chest", {
    name: "chest",
    location: room.id,
    support: room.id,
    pos: { x: 60, y: 0 },
    props: { ...registry.chest?.props, openable: true, open: false },
  });
  const stone = onFloor(chest.snapshot, "stone", "stone", 70);
  const bottle = spawn(stone.snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    support: null,
    contained_in: actor.id,
  });

  return {
    snapshot: bottle.snapshot,
    registry,
    roomId: room.id,
    tableId: table.id,
    cupId: cup.id,
    chestId: chest.id,
    stoneId: stone.id,
    actorId: actor.id,
    bottleId: bottle.id,
  };
}

function pour(
  world: PourWorld,
  args: Record<string, unknown>,
  snapshot: Snapshot = world.snapshot,
  target = "bottle",
) {
  return apply(snapshot, world.registry, {
    command_id: "pour-bottle",
    actor: world.actorId,
    verb: "pour",
    target,
    args,
  });
}

// The same fixture, one entity's props changed: enough to hold a different liquid or shut a chest
// without a second world builder per case.
function withProps(world: PourWorld, id: Id, props: Props): Snapshot {
  const entity = world.snapshot.entities[id];
  if (entity === undefined) {
    throw new TypeError(`Unknown entity ${id}`);
  }
  return {
    ...world.snapshot,
    entities: {
      ...world.snapshot.entities,
      [id]: { ...entity, props: { ...entity.props, ...props } },
    },
  };
}

function carried(world: PourWorld, templateId: string, name: string, props: Props = {}): Snapshot {
  return spawn(world.snapshot, world.registry, templateId, {
    name,
    location: world.roomId,
    support: null,
    contained_in: world.actorId,
    props: { ...world.registry[templateId]?.props, ...props },
  }).snapshot;
}

function contents(snapshot: Snapshot, id: Id): [unknown, unknown] {
  const props = snapshot.entities[id]?.props;
  ok(props !== undefined, `No such entity ${id}`);
  return [props.liquid_material, props.liquid_amount];
}

function handless(world: PourWorld): Snapshot {
  const actor = world.snapshot.entities[world.actorId];
  ok(actor !== undefined);
  const parts: Entity["parts"] = {
    ...actor.parts,
    hand_l: { integrity: 0, status: "destroyed" },
    hand_r: { integrity: 0, status: "destroyed" },
  };
  return {
    ...world.snapshot,
    entities: { ...world.snapshot.entities, [world.actorId]: { ...actor, parts } },
  };
}

test("pouring half a bottle into a cup moves that amount and leaves the rest", () => {
  const world = pourWorld();
  const result = pour(world, { destination: "cup", amount: 37 });

  strictEqual(result.status, "ok");
  deepStrictEqual(contents(result.snapshot, world.cupId), ["wine", 37]);
  deepStrictEqual(contents(result.snapshot, world.bottleId), ["wine", 38]);
  deepStrictEqual(result.events.map((event) => event.type), ["pour", "poured"]);
  strictEqual(result.events[0]?.entity, world.bottleId);
  strictEqual(result.events[1]?.entity, world.bottleId);
  strictEqual(result.events[1]?.cause_id, result.events[0]?.event_id);
  deepStrictEqual(result.events[1]?.data, { material: "wine", amount: 37, to: world.cupId });
  deepStrictEqual(
    result.deltas.map((delta) => [delta.entity, delta.field]),
    [
      [world.bottleId, "props"],
      [world.cupId, "props"],
    ],
  );
  strictEqual(result.snapshot.version, 1);
});

test("pouring without an amount empties the source and leaves it holding no material", () => {
  const world = pourWorld();
  const result = pour(world, { destination: "cup" });

  strictEqual(result.status, "ok");
  deepStrictEqual(contents(result.snapshot, world.cupId), ["wine", 75]);
  deepStrictEqual(contents(result.snapshot, world.bottleId), ["", 0]);
  deepStrictEqual(result.events[1]?.data, { material: "wine", amount: 75, to: world.cupId });
});

test("a container holding the same liquid takes the amount on top of what it has", () => {
  const world = pourWorld();
  const filled = withProps(world, world.cupId, { liquid_material: "wine", liquid_amount: 20 });
  const result = pour(world, { destination: "cup", amount: 30 }, filled);

  strictEqual(result.status, "ok");
  deepStrictEqual(contents(result.snapshot, world.cupId), ["wine", 50]);
  deepStrictEqual(contents(result.snapshot, world.bottleId), ["wine", 45]);
});

test("pouring onto a table leaves residue on the table and nothing in any cup", () => {
  const world = pourWorld();
  const result = pour(world, { destination: "table", amount: 37 });

  strictEqual(result.status, "ok");
  deepStrictEqual(result.snapshot.entities[world.tableId]?.residue, { wine: 37 });
  deepStrictEqual(result.snapshot.entities[world.roomId]?.residue, { glass: 5 });
  deepStrictEqual(contents(result.snapshot, world.cupId), [undefined, undefined]);
  deepStrictEqual(result.deltas.map((delta) => [delta.entity, delta.field]), [
    [world.bottleId, "props"],
    [world.tableId, "residue"],
  ]);
  deepStrictEqual(result.events[1]?.data, { material: "wine", amount: 37, to: world.tableId });
});

test("pouring onto the floor leaves residue in the room, adding to what is there", () => {
  const world = pourWorld();
  const result = pour(world, { destination: world.roomId });

  strictEqual(result.status, "ok");
  deepStrictEqual(result.snapshot.entities[world.roomId]?.residue, { glass: 5, wine: 75 });
  deepStrictEqual(contents(result.snapshot, world.bottleId), ["", 0]);
  deepStrictEqual(result.events[1]?.data, { material: "wine", amount: 75, to: world.roomId });
});

test("a container already holding another liquid refuses the pour", () => {
  const world = pourWorld();
  const beer = withProps(world, world.cupId, { liquid_material: "beer", liquid_amount: 10 });
  const result = pour(world, { destination: "cup" }, beer);

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "incompatible_liquid");
  deepStrictEqual(result.reason_data, { material: "wine", held_material: "beer" });
  strictEqual(result.deltas.length, 0);
  strictEqual(result.events.length, 0);
  deepStrictEqual(contents(result.snapshot, world.bottleId), ["wine", 75]);
});

test("a container that cannot hold the whole pour refuses with the numbers", () => {
  const world = pourWorld();
  const full = withProps(world, world.bottleId, { liquid_amount: 300 });
  const result = pour(world, { destination: "cup" }, full);

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "container_full");
  deepStrictEqual(result.reason_data, { requested: 300, held: 0, capacity: 288 });
  deepStrictEqual(contents(result.snapshot, world.bottleId), ["wine", 300]);

  const fitting = pour(world, { destination: "cup", amount: 288 }, full);
  strictEqual(fitting.status, "ok");
  deepStrictEqual(contents(fitting.snapshot, world.cupId), ["wine", 288]);

  const onceMore = pour(world, { destination: "cup", amount: 1 }, fitting.snapshot);
  strictEqual(onceMore.status, "refused");
  strictEqual(onceMore.reason_code, "container_full");
  deepStrictEqual(onceMore.reason_data, { requested: 1, held: 288, capacity: 288 });
  deepStrictEqual(contents(onceMore.snapshot, world.cupId), ["wine", 288]);
});

test("a shut container refuses the pour, and so does what one holds", () => {
  const world = pourWorld();
  const shut = pour(world, { destination: "chest" });
  strictEqual(shut.status, "refused");
  strictEqual(shut.reason_code, "container_closed");
  deepStrictEqual(shut.reason_data, { enclosure: world.chestId });

  const inChest = spawn(world.snapshot, world.registry, "cup", {
    name: "inner cup",
    location: world.roomId,
    contained_in: world.chestId,
  }).snapshot;
  // What the shut chest holds is neither seen nor groped for, so it cannot be named at all.
  const enclosed = pour(world, { destination: "inner cup" }, inChest);
  strictEqual(enclosed.status, "unresolved");
  strictEqual(enclosed.reason_data, undefined);

  // A surface inside a shut container is hidden the same way, as it is for `put ... on`.
  const tray = spawn(inChest, world.registry, "table", {
    name: "tray",
    location: world.roomId,
    contained_in: world.chestId,
  }).snapshot;
  const hidden = pour(world, { destination: "tray" }, tray);
  strictEqual(hidden.status, "unresolved");
  strictEqual(hidden.reason_data, undefined);
});

test("a pour the actor cannot do is refused with its own code", () => {
  const world = pourWorld();

  const uncarried = spawn(world.snapshot, world.registry, "bottle", {
    name: "spare bottle",
    location: world.roomId,
    support: world.tableId,
    pos: { x: 30, y: 0 },
  }).snapshot;
  const dropped = pour(world, { destination: "cup" }, uncarried, "spare bottle");
  strictEqual(dropped.reason_code, "not_carried");

const noLiquid = carried(world, "cup", "flask");
strictEqual(
    pour(world, { destination: "table" }, noLiquid, "flask").reason_code,
    "no_liquid",
  );

  const empty = withProps(world, world.bottleId, { liquid_amount: 0 });
  strictEqual(pour(world, { destination: "cup" }, empty).reason_code, "nothing_to_pour");

  const asked = pour(world, { destination: "cup", amount: 100 });
  strictEqual(asked.reason_code, "insufficient_liquid");
  deepStrictEqual(asked.reason_data, { requested: 100, available: 75 });

  const itself = pour(world, { destination: "bottle" });
  strictEqual(itself.reason_code, "cannot_pour_into_self");

  const notADestination = pour(world, { destination: "stone" });
  strictEqual(notADestination.reason_code, "not_a_destination");

  const far = spawn(world.snapshot, world.registry, "table", {
    name: "far table",
    location: world.roomId,
    support: world.roomId,
    pos: { x: 900, y: 0 },
  }).snapshot;
  // The room is dark and no sense is covered: the far table is named only once it can be seen.
  strictEqual(pour(world, { destination: "far table" }, far).status, "unresolved");
  const room = far.entities[world.roomId]!;
  const seen: Snapshot = {
    ...far,
    coverage: { ...far.coverage, senses: ["sight"] },
    entities: { ...far.entities, [room.id]: { ...room, props: { ...room.props, lit: true } } },
  };
  const outOfReach = pour(world, { destination: "far table" }, seen);
  strictEqual(outOfReach.reason_code, "out_of_reach");
  deepStrictEqual(outOfReach.reason_data, { distance_cm: 900, reach_cm: 100 });

  for (const args of [
    { amount: 10 },
    { destination: "cup", amount: 0 },
    { destination: "cup", amount: -5 },
    { destination: "cup", amount: 1.5 },
    { destination: "cup", amount: "10" },
  ]) {
    strictEqual(pour(world, args).status, "invalid", JSON.stringify(args));
    strictEqual(pour(world, args).reason_code, "invalid_args", JSON.stringify(args));
  }

strictEqual(pour(world, { destination: "wardrobe" }).status, "unresolved");
strictEqual(asked.snapshot, world.snapshot);
strictEqual(asked.deltas.length, 0);
strictEqual(asked.events.length, 0);
});

test("a handless actor cannot pour and the refusal names the capacity", () => {
  const world = pourWorld();
  const result = pour(world, { destination: "cup", amount: 37 }, handless(world));

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "insufficient_manipulation");
  deepStrictEqual(result.reason_data, { capacity: "manipulation", have: 0, need: 50 });
});

test("a pour reads the same in a store world and a memory world", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-pour-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "cup",
      overrides: { name: "cup", location: "e1", support: "e1", pos: { x: 40, y: 0 } },
    },
    {
      template: "bottle",
      overrides: { name: "bottle", location: "e1", support: null, contained_in: "e2" },
    },
  ];
  const stored = createWorld(join(dir, "pour"), scenario);
  const inMemory = memoryWorld(stored.snapshot());
  const commands = [
    {
      command_id: "pour-half",
      actor: "e2",
      verb: "pour",
      target: "bottle",
      args: { destination: "cup", amount: 37 },
    },
    {
      command_id: "pour-rest",
      actor: "e2",
      verb: "pour",
      target: "bottle",
      args: { destination: "e1" },
    },
  ];

  for (const command of commands) {
    const onDisk = stored.command(command);
    const inMemoryResult = inMemory.command(command);
    strictEqual(onDisk.status, "ok");
    strictEqual(inMemoryResult.status, "ok");
    strictEqual(canonicalJson(inMemoryResult.events), canonicalJson(onDisk.events));
    strictEqual(canonicalJson(inMemoryResult.snapshot), canonicalJson(onDisk.snapshot));
  }

  deepStrictEqual(contents(stored.snapshot(), "e3"), ["wine", 37]);
  deepStrictEqual(stored.snapshot().entities.e1?.residue, { wine: 38 });
  deepStrictEqual(contents(stored.snapshot(), "e4"), ["", 0]);
  strictEqual(stored.trace({ entity: "e4", field: "props" }).events.length > 0, true);
});