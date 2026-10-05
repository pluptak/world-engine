import { deepStrictEqual, equal, ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

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

function tempRoot(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-acceptance-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function initWorld(dir: string, scenarioPath: string): void {
  const result = runCli(undefined, ["init", dir, scenarioPath]);
  strictEqual(result.status, 0, result.stderr);
  strictEqual((JSON.parse(result.stdout) as { status: string }).status, "ok");
}

function send(world: string, command: Record<string, unknown>) {
  const result = runCli(JSON.stringify({ op: "command", world, command }));
  ok(result.stdout.length > 0, result.stderr);
  return { process: result, response: JSON.parse(result.stdout) as Record<string, unknown> };
}

function snapshotFromCli(world: string): string {
  const result = runCli(JSON.stringify({ op: "snapshot", world }));
  strictEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commandsForScenario(name: "bottle" | "hand"): Array<Record<string, unknown>> {
  if (name === "bottle") {
    return [{
      command_id: "push-table",
      actor: "e4",
      verb: "push",
      target: "table",
    }];
  }
  const commands: Array<Record<string, unknown>> = [];
  for (let index = 0; index < 3; index += 1) {
    commands.push({
      command_id: `attack-hand-${index}`,
      actor: "e2",
      verb: "attack",
      target: "e3.hand_r",
    });
    if (index < 2) {
      commands.push({
        command_id: `wait-${index}`,
        actor: "e2",
        verb: "wait",
        args: { ticks: 3 },
      });
    }
  }
  commands.push({
    command_id: "take-crate",
    actor: "e3",
    verb: "take",
    target: "crate",
  });
  return commands;
}

function runCommands(world: string, commands: Array<Record<string, unknown>>) {
  const results = [];
  for (const command of commands) {
    const result = send(world, command);
    results.push(result);
  }
  return results;
}

function specsFromInitial(worldDir: string): Array<Record<string, unknown>> {
  const snapshot = JSON.parse(readFileSync(join(worldDir, "initial.json"), "utf8")) as {
    entities: Record<string, Record<string, unknown>>;
  };
  return Object.keys(snapshot.entities)
    .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)))
    .map((id) => {
      const { id: _id, template, parts: _parts, ...overrides } = snapshot.entities[id]!;
      return { template, overrides };
    });
}

