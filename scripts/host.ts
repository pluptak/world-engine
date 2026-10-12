import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../src/cli/main.js";

// A reference host (`docs/host.md`): it plays a run through the CLI's JSON ops alone. Every request goes
// through `runCli` as text and every answer is read back as text, so the host sees only what a caller in
// another language would. Players are async functions; the host waits for each at most `timeout_ms` per round.

export type Move = Record<string, unknown>;
// A player's answer for a round: one move, one per body as an array, or "idle" to pass.
export type Answer = Move | Move[] | "idle";
export type Turn = { round: number; observation: unknown };
export type Player = (turn: Turn) => Promise<Answer>;

// One plan entry per round: a move, an array of moves, "idle", or `{ late }` where `late` is what the player answers after
// the timeout, which the host drops.
export type PlanEntry = Move | Move[] | "idle" | { late: Move | Move[] | "idle" };

export interface Plan {
  timeout_ms: number;
  handles: Record<string, { slot: string; moves: PlanEntry[] }>;
}

export interface Exchange {
  request: Record<string, unknown>;
  response: unknown;
}

export interface HostResult {
  status: "ok";
  rounds: number;
  ended: string | null;
  dropped: { round: number; handle: string }[];
}

interface Snapshot {
  entities: Record<string, { name?: string }>;
  run?: { state: string; ended?: { reason: string } };
}

// The names a scene gives its entities, which the plan uses for slots. The name must be unique in the world.
function idNamed(snapshot: Snapshot, name: string): string {
  const ids = Object.entries(snapshot.entities)
    .filter(([, entity]) => entity.name === name)
    .map(([id]) => id);
  if (ids.length !== 1) {
    throw new Error(`slot ${name}: ${ids.length} entities carry that name`);
  }
  return ids[0]!;
}

export async function hostRun(
  scenePath: string,
  plan: Plan,
  dir: string,
  players: Record<string, Player>,
): Promise<HostResult> {
  const transcriptPath = resolve(dir, "transcript.jsonl");
  const record = (exchange: Exchange): void => {
    appendFileSync(transcriptPath, `${JSON.stringify(exchange)}\n`, "utf8");
  };
  const call = (request: Record<string, unknown>): unknown => {
    const response: unknown = JSON.parse(runCli([], JSON.stringify(request)).stdout);
    record({ request, response });
    return response;
  };
  const ok = (response: unknown, what: string): void => {
    if ((response as { status?: unknown }).status !== "ok") {
      throw new Error(`${what} refused: ${JSON.stringify(response)}`);
    }
  };

  const initRequest = { op: "init", scene: scenePath, world: dir };
  const initResponse: unknown = JSON.parse(runCli(["init", dir, scenePath], "").stdout);
  record({ request: initRequest, response: initResponse });
  ok(initResponse, "init");

  const world = dir;
  const snapshotOf = (): Snapshot => call({ op: "snapshot", world }) as Snapshot;
  const names = snapshotOf();
  for (const [handle, entry] of Object.entries(plan.handles)) {
    ok(
      call({ op: "director_edit", world, edit: { kind: "register_player", handle, slot: idNamed(names, entry.slot) } }),
      `register ${handle}`,
    );
  }
  ok(call({ op: "director_edit", world, edit: { kind: "start_run" } }), "start_run");

  const handles = Object.keys(plan.handles);
  const rounds = Math.max(0, ...handles.map((handle) => plan.handles[handle]!.moves.length));
  const dropped: { round: number; handle: string }[] = [];
  let round = 0;
  for (; round < rounds; round += 1) {
    if (snapshotOf().run?.state === "ended") {
      break;
    }
    const pending = handles.map((handle) => {
      const observation = call({ op: "player_observe", world, handle });
      return { handle, answer: players[handle]!({ round, observation }).catch((): Answer => "idle") };
    });
    // One deadline for the whole round: an answer that comes after it is dropped, not submitted later.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolveLate) => {
      timer = setTimeout(() => resolveLate(null), plan.timeout_ms);
    });
    const answers = await Promise.all(
      pending.map(async ({ handle, answer }) => ({
        handle,
        settled: await Promise.race([answer.then((value) => ({ value })), deadline]),
      })),
    );
    clearTimeout(timer);
    for (const { handle, settled } of answers) {
      if (settled === null) {
        dropped.push({ round, handle });
        continue;
      }
      const { value } = settled;
      const moves = value === "idle" ? [] : Array.isArray(value) ? value : [value];
      for (const move of moves) {
        ok(call({ op: "player_submit", world, handle, move }), `${handle} submit ${String(move.command_id)}`);
      }
    }
    const closed = call({ op: "director_close_round", world }) as { status: string; reason_code?: string };
    if (closed.status !== "ok") {
      throw new Error(`round ${round} refused: ${closed.reason_code ?? closed.status}`);
    }
  }

  return { status: "ok", rounds: round, ended: snapshotOf().run?.ended?.reason ?? null, dropped };
}

// The scripted player a plan describes: its entry for the round, or its late answer, which arrives after the timeout.
export function scriptedPlayer(entries: PlanEntry[], timeoutMs: number): Player {
  return async ({ round }) => {
    const entry = entries[round];
    if (entry === undefined || entry === "idle") {
      return "idle";
    }
    if (typeof entry === "object" && !Array.isArray(entry) && "late" in entry) {
      await new Promise((resolveLater) => setTimeout(resolveLater, timeoutMs * 3));
      return entry.late as Answer;
    }
    return entry as Answer;
  };
}

function main(argv: string[]): Promise<void> {
  const [scenePath, planPath, dir] = argv;
  if (scenePath === undefined || planPath === undefined || dir === undefined) {
    throw new Error("usage: npm run host -- <scene.json> <plan.json> <dir>");
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;
  const players: Record<string, Player> = {};
  for (const [handle, entry] of Object.entries(plan.handles)) {
    players[handle] = scriptedPlayer(entry.moves, plan.timeout_ms);
  }
  return hostRun(scenePath, plan, dir, players).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
