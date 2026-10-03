import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  WORLD_AUTHOR,
  type Scenario,
  type World,
  type WorldEdit,
} from "../src/index.js";
import { replay } from "../src/store/file-store.js";

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-edit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

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
    template: "chest",
    overrides: {
      name: "chest",
      location: "e1",
      support: "e1",
      pos: { x: 40, y: 0 },
      props: {
        container: true,
        topples: true,
        inner_w_cm: 55,
        inner_d_cm: 35,
        inner_h_cm: 35,
        openable: true,
        open: true,
      },
    },
  },
];

function editWorld(t: { after(callback: () => void): void }): { dir: string; world: World } {
  const dir = join(tempDir(t), "edited-world");
  return { dir, world: createWorld(dir, scenario) };
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

test("a memory edit without options takes the next deterministic command id", () => {
  const stored = createWorld(mkdtempSync(join(tmpdir(), "world-engine-edit-mem-")), scenario);
  const world = memoryWorld(stored.snapshot());

  const result = world.edit({ kind: "place", target: "e3", support: "e2" });

  strictEqual(result.status, "ok");
  strictEqual(result.command_id, "edit-1");
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
