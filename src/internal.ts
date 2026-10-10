import type { Command } from "./engine/command.js";
import type { RoundResult } from "./api.js";

// What a world keeps for its handles (`docs/roles.md`): the players' pending moves, and the one way a round
// is taken with roles on its moves. Keyed by a symbol the public `World` type carries but nobody's caller
// names, so a caller of `command` or `round` can never reach a role it was not given.
export const INTERNAL: unique symbol = Symbol("world internals");

// A player's move, held until its round closes: the command as a round move, its actor the handle's slot.
// Held by the world, never in its state: no version, no snapshot and no log line until the round closes.
// A handle may instead be idle, passing every round until it submits again (`docs/rounds.md`).
export interface PendingStore {
  get(handle: string): Command | null;
  // A move, which replaces an idle mark.
  set(handle: string, command: Command): void;
  // Idle: passes the rounds, and drops any move.
  setIdle(handle: string): void;
  // Drops the handle's entry, move or idle mark.
  clear(handle: string): void;
  // The handles that hold a move.
  handles(): string[];
  // The handles that are idle.
  idlers(): string[];
}

export interface WorldInternals {
  pending: PendingStore;
  // A round whose moves may carry their roles: the director closes a round with the players' moves.
  roundAs(moves: readonly Command[]): RoundResult;
}
