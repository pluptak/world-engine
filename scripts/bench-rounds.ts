import { createWorld, type Command, type Scene } from "../src/index.js";
import { directorWorld } from "../src/director-world.js";
import { planRound } from "../src/engine/round.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { observeEntities } from "../src/engine/projection.js";
import { playerWorld } from "../src/player-world.js";
import { readEvents } from "../src/store/file-store.js";
import { ROOMS, scaleRegistry, scaleScenario } from "./bench-world.js";

// The rounds benchmark's workload (`npm run bench:rounds`): the scale world, with the first players' agents
// registered as players of one run. Each round every player submits one move through its handle and the director
// closes the round; then quiet rounds, each closed while every player idles. Times are split by phase, and the
// test runs the same workload with tiny counts, untimed.

export const PLAYERS = 8;

// The steps a player's agent plays in its own room, one a round: open the chest, take a stone, put it in, take it out,
// drop it, close the chest, and step to one of two spots a lap, alternating. The stone is dropped where the agent
// stands, so the agent does not step back to where it began, which the drop would block; `wait`, which the scale
// world cycles through, is not a round move.
const CYCLE = 7;
function stepOf(step: number, room: number, lap: number): Omit<Command, "actor" | "command_id"> {
  const stone = `stone${room}_0`;
  const chest = `chest${room}`;
  switch (step) {
    case 0:
      return { verb: "open", target: chest };
    case 1:
      return { verb: "take", target: stone };
    case 2:
      return { verb: "put", target: stone, args: { relation: "in", destination: chest } };
    case 3:
      return { verb: "take", target: stone };
    case 4:
      return { verb: "drop", target: stone };
    case 5:
      return { verb: "close", target: chest };
    default:
      return { verb: "move", args: { to: { x: 0, y: lap % 2 === 0 ? -60 : -40 } } };
  }
}

export interface RoundsOptions {
  rounds: number;
  quiet: number;
  players?: number;
}

// The mean of a list of milliseconds, to two places; zero for none.
const mean = (values: readonly number[]): number =>
  Math.round((values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)) * 100) / 100;

const hr = (): number => Number(process.hrtime.bigint()) / 1e6;

