import { createHash } from "node:crypto";
import type { World } from "./api.js";
import type { Options, OptionsRequest, ReadyOption } from "./options.js";
import type { Command, Result } from "./engine/command.js";
import { PROP_FIELDS } from "./engine/fields.js";
import { gropable } from "./engine/query.js";
import { verbRegistry } from "./engine/verbs/index.js";
import type { Inspection, ObservedEntity, Projection } from "./engine/projection.js";
import { WorldError } from "./errors.js";
import { own, type Id, type ReasonData, type Snapshot, type Status } from "./model.js";

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

// What an actor calls an entity or an event: never the world's id, whose shared counter would tell
// it, by a gap, that something was made out of its sight. `x` and the first 12 hex digits of a hash
// of the actor and the id, so each actor has its own names, they carry no count, and nothing is
// stored; a part address keeps its part. It hides the count from a controller that reads its views,
// not from one that hashes candidate ids to decode them.
export function aliasOf(actor: Id, id: Id): string {
  const dot = id.indexOf(".");
  const [entity, part] = dot < 0 ? [id, ""] : [id.slice(0, dot), id.slice(dot)];
  return `x${createHash("sha256").update(`${actor}:${entity}`).digest("hex").slice(0, 12)}${part}`;
}

const ALIAS = /^x[0-9a-f]{12}(\..+)?$/;

