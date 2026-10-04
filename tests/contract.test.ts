import { deepStrictEqual, match, ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  AnswerSchema,
  CommandResponseSchema,
  RequestSchema,
  ResponseSchema,
  SnapshotSchema,
} from "../src/contract.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const bottleScenario = fileURLToPath(new URL("../scenarios/bottle.json", import.meta.url));
const handScenario = fileURLToPath(new URL("../scenarios/hand.json", import.meta.url));

function runCli(input?: string, args: string[] = []) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    ...(input !== undefined && { input }),
  });
}

function temporaryDirectory(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function initWorld(t: { after(callback: () => void): void }, scenarioPath = bottleScenario): string {
  const dir = join(temporaryDirectory(t), "world");
  const result = runCli(undefined, ["init", dir, scenarioPath]);
  strictEqual(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout) as { status: string; snapshot_version: number };
  strictEqual(response.status, "ok");
  strictEqual(response.snapshot_version, 0);
  return dir;
}

function sendCommand(
  world: string,
  command: Record<string, unknown>,
  based_on_version?: number,
  include_snapshot = false,
) {
  return runCli(JSON.stringify({
    op: "command",
    world,
    ...(based_on_version !== undefined && { based_on_version }),
    command,
    ...(include_snapshot && { include_snapshot: true }),
  }));
}

function commandBody(result: ReturnType<typeof runCli>) {
  return CommandResponseSchema.parse(JSON.parse(result.stdout));
}

test("CLI command responses parse for every command status", (t) => {
  const world = initWorld(t);
  const okResult = sendCommand(world, {
    command_id: "move-actor",
    actor: "e4",
    verb: "move",
    args: { to: { x: -40, y: 0 } },
  });
  strictEqual(okResult.status, 0, okResult.stderr);
  strictEqual(commandBody(okResult).status, "ok");

  const refused = sendCommand(world, {
    command_id: "drop-bottle",
    actor: "e4",
    verb: "drop",
    target: "bottle",
  });
  strictEqual(refused.status, 0, refused.stderr);
  strictEqual(commandBody(refused).status, "refused");

  const unresolved = sendCommand(world, {
    command_id: "take-missing",
    actor: "e4",
    verb: "take",
    target: "missing",
  });
  strictEqual(unresolved.status, 0, unresolved.stderr);
  strictEqual(commandBody(unresolved).status, "unresolved");

  const customScenario = join(temporaryDirectory(t), "ambiguous.json");
  writeFileSync(customScenario, JSON.stringify([
    { template: "room", overrides: { name: "room" } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "bottle",
      overrides: { name: "bottle", location: "e1", support: "e1", pos: { x: 1, y: 0 } },
    },
    {
      template: "bottle",
      overrides: { name: "bottle", location: "e1", support: "e1", pos: { x: 2, y: 0 } },
    },
  ]), "utf8");
  const ambiguousWorld = initWorld(t, customScenario);
  const ambiguous = sendCommand(ambiguousWorld, {
    command_id: "take-bottle",
    actor: "e2",
    verb: "take",
    target: "bottle",
  });
  strictEqual(ambiguous.status, 0, ambiguous.stderr);
  strictEqual(commandBody(ambiguous).status, "ambiguous");

  const staleWorld = initWorld(t);
  const push = sendCommand(staleWorld, {
    command_id: "push-table",
    actor: "e4",
    verb: "push",
    target: "table",
  }, 0);
  strictEqual(commandBody(push).status, "ok");
  const preempted = sendCommand(staleWorld, {
    command_id: "take-bottle",
    actor: "e4",
    verb: "take",
    target: "bottle",
  }, 0);
  strictEqual(preempted.status, 0, preempted.stderr);
  strictEqual(commandBody(preempted).status, "preempted");

  const invalid = sendCommand(world, {
    command_id: "unknown-verb",
    actor: "e4",
    verb: "fly",
  });
  strictEqual(invalid.status, 2);
  strictEqual(commandBody(invalid).status, "invalid");
});

test("command responses include snapshots on request and expose relation deltas", (t) => {
  const world = initWorld(t, handScenario);
  const take = sendCommand(world, {
    command_id: "take-crate",
    actor: "e3",
    verb: "take",
    target: "crate",
  });
  strictEqual(commandBody(take).status, "ok");
  const takeFields = commandBody(take).deltas.map((delta) => delta.field);
  ok(takeFields.includes("contained_in"));
  ok(takeFields.includes("support"));

  let lastAttack = undefined as ReturnType<typeof runCli> | undefined;
  for (let index = 0; index < 3; index += 1) {
    lastAttack = sendCommand(world, {
      command_id: `attack-${index}`,
      actor: "e2",
      verb: "attack",
      target: "e3.hand_r",
    });
    strictEqual(commandBody(lastAttack).status, "ok");
    if (index < 2) {
      const wait = sendCommand(world, {
        command_id: `wait-${index}`,
        actor: "e2",
        verb: "wait",
        args: { ticks: 3 },
      });
      strictEqual(commandBody(wait).status, "ok");
    }
  }

  ok(lastAttack);
  const response = commandBody(lastAttack);
  for (const field of ["detached_from", "location", "support"]) {
    ok(response.deltas.some((delta) => delta.field === field), `missing delta field ${field}`);
  }

  const withSnapshot = sendCommand(world, {
    command_id: "move-after-detach",
    actor: "e2",
    verb: "move",
    args: { to: { x: 1, y: 0 } },
  }, undefined, true);
  const included = commandBody(withSnapshot);
  ok(included.snapshot);
  strictEqual(included.snapshot.coverage.senses.includes("sight"), true);
});

test("an edit operation removes the table through the World method", (t) => {
  const world = initWorld(t);
  const removed = runCli(JSON.stringify({
    op: "edit",
    world,
    command_id: "remove-table",
    edit: { kind: "remove", target: "e2" },
  }));
  strictEqual(removed.status, 0, removed.stderr);
  const body = commandBody(removed);
  strictEqual(body.status, "ok");
  deepStrictEqual(
    body.events.map((event) => event.type),
    ["edit", "removed", "displaced", "dropped", "broken", "spawned", "spawned", "spawned"],
  );

  const looped = runCli(JSON.stringify({
    op: "edit",
    world,
    command_id: "loop-room",
    edit: { kind: "place", target: "e1", support: "e3", pos: null },
  }));
  strictEqual(looped.status, 0, looped.stderr);
  const refused = commandBody(looped);
  strictEqual(refused.status, "refused");
  strictEqual(refused.reason_code, "circular_placement");
});

test("query and snapshot operations return schema-valid responses with coverage", (t) => {
  const world = initWorld(t);
  const query = runCli(JSON.stringify({
    op: "query",
    world,
    query: { kind: "fact", subject: "e3", relation: "temperature" },
  }));
  strictEqual(query.status, 0, query.stderr);
  deepStrictEqual(AnswerSchema.parse(JSON.parse(query.stdout)), {
    value: "unknown",
    basis_code: "uncovered_category",
  });

  const snapshot = runCli(JSON.stringify({ op: "snapshot", world }));
  strictEqual(snapshot.status, 0, snapshot.stderr);
  const parsedSnapshot = SnapshotSchema.parse(JSON.parse(snapshot.stdout));
  strictEqual(parsedSnapshot.coverage.senses.includes("hearing"), true);
});

test("malformed requests return invalid JSON without a stack trace", () => {
  const result = runCli(JSON.stringify({ op: "command", world: "world" }));
  strictEqual(result.status, 2);
  const response = ResponseSchema.parse(JSON.parse(result.stdout));
  ok("issues" in response);
  match(result.stdout, /"status":"invalid"/);
  strictEqual(/Error:| at /.test(result.stdout), false);
});

test("malformed JSON is converted to an invalid response", () => {
  const result = runCli('{"op":');
  strictEqual(result.status, 2);
  const response = ResponseSchema.parse(JSON.parse(result.stdout));
  ok("issues" in response);
});

test("an unknown world reports no_such_world", (t) => {
  const missing = join(temporaryDirectory(t), "never-created");
  for (const request of [
    { op: "snapshot", world: missing },
    { op: "query", world: missing, query: { kind: "fact", subject: "e1", relation: "status" } },
    {
      op: "command",
      world: missing,
      command: { command_id: "c1", actor: "e1", verb: "move", args: { to: { x: 0, y: 0 } } },
    },
  ]) {
    const result = runCli(JSON.stringify(request));
    strictEqual(result.status, 2);
    const response = ResponseSchema.parse(JSON.parse(result.stdout));
    ok("issues" in response);
    strictEqual(response.issues[0]?.code, "no_such_world");
  }
});

test("a world built from other templates reports templates_changed", (t) => {
  const world = initWorld(t);
  for (const name of ["snapshot.json", "initial.json"]) {
    const path = join(world, name);
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    snapshot.templates_hash = "0".repeat(64);
    writeFileSync(path, JSON.stringify(snapshot), "utf8");
  }

  const result = runCli(JSON.stringify({ op: "snapshot", world }));
  strictEqual(result.status, 2);
  const response = ResponseSchema.parse(JSON.parse(result.stdout));
  ok("issues" in response);
  strictEqual(response.issues[0]?.code, "templates_changed");
});

test("a missing scenario file reports no_such_scenario", (t) => {
  const dir = temporaryDirectory(t);
  const result = runCli(undefined, [
    "init",
    join(dir, "world"),
    join(dir, "no-such-scenario.json"),
  ]);
  strictEqual(result.status, 2);
  const response = ResponseSchema.parse(JSON.parse(result.stdout));
  ok("issues" in response);
  strictEqual(response.issues[0]?.code, "no_such_scenario");
});

test("CLI init accepts a scenario with declared names and refuses a duplicate", (t) => {
  const named = runCli(undefined, ["init", join(temporaryDirectory(t), "named"), bottleScenario]);
  strictEqual(named.status, 0, named.stderr);

  const path = join(temporaryDirectory(t), "duplicate.json");
  writeFileSync(
    path,
    JSON.stringify([
      { id: "room", template: "room", overrides: { name: "room" } },
      { id: "room", template: "room", overrides: { name: "other" } },
    ]),
  );
  const refused = runCli(undefined, ["init", join(temporaryDirectory(t), "duplicate"), path]);
  strictEqual(refused.status, 2, refused.stderr);
  const response = JSON.parse(refused.stdout) as { issues: Array<{ code: string }> };
  strictEqual(response.issues[0]?.code, "duplicate_name");
});

test("request schemas reject unknown operations", () => {
  const parsed = RequestSchema.safeParse({ op: "other", world: "world" });
  strictEqual(parsed.success, false);
});
