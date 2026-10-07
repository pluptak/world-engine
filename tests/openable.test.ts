import { deepStrictEqual, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { apply } from "../src/engine/pipeline.js";
import { query } from "../src/engine/query.js";
import { spawn } from "../src/engine/spawn.js";
import type { Id, Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash, type TemplateRegistry } from "../src/templates.js";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));
const baseRegistry = loadTemplates(templatesDir);

interface DoorWorld {
  snapshot: Snapshot;
  registry: TemplateRegistry;
  roomAId: Id;
  roomBId: Id;
  farRoomId: Id;
  actorId: Id;
  bottleId: Id;
  doorId: Id;
}

function doorWorld(
  doorProps: Record<string, number | string | boolean>,
  registry: TemplateRegistry = baseRegistry,
): DoorWorld {
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const roomA = spawn(initial, registry, "room", { name: "room-a", props: { lit: true } });
  const roomB = spawn(roomA.snapshot, registry, "room", { name: "room-b", props: { lit: true } });
  const farRoom = spawn(roomB.snapshot, registry, "room", { name: "far", props: { lit: true } });
  const actor = spawn(farRoom.snapshot, registry, "human", {
    name: "actor",
    location: roomA.id,
    support: roomA.id,
    pos: { x: 0, y: 0 },
  });
  const bottle = spawn(actor.snapshot, registry, "bottle", {
    name: "bottle",
    location: roomB.id,
    support: roomB.id,
    pos: { x: 0, y: 0 },
  });
  const door = spawn(bottle.snapshot, registry, "door", {
    name: "door",
    props: { openable: true, from: roomA.id, to: roomB.id, ...doorProps },
  });

  return {
    snapshot: door.snapshot,
    registry,
    roomAId: roomA.id,
    roomBId: roomB.id,
    farRoomId: farRoom.id,
    actorId: actor.id,
    bottleId: bottle.id,
    doorId: door.id,
  };
}

function act(world: DoorWorld, verb: string, target: string, actorId: Id = world.actorId) {
  return apply(world.snapshot, world.registry, {
    command_id: `${verb}-door`,
    actor: actorId,
    verb,
    target,
  });
}

function seesBottle(world: DoorWorld, snapshot: Snapshot): string {
  return query(snapshot, world.registry, [], {
    kind: "perceive",
    observer: world.actorId,
    entity: world.bottleId,
    sense: "sight",
  }).value;
}

test("closing a door takes away sight of the room beyond it", () => {
  const world = doorWorld({ open: true });
  strictEqual(seesBottle(world, world.snapshot), "true");

  const closed = act(world, "close", "door");
  strictEqual(closed.status, "ok");
  strictEqual(closed.snapshot.entities[world.doorId]?.props.open, false);
  deepStrictEqual(closed.events.map((event) => event.type), ["close", "closed"]);
  strictEqual(closed.events[1]?.cause_id, closed.events[0]?.event_id);
  deepStrictEqual(
    closed.deltas.map((delta) => [delta.field, delta.from, delta.to]),
    [["props", { openable: true, open: true, from: world.roomAId, to: world.roomBId },
      { openable: true, open: false, from: world.roomAId, to: world.roomBId }]],
  );
  strictEqual(seesBottle(world, closed.snapshot), "false");

  const opened = apply(closed.snapshot, world.registry, {
    command_id: "open-door",
    actor: world.actorId,
    verb: "open",
    target: "door",
  });
  strictEqual(opened.status, "ok");
  strictEqual(opened.snapshot.entities[world.doorId]?.props.open, true);
  strictEqual(seesBottle(world, opened.snapshot), "true");
});

test("a locked door refuses to open", () => {
  const world = doorWorld({ open: false, locked: true });
  const result = act(world, "open", "door");

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "locked");
  strictEqual(result.snapshot.entities[world.doorId]?.props.open, false);
  strictEqual(result.events.length, 0);
});

