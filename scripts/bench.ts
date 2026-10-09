import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld, type Command, type Scenario } from "../src/index.js";
import { canonicalJson } from "../src/engine/canonical.js";
import { apply } from "../src/engine/pipeline.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { scaleCommand, scaleRegistry, scaleScenario } from "./bench-world.js";

// Two workloads. The default is a fixed alternating take/drop on a four-entity world: deterministic,
// all-ok, it exercises submission, transitions, and persistence per command. `--scale` runs a
// generated world of 20 rooms and 500 entities, with processes running, under mixed commands, and
// splits the time per phase. Each prints one JSON line; the default exits non-zero on refusal.

// A world directory for one run, removed when the run ends however it ends.
function inTempWorld(prefix: string, run: (dir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    run(join(root, "w"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runSmall(): void {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    {
      template: "table",
      overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
    },
    { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
    },
  ];
  inTempWorld("world-engine-bench-", (dir) => runSmallIn(dir, scenario));
}

function runSmallIn(dir: string, scenario: Scenario): void {
  const commands = 10000;
  const world = createWorld(dir, scenario);

  const invalid = world.command({ command_id: "invalid-0", actor: "e4", verb: "unknown_verb" });
  if (invalid.status === "invalid") {
    // Expected; this ensures the fast path works after non-ok submissions
  } else {
    throw new Error("Expected invalid command");
  }

  const start = Date.now();
  const times: number[] = [];
  for (let i = 0; i < commands; i += 1) {
    const cmdStart = Date.now();
    const command: Command =
      i % 2 === 0
        ? { command_id: `take-${i}`, actor: "e4", verb: "take", target: "bottle" }
        : { command_id: `drop-${i}`, actor: "e4", verb: "drop", target: "bottle" };
    const result = world.command(command);
    times.push(Date.now() - cmdStart);
    if (result.status !== "ok") {
      console.log(
        JSON.stringify({
          commands,
          failed_at: i,
          status: result.status,
          reason_code: result.reason_code ?? null,
        }),
      );
      process.exitCode = 1;
      return;
    }
  }
  const ms = Date.now() - start;
  const first1k = times.slice(0, Math.min(1000, commands));
  const last1k = times.slice(Math.max(0, commands - 1000));
  const first1kAvg = first1k.reduce((a, b) => a + b, 0) / first1k.length;
  const last1kAvg = last1k.reduce((a, b) => a + b, 0) / last1k.length;
  console.log(
    JSON.stringify({
      commands,
      ms,
      cmd_per_s: Math.floor((commands * 1000) / Math.max(ms, 1)),
      first_1k_ms_per_cmd: Math.round(first1kAvg * 100) / 100,
      last_1k_ms_per_cmd: Math.round(last1kAvg * 100) / 100,
    }),
  );
}

const hr = (): number => Number(process.hrtime.bigint()) / 1e6;

function runScale(): void {
  inTempWorld("world-engine-bench-scale-", runScaleIn);
}

function runScaleIn(dir: string): void {
  const commands = 10000;
  const registry = scaleRegistry();
  const world = createWorld(dir, scaleScenario(), registry);

  const times: number[] = [];
  const statuses: Record<string, number> = {};
  const not_ok: Record<string, number> = {};
  // Every 20th command is also run standalone through the pipeline and the validator, on the snapshot
  // it will meet, so the submit total can be split into pipeline, validate and the rest (loading the
  // snapshot, the log and event appends, the snapshot write, the head).
  let sampled = 0;
  let sampledTotal = 0;
  let pipelineMs = 0;
  let validateMs = 0;
  const start = hr();
  for (let i = 0; i < commands; i += 1) {
    const command = scaleCommand(i, world);
    const sample = i % 20 === 0;
    let pipeline = 0;
    let validate = 0;
    if (sample) {
      const snapshot = world.snapshot();
      const a = hr();
      const applied = apply(snapshot, registry, command);
      const b = hr();
      if (applied.status === "ok") {
        validateSnapshot(applied.snapshot, registry);
      }
      const c = hr();
      pipeline = b - a;
      validate = c - b;
    }
    const t0 = hr();
    const result = world.command(command);
    const elapsed = hr() - t0;
    times.push(elapsed);
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    if (result.status !== "ok") {
      const key = `${command.verb}:${result.reason_code ?? result.status}`;
      not_ok[key] = (not_ok[key] ?? 0) + 1;
    }
    if (sample) {
      sampled += 1;
      sampledTotal += elapsed;
      pipelineMs += pipeline;
      validateMs += validate;
    }
  }
  const ms = hr() - start;
  const mean = (values: number[]): number => Math.round((values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)) * 100) / 100;
  const per = (total: number): number => Math.round((total / Math.max(sampled, 1)) * 100) / 100;
  console.log(
    JSON.stringify({
      workload: "scale",
      entities: Object.keys(world.snapshot().entities).length,
      commands,
      statuses,
      not_ok,
      ms: Math.round(ms),
      first_1k_ms_per_cmd: mean(times.slice(0, 1000)),
      last_1k_ms_per_cmd: mean(times.slice(-1000)),
      snapshot_bytes: canonicalJson(world.snapshot()).length,
      phases_ms_per_cmd: {
        sampled_commands: sampled,
        total: per(sampledTotal),
        pipeline: per(pipelineMs),
        validate: per(validateMs),
        rest: per(sampledTotal - pipelineMs - validateMs),
      },
    }),
  );
}

// The cost of a read as the log grows: the four-entity world, a watcher beside the actor, and at
// each log length one call of each read a controller makes after a command. Each is timed once; they
// are slow enough at length that a repeat adds nothing, and the point is the trend.
function runReads(): void {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    { template: "table", overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
    { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
    { template: "human", overrides: { name: "actor", location: "e1", support: "e1", pos: { x: -50, y: 0 } } },
    { template: "human", overrides: { name: "watcher", location: "e1", support: "e1", pos: { x: -150, y: 0 } } },
  ];
  const sizes = (process.argv.find((arg) => arg.startsWith("--sizes="))?.slice(8) ?? "1000,5000,10000")
    .split(",")
    .map(Number);
  inTempWorld("world-engine-bench-reads-", (dir) => runReadsIn(dir, scenario, sizes));
}

function runReadsIn(dir: string, scenario: Scenario, sizes: number[]): void {
  const world = createWorld(dir, scenario);
  const watcher = "e5";
  const actor = "e4";
  const bottle = "e3";
  const time = (call: () => unknown): number => {
    const start = hr();
    call();
    return Math.round((hr() - start) * 10) / 10;
  };
  let done = 0;
  const rows: unknown[] = [];
  for (const size of sizes) {
    for (; done < size; done += 1) {
      const result = world.command({
        command_id: `r-${done}`,
        actor,
        verb: done % 2 === 0 ? "take" : "drop",
        target: "bottle",
      });
      if (result.status !== "ok") {
        throw new Error(`command ${done} was ${result.status}`);
      }
    }
    const version = world.snapshot().version;
    // An event the observe below does not ask about, so its replay is cold.
    const olderEvent = world.since(version - 200).events[0]!.event_id;
    rows.push({
      log: size,
      since_ms: time(() => world.since(version - 10)),
      observe_ms: time(() => world.observe(watcher, { since: version - 3 })),
      perceive_event_ms: time(() => world.query({ kind: "perceive", observer: watcher, event_id: olderEvent, sense: "sight" })),
      trace_event_ms: time(() => world.trace({ event_id: olderEvent })),
      trace_field_ms: time(() => world.trace({ entity: bottle, field: "contained_in" })),
      trace_field_again_ms: time(() => world.trace({ entity: bottle, field: "contained_in" })),
      attempts_ms: time(() => world.attempts(version - 10)),
    });
  }
  console.log(JSON.stringify({ workload: "reads", rows }));
}

if (process.argv.includes("--reads")) {
  runReads();
} else if (process.argv.includes("--scale")) {
  runScale();
} else {
  runSmall();
}
