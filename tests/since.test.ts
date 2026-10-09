import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cli as cliRequest } from "./cli-run.js";
import {
  createWorld,
  memoryWorld,
  WorldError,
  type Command,
  type Scenario,
  type World,
} from "../src/index.js";
import { SinceResponseSchema } from "../src/contract.js";
import { loadTemplates } from "../src/templates.js";
import { presetRegistry } from "./presets.js";
import { tempDir } from "./harness.js";

const presets = presetRegistry(loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))));

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

const scenario: Scenario = [
  { template: "room", overrides: { name: "room" } },
  { template: "table", overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  { template: "human", overrides: { name: "actor", location: "e1", support: "e1", pos: { x: -50, y: 0 } } },
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

const chain: Command[] = [
  { command_id: "take-bottle", actor: "e4", verb: "take", target: "bottle" },
  {
    command_id: "put-on-table",
    actor: "e4",
    verb: "put",
    target: "bottle",
    args: { relation: "on", destination: "table" },
  },
  { command_id: "take-again", actor: "e4", verb: "take", target: "bottle" },
  {
    command_id: "put-in-chest",
    actor: "e4",
    verb: "put",
    target: "bottle",
    args: { relation: "in", destination: "chest" },
  },
  { command_id: "wait-two", actor: "e4", verb: "wait", args: { ticks: 2 } },
];

function runChain(world: World): { deltas: unknown[]; events: unknown[] } {
  const deltas: unknown[] = [];
  const events: unknown[] = [];
  for (const command of chain) {
    const result = world.command(command);
    strictEqual(result.status, "ok", command.command_id);
    deltas.push(...result.deltas);
    events.push(...result.events);
  }
  return { deltas, events };
}

test("since(0) equals the concatenated command results", (t) => {
  const world = createWorld(join(tempDir(t), "fold"), scenario, presets);
  const expected = runChain(world);

  const since = world.since(0);
  deepStrictEqual(since.deltas, expected.deltas);
  deepStrictEqual(since.events, expected.events);

  strictEqual(world.since(world.snapshot().version).deltas.length, 0);
});

test("a mid-world since cuts the fold at the right command", (t) => {
  const world = createWorld(join(tempDir(t), "cut"), scenario, presets);
  const first = world.command(chain[0]!);
  strictEqual(first.status, "ok");
  const second = world.command(chain[1]!);
  strictEqual(second.status, "ok");

  const sinceOne = world.since(1);
  deepStrictEqual(sinceOne.deltas, second.deltas);
  deepStrictEqual(sinceOne.events, second.events);
});

test("a future or negative version is refused in both worlds", (t) => {
  const stored = createWorld(join(tempDir(t), "versions"), scenario, presets);
  const memory = memoryWorld(stored.snapshot(), presets);

  for (const world of [stored, memory]) {
    throws(
      () => world.since(99),
      (error: unknown) => error instanceof WorldError && error.code === "future_version",
    );
    throws(
      () => world.since(-1),
      (error: unknown) => error instanceof WorldError && error.code === "invalid_version",
    );
  }
});

test("a memory world only knows its own lifetime", (t) => {
  const dir = join(tempDir(t), "seed");
  const stored = createWorld(dir, scenario, presets);
  const taken = stored.command({ command_id: "take-bottle", actor: "e4", verb: "take", target: "bottle" });
  strictEqual(taken.status, "ok");
  strictEqual(stored.snapshot().version, 1);

  const memory = memoryWorld(stored.snapshot(), presets);
  throws(
    () => memory.since(0),
    (error: unknown) => error instanceof WorldError && error.code === "history_unavailable",
  );
  const after = memory.command({ command_id: "drop-bottle", actor: "e4", verb: "drop", target: "bottle" });
  strictEqual(after.status, "ok");
  deepStrictEqual(memory.since(1).events, after.events);
});

test("a memory world answers since from its own records", (t) => {
  const stored = createWorld(join(tempDir(t), "memory-source"), scenario, presets);
  const memory = memoryWorld(stored.snapshot(), presets);
  const expected = runChain(memory);

  const since = memory.since(0);
  deepStrictEqual(since.events, expected.events);
  deepStrictEqual(since.deltas, expected.deltas);
});

test("the CLI answers since", (t) => {
  const dir = join(tempDir(t), "cli");
  const world = createWorld(dir, scenario, presets);
  const taken = world.command(chain[0]!);
  strictEqual(taken.status, "ok");

  const cli = cliRequest(JSON.stringify({ op: "since", world: dir, version: 0 }));
  strictEqual(cli.status, 0, cli.stderr);
  const parsed = SinceResponseSchema.parse(JSON.parse(cli.stdout));
  deepStrictEqual(parsed.events, taken.events);
  deepStrictEqual(parsed.deltas, taken.deltas);
});
