import type { Command } from "./engine/command.js";
import type { Id, Snapshot, WorldEvent } from "./model.js";
import type { RoundResult } from "./api.js";
import type { ActorCommand, ActorWorld } from "./actor-world.js";

// What a view would send for a move, aliases read back to ids as its own `check` reads them: a player's
// handle holds its move this way. Kept here, never exported by the package, since it decodes aliases.
export const VIEW_COMMANDS = new WeakMap<ActorWorld, (command: ActorCommand) => Command>();

// What a world keeps for its handles (`docs/roles.md`): the players' pending moves, and the one way a round
// is taken with roles on its moves. Keyed by a symbol the public `World` type carries but nobody's caller
// names, so a caller of `command` or `round` can never reach a role it was not given.
export const INTERNAL: unique symbol = Symbol("world internals");

// A player's moves, held until their round closes: each a command as a round move, its actor the body it is for. A
// handle holds one move per body it drives (`docs/roles.md`). Held by the world, never in its state: no version, no
// snapshot and no log line until the round closes. A handle may instead be idle, passing every round until it
// submits again (`docs/rounds.md`).
export interface PendingStore {
  // The handle's moves, in the order they were submitted.
  moves(handle: string): Command[];
  // A move for its actor's body, which replaces that body's move and any idle mark.
  set(handle: string, command: Command): void;
  // Idle: passes the rounds, and drops every move.
  setIdle(handle: string): void;
  // Drops the move for one body, or else every move and any idle mark.
  clear(handle: string, body?: Id): void;
  // The handles that hold a move.
  handles(): string[];
  // The handles that are idle.
  idlers(): string[];
}

export interface WorldInternals {
  pending: PendingStore;
  // A round whose moves may carry their roles: the director closes a round with the players' moves.
  roundAs(moves: readonly Command[]): RoundResult;
  // Whether one of the observers sensed one of the events between the snapshots, as `sensedBy` decides (`docs/roles.md`).
  heard(before: Snapshot, after: Snapshot, events: readonly WorldEvent[], observers: readonly Id[]): boolean;
}