export function runRoundsWorkload(dir: string, options: RoundsOptions) {
  const players = options.players ?? PLAYERS;
  if (players < 1 || players > ROOMS) {
    throw new Error(`players must be 1 to ${ROOMS}`);
  }
  const registry = scaleRegistry();
  const agents = Array.from({ length: players }, (_, p) => `agent${p}`);
  // A seed, since a round of two or more moves rolls the dice to order them; the run names the agents as its slots.
  const scene: Scene = { seed: 7, entities: scaleScenario(), run: { slots: agents } };
  const world = createWorld(dir, scene, registry);
  const id = (name: string) => world.id(name)!;
  const director = directorWorld(world);
  agents.forEach((agent, p) => {
    director.edit({ kind: "register_player", handle: `p${p}`, slot: id(agent) }, { command_id: `reg-${p}` });
  });
  director.edit({ kind: "start_run" }, { command_id: "start" });

  // Each round: the submits, then the round's check on its own (`planRound`, the same planning the close does),
  // then the close. The round's total is the submits and the close; the check is timed beside it.
  const roundTotal: number[] = [];
  const submits: number[] = [];
  const checks: number[] = [];
  const closes: number[] = [];
  // One player's observe per round, split into the snapshot's load, the events' read, the entity
  // half of the projection (timed directly) and the event half (the full observe less the other
  // three, so it carries the handle's own mapping too). The look is since the round's first tick,
  // so both halves have something to do; it is a read, outside the round's own total.
  const observeFull: number[] = [];
  const observeSnapshot: number[] = [];
  const observeEvents: number[] = [];
  const observeEntitiesHalf: number[] = [];
  for (let round = 0; round < options.rounds; round += 1) {
    const tickBefore = world.snapshot().tick;
    let submitting = 0;
    const moves: Command[] = [];
    for (let p = 0; p < players; p += 1) {
      const move = { command_id: `r${round}-p${p}`, ...stepOf(round % CYCLE, p, Math.floor(round / CYCLE)) };
      const a = hr();
      const sent = playerWorld(world, `p${p}`).submit(move);
      submitting += hr() - a;
      if (sent.status !== "ok") {
        throw new Error(`move ${move.command_id} was refused: ${sent.reason_code}`);
      }
      moves.push({ ...move, actor: id(agents[p]!) });
    }
    const b = hr();
    const plan = planRound(world.snapshot(), registry, moves);
    const check = hr() - b;
    if (plan.status !== "ok" || plan.early.size > 0) {
      throw new Error(`round ${round} was not planned whole: ${plan.status}`);
    }
    const c = hr();
    const closed = director.closeRound();
    const close = hr() - c;
    if (closed.status !== "ok" || closed.results.some((result) => result.status !== "ok")) {
      throw new Error(`round ${round} was ${closed.status}: ${closed.results.map((result) => result.status).join(",")}`);
    }
    submits.push(submitting);
    checks.push(check);
    closes.push(close);
    roundTotal.push(submitting + close);
    const observer = id(agents[0]!);
    const player = playerWorld(world, "p0");
    const s0 = hr();
    const snap = world.snapshot();
    observeSnapshot.push(hr() - s0);
    const e0 = hr();
    readEvents(dir).filter((event) => event.tick >= tickBefore);
    observeEvents.push(hr() - e0);
    const h0 = hr();
    observeEntities(snap, registry, [], observer);
    observeEntitiesHalf.push(hr() - h0);
    const f0 = hr();
    player.observe({ since_tick: tickBefore });
    observeFull.push(hr() - f0);
  }

  // Quiet rounds: every player idles. The closing tick alone is timed first (`closeRound` with no move pending), then
  // a quiet round as the director closes it (`closeRounds`, one round), which adds the look at what the round made.
  // The observation is the difference, so the two add up to a quiet round.
  for (let p = 0; p < players; p += 1) {
    playerWorld(world, `p${p}`).idle();
  }
  const closeOnly: number[] = [];
  for (let q = 0; q < options.quiet; q += 1) {
    const a = hr();
    const closed = director.closeRound();
    closeOnly.push(hr() - a);
    if (closed.status !== "ok") {
      throw new Error(`quiet round ${q} was ${closed.status}: ${closed.reason_code ?? ""}`);
    }
  }
  const quietRound: number[] = [];
  for (let q = 0; q < options.quiet; q += 1) {
    const a = hr();
    const closed = director.closeRounds({ max: 1 });
    quietRound.push(hr() - a);
    if (closed.status !== "ok" || closed.rounds !== 1) {
      throw new Error(`quiet round ${q} was ${closed.status}: ${closed.status === "ok" ? closed.stopped : closed.reason_code}`);
    }
  }
  // A round of moves is its check, then its apply and the closing tick it shares with a quiet round.
  const closeTick = mean(closeOnly);
  const quietTotal = mean(quietRound);
  const applies = closes.map((close, round) => close - checks[round]! - closeTick);
  const full = mean(observeFull);
  const snap = mean(observeSnapshot);
  const evts = mean(observeEvents);
  const ents = mean(observeEntitiesHalf);

  return {
    entities: Object.keys(world.snapshot().entities).length,
    players,
    rounds: options.rounds,
    quiet_rounds: options.quiet,
    snapshot_valid: validateSnapshot(world.snapshot(), registry).length === 0,
    ms_per_round: {
      first_100: mean(roundTotal.slice(0, 100)),
      last_100: mean(roundTotal.slice(-100)),
    },
    phases_ms_per_round: {
      submits: mean(submits),
      check: mean(checks),
      apply: mean(applies),
      close: closeTick,
    },
    quiet: {
      ms_per_round: quietTotal,
      observation_ms_per_round: Math.round((quietTotal - closeTick) * 100) / 100,
      close_ms_per_round: closeTick,
    },
    observe: {
      ms_per_round: full,
      snapshot_ms_per_round: snap,
      events_ms_per_round: evts,
      entities_ms_per_round: ents,
      events_half_ms_per_round: Math.round((full - snap - evts - ents) * 100) / 100,
    },
  };
}
