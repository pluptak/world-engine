import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { openWorld } from "../src/index.js";
import { RESPONSES } from "../src/contract.js";
import { hostRun, scriptedPlayer, type Plan, type Player } from "../scripts/host.js";
import { tempDir } from "./harness.js";

// The reference host plays the lab fixture (`tests/fixtures/host-lab.json`: the lab-run scene with ann and bob
// in the lab beside the key) through the JSON ops only. The plan has a race for the key, the AI's terminal
// unlocking the exit door, and dee's move, which arrives after the round's timeout.
const scene = fileURLToPath(new URL("./fixtures/host-lab.json", import.meta.url));
const plan = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/host-plan.json", import.meta.url)), "utf8")) as Plan;

function scriptedPlayers(): Record<string, Player> {
  return Object.fromEntries(Object.entries(plan.handles).map(([handle, entry]) => [handle, scriptedPlayer(entry.moves, plan.timeout_ms)]));
}

function play(t: { after(callback: () => void): void }, options: { scenePath?: string; players?: Record<string, Player>; planned?: Plan } = {}) {
  const dir = join(tempDir(t), "host");
  return hostRun(options.scenePath ?? scene, options.planned ?? plan, dir, options.players ?? scriptedPlayers()).then((result) => ({ dir, result }));
}

function transcript(dir: string): { request: Record<string, unknown>; response: unknown }[] {
  return readFileSync(join(dir, "transcript.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { request: Record<string, unknown>; response: unknown });
}

test("the lab fixture plays two rounds: one subject takes the key and the other is preempted, and the AI unlocks the door", async (t) => {
  const { dir, result } = await play(t);
  deepStrictEqual(result, { status: "ok", rounds: 2, ended: null, dropped: [{ round: 1, handle: "dee" }] });
  const world = openWorld(dir);
  const outcome = (command: string) => world.attempts(0).find((attempt) => attempt.command.command_id === command);
  strictEqual(outcome("ai-unlock")?.status, "ok");
  deepStrictEqual(["ann-key", "bob-key"].map((command) => outcome(command)?.status).sort(), ["ok", "preempted"]);
  deepStrictEqual(outcome("ann-key")?.by, { role: "player", handle: "ann" });
  ok(world.verify().ok);
});

test("a late answer is dropped: its move is never submitted, so it is not in the log", async (t) => {
  const { dir } = await play(t);
  const commands = openWorld(dir).attempts(0).map((attempt) => attempt.command.command_id);
  strictEqual(commands.includes("dee-close"), false);
  ok(transcript(dir).every((line) => (line.request.move as { command_id?: string } | undefined)?.command_id !== "dee-close"));
});

test("every answer in the transcript validates against its op's schema, in request order", async (t) => {
  const { dir } = await play(t);
  const lines = transcript(dir);
  strictEqual(lines[0]?.request.op, "init");
  strictEqual((lines[0]?.response as { status: string }).status, "ok");
  for (const { request, response } of lines.slice(1)) {
    const schema = RESPONSES[request.op as keyof typeof RESPONSES];
    ok(schema !== undefined, `no schema for ${String(request.op)}`);
    ok(schema.safeParse(response).success, `${String(request.op)} answer does not validate`);
  }
  strictEqual(lines.filter((line) => line.request.op === "director_close_round").length, 2);
});

test("a player that answers after the timeout is dropped every round, and the rounds still close", async (t) => {
  const late: Player = () =>
    new Promise((resolve) => setTimeout(() => resolve({ command_id: "late-take", verb: "take", target: "key" }), plan.timeout_ms * 3));
  const players = { ...scriptedPlayers(), dee: late };
  const { dir, result } = await play(t, { players });
  deepStrictEqual(result.dropped, [
    { round: 0, handle: "dee" },
    { round: 1, handle: "dee" },
  ]);
  strictEqual(result.rounds, 2);
  strictEqual(openWorld(dir).attempts(0).some((attempt) => attempt.command.command_id === "late-take"), false);
});

test("a run that ends stops the host before the plan's last round", async (t) => {
  // The tick limit is one tick, so the first round ends the run and the second is never played.
  const dir = tempDir(t);
  const short = join(dir, "short-scene.json");
  const scenePath = JSON.parse(readFileSync(scene, "utf8")) as { run: { tick_limit: number } };
  scenePath.run.tick_limit = 1;
  writeFileSync(short, JSON.stringify(scenePath), "utf8");
  const { result } = await play(t, { scenePath: short });
  deepStrictEqual(result, { status: "ok", rounds: 1, ended: "tick_limit", dropped: [] });
});
