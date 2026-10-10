import type { World } from "./api.js";
import { actorWorld, type ActorCheck, type ActorCommand, type ActorObserveOptions, type ActorOptions, type ActorProjection, type ActorWorld } from "./actor-world.js";
import type { Command } from "./engine/command.js";
import type { OptionsRequest } from "./options.js";
import { INTERNAL } from "./internal.js";
import { WorldError } from "./errors.js";
import type { Id } from "./model.js";

// A player's handle (`docs/roles.md`): the actor view of the body its slot is bound to, under the player
// role. It submits one move at a time for the next round, which is held in the world until the director
// closes that round, and it reads nothing of another player's move.
export interface PlayerWorld {
  observe(options?: ActorObserveOptions): ActorProjection;
  inspect(entity: Id): ReturnType<ActorWorld["inspect"]>;
  options(request?: OptionsRequest): ActorOptions;
  // Judged as a round's move, as the actor view judges any command (`docs/actor-view.md`).
  check(command: ActorCommand): ActorCheck;
  submit(move: ActorCommand): PlayerResult;
  withdraw(): PlayerResult;
  // Passes every round until the handle submits again, and drops any move (`docs/rounds.md`).
  idle(): PlayerResult;
  pending(): Command | null;
}

export type PlayerResult = { status: "ok" } | { status: "refused"; reason_code: string };

// The slot a handle is bound to, or null when the handle is not registered.
function slotOf(world: World, handle: string): Id | null {
  const player = world.snapshot().run?.players?.find((entry) => entry.handle === handle);
  return player?.slot ?? null;
}

export function playerWorld(world: World, handle: string): PlayerWorld {
  const slot = (): Id => {
    const found = slotOf(world, handle);
    if (found === null) {
      throw new WorldError("not_registered", `No player is registered as ${handle}`);
    }
    return found;
  };
  const refusal = (reason_code: string): PlayerResult => ({ status: "refused", reason_code });
  return {
    observe: (options) => actorWorld(world, slot()).observe(options),
    inspect: (entity) => actorWorld(world, slot()).inspect(entity),
    options: (request) => actorWorld(world, slot()).options(request),
    check: (command) => actorWorld(world, slot()).check(command),
    submit: (move) => {
      const found = slotOf(world, handle);
      if (found === null) {
        return refusal("not_registered");
      }
      if (world.snapshot().run?.state !== "running") {
        return refusal("run_not_running");
      }
      // The move is the slot's own: a round takes it as the player's, under the round's version it names.
      const command: Command = {
        command_id: move.command_id,
        actor: found,
        verb: move.verb,
        ...(move.target === undefined ? {} : { target: move.target }),
        ...(move.args === undefined ? {} : { args: move.args }),
      };
      world[INTERNAL].pending.set(handle, command);
      return { status: "ok" };
    },
    withdraw: () => {
      if (slotOf(world, handle) === null) {
        return refusal("not_registered");
      }
      world[INTERNAL].pending.clear(handle);
      return { status: "ok" };
    },
    idle: () => {
      if (slotOf(world, handle) === null) {
        return refusal("not_registered");
      }
      world[INTERNAL].pending.setIdle(handle);
      return { status: "ok" };
    },
    pending: () => {
      slot();
      return world[INTERNAL].pending.get(handle);
    },
  };
}