test("locking and unlocking need a carried key that opens the target", () => {
  const world = doorWorld({ open: false, locked: true });
  const strangerKey = spawn(world.snapshot, world.registry, "stone", {
    name: "key",
    location: world.roomAId,
    support: world.roomAId,
    pos: { x: 5, y: 0 },
    props: { opens: world.doorId },
  });

  const withoutKey = apply(strangerKey.snapshot, world.registry, {
    command_id: "unlock-door",
    actor: world.actorId,
    verb: "unlock",
    target: "door",
  });
  strictEqual(withoutKey.status, "refused");
  strictEqual(withoutKey.reason_code, "no_key");

  const carried = spawn(withoutKey.snapshot, world.registry, "stone", {
    name: "key",
    location: world.roomAId,
    support: null,
    contained_in: world.actorId,
    props: { opens: world.doorId },
  });
  const unlocked = apply(carried.snapshot, world.registry, {
    command_id: "unlock-door",
    actor: world.actorId,
    verb: "unlock",
    target: "door",
  });
  strictEqual(unlocked.status, "ok");
  strictEqual(unlocked.snapshot.entities[world.doorId]?.props.locked, false);
  deepStrictEqual(unlocked.events.map((event) => event.type), ["unlock", "unlocked"]);

  const opened = apply(unlocked.snapshot, world.registry, {
    command_id: "open-door",
    actor: world.actorId,
    verb: "open",
    target: "door",
  });
  strictEqual(opened.status, "ok");

  const locked = apply(opened.snapshot, world.registry, {
    command_id: "lock-door",
    actor: world.actorId,
    verb: "lock",
    target: "door",
  });
  strictEqual(locked.status, "ok");
  strictEqual(locked.snapshot.entities[world.doorId]?.props.locked, true);
});

test("openable verbs refuse what is not openable or not reachable", () => {
  const world = doorWorld({ open: true });
  const table = spawn(world.snapshot, world.registry, "table", {
    name: "table",
    location: world.roomAId,
    support: world.roomAId,
    pos: { x: 20, y: 0 },
  });

  const notOpenable = apply(table.snapshot, world.registry, {
    command_id: "open-table",
    actor: world.actorId,
    verb: "open",
    target: "table",
  });
  strictEqual(notOpenable.status, "refused");
  strictEqual(notOpenable.reason_code, "not_openable");

  const gate = spawn(notOpenable.snapshot, world.registry, "door", {
    name: "gate",
    location: world.roomAId,
    support: world.roomAId,
    pos: { x: 500, y: 0 },
    props: { openable: true, open: true, from: world.roomAId, to: world.farRoomId },
  });
  const outOfReach = apply(gate.snapshot, world.registry, {
    command_id: "close-gate",
    actor: world.actorId,
    verb: "close",
    target: "gate",
  });
  strictEqual(outOfReach.status, "refused");
  strictEqual(outOfReach.reason_code, "out_of_reach");

  const elsewhere = spawn(outOfReach.snapshot, world.registry, "human", {
    name: "stranger",
    location: world.farRoomId,
    support: world.farRoomId,
    pos: { x: 0, y: 0 },
  });
  const notAddressable = apply(elsewhere.snapshot, world.registry, {
    command_id: "close-door",
    actor: elsewhere.id,
    verb: "close",
    target: "door",
  });
  strictEqual(notAddressable.status, "unresolved");
});

