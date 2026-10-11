import type { World } from "./api.js";
import { actorWorld, aliasOf, type ActorCheck, type ActorCommand, type ActorObserveOptions, type ActorOptions, type ActorProjection, type ActorWorld } from "./actor-world.js";
import type { Command } from "./engine/command.js";
import type { OptionsRequest } from "./options.js";
import { INTERNAL, VIEW_COMMANDS } from "./internal.js";
import { verbRegistry } from "./engine/verbs/index.js";
import { WorldError } from "./errors.js";
import { own, type Id, type Snapshot } from "./model.js";
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
  // One body's options: `body` names it when the slot holds several, and it is the body alone otherwise. A body that is
  // out has none, and says why (`body_out`).
  options(request?: OptionsRequest & { body?: string }): PlayerOptions;
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

export type PlayerOptions = ActorOptions & { reason_code?: "body_out" };

// A body is out when the world no longer holds it, or holds it destroyed, and no successor took its place (`liveBodyOf`).
// A move for it would be decided against nothing, so the handle refuses it when it is submitted, not when the round runs.
function bodyOut(snapshot: Snapshot, body: Id): boolean {
  const entity = own(snapshot.entities, liveBodyOf(snapshot, body));
  return entity === undefined || entity.status === "destroyed";
}

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
  // The body a read or a check names, with its slot: a throw when the body is unnamed or not the handle's.
  const namedOf = (body: string | undefined): { found: Bound; id: Id } => {
    const found = bound();
    const id = bodyNamed(found, body);
    if (id === null) {
      throw new WorldError(body === undefined ? "body_required" : "not_a_body", `No body ${body ?? ""} is driven by ${handle}`);
    }
    return { found, id };
  };
  // The view that reads through every body of the slot, as the first of them still in the world: a slot whose first
  // body was removed reads through the rest.
  const slotView = (): ActorWorld => {
    const found = bound();
    const first = found.bodies.find((body) => world.entity(body) !== null) ?? found.bodies[0]!;
    return actorWorld(world, first, found.root, found.bodies);
  };
  const refusal = (reason_code: string): PlayerResult => ({ status: "refused", reason_code });
  return {
    observe: (options) => slotView().observe(options),
    inspect: (entity) => slotView().inspect(entity),
    options: (request) => {
      const { found, id } = namedOf(request?.body);
      if (bodyOut(world.snapshot(), id)) {
        return { actor: aliasOf(found.root, id), ready: [], needs_args: [], reason_code: "body_out" };
      }
      return actorWorld(world, id, found.root, found.bodies).options(
        request === undefined ? undefined : request.refused === undefined ? {} : { refused: request.refused },
      );
    },
    check: (move) => {
      const { body, ...command } = move;
      const { found, id } = namedOf(body);
      if (bodyOut(world.snapshot(), id)) {
        return { status: "refused", command_id: command.command_id, resolved_target: null, reason_code: "body_out" };
      }
      return actorWorld(world, id, found.root, found.bodies).check(command);
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
      if (bodyOut(world.snapshot(), id)) {
        return refusal("body_out");
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
