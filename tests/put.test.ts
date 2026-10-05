import { deepStrictEqual, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { apply } from "../src/engine/pipeline.js";
import { effectivePos } from "../src/engine/geometry.js";
import { spawn } from "../src/engine/spawn.js";
import type { Id, Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash, type TemplateRegistry } from "../src/templates.js";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));
const baseRegistry = loadTemplates(templatesDir);

interface PutWorld {
  snapshot: Snapshot;
  registry: TemplateRegistry;
  roomId: Id;
  tableId: Id;
  actorId: Id;
  bottleId: Id;
  chestId: Id;
  cupId: Id;
  stoneId: Id;
}

function emptySnapshot(registry: TemplateRegistry): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
}

function onRoom(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  templateId: string,
  name: string,
  x: number,
): { snapshot: Snapshot; id: Id } {
  const room = Object.values(snapshot.entities).find((entity) => entity.template === "room");
  if (room === undefined) {
    throw new TypeError("World has no room");
  }
  return spawn(snapshot, registry, templateId, {
    name,
    location: room.id,
    support: room.id,
    pos: { x, y: 0 },
  });
}

function putWorld(registry: TemplateRegistry = baseRegistry): PutWorld {
  const room = spawn(emptySnapshot(registry), registry, "room", { name: "room" });
  const table = onRoom(room.snapshot, registry, "table", "table", 30);
  const chest = onRoom(table.snapshot, registry, "chest", "chest", 40);
  const cup = onRoom(chest.snapshot, registry, "cup", "cup", 45);
  const stone = onRoom(cup.snapshot, registry, "stone", "stone", 50);
  const actor = spawn(stone.snapshot, registry, "human", {
    name: "actor",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const bottle = spawn(actor.snapshot, registry, "bottle", {
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
    actorId: actor.id,
    bottleId: bottle.id,
    chestId: chest.id,
    cupId: cup.id,
    stoneId: stone.id,
  };
}

function put(
  world: PutWorld,
  args: Record<string, unknown>,
  snapshot: Snapshot = world.snapshot,
) {
  return apply(snapshot, world.registry, {
    command_id: "put-item",
    actor: world.actorId,
    verb: "put",
    target: "bottle",
    args,
  });
}

test("an item put on a surface takes that surface as support and no position", () => {
  const world = putWorld();
  const result = put(world, { relation: "on", destination: "table" });

  strictEqual(result.status, "ok");
  const bottle = result.snapshot.entities[world.bottleId];
  strictEqual(bottle?.support, world.tableId);
  strictEqual(bottle?.contained_in, null);
  strictEqual(bottle?.in_part, null);
  strictEqual(bottle?.pos, null);
  deepStrictEqual(
    result.deltas.map((delta) => [delta.field, delta.from, delta.to]),
    [
      ["contained_in", world.actorId, null],
      ["in_part", "hand_l", null],
      ["support", null, world.tableId],
    ],
  );
  deepStrictEqual(result.events.map((event) => event.type), ["put", "moved"]);
  strictEqual(result.events[1]?.cause_id, result.events[0]?.event_id);
  deepStrictEqual(result.events[1]?.data, { relation: "on" });
});

test("an item put on a table keeps the table's position when the table is pushed", () => {
  const world = putWorld();
  const carried = spawn(world.snapshot, world.registry, "stone", {
    name: "stone",
    location: world.roomId,
    support: null,
    contained_in: world.actorId,
  });

  const placed = apply(carried.snapshot, world.registry, {
    command_id: "put-stone",
    actor: world.actorId,
    verb: "put",
    target: carried.id,
    args: { relation: "on", destination: "table" },
  });
  strictEqual(placed.status, "ok");
  strictEqual(placed.snapshot.entities[carried.id]?.pos, null);
  deepStrictEqual(effectivePos(placed.snapshot, carried.id), { x: 30, y: 0 });

  const pushed = apply(placed.snapshot, world.registry, {
    command_id: "push-table",
    actor: world.actorId,
    verb: "push",
    target: "table",
  });
  strictEqual(pushed.status, "ok");
  strictEqual(pushed.snapshot.entities[carried.id]?.support, world.tableId);
  deepStrictEqual(
    effectivePos(pushed.snapshot, carried.id),
    effectivePos(pushed.snapshot, world.tableId),
  );
  deepStrictEqual(effectivePos(pushed.snapshot, carried.id), { x: 60, y: 0 });
});

test("a bottle put on a table then pushed reproduces the bottle break chain", () => {
  const world = putWorld();
  const placed = put(world, { relation: "on", destination: "table" });
  strictEqual(placed.status, "ok");

  const result = apply(placed.snapshot, world.registry, {
    command_id: "push-table",
    actor: world.actorId,
    verb: "push",
    target: "table",
  });

  strictEqual(result.status, "ok");
  deepStrictEqual(
    result.events.map((event) => event.type),
    ["push", "moved", "displaced", "dropped", "broken", "spawned", "spawned", "spawned"],
  );
  strictEqual(result.events[3]?.data.fall_cm, 75);
  strictEqual(result.snapshot.entities[world.bottleId]?.status, "broken");
  deepStrictEqual(result.snapshot.entities[world.roomId]?.residue, { glass: 5, wine: 75 });
});

test("an item put into a container is contained with no support or position", () => {
  const world = putWorld();
  const result = put(world, { relation: "in", destination: "chest" });

  strictEqual(result.status, "ok");
  const bottle = result.snapshot.entities[world.bottleId];
  strictEqual(bottle?.contained_in, world.chestId);
  strictEqual(bottle?.support, null);
  strictEqual(bottle?.pos, null);
  deepStrictEqual(result.events[1]?.data, { relation: "in" });
});

test("a put refuses a destination that cannot receive it", () => {
  const world = putWorld();

  const tooSmall = put(world, { relation: "in", destination: "cup" });
  strictEqual(tooSmall.status, "refused");
  strictEqual(tooSmall.reason_code, "too_large");
  strictEqual(tooSmall.deltas.length, 0);
  strictEqual(tooSmall.events.length, 0);

  const notAContainer = put(world, { relation: "in", destination: "table" });
  strictEqual(notAContainer.status, "refused");
  strictEqual(notAContainer.reason_code, "not_a_container");

  const notASurface = put(world, { relation: "on", destination: "stone" });
  strictEqual(notASurface.status, "refused");
  strictEqual(notASurface.reason_code, "not_a_surface");
});

test("an item wider than the surface footprint is refused as too large", () => {
  const registry: TemplateRegistry = {
    ...baseRegistry,
    table: { ...baseRegistry.table!, size_cm: { w: 4, d: 60, h: 75 } },
  };
  const world = putWorld(registry);
  const result = put(world, { relation: "on", destination: "table" });

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "too_large");
});

test("a long item fits a table in either orientation", () => {
  for (const size of [
    { w: 100, d: 20, h: 20 },
    { w: 20, d: 100, h: 20 },
  ]) {
    const registry: TemplateRegistry = {
      ...baseRegistry,
      stone: { ...baseRegistry.stone!, size_cm: size },
    };
    const world = putWorld(registry);
    const plank = spawn(world.snapshot, registry, "stone", {
      name: "plank",
      location: world.roomId,
      support: null,
      contained_in: world.actorId,
    });

    const placed = apply(plank.snapshot, registry, {
      command_id: "put-plank",
      actor: world.actorId,
      verb: "put",
      target: "plank",
      args: { relation: "on", destination: "table" },
    });

    strictEqual(placed.status, "ok", `${size.w} by ${size.d}`);
    strictEqual(placed.snapshot.entities[plank.id]?.support, world.tableId);
  }
});

test("a chair leg is too long for the chest, however it is turned", () => {
  const world = putWorld();
  const leg = spawn(world.snapshot, world.registry, "chair.leg_fl", {
    name: "leg",
    location: world.roomId,
    support: null,
    contained_in: world.actorId,
  });

  const result = apply(leg.snapshot, world.registry, {
    command_id: "put-leg",
    actor: world.actorId,
    verb: "put",
    target: "leg",
    args: { relation: "in", destination: "chest" },
  });

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "too_large");
  strictEqual(result.snapshot.entities[leg.id]?.contained_in, world.actorId);
});

test("putting into a closed container is refused", () => {
  const registry: TemplateRegistry = {
    ...baseRegistry,
    chest: {
      ...baseRegistry.chest!,
      props: { ...baseRegistry.chest!.props, openable: true, open: false },
    },
  };
  const world = putWorld(registry);
  const result = put(world, { relation: "in", destination: "chest" }, world.snapshot);

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "container_closed");

  const opened = apply(world.snapshot, registry, {
    command_id: "open-chest",
    actor: world.actorId,
    verb: "open",
    target: "chest",
  });
  strictEqual(opened.status, "ok");

  const afterOpen = put(world, { relation: "in", destination: "chest" }, opened.snapshot);
  strictEqual(afterOpen.status, "ok");
  strictEqual(afterOpen.snapshot.entities[world.bottleId]?.contained_in, world.chestId);
});

