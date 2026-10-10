import type { EditOptions, World } from "./api.js";
import type { Result, WorldEdit } from "./engine/command.js";

// The director's handle (`docs/roles.md`): everything a World reads, and writes only through `edit`, under
// the director role, so the engine refuses what a director may not send. It has no `command`: a director
// acts between rounds through its levers, never as a character. `round` stays the author's for now.
export interface DirectorWorld {
  snapshot: World["snapshot"];
  schedule: World["schedule"];
  query: World["query"];
  observe: World["observe"];
  inspect: World["inspect"];
  since: World["since"];
  attempts: World["attempts"];
  edit(edit: WorldEdit, options?: Omit<EditOptions, "by">): Result;
  round: World["round"];
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
    round: (moves) => world.round(moves),
  };
}
