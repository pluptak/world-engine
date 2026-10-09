import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cli as cliRequest } from "./cli-run.js";
import {
  createWorld,
  memoryWorld,
  type Scenario,
  type World,
  type WorldEvent,
} from "../src/index.js";
import { CommandResponseSchema } from "../src/contract.js";
import { tempDir } from "./harness.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

// The break happens behind a closed door: heard next door, never seen.
const doorScenario: Scenario = [
  { template: "room", overrides: { name: "room-a", props: { lit: true } } },
  { template: "room", overrides: { name: "room-b", props: { lit: true } } },
  {
    template: "door",
    overrides: { name: "door", props: { open: false, from: "e1", to: "e2" } },
  },
  {
    template: "table",
    overrides: { name: "table", location: "e2", support: "e2", pos: { x: 30, y: 0 } },
  },
  {
    template: "bottle",
    overrides: { name: "bottle", location: "e2", support: "e4" },
  },
  {
    template: "human",
    overrides: { name: "listener", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
  },
  {
    template: "human",
    overrides: { name: "breaker", location: "e2", support: "e2", pos: { x: -50, y: 0 } },
  },
  // In the table's path, so the push stops short and the jolt knocks the bottle off.
  {
    template: "stone",
    overrides: { name: "doorstop", location: "e2", support: "e2", pos: { x: 129, y: 0 } },
  },
];

function idOf(world: World, name: string): string {
  for (const [id, entity] of Object.entries(world.snapshot().entities)) {
    if (entity.name === name) {
      return id;
    }
  }
  throw new TypeError(`No entity named ${name}`);
}

// The same seed on disk and in memory, so both worlds run the same commands.
function twoWorlds(t: { after(callback: () => void): void }): { store: World; memory: World } {
  const dir = tempDir(t);
  const store = createWorld(join(dir, "w"), doorScenario);
  const memory = memoryWorld(store.snapshot());
  return { store, memory };
}

function brokenOf(events: WorldEvent[]): WorldEvent {
  const broken = events.find((event) => event.type === "broken");
  ok(broken);
  return broken;
}

// Leaving for a dark room: perceptible before the move, not after — still listed.
const leaveScenario: Scenario = [
  { template: "room", overrides: { name: "room-a", props: { lit: true } } },
  { template: "room", overrides: { name: "room-b", props: { lit: false } } },
  {
    template: "door",
    overrides: { name: "door", props: { open: true, from: "e1", to: "e2" } },
  },
  {
    template: "human",
    overrides: { name: "watcher", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
  },
  {
    template: "human",
    overrides: { name: "leaver", location: "e1", support: "e1", pos: { x: 10, y: 0 } },
  },
];

test("a break behind a closed door is heard next door, not seen", (t) => {
  const { store, memory } = twoWorlds(t);
  for (const world of [store, memory]) {
    const listener = idOf(world, "listener");
    const breaker = idOf(world, "breaker");
    const push = world.command({
      command_id: "push-table",
      actor: breaker,
      verb: "push",
      target: "table",
      perceivers: true,
    });
    strictEqual(push.status, "ok");
    const broken = brokenOf(push.events);
    deepStrictEqual(broken.perceivers?.hearing, [breaker, listener].sort());
    deepStrictEqual(broken.perceivers?.sight, [breaker]);
    deepStrictEqual(broken.perceivers?.smell, []);
    deepStrictEqual(broken.perceivers?.touch, []);
    deepStrictEqual(broken.perceivers?.unknown_senses, ["smell", "touch"]);

    const sounded = push.events.find((event) => event.type === "push");
    ok(sounded);
    deepStrictEqual(sounded.perceivers?.hearing, [breaker]);
    deepStrictEqual(sounded.perceivers?.sight, [breaker]);
    deepStrictEqual(sounded.perceivers?.touch, []);
  }
});

test("leaving for a dark room is still listed as seen", (t) => {
  const dir = tempDir(t);
  const store = createWorld(join(dir, "w"), leaveScenario);
  const memory = memoryWorld(store.snapshot());
  for (const world of [store, memory]) {
    const watcher = idOf(world, "watcher");
    const leaver = idOf(world, "leaver");
    const left = world.command({
      command_id: "leave",
      actor: leaver,
      verb: "move",
      args: { location: idOf(world, "room-b") },
      perceivers: true,
    });
    strictEqual(left.status, "ok");
    const moved = left.events.find((event) => event.type === "moved");
    ok(moved);
    strictEqual(moved.entity, leaver);
    // True in the lit room before the move, false in the dark one after: listed at either end.
    deepStrictEqual(moved.perceivers?.sight, [watcher, leaver].sort());
  }
});

test("events carry no perceivers unless asked", (t) => {
  const { store, memory } = twoWorlds(t);
  for (const world of [store, memory]) {
    const push = world.command({
      command_id: "push-table",
      actor: idOf(world, "breaker"),
      verb: "push",
      target: "table",
    });
    strictEqual(push.status, "ok");
    for (const event of push.events) {
      strictEqual("perceivers" in event, false);
    }
    const refused = world.command({
      command_id: "push-missing",
      actor: idOf(world, "breaker"),
      verb: "push",
      target: "missing",
      perceivers: true,
    });
    strictEqual(refused.status, "unresolved");
    deepStrictEqual(refused.events, []);
  }
});

test("a CLI command with perceivers reports them through the contract", (t) => {
  const dir = tempDir(t);
  const seed = createWorld(join(dir, "w"), doorScenario);
  const breaker = idOf(seed, "breaker");
  const listener = idOf(seed, "listener");

  const cli = cliRequest(JSON.stringify({
        op: "command",
        world: join(dir, "w"),
        command: {
          command_id: "push-table",
          actor: breaker,
          verb: "push",
          target: "table",
          perceivers: true,
        },
      }));
  strictEqual(cli.status, 0, cli.stderr);
  const parsed = CommandResponseSchema.parse(JSON.parse(cli.stdout));
  strictEqual(parsed.status, "ok");
  const broken = brokenOf(parsed.events);
  deepStrictEqual(broken.perceivers?.hearing, [breaker, listener].sort());
  deepStrictEqual(broken.perceivers?.sight, [breaker]);
});

test("removing the table under the bottle by edit with perceivers: true, with listener behind closed door", (t) => {
  const { store, memory } = twoWorlds(t);
  for (const world of [store, memory]) {
    const listener = idOf(world, "listener");
    const breaker = idOf(world, "breaker");
    const result = world.edit(
      { kind: "remove", target: "e4" },
      { command_id: "remove-table", perceivers: true },
    );
    strictEqual(result.status, "ok");
    const broken = brokenOf(result.events);
    deepStrictEqual(broken.perceivers?.hearing, [breaker, listener].sort());
    deepStrictEqual(broken.perceivers?.sight, [breaker]);
    deepStrictEqual(broken.perceivers?.smell, []);
  }
});

test("an edit without the perceivers option yields events with no perceivers key", (t) => {
  const { store, memory } = twoWorlds(t);
  for (const world of [store, memory]) {
    const result = world.edit(
      { kind: "remove", target: "e4" },
      { command_id: "remove-table" },
    );
    strictEqual(result.status, "ok");
    for (const event of result.events) {
      strictEqual("perceivers" in event, false);
    }
  }
});

test("a CLI edit with perceivers: true returns events carrying perceivers", (t) => {
  const dir = tempDir(t);
  const seed = createWorld(join(dir, "w"), doorScenario);
  const listener = idOf(seed, "listener");
  const breaker = idOf(seed, "breaker");

  const cli = cliRequest(JSON.stringify({
        op: "edit",
        world: join(dir, "w"),
        command_id: "remove-table",
        edit: { kind: "remove", target: "e4" },
        perceivers: true,
      }));
  strictEqual(cli.status, 0, cli.stderr);
  const parsed = CommandResponseSchema.parse(JSON.parse(cli.stdout));
  strictEqual(parsed.status, "ok");
  const broken = brokenOf(parsed.events);
  deepStrictEqual(broken.perceivers?.hearing, [breaker, listener].sort());
  deepStrictEqual(broken.perceivers?.sight, [breaker]);
});
