import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld, type Command, type Scenario } from "../src/index.js";

// Fixed alternating take/drop workload: deterministic, all-ok, exercises submission,
// transitions, and persistence per command. Prints one JSON line; exits non-zero on refusal.
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

const commands = 10000;
const world = createWorld(join(mkdtempSync(join(tmpdir(), "world-engine-bench-")), "w"), scenario);

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
    process.exit(1);
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
