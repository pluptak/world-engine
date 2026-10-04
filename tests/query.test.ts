import { deepStrictEqual, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { query, type Query } from "../src/engine/query.js";
import { spawn } from "../src/engine/spawn.js";
import type { Snapshot, WorldEvent } from "../src/model.js";
import { loadTemplates, templatesHash } from "../src/templates.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function initialSnapshot(): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
}

function twoRoomWorld(doorOpen: boolean) {
  const roomA = spawn(initialSnapshot(), registry, "room", {
    name: "room-a",
    props: { lit: true },
  });
  const roomB = spawn(roomA.snapshot, registry, "room", {
    name: "room-b",
    props: { lit: true },
  });
  const observer = spawn(roomB.snapshot, registry, "human", {
    name: "observer",
    location: roomA.id,
    support: roomA.id,
    pos: { x: 0, y: 0 },
  });
  const bottle = spawn(observer.snapshot, registry, "bottle", {
    name: "bottle",
    location: roomB.id,
    support: roomB.id,
    pos: { x: 0, y: 0 },
  });
  const door = spawn(bottle.snapshot, registry, "door", {
    props: { open: doorOpen, from: roomA.id, to: roomB.id },
  });
  return {
    snapshot: door.snapshot,
    roomAId: roomA.id,
    roomBId: roomB.id,
    observerId: observer.id,
    bottleId: bottle.id,
  };
}

test("spawn supplies default coverage and fact queries use covered state", () => {
  const room = spawn(initialSnapshot(), registry, "room", { name: "room" });
  const table = spawn(room.snapshot, registry, "table", {
    name: "table",
    location: room.id,
    support: room.id,
    pos: { x: 10, y: 10 },
  });
  const bottle = spawn(table.snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    support: table.id,
  });

  deepStrictEqual(bottle.snapshot.coverage, {
    relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
    senses: ["sight", "hearing"],
    properties: ["integrity", "residue", "pos"],
  });
  const supportQuery: Query = {
    kind: "fact",
    subject: bottle.id,
    relation: "support",
    object: table.id,
  };
  deepStrictEqual(query(bottle.snapshot, registry, [], supportQuery), {
    value: "true",
    basis_code: "relation_state",
  });

  const pushed: Snapshot = {
    ...bottle.snapshot,
    entities: {
      ...bottle.snapshot.entities,
      [bottle.id]: { ...bottle.snapshot.entities[bottle.id]!, support: room.id },
    },
  };
  strictEqual(query(pushed, registry, [], supportQuery).value, "false");
  deepStrictEqual(
    query(bottle.snapshot, registry, [], {
      kind: "fact",
      subject: bottle.id,
      relation: "temperature",
    }),
    { value: "unknown", basis_code: "uncovered_category" },
  );
  deepStrictEqual(
    query(bottle.snapshot, registry, [], {
      kind: "fact",
      subject: "missing",
      relation: "temperature",
    }),
    { value: "false", basis_code: "no_such_entity" },
  );
});

test("attached_to reflects declared part states", () => {
  const guard = spawn(initialSnapshot(), registry, "human", { name: "guard" });
  const relation = {
    kind: "fact" as const,
    subject: guard.id,
    relation: "attached_to",
    object: "hand_r",
  };
  strictEqual(query(guard.snapshot, registry, [], relation).value, "true");

  const detached: Snapshot = {
    ...guard.snapshot,
    entities: {
      ...guard.snapshot.entities,
      [guard.id]: {
        ...guard.snapshot.entities[guard.id]!,
        parts: { ...guard.snapshot.entities[guard.id]!.parts, hand_r: { integrity: 0, status: "detached" } },
      },
    },
  };
  strictEqual(query(detached, registry, [], relation).value, "false");
});

test("uncovered smell is unknown", () => {
  const world = twoRoomWorld(false);
  deepStrictEqual(
    query(world.snapshot, registry, [], {
      kind: "perceive",
      observer: world.observerId,
      entity: world.bottleId,
      sense: "smell",
    }),
    { value: "unknown", basis_code: "uncovered_sense" },
  );
});

test("sight needs a lit location and an open door between adjacent rooms", () => {
  const closed = twoRoomWorld(false);
  const breaking: WorldEvent = {
    event_id: "ev-break",
    cause_id: null,
    command_id: "c-break",
    type: "broken",
    entity: closed.bottleId,
    data: {},
  };
  const sightQuery: Query = {
    kind: "perceive",
    observer: closed.observerId,
    event_id: breaking.event_id,
    sense: "sight",
  };
  strictEqual(query(closed.snapshot, registry, [breaking], sightQuery).value, "false");

  const open = twoRoomWorld(true);
  const openBreaking = { ...breaking, entity: open.bottleId };
  strictEqual(
    query(open.snapshot, registry, [openBreaking], {
      kind: "perceive",
      observer: open.observerId,
      event_id: openBreaking.event_id,
      sense: "sight",
    }).value,
    "true",
  );

  const unlit: Snapshot = {
    ...open.snapshot,
    entities: {
      ...open.snapshot.entities,
      [open.roomBId]: { ...open.snapshot.entities[open.roomBId]!, props: { lit: false } },
    },
  };
  strictEqual(
    query(unlit, registry, [], {
      kind: "perceive",
      observer: open.observerId,
      entity: open.bottleId,
      sense: "sight",
    }).value,
    "false",
  );
});

test("hearing through a closed door depends on whether an event is loud", () => {
  const world = twoRoomWorld(false);
  const event = (type: string, data: Record<string, unknown> = {}): WorldEvent => ({
    event_id: `ev-${type}`,
    cause_id: null,
    command_id: "c1",
    type,
    entity: world.bottleId,
    data,
  });
  const perceiveEvent = (selected: WorldEvent) =>
    query(
      world.snapshot,
      registry,
      [selected],
      {
        kind: "perceive",
        observer: world.observerId,
        event_id: selected.event_id,
        sense: "hearing",
      },
    );

  strictEqual(perceiveEvent(event("broken")).value, "true");
  strictEqual(perceiveEvent(event("moved")).value, "false");
  strictEqual(perceiveEvent(event("dropped", { fall_cm: 49 })).value, "false");
  strictEqual(perceiveEvent(event("dropped", { fall_cm: 50 })).value, "true");
});

test("an observer without sight capacity cannot see", () => {
  const world = twoRoomWorld(true);
  const observer = world.snapshot.entities[world.observerId]!;
  const blind: Snapshot = {
    ...world.snapshot,
    entities: {
      ...world.snapshot.entities,
      [world.observerId]: {
        ...observer,
        parts: { ...observer.parts, head: { integrity: 0, status: "destroyed" } },
      },
    },
  };
  deepStrictEqual(
    query(blind, registry, [], {
      kind: "perceive",
      observer: world.observerId,
      entity: world.bottleId,
      sense: "sight",
    }),
    { value: "false", basis_code: "no_sense_capacity" },
  );
});
