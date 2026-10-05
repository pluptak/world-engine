import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { apply } from "../src/engine/pipeline.js";
import { spawn } from "../src/engine/spawn.js";
import type { Id, Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash, type TemplateRegistry } from "../src/templates.js";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));
const baseRegistry = loadTemplates(templatesDir);

interface GiveWorld {
  snapshot: Snapshot;
  registry: TemplateRegistry;
  roomId: Id;
  giverId: Id;
  recipientId: Id;
  tableId: Id;
  itemId: Id;
}

function giveWorld(registry: TemplateRegistry = baseRegistry): GiveWorld {
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(initial, registry, "room", { name: "room" });
  const onFloor = (snapshot: Snapshot, templateId: string, name: string, x: number) =>
    spawn(snapshot, registry, templateId, {
      name,
      location: room.id,
      support: room.id,
      pos: { x, y: 0 },
    });

  const giver = onFloor(room.snapshot, "human", "giver", 0);
  const recipient = onFloor(giver.snapshot, "human", "recipient", 50);
  // Its footprint ends at the recipient's centre, so what the recipient drops lands on the floor.
  const table = onFloor(recipient.snapshot, "table", "table", 110);
  const chair = onFloor(table.snapshot, "chair", "chair", 90);
  const item = spawn(chair.snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    support: null,
    contained_in: giver.id,
  });

  return {
    snapshot: item.snapshot,
    registry,
    roomId: room.id,
    giverId: giver.id,
    recipientId: recipient.id,
    tableId: table.id,
    itemId: item.id,
  };
}

function give(world: GiveWorld, args: Record<string, unknown>, snapshot = world.snapshot) {
  return apply(snapshot, world.registry, {
    command_id: "give-item",
    actor: world.giverId,
    verb: "give",
    target: "bottle",
    args,
  });
}

test("giving an item to another actor leaves exactly one containment delta", () => {
  const world = giveWorld();
  const result = give(world, { destination: "recipient" });

  strictEqual(result.status, "ok");
  deepStrictEqual(
    result.deltas.map((delta) => [delta.entity, delta.field, delta.from, delta.to]),
    [[world.itemId, "contained_in", world.giverId, world.recipientId]],
  );
  const item = result.snapshot.entities[world.itemId];
  strictEqual(item?.contained_in, world.recipientId);
  strictEqual(item?.support, null);
  strictEqual(item?.pos, null);
  strictEqual(item?.location, world.roomId);

  deepStrictEqual(result.events.map((event) => event.type), ["give", "moved"]);
  strictEqual(result.events[1]?.entity, world.itemId);
  strictEqual(result.events[1]?.cause_id, result.events[0]?.event_id);
  deepStrictEqual(result.events[1]?.data, { from: world.giverId, to: world.recipientId });
});

test("the giver no longer holds the item and the recipient can drop it", () => {
  const world = giveWorld();
  const given = give(world, { destination: "recipient" });
  strictEqual(given.status, "ok");

  const dropped = apply(given.snapshot, world.registry, {
    command_id: "recipient-drops",
    actor: world.recipientId,
    verb: "drop",
    target: "bottle",
  });

  strictEqual(dropped.status, "ok");
  strictEqual(dropped.snapshot.entities[world.itemId]?.contained_in, null);
  strictEqual(dropped.snapshot.entities[world.itemId]?.support, world.roomId);
});

test("giving out of reach is refused", () => {
  const world = giveWorld();
  const far = spawn(world.snapshot, world.registry, "human", {
    name: "stranger",
    location: world.roomId,
    support: world.roomId,
    pos: { x: 900, y: 0 },
  });
  const result = give(world, { destination: far.id }, far.snapshot);

  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "out_of_reach");
  strictEqual(result.deltas.length, 0);
  strictEqual(result.events.length, 0);
});

test("a recipient who lost a hand cannot take a two-handed item", () => {
  const registry: TemplateRegistry = {
    ...baseRegistry,
    human: {
      ...baseRegistry.human!,
      parts: baseRegistry.human!.parts.filter((part) => part.name !== "hand_r"),
    },
  };
  const world = giveWorld(registry);
  const twoHanded = spawn(world.snapshot, registry, "stone", {
    name: "crate",
    location: world.roomId,
    support: null,
    contained_in: world.giverId,
    props: { hands_required: 2 },
  });

  const refused = apply(twoHanded.snapshot, registry, {
    command_id: "give-crate",
    actor: world.giverId,
    verb: "give",
    target: "crate",
    args: { destination: "recipient" },
  });

  strictEqual(refused.status, "refused");
  strictEqual(refused.reason_code, "insufficient_manipulation");
  strictEqual(refused.snapshot.entities[twoHanded.id]?.contained_in, world.giverId);
});

