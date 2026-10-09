import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  openWorld,
  WORLD_AUTHOR,
  WorldError,
  type Id,
  type Scenario,
  type World,
  type WorldEdit,
} from "../src/index.js";
import { replay } from "../src/store/file-store.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { presetRegistry } from "./presets.js";
import { fileURLToPath } from "node:url";

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-edit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const shipped: TemplateRegistry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const registry = presetRegistry(shipped);

const scenario: Scenario = [
  { template: "room", overrides: { name: "room" } },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  {
    template: "human",
    overrides: { name: "pusher", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
  {
    template: "open_chest",
    overrides: {
      name: "chest",
      location: "e1",
      support: "e1",
      pos: { x: 40, y: 0 },
    },
  },
];

function editWorld(t: { after(callback: () => void): void }): { dir: string; world: World } {
  const dir = join(tempDir(t), "edited-world");
  return { dir, world: createWorld(dir, scenario, registry) };
}

// An edit spawn into a container, with the name taken from the command id; the world assigns the id.
function spawnInto(world: World, commandId: string, container: Id, template: string): Id {
  const result = world.edit({
    kind: "spawn",
    template,
    overrides: { name: commandId.split("-").at(-1), contained_in: container },
  });
  strictEqual(result.status, "ok");
  const id = result.events[1]?.entity;
  ok(typeof id === "string");
  return id;
}

function causesLeadToRoot(events: Array<{ event_id: string; cause_id: string | null }>): boolean {
  const positions = new Map(events.map((event, index) => [event.event_id, index]));
  return events.every((event, index) => {
    let current = event;
    let currentIndex = index;
    while (current.cause_id !== null) {
      const parent = positions.get(current.cause_id);
      if (parent === undefined || parent >= currentIndex) {
        return false;
      }
      current = events[parent]!;
      currentIndex = parent;
    }
    return currentIndex === 0;
  });
}

test("removing the table under the bottle produces the break chain caused by the edit", (t) => {
  const { dir, world } = editWorld(t);
  const result = world.edit({ kind: "remove", target: "e2" }, { command_id: "remove-table" });

  strictEqual(result.status, "ok");
  deepStrictEqual(
    result.events.map((event) => event.type),
    ["edit", "removed", "displaced", "dropped", "broken", "spawned", "spawned", "spawned"],
  );
  strictEqual(result.events[0]?.cause_id, null);
  strictEqual(
    result.events.every((event) => event.command_id === "remove-table"),
    true,
  );
  ok(causesLeadToRoot(result.events));

  strictEqual(world.entity("e2"), null);
  strictEqual(world.entity("e3")?.status, "broken");
  deepStrictEqual(world.entity("e1")?.residue, { glass: 5, wine: 75 });

  strictEqual(canonicalJson(replay(dir)), canonicalJson(world.snapshot()));
  const entries = readFileSync(join(dir, "log.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { command: { actor: string; verb: string }; status: string });
  deepStrictEqual(entries.at(-1), {
    command: {
      command_id: "remove-table",
      actor: WORLD_AUTHOR,
      verb: "edit",
      target: "e2",
      args: { edit: { kind: "remove", target: "e2" } },
    },
    based_on_version: 0,
    version: 0,
    status: "ok",
  });
});

test("an edit making a support loop is refused with circular_placement", (t) => {
  const { world } = editWorld(t);
  const before = canonicalJson(world.snapshot());

  const loop = world.edit(
    { kind: "place", target: "e2", support: "e3", pos: null },
    { command_id: "loop-table" },
  );

  strictEqual(loop.status, "refused");
  strictEqual(loop.reason_code, "circular_placement");
  strictEqual(world.snapshot().version, 0);
  strictEqual(canonicalJson(loop.snapshot), before);
});

test("spawn, place, set_props and set_part run as one logged edit each", (t) => {
  const { world } = editWorld(t);

  const spawned = world.edit(
    {
      kind: "spawn",
      template: "bottle",
      overrides: { name: "spare", location: "e1", support: "e2" },
    },
    { command_id: "spawn-bottle" },
  );
  strictEqual(spawned.status, "ok");
  deepStrictEqual(
    spawned.events.map((event) => event.type),
    ["edit", "spawned"],
  );
  strictEqual(spawned.resolved_target, null);
  const spare = spawned.events[1]?.entity;
  ok(typeof spare === "string");
  strictEqual(world.entity(spare)?.support, "e2");

  const placed = world.edit(
    { kind: "place", target: spare, support: "e1", contained_in: null, pos: { x: 31, y: 0 } },
    { command_id: "place-bottle" },
  );
  strictEqual(placed.status, "ok");
  deepStrictEqual(
    placed.events.map((event) => event.type),
    ["edit", "placed"],
  );
  strictEqual(placed.resolved_target, spare);
  deepStrictEqual(world.entity(spare)?.pos, { x: 31, y: 0 });

  const chest = world.entity("e5");
  ok(chest);
  const shut = world.edit(
    { kind: "set_props", target: "e5", props: { ...chest.props, open: false } },
    { command_id: "shut-chest" },
  );
  strictEqual(shut.status, "ok");
  deepStrictEqual(
    shut.events.map((event) => [event.type, event.data]),
    [
      ["edit", {}],
      ["edited", { field: "props" }],
    ],
  );
  strictEqual(world.entity("e5")?.props.open, false);

  const hurt = world.edit(
    { kind: "set_part", target: "e4", part: "arm_r", state: { integrity: 60, status: "damaged" } },
    { command_id: "hurt-arm" },
  );
  strictEqual(hurt.status, "ok");
  deepStrictEqual(world.entity("e4")?.parts.arm_r, { integrity: 60, status: "damaged" });
  strictEqual(world.snapshot().version, 4);
});

test("place clears the other relation and follows the chain across rooms", (t) => {
  const { world } = editWorld(t);
  const taken = world.command({
    command_id: "take-bottle",
    actor: "e4",
    verb: "take",
    target: "bottle",
  });
  strictEqual(taken.status, "ok");
  strictEqual(world.entity("e3")?.contained_in, "e4");

  const cellar = world.edit(
    { kind: "spawn", template: "room", overrides: { name: "cellar" } },
    { command_id: "spawn-cellar" },
  );
  const cellarId = cellar.events[1]?.entity;
  ok(typeof cellarId === "string");

  const placed = world.edit(
    { kind: "place", target: "e3", support: "e2", pos: null },
    { command_id: "place-bottle" },
  );
  strictEqual(placed.status, "ok");
  strictEqual(world.entity("e3")?.contained_in, null);
  strictEqual(world.entity("e3")?.support, "e2");

  const moved = world.edit(
    { kind: "place", target: "e2", support: cellarId, pos: { x: 5, y: 0 } },
    { command_id: "place-table" },
  );
  strictEqual(moved.status, "ok");
  strictEqual(world.entity("e2")?.location, cellarId);
  strictEqual(world.entity("e3")?.location, cellarId);
  strictEqual(world.entity("e3")?.support, "e2");

  const reach = world.command({
    command_id: "take-across-rooms",
    actor: "e4",
    verb: "take",
    target: "e3",
  });
  // In another room it is neither sensed nor in reach: even its id names nothing.
  strictEqual(reach.status, "unresolved");
  strictEqual(reach.reason_code, undefined);
});

test("removing a held container passes its contents to the holder", (t) => {
  const { world } = editWorld(t);

  const held = world.edit(
    { kind: "spawn", template: "cup", overrides: { name: "cup", contained_in: "e4" } },
    { command_id: "spawn-held-cup" },
  );
  strictEqual(held.status, "ok");
  const cup = held.events[1]?.entity;
  ok(typeof cup === "string");

  const inner = world.edit(
    // A shard, which fits a cup: a cup in a cup is not a state a container allows.
    { kind: "spawn", template: "glass_shard", overrides: { name: "inner", contained_in: cup } },
    { command_id: "spawn-inner-cup" },
  );
  strictEqual(inner.status, "ok");
  const drop = inner.events[1]?.entity;
  ok(typeof drop === "string");

  const removed = world.edit({ kind: "remove", target: cup }, { command_id: "remove-held-cup" });

  strictEqual(removed.status, "ok");
  deepStrictEqual(
    removed.events.map((event) => event.type),
    ["edit", "removed"],
  );
  strictEqual(world.entity(drop)?.contained_in, "e4");
  strictEqual(world.entity(drop)?.support, null);
  strictEqual(world.entity(drop)?.location, "e1");

  const released = world.command({
    command_id: "drop-inner",
    actor: "e4",
    verb: "drop",
    target: drop,
  });
  strictEqual(released.status, "ok");
});

test("removing a container inside a chest keeps its contents shut inside", (t) => {
  const { world } = editWorld(t);
  const chest = world.entity("e5");
  ok(chest);
  const shut = world.edit(
    { kind: "set_props", target: "e5", props: { ...chest.props, open: false } },
    { command_id: "shut-chest" },
  );
  strictEqual(shut.status, "ok");

  const cup = spawnInto(world, "spawn-cup", "e5", "cup");
  const pebble = spawnInto(world, "spawn-pebble", cup, "glass_shard");

  const removed = world.edit({ kind: "remove", target: cup }, { command_id: "remove-cup" });
  strictEqual(removed.status, "ok");

  strictEqual(world.entity(pebble)?.contained_in, "e5");
  strictEqual(world.entity(pebble)?.support, null);
  strictEqual(world.entity(pebble)?.location, "e1");

  const take = world.command({
    command_id: "take-pebble",
    actor: "e4",
    verb: "take",
    target: "pebble",
  });
  // Shut in the chest, the pebble cannot be named until it is opened.
  strictEqual(take.status, "unresolved");
});

test("a detached part outlives its origin, but not the other way round", (t) => {
  const { world } = editWorld(t);
  const spawned = world.edit(
    {
      kind: "spawn",
      template: "human",
      overrides: { name: "guard", location: "e1", support: "e1", pos: { x: 50, y: 0 } },
    },
    { command_id: "spawn-guard" },
  );
  strictEqual(spawned.status, "ok");
  const guard = spawned.events[1]?.entity;
  ok(typeof guard === "string");

  let arm: string | undefined;
  for (let index = 0; index < 3; index += 1) {
    const hit = world.command({
      command_id: `cut-arm-${index}`,
      actor: "e4",
      verb: "attack",
      target: `${guard}.arm_r`,
    });
    strictEqual(hit.status, "ok");
    const snapshot = world.snapshot();
    arm = Object.keys(snapshot.entities).find(
      (id) => snapshot.entities[id]?.detached_from?.entity === guard,
    );
  }
  ok(arm);

  const removeArm = world.edit({ kind: "remove", target: arm }, { command_id: "remove-arm-first" });
  strictEqual(removeArm.status, "refused");
  strictEqual(removeArm.reason_code, "detached_part_without_entity");

  const removeGuard = world.edit({ kind: "remove", target: guard }, { command_id: "remove-guard" });
  strictEqual(removeGuard.status, "ok");
  strictEqual(world.entity(guard), null);
  deepStrictEqual(world.entity(arm)?.detached_from, { entity: guard, part: "arm_r" });

  const removeArmAfter = world.edit({ kind: "remove", target: arm }, { command_id: "remove-arm" });
  strictEqual(removeArmAfter.status, "ok");
  strictEqual(world.entity(arm), null);
});

test("spawn derives a missing location and refuses two holders", (t) => {
  const { world } = editWorld(t);

  const spawned = world.edit(
    { kind: "spawn", template: "bottle", overrides: { name: "spare", support: "e2" } },
    { command_id: "spawn-spare" },
  );
  strictEqual(spawned.status, "ok");
  const spare = spawned.events[1]?.entity;
  ok(typeof spare === "string");
  strictEqual(world.entity(spare)?.location, "e1");

  const conflict = world.edit(
    { kind: "place", target: spare, support: "e2", contained_in: "e4" },
    { command_id: "conflict-spare" },
  );
  strictEqual(conflict.status, "refused");
  strictEqual(conflict.reason_code, "conflicting_placement");
});

test("a memory edit without options takes the next deterministic command id", () => {
  const stored = createWorld(mkdtempSync(join(tmpdir(), "world-engine-edit-mem-")), scenario, registry);
  const world = memoryWorld(stored.snapshot(), registry);

  const first = world.edit({ kind: "place", target: "e3", support: "e2" });
  strictEqual(first.status, "ok");
  strictEqual(first.command_id, "edit-1");

  const taken = world.command({
    command_id: "take-bottle",
    actor: "e4",
    verb: "take",
    target: "bottle",
  });
  strictEqual(taken.status, "ok");

  const third = world.edit({ kind: "place", target: "e3", support: "e2" });
  strictEqual(third.status, "ok");
  strictEqual(third.command_id, "edit-3");
});

test("the same edits write the same log through one handle or many", (t) => {
  // Spawn a spare bottle, try to loop the table onto the bottle it stands on, then place the spare
  // on the floor: one ok, one refused, one ok. `open` stands for how the caller holds the world:
  // one long-lived handle, or a fresh one per call, as the CLI does.
  const run = (open: () => World): string[] => {
    const spawned = open().edit({
      kind: "spawn",
      template: "bottle",
      overrides: { name: "spare", support: "e2" },
    });
    const spare = spawned.events[1]?.entity;
    ok(typeof spare === "string");
    const looped = open().edit({ kind: "place", target: "e2", support: "e3", pos: null });
    const placed = open().edit({ kind: "place", target: spare, support: "e1", pos: { x: 31, y: 0 } });
    return [
      spawned.status,
      `${looped.status} ${looped.reason_code ?? ""}`.trim(),
      `${placed.status} ${placed.reason_code ?? ""}`.trim(),
    ];
  };

  const runs = [false, true].map((perCall) => {
    const dir = join(tempDir(t), perCall ? "per-call" : "one-handle");
    createWorld(dir, scenario, registry);
    const single = openWorld(dir);
    const statuses = run(perCall ? () => openWorld(dir) : () => single);
    deepStrictEqual(statuses, ["ok", "refused circular_placement", "ok"]);
    return {
      log: readFileSync(join(dir, "log.jsonl"), "utf8"),
      snapshot: readFileSync(join(dir, "snapshot.json"), "utf8"),
    };
  });

  const [one, many] = runs;
  ok(one && many);
  deepStrictEqual(one.log, many.log);
  deepStrictEqual(one.snapshot, many.snapshot);
  ok(one.log.includes('"command_id":"edit-1"'));
  ok(one.log.includes('"command_id":"edit-3"'));
});

test("edits that break snapshot invariants are refused and change nothing", (t) => {
  const { world } = editWorld(t);
  const before = canonicalJson(world.snapshot());

  const overfull = world.edit(
    { kind: "set_part", target: "e4", part: "arm_r", state: { integrity: 200, status: "damaged" } },
    { command_id: "overfull-arm" },
  );
  strictEqual(overfull.status, "refused");
  strictEqual(overfull.reason_code, "integrity_out_of_range");

  const tail = world.edit(
    { kind: "set_part", target: "e4", part: "tail", state: { integrity: 100, status: "intact" } },
    { command_id: "tail-part" },
  );
  strictEqual(tail.status, "refused");
  strictEqual(tail.reason_code, "unknown_part");

  const room = world.edit({ kind: "remove", target: "e1" }, { command_id: "remove-room" });
  strictEqual(room.status, "refused");
  strictEqual(room.reason_code, "occupied_room");

  strictEqual(world.snapshot().version, 0);
  strictEqual(canonicalJson(world.snapshot()), before);
});

test("malformed edits and foreign authors are invalid", (t) => {
  const { world } = editWorld(t);

  const unknown = world.edit(
    { kind: "spawn", template: "dragon", overrides: { location: "e1" } },
    { command_id: "spawn-dragon" },
  );
  strictEqual(unknown.status, "invalid");
  strictEqual(unknown.reason_code, "unknown_template");

  const missing = world.edit({ kind: "remove", target: "e99" }, { command_id: "remove-missing" });
  strictEqual(missing.status, "unresolved");

  const malformed = world.edit({ kind: "remove" } as unknown as WorldEdit, {
    command_id: "malformed",
  });
  strictEqual(malformed.status, "invalid");
  strictEqual(malformed.reason_code, "invalid_args");

  const foreign = world.command({
    command_id: "foreign-edit",
    actor: "e4",
    verb: "edit",
    target: "e2",
    args: { edit: { kind: "remove", target: "e2" } },
  });
  strictEqual(foreign.status, "invalid");
  strictEqual(foreign.reason_code, "invalid_author");

  const mismatched = world.command({
    command_id: "mismatched-edit",
    actor: WORLD_AUTHOR,
    verb: "edit",
    target: "e3",
    args: { edit: { kind: "remove", target: "e2" } },
  });
  strictEqual(mismatched.status, "invalid");
  strictEqual(mismatched.reason_code, "mismatched_target");
});

test("update_props writes the keys it is sent over the rest; set_props replaces them all", (t) => {
  const { dir, world } = editWorld(t);
  const before = world.entity("e5")!.props;

  const shut = world.edit({ kind: "update_props", target: "e5", props: { open: false, locked: false } });
  strictEqual(shut.status, "ok");
  deepStrictEqual(
    shut.events.map((event) => [event.type, event.data]),
    [
      ["edit", {}],
      ["edited", { field: "props" }],
    ],
  );
  deepStrictEqual(world.entity("e5")?.props, { ...before, open: false, locked: false });
  deepStrictEqual(
    shut.deltas.map((delta) => [delta.entity, delta.field, delta.from, delta.to]),
    [["e5", "props", before, { ...before, open: false, locked: false }]],
  );

  // A replacing write that drops a definition the template declares is refused, and changes nothing.
  const dropped = world.edit({ kind: "set_props", target: "e5", props: { open: true } });
  deepStrictEqual([dropped.status, dropped.reason_code], ["refused", "field_not_editable"]);
  deepStrictEqual(world.entity("e5")?.props, { ...before, open: false, locked: false });
  strictEqual(canonicalJson(replay(dir)), canonicalJson(world.snapshot()));
});

test("a spawn that writes a derived field other than the engine derives it is refused derived_field", (t) => {
  const { world } = editWorld(t);
  const hall = world.edit({ kind: "spawn", template: "room", overrides: { name: "hall" } });
  strictEqual(hall.status, "ok");
  const hallId = hall.events[1]!.entity;
  const before = canonicalJson(world.snapshot());

  const elsewhere = world.edit({ kind: "spawn", template: "bottle", overrides: { name: "lost", location: hallId, support: "e2" } });
  deepStrictEqual([elsewhere.status, elsewhere.reason_code], ["refused", "derived_field"]);
  const stunned = world.edit({
    kind: "spawn",
    template: "human",
    overrides: {
      name: "dazed",
      support: "e1",
      pos: { x: 0, y: 90 },
      modifiers: [{ capacity: "manipulation", delta: -50, expires_at_tick: null, cause_id: "ev1" }],
    },
  });
  deepStrictEqual([stunned.status, stunned.reason_code], ["refused", "derived_field"]);
  strictEqual(canonicalJson(world.snapshot()), before);

  // What the engine would derive anyway may be spelled out, and a corpse is state the author may place.
  const spelled = world.edit({
    kind: "spawn",
    template: "human",
    overrides: { name: "corpse", location: "e1", support: "e1", pos: { x: 0, y: 90 }, modifiers: [], status: "destroyed" },
  });
  strictEqual(spelled.status, "ok");
  strictEqual(world.entity(spelled.events[1]!.entity)?.status, "destroyed");
});

test("a scenario that writes a derived field is refused before anything is written", (t) => {
  const dir = join(tempDir(t), "never-created");
  const astray: Scenario = [
    { template: "room", overrides: { name: "room" } },
    { template: "room", overrides: { name: "hall" } },
    { template: "table", overrides: { name: "table", location: "e2", support: "e1", pos: { x: 0, y: 0 } } },
  ];
  try {
    createWorld(dir, astray);
    throw new Error("Expected the scenario to be refused");
  } catch (error) {
    ok(error instanceof WorldError, String(error));
    strictEqual(error.code, "derived_field");
    ok(error.message.includes("entry 2"), error.message);
  }
  strictEqual(existsSync(dir), false);
});
