import { canonicalJson } from "./canonical.js";
import { advanceClock, commandDuration } from "./clock.js";
import { reconcileSince } from "./process.js";
import { NoSeedError, nextRandom } from "./rng.js";
import { pruneSchedule } from "./schedule.js";
import type { Command, CommandContext, Result, TransitionContext } from "./command.js";
import { WORLD_AUTHOR } from "./command.js";
import { eventPerceivers } from "./query.js";
import { verbRegistry } from "./verbs/index.js";
import type { Delta, Entity, Id, ReasonData, Snapshot, WorldEvent } from "../model.js";
import type { TemplateRegistry } from "../templates.js";
import { isAgent } from "./verbs/address.js";
import { resolveTarget } from "./resolve.js";

function unchangedResult(
  snapshot: Snapshot,
  command: Command,
  status: Result["status"],
  resolvedTarget: Id | null = null,
  reasonCode?: string,
  candidates?: Id[],
  reasonData?: ReasonData,
): Result {
  return {
    status,
    command_id: command.command_id,
    resolved_target: resolvedTarget,
    ...(candidates !== undefined && { candidates }),
    ...(reasonCode !== undefined && { reason_code: reasonCode }),
    ...(reasonData !== undefined && { reason_data: reasonData }),
    snapshot,
    deltas: [],
    events: [],
  };
}

// The reserved author signs edits and time but lives in no snapshot; its verbs never read it.
const worldAuthor: Entity = {
  id: WORLD_AUTHOR,
  template: "world",
  name: "world",
  aliases: [],
  location: null,
  support: null,
  contained_in: null,
  in_part: null,
  concealed_by: null,
  pos: null,
  detached_from: null,
  integrity: 100,
  status: "intact",
  parts: {},
  residue: {},
  modifiers: [],
  props: {},
};

function withPerceivers(
  before: Snapshot,
  after: Snapshot,
  registry: TemplateRegistry,
  events: WorldEvent[],
): WorldEvent[] {
  const described = new Map(
    eventPerceivers(before, after, registry, events).map((entry) => [
      entry.event_id,
      entry.perceivers,
    ]),
  );
  return events.map((event) => ({ ...event, perceivers: described.get(event.event_id) }));
}

