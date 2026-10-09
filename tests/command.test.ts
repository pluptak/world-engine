import { deepStrictEqual, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson } from "../src/engine/canonical.js";
import type { Command } from "../src/engine/command.js";
import { apply } from "../src/engine/pipeline.js";
import { resolveTarget } from "../src/engine/resolve.js";
import { spawn } from "../src/engine/spawn.js";
import { validateSnapshot } from "../src/engine/validate.js";
import type { Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash } from "../src/templates.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function initialSnapshot(senses: string[] = []): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses, properties: [] },
    entities: {},
  };
}

// Unlit and with no sense covered, the guard addresses only what it reaches; `lit` lets it see the
// whole hall.
function world(bottlePositions: Array<{ x: number; y: number }> = [{ x: 1, y: 0 }], lit = false) {
  const room = spawn(initialSnapshot(lit ? ["sight"] : []), registry, "room", {
    name: "hall",
    ...(lit && { props: { lit: true } }),
  });
  const actor = spawn(room.snapshot, registry, "human", {
    name: "guard",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  let snapshot = actor.snapshot;
  const bottles: string[] = [];
  for (const pos of bottlePositions) {
    const bottle = spawn(snapshot, registry, "bottle", {
      name: "bottle",
      location: room.id,
      support: room.id,
      pos,
    });
    snapshot = bottle.snapshot;
    bottles.push(bottle.id);
  }
  return { snapshot, roomId: room.id, actorId: actor.id, bottleIds: bottles };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function command(actor: string, verb: string, target?: string, args?: Record<string, unknown>): Command {
  return {
    command_id: "c1",
    actor,
    verb,
    ...(target !== undefined && { target }),
    ...(args !== undefined && { args }),
  };
}

test("apply returns invalid for an unknown verb", () => {
  const { snapshot, actorId } = world();
  const result = apply(snapshot, registry, command(actorId, "fly"));

  strictEqual(result.status, "invalid");
  strictEqual(result.reason_code, "unknown_verb");
  strictEqual(result.snapshot, snapshot);
});

test("apply returns unresolved for a target with no match", () => {
  const { snapshot, actorId } = world();
  const result = apply(snapshot, registry, command(actorId, "take", "missing"));

  strictEqual(result.status, "unresolved");
  strictEqual(result.snapshot, snapshot);
});

test("ambiguous targets return sorted candidates and do not change the snapshot", () => {
  const { snapshot, actorId, bottleIds } = world([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  const result = apply(snapshot, registry, command(actorId, "take", "BOTTLE"));

  strictEqual(result.status, "ambiguous");
  deepStrictEqual(result.candidates, bottleIds);
  strictEqual(result.snapshot, snapshot);
});

test("take refuses a target outside reach without changing the snapshot", () => {
  const { snapshot, actorId } = world([{ x: 200, y: 0 }], true);
  const result = apply(snapshot, registry, command(actorId, "take", "bottle"));

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "out_of_reach");
  strictEqual(result.snapshot, snapshot);
});

test("what the actor neither senses nor reaches resolves as though it did not exist", () => {
  const setup = world([{ x: 200, y: 0 }]);
  const far = setup.bottleIds[0]!;
  const chair = spawn(setup.snapshot, registry, "chair", {
    name: "chair",
    location: setup.roomId,
    support: setup.roomId,
    pos: { x: -200, y: 0 },
  });
  const { snapshot } = chair;
  const actorId = setup.actorId;

  for (const target of ["bottle", far, `${chair.id}.leg_fl`]) {
    const result = apply(snapshot, registry, command(actorId, "take", target));
    strictEqual(result.status, "unresolved", target);
    strictEqual(result.resolved_target, null, target);
    strictEqual(result.snapshot, snapshot, target);
  }
  strictEqual(resolveTarget(snapshot, registry, "world", far).status, "resolved");
  strictEqual(resolveTarget(snapshot, registry, "world", `${chair.id}.leg_fl`).status, "resolved");
});

test("candidates name only what the actor could tell is there", () => {
  const positions = [{ x: 1, y: 0 }, { x: 200, y: 0 }];
  const dark = world(positions);
  const near = apply(dark.snapshot, registry, command(dark.actorId, "take", "bottle"));
  strictEqual(near.status, "ok");
  strictEqual(near.resolved_target, dark.bottleIds[0]);

  const lit = world(positions, true);
  const both = apply(lit.snapshot, registry, command(lit.actorId, "take", "bottle"));
  strictEqual(both.status, "ambiguous");
  deepStrictEqual(both.candidates, lit.bottleIds);
});

test("take and drop record field deltas and causal events", () => {
  const setup = world();
  const snapshot = deepFreeze(setup.snapshot);
  const taking = apply(snapshot, registry, command(setup.actorId, "take", "bottle"));
  const bottleId = setup.bottleIds[0]!;
  const takeRoot = taking.events[0]!;
  const moved = taking.events[1]!;

  strictEqual(taking.status, "ok");
  strictEqual(takeRoot.type, "take");
  strictEqual(takeRoot.cause_id, null);
  strictEqual(moved.type, "moved");
  strictEqual(moved.cause_id, takeRoot.event_id);
  deepStrictEqual(taking.deltas.map((delta) => delta.field), [
    "contained_in",
    "in_part",
    "support",
    "pos",
  ]);
  strictEqual(taking.deltas.every((delta) => delta.event_id === moved.event_id), true);
  strictEqual(taking.snapshot.entities[bottleId]?.contained_in, setup.actorId);
  strictEqual(taking.snapshot.entities[bottleId]?.in_part, "hand_l");
  strictEqual(taking.snapshot.entities[bottleId]?.support, null);
  strictEqual(taking.snapshot.entities[bottleId]?.pos, null);
  strictEqual(snapshot.entities[bottleId]?.support, setup.roomId);

  const dropping = apply(
    taking.snapshot,
    registry,
    { command_id: "c2", actor: setup.actorId, verb: "drop", target: "bottle" },
  );
  const dropRoot = dropping.events[0]!;
  const dropped = dropping.events[1]!;

  strictEqual(dropping.status, "ok");
  strictEqual(dropRoot.type, "drop");
  strictEqual(dropRoot.cause_id, null);
  strictEqual(dropped.type, "dropped");
  strictEqual(dropped.cause_id, dropRoot.event_id);
  deepStrictEqual(dropping.deltas.slice(0, 4).map((delta) => delta.field), [
    "contained_in",
    "in_part",
    "support",
    "pos",
  ]);
  strictEqual(dropping.snapshot.entities[bottleId]?.contained_in, null);
  strictEqual(dropping.snapshot.entities[bottleId]?.in_part, null);
  strictEqual(dropping.snapshot.entities[bottleId]?.support, setup.roomId);
  deepStrictEqual(dropping.snapshot.entities[bottleId]?.pos, { x: 0, y: 0 });
  strictEqual(dropping.events.some((event) => event.type === "broken"), true);
  strictEqual([...taking.events, ...dropping.events].every((event) => event.command_id.length > 0), true);
});

test("move updates position and a location change needs an open door", () => {
  const setup = world([]);
  const moved = apply(
    setup.snapshot,
    registry,
    command(setup.actorId, "move", undefined, { to: { x: 25, y: 10 } }),
  );
  strictEqual(moved.status, "ok");
  deepStrictEqual(moved.snapshot.entities[setup.actorId]?.pos, { x: 25, y: 10 });

  const otherRoom = spawn(moved.snapshot, registry, "room", { name: "kitchen" });
  const toKitchen = command(setup.actorId, "move", undefined, { location: otherRoom.id });
  // With no doorway to it, the kitchen is no room the guard can name: it answers as an id that
  // names nothing, or names no room, so a move cannot map the world.
  for (const location of [otherRoom.id, "e999", setup.actorId]) {
    const probe = apply(otherRoom.snapshot, registry, command(setup.actorId, "move", undefined, { location }));
    deepStrictEqual([probe.status, probe.reason_code], ["invalid", "invalid_location"], location);
  }

  const shut = spawn(otherRoom.snapshot, registry, "door", {
    props: { open: false, from: setup.roomId, to: otherRoom.id },
  });
  const noDoor = apply(shut.snapshot, registry, toKitchen);
  strictEqual(noDoor.status, "refused");
  strictEqual(noDoor.reason_code, "no_open_door");

  const door = spawn(otherRoom.snapshot, registry, "door", {
    props: { open: true, from: setup.roomId, to: otherRoom.id },
  });
  const throughDoor = apply(
    door.snapshot,
    registry,
    command(setup.actorId, "move", undefined, { location: otherRoom.id }),
  );
  strictEqual(throughDoor.status, "ok");
  strictEqual(throughDoor.snapshot.entities[setup.actorId]?.location, otherRoom.id);
  strictEqual(throughDoor.snapshot.entities[setup.actorId]?.support, otherRoom.id);
});

test("repeating a command on the same snapshot is deterministic", () => {
  const { snapshot, actorId } = world();
  const request = command(actorId, "take", "bottle");

  deepStrictEqual(
    canonicalJson(apply(snapshot, registry, request)),
    canonicalJson(apply(snapshot, registry, request)),
  );
});

test("part addresses resolve only for declared, attached parts", () => {
  const { snapshot, actorId } = world();
  const resolved = resolveTarget(snapshot, registry, actorId, `${actorId}.hand_l`);
  deepStrictEqual(resolved, {
    status: "resolved",
    target: { entity_id: actorId, part: "hand_l", address: `${actorId}.hand_l` },
  });

  const actor = snapshot.entities[actorId]!;
  const detached: Snapshot = {
    ...snapshot,
    entities: {
      ...snapshot.entities,
      [actorId]: {
        ...actor,
        parts: { ...actor.parts, hand_l: { integrity: 0, status: "detached" } },
      },
    },
  };
  strictEqual(resolveTarget(detached, registry, actorId, `${actorId}.hand_l`).status, "unresolved");
});

test("take of a part address is refused with its declared code", () => {
  const { snapshot, actorId } = world();
  const result = apply(snapshot, registry, command(actorId, "take", `${actorId}.hand_r`));

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "target_attached");
});

test("moving rooms carries what the actor holds", () => {
  const setup = world();
  const otherRoom = spawn(setup.snapshot, registry, "room", { name: "cellar" });
  const door = spawn(otherRoom.snapshot, registry, "door", {
    name: "door",
    props: { open: true, from: setup.roomId, to: otherRoom.id },
  });
  const bottleId = setup.bottleIds[0]!;

  const taking = apply(
    door.snapshot,
    registry,
    command(setup.actorId, "take", "bottle"),
  );
  strictEqual(taking.status, "ok");

  const moving = apply(
    taking.snapshot,
    registry,
    command(setup.actorId, "move", undefined, { location: otherRoom.id }),
  );
  strictEqual(moving.status, "ok");
  strictEqual(moving.snapshot.entities[bottleId]?.contained_in, setup.actorId);
  strictEqual(moving.snapshot.entities[bottleId]?.location, otherRoom.id);
  deepStrictEqual(
    validateSnapshot(moving.snapshot, registry).map((issue) => issue.code),
    [],
  );
});
