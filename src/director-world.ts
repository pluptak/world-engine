import type { EditOptions, RoundResult, World } from "./api.js";
import type { Command, Result, WorldEdit } from "./engine/command.js";
import { INTERNAL } from "./internal.js";
import { driverBodies, liveBodyOf } from "./engine/run.js";
import type { Id, Snapshot } from "./model.js";

// The director's handle (`docs/roles.md`): everything a World reads, and writes only through `edit`, under
// the director role, so the engine refuses what a director may not send. It has no `command`: a director
// acts between rounds through its levers, never as a character. It learns which players have submitted,
// never what they submitted, and it closes a round with those moves.
export interface DirectorWorld {
  snapshot: World["snapshot"];
  schedule: World["schedule"];
  query: World["query"];
  observe: World["observe"];
  inspect: World["inspect"];
  since: World["since"];
  attempts: World["attempts"];
  edit(edit: WorldEdit, options?: Omit<EditOptions, "by">): Result;
  // The handles that hold a pending move for the next round; their moves are not in it.
  submitted(): string[];
  // Takes every pending move as one round, each under its player's role, and the close under the director's.
  // A round the world refuses takes no move: the players' moves stay pending for the next close.
  closeRound(): RoundResult;
  // Closes empty rounds while every live registered player is idle (`docs/rounds.md`), stopping after `max`,
  // one round before the beat `stop_before` names, or at the first round a registered body senses an event of.
  closeRounds(options: { max: number; stop_before?: string }): QuietRounds;
}

export type QuietRounds =
  | { status: "ok"; rounds: number; stopped: "max" | "beat" | "heard" }
  | { status: "refused"; reason_code: string; rounds: number };

export function directorWorld(world: World): DirectorWorld {
  const pending = world[INTERNAL].pending;
  // The bodies of a slot that are in the world and not destroyed (`driverBodies`).
  const liveOf = (snapshot: Snapshot, slot: Id): Id[] =>
    driverBodies(snapshot, slot).filter((body) => {
      const entity = snapshot.entities[body];
      return entity !== undefined && entity.status !== "destroyed";
    });
  // The live bodies of every registered player.
  const liveBodies = (): Id[] => {
    const snapshot = world.snapshot();
    return (snapshot.run?.players ?? []).flatMap((player) => liveOf(snapshot, player.slot));
  };
  const pendingDue = (id: string): number | null => {
    const cause = world.schedule({ kind: "beat" }).find((entry) => entry.kind === "beat" && entry.id === id);
    return cause === undefined ? null : cause.due_tick;
  };
  return {
    snapshot: () => world.snapshot(),
    schedule: (filter) => world.schedule(filter),
    query: (query) => world.query(query),
    observe: (observer, options) => world.observe(observer, options),
    inspect: (observer, entity) => world.inspect(observer, entity),
    since: (version) => world.since(version),
    attempts: (version) => world.attempts(version),
    edit: (edit, options = {}) => world.edit(edit, { ...options, by: { role: "director" } }),
    submitted: () => pending.handles(),
    closeRound: () => {
      const handles = pending.handles();
      // Each move is for the body it was submitted for, which a successor may have taken over since: the round
      // takes it for the body the handle drives when the round closes.
      const snapshot = world.snapshot();
      const moves = handles.flatMap((handle): Command[] =>
        pending.moves(handle).map((command) => ({ ...command, actor: liveBodyOf(snapshot, command.actor), by: { role: "player", handle } })),
      );
      const result = world[INTERNAL].roundAs(moves);
      if (result.status === "ok") {
        handles.forEach((handle) => pending.clear(handle));
      }
      return result;
    },
    closeRounds: ({ max, stop_before }) => {
      const idle = new Set(pending.idlers());
      const moving = new Set(pending.handles());
      const players = world.snapshot().run?.players ?? [];
      const liveHandles = players
        .filter((player) => liveOf(world.snapshot(), player.slot).length > 0)
        .map((player) => player.handle);
      // Every live player must be idle: one that has a move, or has not passed, keeps the time as it is.
      if (liveHandles.some((handle) => !idle.has(handle) || moving.has(handle))) {
        return { status: "refused", reason_code: "players_active", rounds: 0 };
      }
      if (stop_before !== undefined && pendingDue(stop_before) === null) {
        return { status: "refused", reason_code: "no_such_beat", rounds: 0 };
      }
      let rounds = 0;
      for (;;) {
        if (rounds >= max) {
          return { status: "ok", rounds, stopped: "max" };
        }
        const due = stop_before === undefined ? null : pendingDue(stop_before);
        // One tick short of the beat: the next round would be the one that falls it due.
        if (due !== null && world.snapshot().tick + 1 >= due) {
          return { status: "ok", rounds, stopped: "beat" };
        }
        const before = world.snapshot();
        const closed = world[INTERNAL].roundAs([]);
        if (closed.status !== "ok" || closed.closing === undefined) {
          return { status: "refused", reason_code: closed.reason_code ?? closed.status, rounds };
        }
        rounds += 1;
        // A registered body that sensed anything the round made stops the quiet: no player sleeps through it.
        if (world[INTERNAL].heard(before, closed.closing.snapshot, closed.closing.events, liveBodies())) {
          return { status: "ok", rounds, stopped: "heard" };
        }
      }
    },
  };
}
