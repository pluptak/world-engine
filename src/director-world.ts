import type { EditOptions, RoundResult, World } from "./api.js";
import type { Command, Result, WorldEdit } from "./engine/command.js";
import { INTERNAL } from "./internal.js";
import type { Id } from "./model.js";

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
  // A registered player whose body is in the world and not destroyed.
  const liveSlots = (): Id[] =>
    (world.snapshot().run?.players ?? [])
      .map((player) => player.slot)
      .filter((slot) => {
        const entity = world.snapshot().entities[slot];
        return entity !== undefined && entity.status !== "destroyed";
      });
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
      const moves = handles.flatMap((handle): Command[] => {
        const command = pending.get(handle);
        return command === null ? [] : [{ ...command, by: { role: "player", handle } }];
      });
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
      const liveHandles = players.filter((player) => liveSlots().includes(player.slot)).map((player) => player.handle);
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
        const before = world.snapshot().version;
        const closed = world[INTERNAL].roundAs([]);
        if (closed.status !== "ok") {
          return { status: "refused", reason_code: closed.reason_code ?? closed.status, rounds };
        }
        rounds += 1;
        // A registered body that sensed anything the round made stops the quiet: no player sleeps through it.
        if (liveSlots().some((slot) => world.observe(slot, { since: before }).events.length > 0)) {
          return { status: "ok", rounds, stopped: "heard" };
        }
      }
    },
  };
}
