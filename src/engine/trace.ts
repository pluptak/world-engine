import { WorldError } from "../errors.js";
import type { Delta, Entity, Id, WorldEvent } from "../model.js";

export type TraceQuery = { event_id: Id } | { entity: Id; field: string };

// Valid Entity field names plus the pseudo-field "entity" used for spawn/remove deltas.
export const VALID_ENTITY_FIELDS = [
  "id",
  "template",
  "name",
  "aliases",
  "location",
  "support",
  "contained_in",
  "pos",
  "detached_from",
  "integrity",
  "status",
  "parts",
  "residue",
  "modifiers",
  "props",
  "entity",
] as const;

export function traceChain(events: readonly WorldEvent[], startEventId: Id): WorldEvent[] {
  const byId = new Map<Id, WorldEvent>();
  for (const event of events) {
    byId.set(event.event_id, event);
  }
  const start = byId.get(startEventId);
  if (start === undefined) {
    throw new WorldError("no_such_event", `No such event ${startEventId}`);
  }
  const leafFirst: WorldEvent[] = [start];
  let current = start;
  while (current.cause_id !== null) {
    const parent = byId.get(current.cause_id);
    if (parent === undefined) {
      throw new WorldError("no_such_event", `No such event ${current.cause_id}`);
    }
    leafFirst.push(parent);
    current = parent;
  }
  return leafFirst.reverse();
}

export function fieldEventId(
  deltas: readonly Delta[],
  entity: Id,
  field: string,
): Id | null {
  let found: Id | null = null;
  for (const delta of deltas) {
    if (delta.entity === entity && delta.field === field) {
      found = delta.event_id;
    }
  }
  return found;
}

export function entitySpawnEventId(
  deltas: readonly Delta[],
  entity: Id,
): Id | null {
  for (const delta of deltas) {
    if (delta.entity === entity && delta.field === "entity") {
      return delta.event_id;
    }
  }
  return null;
}

export function traceQuery(
  events: readonly WorldEvent[],
  deltas: readonly Delta[],
  query: TraceQuery,
): WorldEvent[] {
  if ("event_id" in query) {
    return traceChain(events, query.event_id);
  }

  const field = query.field as string;
  if (!VALID_ENTITY_FIELDS.includes(field as typeof VALID_ENTITY_FIELDS[number])) {
    throw new WorldError(
      "no_such_field",
      `No such field ${field}`,
    );
  }

  const start = fieldEventId(deltas, query.entity, field);
  if (start !== null) {
    return traceChain(events, start);
  }

  const spawnEventId = entitySpawnEventId(deltas, query.entity);
  if (spawnEventId !== null) {
    return traceChain(events, spawnEventId);
  }

  return [];
}