export function actorWorld(world: World, actor: Id): ActorWorld {
  if (world.entity(actor) === null) {
    throw new WorldError("no_such_entity", `Unknown actor ${actor}`);
  }
  const alias = (id: Id): string => aliasOf(actor, id);
  // An entity id or a part address of one, in the world as it is: the strings an actor's alias
  // stands for. Anything else (a name, a relation, a token) is left as it is.
  const isAddress = (snapshot: Snapshot, value: string): boolean =>
    own(snapshot.entities, value.split(".")[0]!) !== undefined;
  const aliasValue = (snapshot: Snapshot, value: unknown): unknown =>
    typeof value === "string" && isAddress(snapshot, value) ? alias(value) : value;
  // A word no name, alias or id in the world is: names are free text, so the builder reads the world's
  // own names and takes the first `nothing<n>` none of them is. The world answers it as it answers a
  // name no one holds, and the view never sends it back.
  const nothing = (): string => {
    const snapshot = world.snapshot();
    const taken = new Set<string>(Object.keys(snapshot.entities));
    for (const entity of Object.values(snapshot.entities)) {
      taken.add(entity.name.toLowerCase());
      entity.aliases.forEach((name) => taken.add(name.toLowerCase()));
    }
    let n = 0;
    while (taken.has(`nothing${n}`)) {
      n += 1;
    }
    return `nothing${n}`;
  };
  // One of this actor's aliases, back to the id it stands for. A raw world id, or an entity's part
  // address, names nothing in the actor's view; another actor's alias passes as it is and resolves
  // as text, as a name no one holds would.
  const unalias = (text: string): string => {
    const match = ALIAS.exec(text);
    if (match === null) {
      return isAddress(world.snapshot(), text) ? nothing() : text;
    }
    const part = match[1] ?? "";
    const entity = text.slice(0, text.length - part.length);
    const id = Object.keys(world.snapshot().entities).find((candidate) => alias(candidate) === entity);
    return id === undefined ? text : `${id}${part}`;
  };
  // A `token` arg (what `say` says) is opaque text the engine stores and others are told, never a name:
  // it passes as it is, so neither an alias nor an id-shaped word is rewritten into it.
  const unaliasArgs = (verb: string, args: Record<string, unknown>): Record<string, unknown> => {
    const declared = verbRegistry.get(verb)?.args;
    return Object.fromEntries(
      Object.entries(args).map(([key, value]) => [
        key,
        typeof value === "string" && declared?.[key]?.kind !== "token" ? unalias(value) : value,
      ]),
    );
  };

  // Built field by field, so nothing a caller adds (an `actor`, `perceivers`) reaches the world.
  const toCommand = (command: ActorCommand): Command => ({
    command_id: command.command_id,
    actor,
    verb: command.verb,
    ...(command.target !== undefined && { target: unalias(command.target) }),
    ...(command.args !== undefined && { args: unaliasArgs(command.verb, command.args) }),
  });

  const entityOut = <T extends ObservedEntity>(entity: T): T => {
    const facts = entity.facts;
    const ref = (id: Id | null | undefined) => (typeof id === "string" ? alias(id) : id);
    return {
      ...entity,
      id: alias(entity.id),
      ...(facts !== undefined && {
        facts: {
          ...facts,
          ...(facts.location !== undefined && { location: ref(facts.location) }),
          ...(facts.support !== undefined && { support: ref(facts.support) }),
          ...(facts.contained_in !== undefined && { contained_in: ref(facts.contained_in) }),
        },
      }),
    };
  };
  const inspectionOut = (inspection: Inspection): Inspection => {
    const snapshot = world.snapshot();
    const props =
      inspection.props === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(inspection.props).map(([key, value]) => [
              key,
              PROP_FIELDS[key]?.type === "id" ? (aliasValue(snapshot, value) as typeof value) : value,
            ]),
          );
    return {
      ...entityOut(inspection),
      ...(props !== undefined && { props }),
      ...(inspection.holds !== undefined && { holds: inspection.holds.map(alias).sort() }),
    };
  };
  const optionOut = <T extends ReadyOption>(option: T, snapshot: Snapshot): T => ({
    ...option,
    ...(option.target !== undefined && { target: alias(option.target) }),
    ...(option.args !== undefined && {
      args: Object.fromEntries(Object.entries(option.args).map(([key, value]) => [key, aliasValue(snapshot, value)])),
    }),
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
    const told: ReasonData = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, aliasValue(snapshot, value) as ReasonData[string]]),
    );
    return {
      status: result.status,
      command_id: result.command_id,
      resolved_target: result.resolved_target === null ? null : alias(result.resolved_target),
      ...(result.candidates !== undefined && { candidates: result.candidates.map(alias) }),
      ...(result.reason_code !== undefined && { reason_code: result.reason_code }),
      ...(Object.keys(told).length > 0 && { reason_data: told }),
    };
  };

  // Built field by field, so nothing the world adds to a projection or options reaches the actor.
  // Entities are listed by alias, so not in the order they were made; events in the order they
  // happened, which the actor could tell.
  const toActor = (projection: Projection): ActorProjection => ({
    observer: alias(projection.observer),
    tick: world.snapshot().tick,
    unknown_senses: projection.unknown_senses,
    entities: projection.entities.map(entityOut).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    events: projection.events.map((event) => ({
      ...event,
      event_id: alias(event.event_id),
      ...(event.entity !== undefined && { entity: alias(event.entity) }),
    })),
  });

  return {
    actor,
    observe: (options = {}) =>
      toActor(world.observe(actor, options.since_tick === undefined ? {} : { since_tick: options.since_tick })),
    inspect: (entity) => {
      const inspection = world.inspect(actor, unalias(entity));
      return inspection === null ? null : inspectionOut(inspection);
    },
    check: (command) => verdict(world.check(toCommand(command)), world.observe(actor)),
    options: (request) => {
      const options = world.options(actor, request);
      const snapshot = world.snapshot();
      return {
        actor: alias(options.actor),
        ready: options.ready.map((option) => optionOut(option, snapshot)),
        needs_args: options.needs_args,
        ...(options.blocked !== undefined && { blocked: options.blocked.map((option) => optionOut(option, snapshot)) }),
      };
    },
    command: (command) => {
      const result = world.command(toCommand(command), { observe: true });
      const observation = result.observation ?? world.observe(actor);
      return { ...verdict(result, observation), observation: toActor(observation) };
    },
  };
}
