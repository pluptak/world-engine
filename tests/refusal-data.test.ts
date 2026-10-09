import { deepStrictEqual, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, type Scenario } from "../src/index.js";
import { CommandResponseSchema } from "../src/contract.js";
import { reachData } from "../src/engine/verbs/address.js";
import { spawn } from "../src/engine/spawn.js";
import { loadTemplates, templatesHash } from "../src/templates.js";
import { presetRegistry } from "./presets.js";

const presets = presetRegistry(loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))));
import type { Snapshot } from "../src/model.js";

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-refusal-data-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const farScenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "human",
    overrides: { name: "actor", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
  {
    template: "bottle",
    overrides: { name: "bottle", location: "e1", support: "e1", pos: { x: 100, y: 0 } },
  },
];

test("a far take carries distance and reach data", (t) => {
  const world = createWorld(join(tempDir(t), "far"), farScenario);
  const taken = world.command({ command_id: "take-far", actor: "e2", verb: "take", target: "bottle" });
  strictEqual(taken.status, "refused");
  strictEqual(taken.reason_code, "out_of_reach");
  deepStrictEqual(taken.reason_data, { distance_cm: 150, reach_cm: 100 });
  const parsed = CommandResponseSchema.parse({
    status: taken.status,
    command_id: taken.command_id,
    resolved_target: taken.resolved_target,
    reason_code: taken.reason_code,
    reason_data: taken.reason_data,
    snapshot_version: taken.snapshot.version,
    deltas: taken.deltas,
    events: taken.events,
  });
  deepStrictEqual(parsed.reason_data, { distance_cm: 150, reach_cm: 100 });
});

test("a take just beyond reach reports ceiling'd distance", (t) => {
  const world = createWorld(join(tempDir(t), "ceiled-reach"), [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "stone",
      overrides: { name: "stone", location: "e1", support: "e1", pos: { x: 100, y: 1 } },
    },
  ]);
  const taken = world.command({ command_id: "take-stone", actor: "e2", verb: "take", target: "stone" });
  strictEqual(taken.status, "refused");
  strictEqual(taken.reason_code, "out_of_reach");
  deepStrictEqual(taken.reason_data, { distance_cm: 101, reach_cm: 100 });
});

test("unmeasurable reach yields no data", () => {  const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
  let snapshot: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(snapshot, registry, "room", { name: "room" });
  snapshot = room.snapshot;
  const actor = spawn(snapshot, registry, "human", {
    name: "actor",
    location: room.id,
    support: room.id,
    pos: { x: -50, y: 0 },
  });
  snapshot = actor.snapshot;
  const bottle = spawn(snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    support: room.id,
    pos: { x: 100, y: 0 },
  });
  snapshot = bottle.snapshot;
  const door = spawn(snapshot, registry, "door", {
    props: { open: true, from: room.id, to: "elsewhere" },
  });
  snapshot = door.snapshot;
  deepStrictEqual(reachData(snapshot, actor.id, bottle.id), { distance_cm: 150, reach_cm: 100 });
  strictEqual(reachData(snapshot, actor.id, door.id), null);
});

test("a chair into a chest reports the failing pair", (t) => {
  const world = createWorld(join(tempDir(t), "chair"), [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "chair",
      overrides: { name: "chair", location: "e1", support: "e1", pos: { x: 10, y: 0 } },
    },
    {
      template: "open_chest",
      overrides: {
        name: "chest",
        location: "e1",
        support: "e1",
        pos: { x: 20, y: 0 },
      },
    },
  ], presets);
  strictEqual(
    world.command({ command_id: "take-chair", actor: "e2", verb: "take", target: "chair" }).status,
    "ok",
  );
  const put = world.command({
    command_id: "put-chair",
    actor: "e2",
    verb: "put",
    target: "chair",
    args: { relation: "in", destination: "chest" },
  });
  strictEqual(put.status, "refused");
  strictEqual(put.reason_code, "too_large");
  deepStrictEqual(put.reason_data, { item_cm: 90, space_cm: 55 });
});

test("a take from a shut chest names the enclosure to one who smells what is in it", (t) => {
  const chest = (): Scenario[number] => ({
    template: "shut_chest",
    overrides: {
      name: "chest",
      location: "e1",
      support: "e1",
      pos: { x: 20, y: 0 },
    },
  });
  const at = (template: string, name: string) => ({
    template,
    overrides: { name, location: "e1", support: "e1", pos: { x: 0, y: 0 } },
  });
  const inChest = (template: string) => ({
    template,
    overrides: { name: "bottle", location: "e1", support: null, contained_in: "e3" },
  });
  const room = { template: "room", overrides: { name: "room", props: { lit: true } } };

  // A plain bottle in the shut chest is neither seen nor smelt: there is nothing to name.
  const blind = createWorld(join(tempDir(t), "shut"), [room, at("human", "actor"), chest(), inChest("bottle")], presets);
  const unnamed = blind.command({ command_id: "take", actor: "e2", verb: "take", target: "bottle" });
  strictEqual(unnamed.status, "unresolved");
  strictEqual(unnamed.reason_data, undefined);

  // Wine smells through the lid, so a dog in a world that covers smell can name it, and is refused.
  const nosed = createWorld(
    join(tempDir(t), "shut-smelt"),
    [room, at("dog", "rex"), chest(), inChest("wine_bottle")],
    presets,
    { coverage: { relations: [], senses: ["sight", "hearing", "smell"], properties: [] } },
  );
  const taken = nosed.command({ command_id: "take", actor: "e2", verb: "take", target: "bottle" });
  strictEqual(taken.status, "refused");
  strictEqual(taken.reason_code, "container_closed");
  deepStrictEqual(taken.reason_data, { enclosure: "e3" });
});

