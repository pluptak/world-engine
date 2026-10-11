import type { World } from "./api.js";
import { actorWorld, aliasOf, type ActorCheck, type ActorCommand, type ActorObserveOptions, type ActorOptions, type ActorProjection, type ActorWorld } from "./actor-world.js";
import type { Command } from "./engine/command.js";
import type { OptionsRequest } from "./options.js";
import { INTERNAL, VIEW_COMMANDS } from "./internal.js";
import { verbRegistry } from "./engine/verbs/index.js";
import { WorldError } from "./errors.js";
import type { Id } from "./model.js";
import { driverBodies, liveBodyOf } from "./engine/run.js";

// A player's handle (`docs/roles.md`): the actor view of the bodies its slot drives, under the player role. It
// submits one move per body for the next round, which is held in the world until the director closes that round,
// and it reads nothing of another player's move. A move names its body by the view's alias when the slot holds
// several bodies; a slot of one body needs no name.
export type PlayerMove = ActorCommand & { body?: string };

export interface PlayerWorld {
  // What any of the slot's bodies senses, once each.
  observe(options?: ActorObserveOptions): ActorProjection;
  inspect(entity: Id): ReturnType<ActorWorld["inspect"]>;
  // One body's options: `body` names it when the slot holds several, and it is the body alone otherwise.
  options(request?: OptionsRequest & { body?: string }): ActorOptions;
  // Judged as a round's move, as the actor view judges any command (`docs/actor-view.md`), for the body it names.
  check(command: PlayerMove): ActorCheck;
  // A move written as the view writes things: its own aliases or names, never a world id.
  submit(move: PlayerMove): PlayerResult;
  // Drops the move for one body, or every move the handle holds.
  withdraw(body?: string): PlayerResult;
  // Passes every round until the handle submits again, and drops any move (`docs/rounds.md`).
  idle(): PlayerResult;
  // The moves held for the next round, written as the view writes them.
  pending(): PlayerMove[];
}

export type PlayerResult = { status: "ok" } | { status: "refused"; reason_code: string };

// A handle's slot: the slot's first body, which names it, and the bodies it drives now, in slot order (`driverBodies`).
interface Bound {
  root: Id;
  bodies: Id[];
}

function boundOf(world: World, handle: string): Bound | null {
  const snapshot = world.snapshot();
  const player = snapshot.run?.players?.find((entry) => entry.handle === handle);
  return player === undefined ? null : { root: player.slot, bodies: driverBodies(snapshot, player.slot) };
}

// The body a move names, by its alias in the view: the slot's one body when none is named and it holds one, else null.
function bodyNamed(bound: Bound, body: string | undefined): Id | null {
  if (body === undefined) {
    return bound.bodies.length === 1 ? bound.bodies[0]! : null;
  }
  return bound.bodies.find((candidate) => aliasOf(bound.root, candidate) === body) ?? null;
}

export function playerWorld(world: World, handle: string): PlayerWorld {
  const bound = (): Bound => {
    const found = boundOf(world, handle);
    if (found === null) {
      throw new WorldError("not_registered", `No player is registered as ${handle}`);
    }
    return found;
  };
  // The view of one body, for a read or a check that names it: a throw when the body is unnamed or not the handle's.
  const viewOf = (body: string | undefined): ActorWorld => {
    const found = bound();
    const id = bodyNamed(found, body);
    if (id === null) {
      throw new WorldError(body === undefined ? "body_required" : "not_a_body", `No body ${body ?? ""} is driven by ${handle}`);
    }
    return actorWorld(world, id, found.root, found.bodies);
  };
  // The view that reads through every body of the slot.
  const slotView = (): ActorWorld => {
    const found = bound();
    return actorWorld(world, found.bodies[0]!, found.root, found.bodies);
  };
  const refusal = (reason_code: string): PlayerResult => ({ status: "refused", reason_code });
  return {
    observe: (options) => slotView().observe(options),
    inspect: (entity) => slotView().inspect(entity),
    options: (request) =>
      viewOf(request?.body).options(
        request === undefined ? undefined : request.refused === undefined ? {} : { refused: request.refused },
      ),
    check: (move) => {
      const { body, ...command } = move;
      return viewOf(body).check(command);
    },
    submit: (move) => {
      const found = boundOf(world, handle);
      if (found === null) {
        return refusal("not_registered");
      }
      if (world.snapshot().run?.state !== "running") {
        return refusal("run_not_running");
      }
      const id = bodyNamed(found, move.body);
      if (id === null) {
        return refusal(move.body === undefined ? "body_required" : "not_a_body");
      }
      // The move is the body's own, read back from the view's aliases as the view's own `check` reads it, so a
      // target the view offered resolves and a world id names nothing.
      const view = actorWorld(world, id, found.root, found.bodies);
      const command: Command = VIEW_COMMANDS.get(view)!(move);
      // A move this body held under the body it was before a successor took it over is replaced, not kept beside.
      const snapshot = world.snapshot();
      for (const held of world[INTERNAL].pending.moves(handle)) {
        if (liveBodyOf(snapshot, held.actor) === id) {
          world[INTERNAL].pending.clear(handle, held.actor);
        }
      }
      world[INTERNAL].pending.set(handle, command);
      return { status: "ok" };
    },
    withdraw: (body) => {
      const found = boundOf(world, handle);
      if (found === null) {
        return refusal("not_registered");
      }
      if (body === undefined) {
        world[INTERNAL].pending.clear(handle);
        return { status: "ok" };
      }
      const id = bodyNamed(found, body);
      if (id === null) {
        return refusal("not_a_body");
      }
      const snapshot = world.snapshot();
      for (const held of world[INTERNAL].pending.moves(handle)) {
        if (liveBodyOf(snapshot, held.actor) === id) {
          world[INTERNAL].pending.clear(handle, held.actor);
        }
      }
      return { status: "ok" };
    },
    idle: () => {
      if (boundOf(world, handle) === null) {
        return refusal("not_registered");
      }
      world[INTERNAL].pending.setIdle(handle);
      return { status: "ok" };
    },
    pending: () => {
      const found = bound();
      const snapshot = world.snapshot();
      // Written back as the view writes: an id becomes the body's alias for it, and the actor is not said. A body is
      // named only where the slot holds several.
      const out = (value: unknown): unknown =>
        typeof value === "string" && snapshot.entities[value.split(".")[0]!] !== undefined ? aliasOf(found.root, value) : value;
      return world[INTERNAL].pending.moves(handle).map((held) => {
        const body = liveBodyOf(snapshot, held.actor);
        return {
          ...(found.bodies.length > 1 && { body: aliasOf(found.root, body) }),
          command_id: held.command_id,
          verb: held.verb,
          ...(held.target === undefined ? {} : { target: out(held.target) as string }),
          ...(held.args === undefined
            ? {}
            : { args: Object.fromEntries(Object.entries(held.args).map(([key, value]) => [key, verbRegistry.get(held.verb)?.args?.[key]?.kind === "token" ? value : out(value)])) }),
        };
      });
    },
  };
}
