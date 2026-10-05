import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { apply } from "../src/engine/pipeline.js";
import { spawn } from "../src/engine/spawn.js";
import type { Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash, type TemplateRegistry } from "../src/templates.js";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));
const baseRegistry = loadTemplates(templatesDir);

function bottleWorld(
  registry: TemplateRegistry = baseRegistry,
  bottleProps: Record<string, number | string | boolean> = {},
  carried = false,
) {
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(initial, registry, "room", { name: "room" });
  const table = spawn(room.snapshot, registry, "table", {
    name: "table",
    location: room.id,
    support: room.id,
    pos: { x: 30, y: 0 },
  });
  const actor = spawn(table.snapshot, registry, "human", {
    name: "guard",
    location: room.id,
    support: room.id,
    // Beside the table, not inside its footprint, so what the guard drops lands on the floor.
    pos: { x: -40, y: 0 },
  });
  const bottle = spawn(actor.snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    support: carried ? null : table.id,
    contained_in: carried ? actor.id : null,
    pos: carried ? null : { x: 30, y: 0 },
    props: { ...registry.bottle!.props, ...bottleProps },
  });
  return {
    snapshot: bottle.snapshot,
    roomId: room.id,
    tableId: table.id,
    actorId: actor.id,
    bottleId: bottle.id,
  };
}

test("pushing a table propagates a deterministic bottle break chain", () => {
  const scenario = bottleWorld();
  const result = apply(scenario.snapshot, baseRegistry, {
    command_id: "push-table",
    actor: scenario.actorId,
    verb: "push",
    target: "table",
  });

  strictEqual(result.status, "ok");
  deepStrictEqual(
    result.events.map((event) => event.type),
    ["push", "moved", "displaced", "dropped", "broken", "spawned", "spawned", "spawned"],
  );
  strictEqual(result.events[0]?.cause_id, null);
  strictEqual(result.events[0]?.command_id, "push-table");
  strictEqual(result.events[1]?.entity, scenario.tableId);
  strictEqual(result.events[2]?.entity, scenario.bottleId);
  strictEqual(result.events[3]?.data.fall_cm, 75);

  const byId = new Map(result.events.map((event, index) => [event.event_id, { event, index }]));
  for (const [index, event] of result.events.entries()) {
    let current = event;
    let currentIndex = index;
    while (current.cause_id !== null) {
      const parent = byId.get(current.cause_id);
      ok(parent);
      ok(parent.index < currentIndex);
      current = parent.event;
      currentIndex = parent.index;
    }
    strictEqual(current.command_id, "push-table");
  }

  const bottle = result.snapshot.entities[scenario.bottleId]!;
  strictEqual(bottle.status, "broken");
  strictEqual(bottle.props.liquid_material, "");
  strictEqual(bottle.props.liquid_amount, 0);
  deepStrictEqual(result.snapshot.entities[scenario.roomId]?.residue, { glass: 5, wine: 75 });
  strictEqual(
    Object.values(result.snapshot.entities).filter((entity) => entity.template === "glass_shard").length,
    3,
  );
  strictEqual(
    Object.values(result.snapshot.entities)
      .filter((entity) => entity.template === "glass_shard")
      .every((entity) => entity.support === scenario.roomId && entity.pos?.x === 60),
    true,
  );
});

test("a non-toppling item remains supported when its surface is pushed", () => {
  const scenario = bottleWorld(baseRegistry, { topples: false });
  const result = apply(scenario.snapshot, baseRegistry, {
    command_id: "push-table",
    actor: scenario.actorId,
    verb: "push",
    target: "table",
  });

  strictEqual(result.status, "ok");
  strictEqual(result.events.some((event) => event.type === "displaced"), false);
  strictEqual(result.snapshot.entities[scenario.bottleId]?.support, scenario.tableId);
});

test("an insufficient fall drops the bottle without breaking it", () => {
  const registry: TemplateRegistry = {
    ...baseRegistry,
    bottle: {
      ...baseRegistry.bottle!,
      props: { ...baseRegistry.bottle!.props, break_fall_cm: 100 },
    },
  };
  const scenario = bottleWorld(registry);
  const result = apply(scenario.snapshot, registry, {
    command_id: "push-table",
    actor: scenario.actorId,
    verb: "push",
    target: "table",
  });

  strictEqual(result.status, "ok");
  strictEqual(result.events.some((event) => event.type === "dropped"), true);
  strictEqual(result.events.some((event) => event.type === "broken"), false);
  strictEqual(result.snapshot.entities[scenario.bottleId]?.status, "intact");
  // The fall that does not break still spills: the vessel empties onto the room.
  const spilled = result.events.find((event) => event.type === "spilled");
  ok(spilled !== undefined);
  strictEqual(spilled.entity, scenario.bottleId);
  deepStrictEqual(spilled.data, { material: "wine", amount: 75, to: scenario.roomId });
  strictEqual(result.snapshot.entities[scenario.bottleId]?.props.liquid_material, "");
  strictEqual(result.snapshot.entities[scenario.bottleId]?.props.liquid_amount, 0);
  deepStrictEqual(result.snapshot.entities[scenario.roomId]?.residue, { wine: 75 });
});

test("dropping a bottle from hand height breaks it and spills its contents", () => {
  const scenario = bottleWorld(baseRegistry, {}, true);
  const result = apply(scenario.snapshot, baseRegistry, {
    command_id: "drop-bottle",
    actor: scenario.actorId,
    verb: "drop",
    target: "bottle",
  });

  strictEqual(result.status, "ok");
  const dropped = result.events.find((event) => event.type === "dropped");
  ok(dropped);
  strictEqual(dropped.data.fall_cm, 100);
  strictEqual(result.events.some((event) => event.type === "broken"), true);
  strictEqual(result.snapshot.entities[scenario.bottleId]?.status, "broken");
  deepStrictEqual(result.snapshot.entities[scenario.roomId]?.residue, { glass: 5, wine: 75 });
});

test("solid contents lose containment onto the bottle's landing surface", () => {
  const scenario = bottleWorld();
  const stone = spawn(scenario.snapshot, baseRegistry, "stone", {
    name: "stone",
    location: scenario.roomId,
    contained_in: scenario.bottleId,
  });
  const result = apply(stone.snapshot, baseRegistry, {
    command_id: "push-table",
    actor: scenario.actorId,
    verb: "push",
    target: "table",
  });

  strictEqual(result.status, "ok");
  strictEqual(result.snapshot.entities[stone.id]?.contained_in, null);
  strictEqual(result.snapshot.entities[stone.id]?.support, scenario.roomId);
  deepStrictEqual(result.snapshot.entities[stone.id]?.pos, { x: 60, y: 0 });
  const stoneDrop = result.events.find((event) => event.type === "dropped" && event.entity === stone.id);
  ok(stoneDrop);
  const bottleBreak = result.events.find((event) => event.type === "broken");
  ok(bottleBreak);
  strictEqual(stoneDrop.cause_id, bottleBreak.event_id);
});

test("pull moves the target opposite the requested direction", () => {
  const scenario = bottleWorld(baseRegistry, { topples: false });
  const result = apply(scenario.snapshot, baseRegistry, {
    command_id: "pull-table",
    actor: scenario.actorId,
    verb: "pull",
    target: "table",
    args: { distance_cm: 10, dir: "+x" },
  });

  strictEqual(result.status, "ok");
  deepStrictEqual(result.snapshot.entities[scenario.tableId]?.pos, { x: 20, y: 0 });
});
