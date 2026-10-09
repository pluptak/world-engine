import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, memoryWorld, type Coverage, type Id, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { SHARED_FIXTURES } from "./presets.js";
import { tempDir } from "./harness.js";

const registry = parseRegistry({
  ...loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))),
  ...SHARED_FIXTURES,
  // A small wine cup: a definition, so a template and not a scenario's say.
  tiny_cup: {
    id: "tiny_cup",
    extends: "cup",
    props: { container: true, topples: true, inner_w_cm: 6, inner_d_cm: 6, inner_h_cm: 8, liquid_material: "wine", liquid_amount: 30 },
  },
  // A shut bottle that survives the fall: tougher and lidded, which no override may write.
  sturdy_shut_bottle: {
    id: "sturdy_shut_bottle",
    extends: "bottle",
    props: { break_fall_cm: 100, openable: true, open: false },
  },
});

const SMELLING: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "smell"],
  properties: ["integrity", "residue", "pos"],
};

const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  // Its footprint ends at ann's centre, so what ann drops lands on the floor.
  { id: "table", template: "table", overrides: { name: "table", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
  {
    id: "cup",
    template: "tiny_cup",
    overrides: { name: "cup", location: "hall", support: "table" },
  },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
  { id: "rex", template: "dog", overrides: { name: "rex", location: "hall", support: "hall", pos: { x: -50, y: 0 } } },
  // In the table's path, so a push stops short and the jolt knocks the cup off.
  { id: "doorstop", template: "stone", overrides: { name: "doorstop", location: "hall", support: "hall", pos: { x: 200, y: 0 } } },
];

// A store world and a memory world over the same snapshot: every spill reads in both.
function spillWorlds(
  t: { after(callback: () => void): void },
  entries: Scenario = scenario,
  coverage?: Coverage,
): [World, World] {
  const dir = tempDir(t);
  const store = createWorld(
    join(dir, "spilled"),
    entries,
    registry,
    coverage === undefined ? undefined : { coverage },
  );
  const names: Record<string, Id> = {};
  for (const entry of entries) {
    if (entry.id !== undefined) {
      const id = store.id(entry.id);
      ok(typeof id === "string", `no id for ${entry.id}`);
      names[entry.id] = id;
    }
  }
  const memory = coverage === undefined
    ? memoryWorld(store.snapshot(), registry, names)
    : memoryWorld(store.snapshot(), registry, names, { coverage });
  return [store, memory];
}

function idsOf(world: World) {
  const id = (name: string): string => {
    const found = world.id(name);
    ok(typeof found === "string", `no id for ${name}`);
    return found;
  };
  return {
    hall: id("hall"),
    table: id("table"),
    cup: id("cup"),
    ann: id("ann"),
    bob: id("bob"),
    rex: id("rex"),
  };
}

test("a vessel that falls without breaking spills all of it onto its landing", (t) => {
  for (const world of spillWorlds(t)) {
    const ids = idsOf(world);
    const removed = world.edit({ kind: "remove", target: ids.table });
    strictEqual(removed.status, "ok");
    deepStrictEqual(
      removed.events.map((event) => event.type),
      ["edit", "removed", "displaced", "dropped", "spilled"],
    );
    const spilled = removed.events.find((event) => event.type === "spilled");
    ok(spilled);
    const dropped = removed.events.find((event) => event.type === "dropped");
    ok(dropped);
    strictEqual(spilled.entity, ids.cup);
    strictEqual(spilled.cause_id, dropped.event_id);
    deepStrictEqual(spilled.data, { material: "wine", amount: 30, to: ids.hall });
    // All or nothing: the vessel reads empty and the floor carries the whole spill.
    strictEqual(world.entity(ids.cup)?.props.liquid_material, "");
    strictEqual(world.entity(ids.cup)?.props.liquid_amount, 0);
    deepStrictEqual(world.entity(ids.hall)?.residue, { wine: 30 });
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a shut vessel that falls keeps its liquid", (t) => {
  const shutBottle: Scenario = [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "table", template: "table", overrides: { name: "table", location: "hall", support: "hall", pos: { x: 30, y: 0 } } },
    {
      id: "flask",
      template: "sturdy_shut_bottle",
      overrides: {
        name: "flask",
        location: "hall",
        support: "table",
        liquid: { material: "wine", pct: 10 },
      },
    },
  ];
  for (const world of spillWorlds(t, shutBottle)) {
    const table = world.id("table");
    const flask = world.id("flask");
    ok(table !== null && flask !== null);
    const removed = world.edit({ kind: "remove", target: table });
    strictEqual(removed.status, "ok");
    strictEqual(
      removed.events.some((event) => event.type === "spilled"),
      false,
    );
    strictEqual(world.entity(flask)?.props.liquid_amount, 75);
    strictEqual(world.entity(flask)?.props.liquid_material, "wine");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a vessel that breaks releases through the break alone, never twice", (t) => {
  const breaking: Scenario = [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "flask", template: "bottle", overrides: { name: "flask", location: "hall", support: "hall", pos: { x: 10, y: 0 } } },
  ];
  for (const world of spillWorlds(t, breaking)) {
    const ann = world.id("ann");
    const flask = world.id("flask");
    const hall = world.id("hall");
    ok(ann !== null && flask !== null && hall !== null);
    strictEqual(world.command({ command_id: "take-flask", actor: ann, verb: "take", target: "flask" }).status, "ok");
    // A hand-height fall breaks the bottle: one release through the break, no spilled beside it.
    const dropped = world.command({ command_id: "drop-flask", actor: ann, verb: "drop", target: "flask" });
    strictEqual(dropped.status, "ok");
    strictEqual(world.entity(flask)?.status, "broken");
    strictEqual(
      dropped.events.some((event) => event.type === "spilled"),
      false,
    );
    deepStrictEqual(world.entity(hall)?.residue, { glass: 5, wine: 750 });
    strictEqual(world.entity(flask)?.props.liquid_amount, 0);
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a hand that held a cup drops it, and it spills", (t) => {
  for (const world of spillWorlds(t)) {
    const ids = idsOf(world);
    strictEqual(
      world.command({ command_id: "take-cup", actor: ids.ann, verb: "take", target: "cup" }).status,
      "ok",
    );
    for (let index = 0; index < 2; index += 1) {
      strictEqual(
        world.command({ command_id: `hit-${index}`, actor: ids.bob, verb: "attack", target: `${ids.ann}.hand_l` }).status,
        "ok",
      );
      strictEqual(
        world.command({ command_id: `rest-${index}`, actor: ids.bob, verb: "wait", args: { ticks: 3 } }).status,
        "ok",
      );
    }
    const fallen = world.command({ command_id: "hit-2", actor: ids.bob, verb: "attack", target: `${ids.ann}.hand_l` });
    strictEqual(fallen.status, "ok");
    const spilled = fallen.events.find((event) => event.type === "spilled");
    ok(spilled, "no spilled event on the hand-loss fall");
    strictEqual(spilled.entity, ids.cup);
    strictEqual(world.entity(ids.cup)?.props.liquid_amount, 0);
    deepStrictEqual(world.entity(ids.hall)?.residue, { wine: 30 });
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a vessel knocked over by a push spills the same way", (t) => {
  for (const world of spillWorlds(t)) {
    const ids = idsOf(world);
    const pushed = world.command({
      command_id: "push-table",
      actor: ids.ann,
      verb: "push",
      target: "table",
      args: { distance_cm: 120, dir: "+x" },
    });
    strictEqual(pushed.status, "ok");
    const spilled = pushed.events.find((event) => event.type === "spilled");
    ok(spilled, "no spilled event on the toppled fall");
    strictEqual(spilled.entity, ids.cup);
    strictEqual(world.entity(ids.cup)?.props.liquid_amount, 0);
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a spill is smelt where coverage declares smell", (t) => {
  for (const world of spillWorlds(t, scenario, SMELLING)) {
    const ids = idsOf(world);
    const removed = world.edit(
      { kind: "remove", target: ids.table },
      { command_id: "remove-table", perceivers: true },
    );
    strictEqual(removed.status, "ok");
    const spilled = removed.events.find((event) => event.type === "spilled");
    ok(spilled !== undefined && spilled.perceivers !== undefined);
    // The fall is heard in the room and through no doorway but a loud one, and only a nose
    // smells it: the spill reads the pour row. Everyone stands in the lit room here.
    deepStrictEqual(
      [...(spilled.perceivers?.sight ?? [])].sort(),
      [ids.ann, ids.bob, ids.rex].sort(),
    );
    deepStrictEqual(
      [...(spilled.perceivers?.hearing ?? [])].sort(),
      [ids.ann, ids.bob, ids.rex].sort(),
    );
    deepStrictEqual(spilled.perceivers?.smell, [ids.rex]);
  }
});
