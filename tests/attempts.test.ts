import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AttemptsResponseSchema } from "../src/contract.js";
import { canonicalJson, createWorld, memoryWorld, WorldError, type Scenario, type World } from "../src/index.js";

// Every submission is an attempt, and the world keeps each one with how it came out: what was
// tried, against which version, its status and reason. A failed attempt has no events and took
// no time, but it is history all the same, and a store world and a memory world report it alike.

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

const scenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  { template: "table", overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  { template: "human", overrides: { name: "anna", location: "e1", support: "e1", pos: { x: -50, y: 0 } } },
  { template: "human", overrides: { name: "bob", location: "e1", support: "e1", pos: { x: 400, y: 0 } } },
];

function worlds(t: { after(callback: () => void): void }): { dir: string; worlds: World[] } {
  const base = mkdtempSync(join(tmpdir(), "world-engine-attempts-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "store");
  return {
    dir,
    worlds: [createWorld(dir, scenario), memoryWorld(createWorld(join(base, "seed"), scenario).snapshot())],
  };
}

// Anna pushes the table (ok, version 0 to 1); a take written against version 0 now finds the
// bottle moved (preempted); bob is too far to take it (refused, with numbers); a verb nobody
// knows (invalid); a name nobody has (unresolved); and a wait (ok, 1 to 2). A dry run is not one.
function play(world: World): void {
  world.command({ command_id: "push", actor: "e4", verb: "push", target: "table" });
  world.command({ command_id: "late-take", actor: "e4", verb: "take", target: "bottle" }, { basedOn: 0 });
  world.check({ command_id: "probe", actor: "e5", verb: "take", target: "bottle" });
  world.command({ command_id: "far-take", actor: "e5", verb: "take", target: "bottle" });
  world.command({ command_id: "fly", actor: "e4", verb: "fly" });
  world.command({ command_id: "ghost", actor: "e4", verb: "take", target: "ghost" });
  world.command({ command_id: "rest", actor: "e4", verb: "wait", args: { ticks: 1 } });
}

test("every submission is kept with its outcome, failed ones included, and a dry run is not", (t) => {
  const { worlds: both } = worlds(t);
  const reports = both.map((world) => {
    play(world);
    return world.attempts(0);
  });
  // The store reads its log and the memory world its own record; they agree byte for byte.
  strictEqual(canonicalJson(reports[0]), canonicalJson(reports[1]));
  const [attempts] = reports;
  deepStrictEqual(
    attempts!.map((attempt) => [attempt.command.command_id, attempt.based_on_version, attempt.version, attempt.status]),
    [
      ["push", 0, 0, "ok"],
      ["late-take", 0, 1, "preempted"],
      ["far-take", 1, 1, "refused"],
      ["fly", 1, 1, "invalid"],
      ["ghost", 1, 1, "unresolved"],
      ["rest", 1, 1, "ok"],
    ],
  );
  const far = attempts![2]!;
  strictEqual(far.reason_code, "out_of_reach");
  strictEqual(typeof far.reason_data?.distance_cm, "number");
  strictEqual(attempts![3]!.reason_code, "unknown_verb");
  strictEqual(attempts![0]!.reason_code, undefined);
});

test("attempts from a version are those decided at it or later; since keeps the ok ones' events", (t) => {
  const { worlds: both } = worlds(t);
  for (const world of both) {
    play(world);
    deepStrictEqual(
      world.attempts(1).map((attempt) => attempt.command.command_id),
      ["late-take", "far-take", "fly", "ghost", "rest"],
    );
    deepStrictEqual(world.attempts(2), []);
    const okIds = world.attempts(1).filter((attempt) => attempt.status === "ok").map((attempt) => attempt.command.command_id);
    deepStrictEqual([...new Set(world.since(1).events.map((event) => event.command_id))], okIds);
    for (const [version, code] of [
      [3, "future_version"],
      [-1, "invalid_version"],
    ] as const) {
      throws(() => world.attempts(version), (error: unknown) => error instanceof WorldError && error.code === code);
    }
  }
  const later = memoryWorld(both[0]!.snapshot());
  throws(() => later.attempts(0), (error: unknown) => error instanceof WorldError && error.code === "history_unavailable");
});

test("a log line without the version it was decided at is refused on reading", (t) => {
  const { dir, worlds: both } = worlds(t);
  play(both[0]!);
  const path = join(dir, "log.jsonl");
  writeFileSync(path, readFileSync(path, "utf8").replace(/,"version":0\}/, "}"), "utf8");
  throws(() => both[0]!.attempts(0), /Invalid log entry at line 1/);
});

test("the CLI answers attempts", (t) => {
  const { dir, worlds: both } = worlds(t);
  play(both[0]!);
  const run = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ op: "attempts", world: dir, version: 1 }),
  });
  strictEqual(run.status, 0, run.stderr);
  const response = AttemptsResponseSchema.parse(JSON.parse(run.stdout));
  deepStrictEqual(response.attempts.map((attempt) => attempt.status), ["preempted", "refused", "invalid", "unresolved", "ok"]);
});