test("the giver cannot take back what the recipient now holds", () => {
  const world = giveWorld();
  const given = give(world, { destination: "recipient" });
  strictEqual(given.status, "ok");

  const retaken = apply(given.snapshot, world.registry, {
    command_id: "giver-takes-back",
    actor: world.giverId,
    verb: "take",
    target: "bottle",
  });

  strictEqual(retaken.status, "refused");
  strictEqual(retaken.reason_code, "held_by_another");
  strictEqual(retaken.snapshot.entities[world.itemId]?.contained_in, world.recipientId);
});

test("a recipient who cannot move but has hands receives an item", () => {
  const registry: TemplateRegistry = {
    ...baseRegistry,
    human: {
      ...baseRegistry.human!,
      parts: baseRegistry.human!.parts.filter((part) => part.name !== "torso"),
    },
  };
  const world = giveWorld(registry);
  const pen = spawn(world.snapshot, registry, "stone", {
    name: "pen",
    location: world.roomId,
    support: null,
    contained_in: world.giverId,
  });

  const result = apply(pen.snapshot, registry, {
    command_id: "give-pen",
    actor: world.giverId,
    verb: "give",
    target: "pen",
    args: { destination: "recipient" },
  });

  strictEqual(result.status, "ok");
  strictEqual(result.snapshot.entities[pen.id]?.contained_in, world.recipientId);
  strictEqual(result.snapshot.entities[pen.id]?.in_part, "hand_l");
  deepStrictEqual(
    result.deltas.map((delta) => [delta.field, delta.from, delta.to]),
    [
      ["contained_in", world.giverId, world.recipientId],
      ["in_part", "hand_r", "hand_l"],
    ],
  );
});

test("give refuses a severed arm and a chair", () => {
  const world = giveWorld();
  let snapshot = world.snapshot;
  for (let index = 0; index < 3; index += 1) {
    const hit = apply(snapshot, world.registry, {
      command_id: `cut-arm-${index}`,
      actor: world.giverId,
      verb: "attack",
      target: `${world.recipientId}.arm_r`,
    });
    strictEqual(hit.status, "ok");
    snapshot = hit.snapshot;
  }

  const arm = Object.values(snapshot.entities).find(
    (entity) => entity.detached_from?.entity === world.recipientId,
  );
  ok(arm);
  strictEqual(arm.template, "human.arm_r");

  const toArm = give(world, { destination: arm.id }, snapshot);
  strictEqual(toArm.status, "refused");
  strictEqual(toArm.reason_code, "not_an_actor");
  strictEqual(toArm.snapshot.entities[world.itemId]?.contained_in, world.giverId);

  const toChair = give(world, { destination: "chair" });
  strictEqual(toChair.status, "refused");
  strictEqual(toChair.reason_code, "not_an_actor");
});

test("an agent template that is detached from a whole is not an agent", () => {
  const world = giveWorld();
  const severed = spawn(world.snapshot, world.registry, "human", {
    name: "severed",
    location: world.roomId,
    support: world.roomId,
    pos: { x: 40, y: 0 },
    detached_from: { entity: world.recipientId, part: "torso" },
  });

  const result = give(world, { destination: severed.id }, severed.snapshot);
  strictEqual(result.status, "refused");
  strictEqual(result.reason_code, "not_an_actor");
});

test("giving refuses what the recipient cannot be or accept", () => {
  const world = giveWorld();

  const toSelf = give(world, { destination: "giver" });
  strictEqual(toSelf.status, "refused");
  strictEqual(toSelf.reason_code, "cannot_give_to_self");

  const uncarried = apply(world.snapshot, world.registry, {
    command_id: "give-table",
    actor: world.giverId,
    verb: "give",
    target: "table",
    args: { destination: "recipient" },
  });
  strictEqual(uncarried.status, "refused");
  strictEqual(uncarried.reason_code, "not_carried");

  const noDestination = give(world, {});
  strictEqual(noDestination.status, "invalid");
  strictEqual(noDestination.reason_code, "invalid_args");
});

test("a give destination resolves like any other target", () => {
  const world = giveWorld();
  const unknown = give(world, { destination: "nobody" });
  strictEqual(unknown.status, "unresolved");
  strictEqual(unknown.resolved_target, null);

  const twin = spawn(world.snapshot, world.registry, "human", {
    name: "recipient",
    location: world.roomId,
    support: world.roomId,
    pos: { x: 60, y: 0 },
  });
  const ambiguous = give(world, { destination: "recipient" }, twin.snapshot);
  strictEqual(ambiguous.status, "ambiguous");
  deepStrictEqual(ambiguous.candidates, [world.recipientId, twin.id]);

  const part = give(world, { destination: `${world.recipientId}.hand_r` });
  strictEqual(part.status, "refused");
  strictEqual(part.reason_code, "not_an_actor");
});