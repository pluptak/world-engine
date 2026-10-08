import { ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cli as cliRequest } from "./cli-run.js";
import { createWorld, memoryWorld, type Command, type Scenario } from "../src/index.js";
import { CheckResponseSchema } from "../src/contract.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const scenario: Scenario = [
  { template: "room", overrides: { name: "room" } },
  { template: "table", overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  { template: "human", overrides: { name: "actor", location: "e1", support: "e1", pos: { x: -50, y: 0 } } },
  {
    template: "chest",
    overrides: {
      name: "chest",
      location: "e1",
      support: "e1",
      pos: { x: 40, y: 0 },
      props: { container: true, topples: true, inner_w_cm: 55, inner_d_cm: 35, inner_h_cm: 35, openable: true, open: true },
    },
  },
];

const cases: Command[] = [
  { command_id: "c1", actor: "e4", verb: "take", target: "bottle" },
  { command_id: "c2", actor: "e4", verb: "take", target: "bottle" },
  { command_id: "c3", actor: "e4", verb: "fly" },
  { command_id: "c4", actor: "e4", verb: "take", target: "missing" },
  { command_id: "c5", actor: "e2", verb: "take", target: "bottle" },
  { command_id: "c6", actor: "e4", verb: "take", target: "table" },
  {
    command_id: "c7",
    actor: "e4",
    verb: "put",
    target: "bottle",
    args: { relation: "in", destination: "chest" },
  },
  { command_id: "c8", actor: "e4", verb: "move", args: { to: { x: 25, y: 5 } } },
  { command_id: "c9", actor: "e4", verb: "attack", target: "e5" },
];

test("check agrees with command on every verdict in the chain", (t) => {
  const world = createWorld(join(tempDir(t), "agreement"), scenario);
  for (const command of cases) {
    const checked = world.check(command);
    const done = world.command(command);
    strictEqual(checked.status, done.status, command.verb);
    strictEqual(checked.reason_code, done.reason_code, command.verb);
    strictEqual(checked.resolved_target, done.resolved_target, command.verb);
  }
});

test("a check leaves the world directory byte-identical", (t) => {
  const dir = join(tempDir(t), "untouched");
  const world = createWorld(dir, scenario);
  const read = () =>
    ["initial.json", "snapshot.json", "log.jsonl"]
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\u0000");

  const before = read();
  const checked = world.check({ command_id: "probe", actor: "e4", verb: "take", target: "bottle" });
  strictEqual(checked.status, "ok");
  strictEqual(read(), before);
  strictEqual(world.snapshot().version, 0);
});

test("a memory world answers checks without moving", () => {
  const world = memoryWorld(createWorld(mkdtempSync(join(tmpdir(), "check-mem-")), scenario).snapshot());
  const before = world.snapshot();
  const checked = world.check({ command_id: "probe", actor: "e4", verb: "take", target: "bottle" });
  strictEqual(checked.status, "ok");
  ok(before === world.snapshot());
  ok(before.entities.e3?.contained_in === null);
});

test("the CLI answers a check", (t) => {
  const dir = join(tempDir(t), "cli");
  createWorld(dir, scenario);
  const cli = cliRequest(JSON.stringify({ op: "check", world: dir, command: { command_id: "probe", actor: "e4", verb: "take", target: "bottle" } }));
  strictEqual(cli.status, 0, cli.stderr);
  const parsed = CheckResponseSchema.parse(JSON.parse(cli.stdout));
  strictEqual(parsed.status, "ok");
  strictEqual(parsed.resolved_target, "e3");
});
