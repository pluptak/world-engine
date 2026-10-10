import { isOneTickVerb } from "./clock.js";
import type { Command, Result } from "./command.js";
import { apply } from "./pipeline.js";
import { roundOrder } from "./rng.js";
import { verbRegistry } from "./verbs/index.js";
import type { Id, Snapshot } from "../model.js";
import type { TemplateRegistry } from "../templates.js";

// A round (`docs/rounds.md`): every move is decided against the same world, the moves are taken in an
// order no caller picks, and the clock moves once. This is the planning half, which needs no disk: what
// a round refuses before it starts, what it refuses where it starts, and the order of the rest.

export interface RoundPlan {
  status: "ok" | "invalid" | "refused";
  reason_code?: string;
  // The moves refused where the round starts, by index in the moves given: they take no part.
  early: Map<number, Result>;
  // The indices of the moves the round applies, in the order it applies them.
  order: number[];
}

// A move of a round is a verb that lasts one tick. A verb that lasts longer, or none, is not one.
export function isRoundMove(verb: string): boolean {
  const declared = verbRegistry.get(verb);
  return declared === undefined || isOneTickVerb(declared);
}

export function notAMove(snapshot: Snapshot, command: Command): Result {
  return {
    status: "invalid",
    command_id: command.command_id,
    resolved_target: null,
    reason_code: "not_a_round_move",
    snapshot,
    deltas: [],
    events: [],
  };
}

export function planRound(snapshot: Snapshot, registry: TemplateRegistry, moves: readonly Command[]): RoundPlan {
  const actors: Id[] = moves.map((move) => move.actor);
  if (new Set(actors).size !== actors.length) {
    return { status: "invalid", reason_code: "duplicate_actor", early: new Map(), order: [] };
  }
  if (moves.length >= 2 && snapshot.rng === undefined) {
    return { status: "refused", reason_code: "no_seed", early: new Map(), order: [] };
  }
  const early = new Map<number, Result>();
  const passing: number[] = [];
  moves.forEach((move, index) => {
    if (!isRoundMove(move.verb)) {
      early.set(index, notAMove(snapshot, move));
      return;
    }
    // Checked as a move of the round, which takes no time: the same verdict a move gets when it is applied.
    const result = apply(snapshot, registry, { ...move, round: true });
    if (result.status === "ok") {
      passing.push(index);
    } else {
      early.set(index, result);
    }
  });
  // Sorted by actor before the stream shuffles them, so the order does not depend on how the caller listed them.
  const byActor = [...passing].sort((left, right) => (actors[left]! < actors[right]! ? -1 : actors[left]! > actors[right]! ? 1 : 0));
  return { status: "ok", early, order: roundOrder(snapshot.rng ?? 0, snapshot.tick, byActor) };
}
