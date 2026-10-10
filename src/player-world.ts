import type { World } from "./api.js";
import { actorWorld, aliasOf, type ActorCheck, type ActorCommand, type ActorObserveOptions, type ActorOptions, type ActorProjection, type ActorWorld } from "./actor-world.js";
import type { Command } from "./engine/command.js";
import type { OptionsRequest } from "./options.js";
import { INTERNAL, VIEW_COMMANDS } from "./internal.js";
import { verbRegistry } from "./engine/verbs/index.js";
import { WorldError } from "./errors.js";
import type { Id } from "./model.js";
import { liveBodyOf } from "./engine/run.js";

// A player's handle (`docs/roles.md`): the actor view of the body its slot is bound to, under the player
// role. It submits one move at a time for the next round, which is held in the world until the director
// closes that round, and it reads nothing of another player's move.
export interface PlayerWorld {
  observe(options?: ActorObserveOptions): ActorProjection;
  inspect(entity: Id): ReturnType<ActorWorld["inspect"]>;
  options(request?: OptionsRequest): ActorOptions;
  // Judged as a round's move, as the actor view judges any command (`docs/actor-view.md`).
  check(command: ActorCommand): ActorCheck;
  // A move written as the view writes things: its own aliases or names, never a world id.
  submit(move: ActorCommand): PlayerResult;
  withdraw(): PlayerResult;
  // Passes every round until the handle submits again, and drops any move (`docs/rounds.md`).
  idle(): PlayerResult;
  // The move held for the next round, written as the view writes it.
  pending(): ActorCommand | null;
}

export type PlayerResult = { status: "ok" } | { status: "refused"; reason_code: string };

// The body a handle drives: the body its slot is bound to, or the successor that took it over (`liveBodyOf`).
// Null when the handle is not registered.
function slotOf(world: World, handle: string): Id | null {
  const snapshot = world.snapshot();
  const player = snapshot.run?.players?.find((entry) => entry.handle === handle);
  return player === undefined ? null : liveBodyOf(snapshot, player.slot);
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
      // The move is the slot's own, read back from the view's aliases as the view's own `check` reads it, so
      // a target the view offered resolves and a world id names nothing.
      const view = actorWorld(world, found);
      const command: Command = VIEW_COMMANDS.get(view)!(move);
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
      const body = slot();
      const held = world[INTERNAL].pending.get(handle);
      if (held === null) {
        return null;
      }
      // Written back as the view writes: an id becomes the body's alias for it, and the actor is not said.
      const snapshot = world.snapshot();
      const out = (value: unknown): unknown =>
        typeof value === "string" && snapshot.entities[value.split(".")[0]!] !== undefined ? aliasOf(body, value) : value;
      return {
        command_id: held.command_id,
        verb: held.verb,
        ...(held.target === undefined ? {} : { target: out(held.target) as string }),
        ...(held.args === undefined
          ? {}
          : { args: Object.fromEntries(Object.entries(held.args).map(([key, value]) => [key, verbRegistry.get(held.verb)?.args?.[key]?.kind === "token" ? value : out(value)])) }),
      };
    },
  };
}
