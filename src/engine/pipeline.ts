import { canonicalJson } from "./canonical.js";
import type { Command, CommandContext, Result, TransitionContext } from "./command.js";
import { verbRegistry } from "./verbs/index.js";
import type { Delta, Entity, Id, Snapshot, WorldEvent } from "../model.js";
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
): Result {
  return {
    status,
    command_id: command.command_id,
    resolved_target: resolvedTarget,
    ...(candidates !== undefined && { candidates }),
    ...(reasonCode !== undefined && { reason_code: reasonCode }),
    snapshot,
    deltas: [],
    events: [],
  };
}

export function apply(snapshot: Snapshot, registry: TemplateRegistry, command: Command): Result {
  const verb = verbRegistry.get(command.verb);
  if (verb === undefined) {
    return unchangedResult(snapshot, command, "invalid", null, "unknown_verb");
  }

  const actor = snapshot.entities[command.actor];
  if (actor === undefined) {
    return unchangedResult(snapshot, command, "invalid", null, "no_such_actor");
  }
  if (!isAgent(snapshot, actor.id)) {
    return unchangedResult(snapshot, command, "invalid", null, "not_an_agent");
  }

  let target = null;
  if (command.target !== undefined) {
    const resolution = resolveTarget(snapshot, actor.id, command.target);
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

  const commandContext: CommandContext = { snapshot, registry, command, actor, target };
  const precondition = verb.preconditions(commandContext);
  if (precondition.status !== "ok") {
    return unchangedResult(
      snapshot,
      command,
      precondition.status,
      precondition.status === "unresolved" ? null : (target?.address ?? null),
      "reason_code" in precondition ? precondition.reason_code : undefined,
      "candidates" in precondition ? precondition.candidates : undefined,
    );
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
    if (working.entities[entity] === undefined) {
      throw new TypeError(`Cannot emit an event for unknown entity ${entity}`);
    }
    const eventId = `ev${working.next_seq}`;
    const event: WorldEvent = {
      event_id: eventId,
      cause_id: causeId,
      command_id: command.command_id,
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

  const rootEntity = target?.entity_id ?? actor.id;
  const rootEventId = emit(command.verb, rootEntity, {}, null);
  const transitionContext: TransitionContext = {
    ...commandContext,
    get snapshot() {
      return working;
    },
    set snapshot(value) {
      working = value;
    },
    root_event_id: rootEventId,
    emit,
    set,
    recordDelta,
  };
  verb.transition(transitionContext);
  working = { ...working, version: working.version + 1 };

  return {
    status: "ok",
    command_id: command.command_id,
    resolved_target: target?.address ?? null,
    snapshot: working,
    deltas,
    events,
  };
}