function acceptedCommands(worldDir: string): Array<Record<string, unknown>> {
  return readFileSync(join(worldDir, "log.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { status: string; command: Record<string, unknown> })
    .filter((entry) => entry.status === "ok")
    .map((entry) => entry.command);
}

test("propagation preserves the full causal bottle chain", (t) => {
  const world = join(tempRoot(t), "bottle-world");
  initWorld(world, bottleScenario);
  const result = send(world, {
    command_id: "accept-push-table",
    actor: "e4",
    verb: "push",
    target: "table",
  });
  strictEqual(result.response.status, "ok");

  const events = result.response.events as Array<{
    event_id: string;
    cause_id: string | null;
    command_id: string;
    type: string;
  }>;
  const types = events.map((event) => event.type);
  deepStrictEqual(types, ["push", "moved", "collided", "displaced", "dropped", "broken", "spawned", "spawned", "spawned"]);
  const eventPositions = new Map(events.map((event, index) => [event.event_id, index]));
  for (const [index, event] of events.entries()) {
    let current = event;
    let currentIndex = index;
    while (current.cause_id !== null) {
      const parentIndex = eventPositions.get(current.cause_id);
      ok(parentIndex !== undefined && parentIndex < currentIndex);
      current = events[parentIndex]!;
      currentIndex = parentIndex;
    }
    equal(current.command_id, "accept-push-table");
  }
});

test("capability loss after hand detachment refuses a two-handed take", (t) => {
  const world = join(tempRoot(t), "hand-world");
  initWorld(world, handScenario);
  let firstHit: Record<string, unknown> | undefined;
  let detachedHit: Record<string, unknown> | undefined;

  for (let index = 0; index < 3; index += 1) {
    const hit = send(world, {
      command_id: `accept-hand-${index}`,
      actor: "e2",
      verb: "attack",
      target: "e3.hand_r",
    });
    strictEqual(hit.response.status, "ok");
    if (index === 0) {
      firstHit = hit.response;
    }
    if (index === 2) {
      detachedHit = hit.response;
    }
    if (index < 2) {
      const wait = send(world, {
        command_id: `accept-wait-${index}`,
        actor: "e2",
        verb: "wait",
        args: { ticks: 3 },
      });
      strictEqual(wait.response.status, "ok");
    }
  }

  ok(firstHit);
  ok(detachedHit);
  const firstCapability = (firstHit.events as Array<{ type: string; data: Record<string, unknown> }>).find(
    (event) => event.type === "capability_changed" && event.data.capacity === "manipulation",
  );
  const detachedEvent = (detachedHit.events as Array<{ event_id: string; type: string }>).find(
    (event) => event.type === "detached",
  );
  const detachedCapability = (detachedHit.events as Array<{
    type: string;
    cause_id: string | null;
    data: Record<string, unknown>;
  }>).find((event) => event.type === "capability_changed" && event.data.capacity === "manipulation");
  ok(firstCapability);
  ok(detachedEvent);
  ok(detachedCapability);
  deepStrictEqual(
    { from: firstCapability.data.from, to: firstCapability.data.to },
    { from: 100, to: 80 },
  );
  deepStrictEqual(
    { from: detachedCapability.data.from, to: detachedCapability.data.to },
    { from: 100, to: 50 },
  );
  equal(detachedCapability.cause_id, detachedEvent.event_id);

  const take = send(world, {
    command_id: "two-handed-take",
    actor: "e3",
    verb: "take",
    target: "crate",
  });
  equal(take.response.status, "refused");
  equal(take.response.reason_code, "insufficient_manipulation");
});

test("both scenarios copy, replay from initial state, and rerun deterministically", (t) => {
  const rootDir = tempRoot(t);
  const scenarios = [
    { name: "bottle" as const, path: bottleScenario },
    { name: "hand" as const, path: handScenario },
  ];

  for (const scenario of scenarios) {
    const original = join(rootDir, `${scenario.name}-original`);
    initWorld(original, scenario.path);
    const commands = commandsForScenario(scenario.name);
    runCommands(original, commands);
    const expectedSnapshot = readFileSync(join(original, "snapshot.json"), "utf8");
    const expectedLog = readFileSync(join(original, "log.jsonl"), "utf8");

    const copy = join(rootDir, `${scenario.name}-copy`);
    cpSync(original, copy, { recursive: true });
    equal(snapshotFromCli(copy), expectedSnapshot);

    const replayed = join(rootDir, `${scenario.name}-replay`);
    const specsPath = join(rootDir, `${scenario.name}-initial-specs.json`);
    writeFileSync(specsPath, JSON.stringify(specsFromInitial(original)), "utf8");
    initWorld(replayed, specsPath);
    equal(
      readFileSync(join(replayed, "initial.json"), "utf8"),
      readFileSync(join(original, "initial.json"), "utf8"),
    );
    runCommands(replayed, acceptedCommands(original));
    equal(readFileSync(join(replayed, "snapshot.json"), "utf8"), expectedSnapshot);

    const fresh = join(rootDir, `${scenario.name}-fresh`);
    initWorld(fresh, scenario.path);
    runCommands(fresh, commands);
    equal(readFileSync(join(fresh, "log.jsonl"), "utf8"), expectedLog);
    equal(readFileSync(join(fresh, "snapshot.json"), "utf8"), expectedSnapshot);
  }
});

test("smell is unknown and sight through an unconnected wall is false", (t) => {
  const bottleWorld = join(tempRoot(t), "bottle-world");
  initWorld(bottleWorld, bottleScenario);
  const smell = runCli(JSON.stringify({
    op: "query",
    world: bottleWorld,
    query: { kind: "perceive", observer: "e4", entity: "e3", sense: "smell" },
  }));
  strictEqual(smell.status, 0, smell.stderr);
  deepStrictEqual(JSON.parse(smell.stdout), { value: "unknown", basis_code: "uncovered_sense" });

  const rootDir = tempRoot(t);
  const wallScenarioPath = join(rootDir, "wall.json");
  writeFileSync(wallScenarioPath, JSON.stringify([
    { template: "room", overrides: { name: "left", props: { lit: true } } },
    { template: "room", overrides: { name: "right", props: { lit: true } } },
    {
      template: "human",
      overrides: { name: "observer", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "bottle",
      overrides: { name: "bottle", location: "e2", support: "e2", pos: { x: 0, y: 0 } },
    },
  ]), "utf8");
  const wallWorld = join(rootDir, "wall-world");
  initWorld(wallWorld, wallScenarioPath);
  const sight = runCli(JSON.stringify({
    op: "query",
    world: wallWorld,
    query: { kind: "perceive", observer: "e3", entity: "e4", sense: "sight" },
  }));
  strictEqual(sight.status, 0, sight.stderr);
  deepStrictEqual(JSON.parse(sight.stdout), { value: "false", basis_code: "not_perceptible" });
});

test("ambiguous, preempted, and refused commands have distinct statuses", (t) => {
  const rootDir = tempRoot(t);
  const ambiguousScenario = join(rootDir, "ambiguous.json");
  writeFileSync(ambiguousScenario, JSON.stringify([
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
  const ambiguousWorld = join(rootDir, "ambiguous-world");
  initWorld(ambiguousWorld, ambiguousScenario);
  const ambiguous = send(ambiguousWorld, {
    command_id: "ambiguous-take",
    actor: "e2",
    verb: "take",
    target: "bottle",
  });

  const staleWorld = join(rootDir, "stale-world");
  initWorld(staleWorld, bottleScenario);
  send(staleWorld, {
    command_id: "push-table",
    actor: "e4",
    verb: "push",
    target: "table",
  });
  const preempted = runCli(JSON.stringify({
    op: "command",
    world: staleWorld,
    based_on_version: 0,
    command: {
      command_id: "stale-take",
      actor: "e4",
      verb: "take",
      target: "bottle",
    },
  }));

  const refusedWorld = join(rootDir, "refused-world");
  initWorld(refusedWorld, bottleScenario);
  const refused = send(refusedWorld, {
    command_id: "drop-unheld",
    actor: "e4",
    verb: "drop",
    target: "bottle",
  });

  deepStrictEqual(
    [ambiguous.response.status, JSON.parse(preempted.stdout).status, refused.response.status],
    ["ambiguous", "preempted", "refused"],
  );
});
