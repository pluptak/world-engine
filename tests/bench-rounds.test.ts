import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { runRoundsWorkload } from "../scripts/bench-rounds.js";
import { tempDir } from "./harness.js";

// The rounds benchmark's workload runs: nothing times it here, so a change to the schema, a verb or the round that
// breaks it fails a test instead of the next measurement.

test("the rounds workload runs with tiny counts: every move and quiet round is ok, and the world is valid", (t) => {
  const report = runRoundsWorkload(join(tempDir(t), "rounds"), { rounds: 15, quiet: 3, players: 3 });
  strictEqual(report.entities, 500);
  strictEqual(report.players, 3);
  strictEqual(report.snapshot_valid, true);
  // Every phase is reported, and the split is for the rounds it timed.
  deepStrictEqual(Object.keys(report.phases_ms_per_round).sort(), ["apply", "check", "close", "submits"]);
  deepStrictEqual(Object.keys(report.quiet).sort(), ["close_ms_per_round", "ms_per_round", "observation_ms_per_round"]);
  deepStrictEqual(
    Object.keys(report.observe).sort(),
    ["entities_ms_per_round", "events_half_ms_per_round", "events_ms_per_round", "ms_per_round", "snapshot_ms_per_round"],
  );
  deepStrictEqual(
    Object.keys(report.submit).sort(),
    ["binding_ms_per_submit", "decode_ms_per_submit", "ms_per_submit", "write_ms_per_submit"],
  );
  ok(report.ms_per_round.first_100 >= 0 && report.ms_per_round.last_100 >= 0);
});

test("the rounds workload's players are one to the scale world's rooms, and it refuses a count outside them", (t) => {
  let thrown: unknown = null;
  try {
    runRoundsWorkload(join(tempDir(t), "too-many"), { rounds: 1, quiet: 0, players: 21 });
  } catch (error) {
    thrown = error;
  }
  ok(thrown instanceof Error && thrown.message === "players must be 1 to 20");
});
