import type { World } from "./api.js";
import type { Options, OptionsRequest } from "./options.js";
import type { Command, Result } from "./engine/command.js";
import { gropable } from "./engine/query.js";
import type { Inspection, Projection } from "./engine/projection.js";
import { WorldError } from "./errors.js";
import { own, type Id, type ReasonData, type Status } from "./model.js";

// What a character's controller may send: the actor is the view's own, and `perceivers`, which names
// who else sensed each event, is the world's record rather than anything the actor could know.
export type ActorCommand = Pick<Command, "command_id" | "verb" | "target" | "args">;

// What an actor sees carries the tick, never the version: the version counts every accepted
// command, so a jump in it would tell the actor that others acted out of its sight. The tick is time
// it feels pass, and `since_tick` is how it asks what it sensed since it last looked.
export type ActorProjection = Omit<Projection, "version"> & { tick: number };
export type ActorOptions = Omit<Options, "version">;
export interface ActorObserveOptions {
  since_tick?: number;
}

// A verdict as the actor could know it: no snapshot, deltas or events, only what it sensed of its
// own command in `observation`. A `reason_data` value naming an entity the actor could not name
// itself is left out, so every id here is the actor, its room, what it named, in its view, or
// within its groping reach.
export interface ActorResult {
  status: Status;
  command_id: Id;
  resolved_target: Id | null;
  candidates?: Id[];
  reason_code?: string;
  reason_data?: ReasonData;
  observation: ActorProjection;
}

export type ActorCheck = Omit<ActorResult, "observation">;

// One actor's side of a world, for a controller that must not see the rest: what it senses, what
// it can try, and what came of what it did. The `World` it wraps stays the trusted caller's.
export interface ActorWorld {
  actor: Id;
  observe(options?: ActorObserveOptions): ActorProjection;
  inspect(entity: Id): Inspection | null;
  check(command: ActorCommand): ActorCheck;
  // What it can try now, by verb and target, from what it can name: no reason carries data.
  options(request?: OptionsRequest): ActorOptions;
  // Decided against the world as it is: an actor has no version to base a command on, so none is
  // ever `preempted` by what it could not see.
  command(command: ActorCommand): ActorResult;
}

const UNTOLD_AMOUNTS: readonly string[] = ["available", "held"];

export function actorWorld(world: World, actor: Id): ActorWorld {
  if (world.entity(actor) === null) {
    throw new WorldError("no_such_entity", `Unknown actor ${actor}`);
  }
  // Built field by field, so nothing a caller adds (an `actor`, `perceivers`) reaches the world.
  const toCommand = (command: ActorCommand): Command => ({
    command_id: command.command_id,
    actor,
    verb: command.verb,
    ...(command.target !== undefined && { target: command.target }),
    ...(command.args !== undefined && { args: command.args }),
  });

  const verdict = (result: Omit<Result, "snapshot" | "deltas" | "events">, view: Projection): ActorCheck => {
    const known = new Set<Id>([actor, ...view.entities.map((entity) => entity.id)]);
    const room = world.entity(actor)?.location;
    if (typeof room === "string") {
      known.add(room);
    }
    // What the actor named itself; a part address (`e5.leg_fl`) names its entity too.
    for (const address of [result.resolved_target, ...(result.candidates ?? [])]) {
      if (address !== null) {
        known.add(address);
        known.add(address.split(".")[0]!);
      }
    }
    // Besides what it senses, an actor could name what it can grope for (`addressable`), so a
    // holder felt for in the dark is named as a refusal's `carried` by.
    const snapshot = world.snapshot();
    const data: ReasonData = {};
    for (const key of Object.keys(result.reason_data ?? {}).sort()) {
      const value = result.reason_data![key]!;
      // How much a vessel holds is read, not told: a refusal does not give the figure (`requested` is
      // the actor's own, and `capacity` is what the vessel is).
      if (UNTOLD_AMOUNTS.includes(key)) {
        continue;
      }
      if (
        typeof value !== "string" ||
        own(snapshot.entities, value) === undefined ||
        known.has(value) ||
        gropable(snapshot, actor, value)
      ) {
        data[key] = value;
      }
    }
    return {
      status: result.status,
      command_id: result.command_id,
      resolved_target: result.resolved_target,
      ...(result.candidates !== undefined && { candidates: result.candidates }),
      ...(result.reason_code !== undefined && { reason_code: result.reason_code }),
      ...(Object.keys(data).length > 0 && { reason_data: data }),
    };
  };

  // Built field by field, so nothing the world adds to a projection or options reaches the actor.
  const toActor = (projection: Projection): ActorProjection => ({
    observer: projection.observer,
    tick: world.snapshot().tick,
    unknown_senses: projection.unknown_senses,
    entities: projection.entities,
    events: projection.events,
  });

  return {
    actor,
    observe: (options = {}) =>
      toActor(world.observe(actor, options.since_tick === undefined ? {} : { since_tick: options.since_tick })),
    inspect: (entity) => world.inspect(actor, entity),
    check: (command) => verdict(world.check(toCommand(command)), world.observe(actor)),
    options: (request) => {
      const options = world.options(actor, request);
      return {
        actor: options.actor,
        ready: options.ready,
        needs_args: options.needs_args,
        ...(options.blocked !== undefined && { blocked: options.blocked }),
      };
    },
    command: (command) => {
      const result = world.command(toCommand(command), { observe: true });
      const observation = result.observation ?? world.observe(actor);
      return { ...verdict(result, observation), observation: toActor(observation) };
    },
  };
}