test("a put refuses what the actor cannot do", () => {
  const world = putWorld();

  const uncarried = apply(world.snapshot, world.registry, {
    command_id: "put-stone",
    actor: world.actorId,
    verb: "put",
    target: "stone",
    args: { relation: "on", destination: "table" },
  });
  strictEqual(uncarried.status, "refused");
  strictEqual(uncarried.reason_code, "not_carried");

  const farTable = onRoom(world.snapshot, world.registry, "table", "far table", 900);
  const outOfReach = put(world, { relation: "on", destination: farTable.id }, farTable.snapshot);
  strictEqual(outOfReach.status, "refused");
  strictEqual(outOfReach.reason_code, "out_of_reach");

  const itself = put(world, { relation: "in", destination: "bottle" });
  strictEqual(itself.status, "refused");
  strictEqual(itself.reason_code, "circular_placement");

  const noRelation = put(world, { destination: "table" });
  strictEqual(noRelation.status, "invalid");
  strictEqual(noRelation.reason_code, "invalid_args");
});

test("a put destination resolves like any other target", () => {
  const world = putWorld();
  const unknown = put(world, { relation: "on", destination: "wardrobe" });
  strictEqual(unknown.status, "unresolved");
  strictEqual(unknown.resolved_target, null);

  const twin = onRoom(world.snapshot, world.registry, "cup", "cup", 60);
  const ambiguous = put(world, { relation: "in", destination: "cup" }, twin.snapshot);
  strictEqual(ambiguous.status, "ambiguous");
  deepStrictEqual(ambiguous.candidates, [world.cupId, twin.id]);
});