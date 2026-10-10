import type { EditOptions, RoundResult, World } from "./api.js";
import type { Command, Result, WorldEdit } from "./engine/command.js";
import { INTERNAL } from "./internal.js";

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
}

export function directorWorld(world: World): DirectorWorld {
  return {
    snapshot: () => world.snapshot(),
    schedule: (filter) => world.schedule(filter),
    query: (query) => world.query(query),
    observe: (observer, options) => world.observe(observer, options),
    inspect: (observer, entity) => world.inspect(observer, entity),
    since: (version) => world.since(version),
    attempts: (version) => world.attempts(version),
    edit: (edit, options = {}) => world.edit(edit, { ...options, by: { role: "director" } }),
    submitted: () => world[INTERNAL].pending.handles(),
    closeRound: () => {
      const pending = world[INTERNAL].pending;
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
  };
}