test("a closed container refuses the take of what it holds", () => {
  const registry: TemplateRegistry = {
    ...baseRegistry,
    chest: {
      ...baseRegistry.chest!,
      props: { ...baseRegistry.chest!.props, openable: true, open: false },
    },
  };
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(initial, registry, "room", { name: "room" });
  const actor = spawn(room.snapshot, registry, "human", {
    name: "actor",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const chest = spawn(actor.snapshot, registry, "chest", {
    name: "chest",
    location: room.id,
    support: room.id,
    pos: { x: 20, y: 0 },
  });
  const bottle = spawn(chest.snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    contained_in: chest.id,
  });

  const take = (snapshot: Snapshot) =>
    apply(snapshot, registry, {
      command_id: "take-bottle",
      actor: actor.id,
      verb: "take",
      target: "bottle",
    });

  // Shut in, the bottle is neither seen nor groped for, so it cannot be named until the chest opens.
  const closed = take(bottle.snapshot);
  strictEqual(closed.status, "unresolved");
  strictEqual(closed.reason_code, undefined);

  const opened = apply(bottle.snapshot, registry, {
    command_id: "open-chest",
    actor: actor.id,
    verb: "open",
    target: "chest",
  });
  strictEqual(opened.status, "ok");
  strictEqual(opened.snapshot.entities[chest.id]?.props.open, true);

  const taken = take(opened.snapshot);
  strictEqual(taken.status, "ok");
  strictEqual(taken.snapshot.entities[bottle.id]?.contained_in, actor.id);
  strictEqual(taken.snapshot.entities[bottle.id]?.in_part, "hand_l");
  deepStrictEqual(
    taken.deltas.map((delta) => [delta.field, delta.from, delta.to]),
    [
      ["contained_in", chest.id, actor.id],
      ["in_part", null, "hand_l"],
    ],
  );
});

test("a coin in an open cup inside a closed chest is out of reach and out of sight", () => {
  const registry: TemplateRegistry = {
    ...baseRegistry,
    chest: {
      ...baseRegistry.chest!,
      props: { ...baseRegistry.chest!.props, openable: true, open: false },
    },
    cup: {
      ...baseRegistry.cup!,
      props: { ...baseRegistry.cup!.props, openable: true, open: true },
    },
  };
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(initial, registry, "room", { name: "room", props: { lit: true } });
  const observer = spawn(room.snapshot, registry, "human", {
    name: "observer",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const chest = spawn(observer.snapshot, registry, "chest", {
    name: "chest",
    location: room.id,
    support: room.id,
    pos: { x: 20, y: 0 },
  });
  const cup = spawn(chest.snapshot, registry, "cup", {
    name: "cup",
    location: room.id,
    contained_in: chest.id,
  });
  const coin = spawn(cup.snapshot, registry, "stone", {
    name: "coin",
    location: room.id,
    contained_in: cup.id,
  });

  const takeCoin = (snapshot: Snapshot) =>
    apply(snapshot, registry, {
      command_id: "take-coin",
      actor: observer.id,
      verb: "take",
      target: "coin",
    });
  const sightOfCoin = (snapshot: Snapshot) =>
    query(snapshot, registry, [], {
      kind: "perceive",
      observer: observer.id,
      entity: coin.id,
      sense: "sight",
    });

  strictEqual(takeCoin(coin.snapshot).status, "unresolved");
  deepStrictEqual(sightOfCoin(coin.snapshot), { value: "false", basis_code: "enclosed" });

  const opened = apply(coin.snapshot, registry, {
    command_id: "open-chest",
    actor: observer.id,
    verb: "open",
    target: "chest",
  });
  strictEqual(opened.status, "ok");

  const taken = takeCoin(opened.snapshot);
  strictEqual(taken.status, "ok");
  strictEqual(taken.snapshot.entities[coin.id]?.contained_in, observer.id);
  deepStrictEqual(sightOfCoin(opened.snapshot), { value: "true", basis_code: "same_location_lit" });
});

test("a container that was never openable does not hide what it holds", () => {
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(baseRegistry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(initial, baseRegistry, "room", { name: "room" });
  const actor = spawn(room.snapshot, baseRegistry, "human", {
    name: "actor",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const chest = spawn(actor.snapshot, baseRegistry, "chest", {
    name: "chest",
    location: room.id,
    support: room.id,
    pos: { x: 20, y: 0 },
  });
  const stone = spawn(chest.snapshot, baseRegistry, "stone", {
    name: "stone",
    location: room.id,
    contained_in: chest.id,
  });

  const result = apply(stone.snapshot, baseRegistry, {
    command_id: "take-stone",
    actor: actor.id,
    verb: "take",
    target: "stone",
  });

  strictEqual(result.status, "ok");
  strictEqual(result.snapshot.entities[stone.id]?.contained_in, actor.id);
});