test("a put into a shut chest names the enclosure", (t) => {
  const world = createWorld(join(tempDir(t), "shut-put"), [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "bottle",
      overrides: { name: "bottle", location: "e1", support: "e1", pos: { x: 10, y: 0 } },
    },
    {
      template: "shut_chest",
      overrides: {
        name: "chest",
        location: "e1",
        support: "e1",
        pos: { x: 20, y: 0 },
      },
    },
  ], presets);
  strictEqual(
    world.command({ command_id: "take", actor: "e2", verb: "take", target: "bottle" }).status,
    "ok",
  );
  const put = world.command({
    command_id: "put",
    actor: "e2",
    verb: "put",
    target: "bottle",
    args: { relation: "in", destination: "chest" },
  });
  strictEqual(put.status, "refused");
  strictEqual(put.reason_code, "container_closed");
  deepStrictEqual(put.reason_data, { enclosure: "e4" });
});

test("misfit reports the first failing pair", async () => {
  const { misfit } = await import("../src/engine/fit.js");
  deepStrictEqual(misfit([200, 70], [120, 60]), { item_cm: 200, space_cm: 120 });
  deepStrictEqual(misfit([90, 45, 45], [55, 35, 35]), { item_cm: 90, space_cm: 55 });
  strictEqual(misfit([8, 8], [120, 60]), null);
});

test("a handless take names capacity, have and need", (t) => {
  const world = createWorld(join(tempDir(t), "handless"), [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "bottle",
      overrides: { name: "bottle", location: "e1", support: "e1", pos: { x: 10, y: 0 } },
    },
  ]);
  for (const part of ["hand_l", "hand_r"]) {
    strictEqual(
      world.edit(
        { kind: "set_part", target: "e2", part, state: { integrity: 0, status: "destroyed" } },
        { command_id: `break-${part}` },
      ).status,
      "ok",
    );
  }
  const taken = world.command({ command_id: "take", actor: "e2", verb: "take", target: "bottle" });
  strictEqual(taken.status, "refused");
  strictEqual(taken.reason_code, "insufficient_manipulation");
  deepStrictEqual(taken.reason_data, { capacity: "manipulation", have: 0, need: 50 });
});

test("a legless move names moving have and need", (t) => {
  const world = createWorld(join(tempDir(t), "legless"), [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
  ]);
  strictEqual(
    world.edit(
      { kind: "set_part", target: "e2", part: "torso", state: { integrity: 0, status: "destroyed" } },
      { command_id: "break-torso" },
    ).status,
    "ok",
  );
  const moved = world.command({ command_id: "move", actor: "e2", verb: "move", args: { to: { x: 5, y: 0 } } });
  strictEqual(moved.status, "refused");
  strictEqual(moved.reason_code, "insufficient_moving");
  deepStrictEqual(moved.reason_data, { capacity: "moving", have: 0, need: 1 });
});

test("every mapped refusal carries data; unmapped ones do not", (t) => {
  const dir = tempDir(t);
  const world = createWorld(join(dir, "sweep"), [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
    },
    {
      template: "bottle",
      overrides: { name: "bottle", location: "e1", support: "e1", pos: { x: 100, y: 0 } },
    },
    {
      template: "dog",
      overrides: { name: "dog", location: "e1", support: "e1", pos: { x: 50, y: 0 } },
    },
    {
      template: "table",
      overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
    },
    {
      template: "stone",
      overrides: { name: "stone", location: "e1", support: "e1", pos: { x: 55, y: 0 } },
    },
    {
      template: "shut_chest",
      overrides: {
        name: "chest",
        location: "e1",
        support: "e1",
        pos: { x: 20, y: 0 },
        props: { locked: true },
      },
    },
  ], presets);
  const far = world.command({ command_id: "m1", actor: "e2", verb: "take", target: "bottle" });
  strictEqual(far.reason_code, "out_of_reach");
  deepStrictEqual(Object.keys(far.reason_data ?? {}).sort(), ["distance_cm", "reach_cm"]);
  const uncarried = world.command({
    command_id: "m2",
    actor: "e2",
    verb: "put",
    target: "bottle",
    args: { relation: "in", destination: "chest" },
  });
  strictEqual(uncarried.reason_code, "not_carried");
  strictEqual(uncarried.reason_data, undefined);
  const locked = world.command({ command_id: "m3", actor: "e2", verb: "open", target: "chest" });
  strictEqual(locked.reason_code, "locked");
  strictEqual(locked.reason_data, undefined);
  const heavy = world.command({ command_id: "m4", actor: "e4", verb: "take", target: "table" });
  strictEqual(heavy.reason_code, "too_heavy");
  strictEqual(heavy.reason_data, undefined);
  strictEqual(
    world.command({ command_id: "m5", actor: "e4", verb: "take", target: "bottle" }).status,
    "ok",
  );
  const full = world.command({ command_id: "m6", actor: "e4", verb: "take", target: "stone" });
  strictEqual(full.reason_code, "mouth_full");
  strictEqual(full.reason_data, undefined);
});