export function apply(snapshot: Snapshot, registry: TemplateRegistry, command: Command): Result {
  const verb = verbRegistry.get(command.verb);
  if (verb === undefined) {
    return unchangedResult(snapshot, command, "invalid", null, "unknown_verb");
  }

  const authored = command.actor === WORLD_AUTHOR && verb.author_only === true;
  const actor = authored ? worldAuthor : snapshot.entities[command.actor];
  if (actor === undefined) {
    return unchangedResult(snapshot, command, "invalid", null, "no_such_actor");
  }
  if (!authored && !isAgent(snapshot, actor.id)) {
    return unchangedResult(snapshot, command, "invalid", null, "not_an_agent");
  }

  let target = null;
  if (command.target !== undefined) {
    const resolution = resolveTarget(snapshot, registry, actor.id, command.target);
    if (resolution.status === "unresolved") {
      return unchangedResult(snapshot, command, "unresolved");
    }
    if (resolution.status === "ambiguous") {
      return unchangedResult(snapshot, command, "ambiguous", null, undefined, resolution.candidates);
    }
    target = resolution.target;
  } else if (verb.requires_target) {
    return unchangedResult(snapshot, command, "unresolved");
  }

  const commandContext: CommandContext = { snapshot, registry, command, actor, target, verb };
  const precondition = verb.preconditions(commandContext);
  if (precondition.status !== "ok") {
    // The catalog is the caller's contract: a refusal the verbs do not declare is a bug, and the
    // whole suite exercises refusals, so this turns declaration drift into a loud failure.
    if (precondition.status === "refused" && !verb.refuses.includes(precondition.reason_code)) {
      throw new TypeError(
        `Verb ${command.verb} refused with undeclared code ${precondition.reason_code}`,
      );
    }
    return unchangedResult(
      snapshot,
      command,
      precondition.status,
      precondition.status === "unresolved" ? null : (target?.address ?? null),
      "reason_code" in precondition ? precondition.reason_code : undefined,
      "candidates" in precondition ? precondition.candidates : undefined,
      "reason_data" in precondition ? precondition.reason_data : undefined,
    );
  }

  // Checked once the verb has accepted its args, so a bad `wait` stays the verb's own refusal.
  const duration = commandDuration(verb, command);
  if (duration === null) {
    throw new TypeError(`Verb ${command.verb} accepted a command without a duration`);
  }
  if (!Number.isSafeInteger(snapshot.tick + duration)) {
    return unchangedResult(snapshot, command, "invalid", null, "clock_overflow");
  }

  let working = snapshot;
  const events: WorldEvent[] = [];
  const deltas: Delta[] = [];
  const recordDelta = (
    entity: Id,
    field: string,
    from: unknown,
    to: unknown,
    eventId: Id,
  ): void => {
    deltas.push({
      event_id: eventId,
      entity,
      field,
      from: structuredClone(from),
      to: structuredClone(to),
    });
  };
  const emit = (type: string, entity: Id, data: Record<string, unknown>, causeId: Id | null): Id => {
    if (working.entities[entity] === undefined && entity !== WORLD_AUTHOR) {
      throw new TypeError(`Cannot emit an event for unknown entity ${entity}`);
    }
    const eventId = `ev${working.next_seq}`;
    const event: WorldEvent = {
      event_id: eventId,
      cause_id: causeId,
      command_id: command.command_id,
      tick: working.tick,
      type,
      entity,
      data: structuredClone(data),
    };
    working = { ...working, next_seq: working.next_seq + 1 };
    events.push(event);
    return eventId;
  };
  const set = (entityId: Id, field: string, value: unknown, eventId: Id): void => {
    const entity = working.entities[entityId];
    if (entity === undefined) {
      throw new TypeError(`Cannot change unknown entity ${entityId}`);
    }
    if (!Object.hasOwn(entity, field)) {
      throw new TypeError(`Unknown entity field ${field}`);
    }

    const from = entity[field as keyof Entity];
    if (canonicalJson(from) === canonicalJson(value)) {
      return;
    }
    const to = structuredClone(value);
    const updated = { ...entity, [field]: to };
    working = {
      ...working,
      entities: { ...working.entities, [entityId]: updated },
    };
    recordDelta(entityId, field, from, to, eventId);
  };

  const root = verb.rootEvent?.(command, actor, target);
  const rootEntity = root?.entity ?? target?.entity_id ?? actor.id;
  const rootEventId = emit(command.verb, rootEntity, root?.data ?? {}, null);
  const transitionContext: TransitionContext = {
    ...commandContext,
    get snapshot() {
      return working;
    },
    set snapshot(value) {
      working = value;
    },
    root_event_id: rootEventId,
    deltas,
    events,
    emit,
    set,
    recordDelta,
    random: () => {
      if (working.rng === undefined) {
        throw new NoSeedError();
      }
      const rolled = nextRandom(working.rng);
      working = { ...working, rng: rolled.state };
      return rolled.value;
    },
  };
  try {
    verb.transition(transitionContext);
    // A process whose condition the verb just made true starts, and one it made false stops.
    reconcileSince(transitionContext, 0);
    pruneSchedule(transitionContext);
    // The verb resolves at the tick it was given; only then does its time pass, and whatever falls
    // due in that time happens after it.
    const wake = verb.wake_on?.(command) ?? [];
    const elapsed = advanceClock(transitionContext, duration, wake);
    // A command that asked to be woken says how long it ran, on its own event.
    if (wake.length > 0) {
      events[0] = { ...events[0]!, data: { advanced: elapsed } };
    }
  } catch (error) {
    // A roll in a world with no seed, wherever in the command it fell (the verb's own transition
    // or a cause that ran as the clock moved): the whole command is refused and nothing is kept.
    // The code belongs to the world, not to a verb, so no verb declares it.
    if (error instanceof NoSeedError) {
      return unchangedResult(snapshot, command, "refused", target?.address ?? null, "no_seed");
    }
    throw error;
  }
  if (verb.validateResult !== undefined) {
    const validation = verb.validateResult({ ...commandContext, snapshot: working });
    if (validation.status !== "ok") {
      if (validation.status === "refused" && !verb.refuses.includes(validation.reason_code)) {
        throw new TypeError(
          `Verb ${command.verb} refused with undeclared code ${validation.reason_code}`,
        );
      }
      return unchangedResult(
        snapshot,
        command,
        validation.status,
        validation.status === "unresolved" ? null : (target?.address ?? null),
        "reason_code" in validation ? validation.reason_code : undefined,
        "candidates" in validation ? validation.candidates : undefined,
        "reason_data" in validation ? validation.reason_data : undefined,
      );
    }
  }
  working = { ...working, version: working.version + 1 };

  // The batch form of perceive, asked for on the way in: every event of this command names who
  // sensed it at either end, the same either-end reading item 5 gives a past event.
  const reported =
    command.perceivers === true
      ? withPerceivers(snapshot, working, registry, events)
      : events;

  return {
    status: "ok",
    command_id: command.command_id,
    resolved_target: target?.address ?? null,
    snapshot: working,
    deltas,
    events: reported,
  };
}
