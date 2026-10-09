import { deepStrictEqual, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli as cliRequest } from "./cli-run.js";
import { createWorld, memoryWorld, type Scenario } from "../src/index.js";
import { tempDir } from "./harness.js";

function logLines(dir: string): number {
  return readFileSync(join(dir, "log.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0).length;
}

const bottleScenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  {
    template: "human",
    overrides: { name: "anna", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
  {
    template: "human",
    overrides: { name: "bob", location: "e1", support: "e1", pos: { x: -40, y: 0 } },
  },
];

test("two takes of one bottle give ok then preempted", (t) => {
  for (const world of [
    createWorld(join(tempDir(t), "store"), bottleScenario),
    memoryWorld(createWorld(join(tempDir(t), "seed"), bottleScenario).snapshot()),
  ]) {
    const results = world.beat([
      { command_id: "take-1", actor: "e4", verb: "take", target: "bottle" },
      { command_id: "take-2", actor: "e5", verb: "take", target: "bottle" },
    ]);
    strictEqual(results.length, 2);
    strictEqual(results[0]?.status, "ok");
    strictEqual(results[1]?.status, "preempted");
    strictEqual(results[1]?.reason_code, "held_by_another");
    strictEqual(world.snapshot().version, 1);
    strictEqual(world.entity("e3")?.contained_in, "e4");
  }
});

test("a beat is not atomic and an empty beat is a no-op", (t) => {
  const dir = join(tempDir(t), "mixed");
  const world = createWorld(dir, bottleScenario);
  const before = logLines(dir);
  const results = world.beat([
    {
      command_id: "put-uncarried",
      actor: "e4",
      verb: "put",
      target: "bottle",
      args: { relation: "on", destination: "table" },
    },
    { command_id: "wait", actor: "e4", verb: "wait", args: { ticks: 1 } },
  ]);
  strictEqual(results[0]?.status, "refused");
  strictEqual(results[0]?.reason_code, "not_carried");
  strictEqual(results[1]?.status, "ok");
  strictEqual(world.snapshot().version, 1);
  strictEqual(logLines(dir), before + 2);
  deepStrictEqual(world.beat([]), []);
  strictEqual(world.snapshot().version, 1);
  strictEqual(logLines(dir), before + 2);
});

test("a stale beat preempts from its first command", (t) => {
  const world = createWorld(join(tempDir(t), "stale"), bottleScenario);
  strictEqual(
    world.command({ command_id: "push", actor: "e4", verb: "push", target: "table" }).status,
    "ok",
  );
  const results = world.beat(
    [{ command_id: "take", actor: "e4", verb: "take", target: "bottle" }],
    { basedOn: 0 },
  );
  strictEqual(results[0]?.status, "preempted");
  strictEqual(world.snapshot().version, 1);
});

test("duplicate command_ids both log", (t) => {
  const dir = join(tempDir(t), "dupes");
  const world = createWorld(dir, bottleScenario);
  const before = logLines(dir);
  const results = world.beat([
    { command_id: "wait", actor: "e4", verb: "wait", args: { ticks: 1 } },
    { command_id: "wait", actor: "e4", verb: "wait", args: { ticks: 1 } },
  ]);
  strictEqual(results[0]?.status, "ok");
  strictEqual(results[1]?.status, "ok");
  strictEqual(logLines(dir), before + 2);
});

test("the CLI answers a beat with per-command results", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { BeatResponseSchema } = await import("../src/contract.js");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
  const dir = join(tempDir(t), "cli");
  createWorld(dir, bottleScenario);
  const beat = cliRequest(JSON.stringify({
      op: "beat",
      world: dir,
      commands: [
        { command_id: "take-1", actor: "e4", verb: "take", target: "bottle" },
        { command_id: "take-2", actor: "e5", verb: "take", target: "bottle" },
      ],
    }));
  strictEqual(beat.status, 0, beat.stderr);
  const parsed = BeatResponseSchema.parse(JSON.parse(beat.stdout));
  strictEqual(parsed.results.length, 2);
  strictEqual(parsed.results[0]?.status, "ok");
  strictEqual(parsed.results[1]?.status, "preempted");
});

test("the CLI continues a beat past an unknown verb", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { BeatResponseSchema } = await import("../src/contract.js");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
  const dir = join(tempDir(t), "cli-invalid");
  createWorld(dir, bottleScenario);
  const beat = cliRequest(JSON.stringify({
      op: "beat",
      world: dir,
      commands: [
        { command_id: "fly", actor: "e4", verb: "fly" },
        { command_id: "wait", actor: "e4", verb: "wait", args: { ticks: 1 } },
      ],
    }));
  strictEqual(beat.status, 0, beat.stderr);
  const parsed = BeatResponseSchema.parse(JSON.parse(beat.stdout));
  strictEqual(parsed.results[0]?.status, "invalid");
  strictEqual(parsed.results[1]?.status, "ok");
});
