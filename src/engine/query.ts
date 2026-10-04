import { capacity } from "./capacity.js";
import { canonicalJson } from "./canonical.js";
import type { Entity, Id, Snapshot, Tri, WorldEvent } from "../model.js";
import type { TemplateRegistry } from "../templates.js";
import { closedEnclosure } from "./verbs/address.js";

export type Query =
  | { kind: "fact"; subject: Id; relation: string; object?: Id | string }
  | { kind: "perceive"; observer: Id; event_id?: Id; entity?: Id; sense: string };

export interface Answer {
  value: Tri;
  basis_code: string;
}

function answer(value: Tri, basis_code: string): Answer {
  return { value, basis_code };
}

function relationValue(
  entity: Entity,
  relation: string,
  object: Id | string | undefined,
): boolean {
  switch (relation) {
    case "support":
    case "contained_in":
    case "location": {
      const value = entity[relation];
      return object === undefined ? value !== null : value === object;
    }
    case "status":
      return object === undefined ? true : entity.status === object;
    case "attached_to": {
      if (object === undefined) {
        return Object.keys(entity.parts)
          .sort()
          .some((name) => {
            const part = entity.parts[name];
            return part !== undefined && part.status !== "detached" && part.status !== "destroyed";
          });
      }
      if (entity.detached_from !== null && object === entity.detached_from.entity) {
        return false;
      }
      const partName =
        typeof object === "string" && object.startsWith(`${entity.id}.`)
          ? object.slice(entity.id.length + 1)
          : object;
      const part = typeof partName === "string" ? entity.parts[partName] : undefined;
      return part !== undefined && part.status !== "detached" && part.status !== "destroyed";
    }
    default:
      return false;
  }
}

function propertyValue(entity: Entity, property: string): unknown {
  if (property === "integrity" || property === "residue" || property === "pos") {
    return entity[property];
  }
  return Object.hasOwn(entity.props, property) ? entity.props[property] : undefined;
}

function propertyMatches(value: unknown, object: Id | string | undefined, property: string): boolean {
  if (value === undefined) {
    return false;
  }
  if (object === undefined) {
    return true;
  }
  if (property === "residue" && typeof object === "string" && value !== null && typeof value === "object") {
    const amount = (value as Record<string, unknown>)[object];
    return typeof amount === "number" && amount > 0;
  }
  if (value === object) {
    return true;
  }
  if (typeof object === "string" && (typeof value === "number" || typeof value === "boolean")) {
    return String(value) === object;
  }
  return typeof object === "string" && typeof value === "object" && canonicalJson(value) === object;
}

function fact(snapshot: Snapshot, query: Extract<Query, { kind: "fact" }>): Answer {
  const entity = snapshot.entities[query.subject];
  if (entity === undefined) {
    return answer("false", "no_such_entity");
  }
  if (snapshot.coverage.relations.includes(query.relation)) {
    return answer(relationValue(entity, query.relation, query.object) ? "true" : "false", "relation_state");
  }
  if (snapshot.coverage.properties.includes(query.relation)) {
    const value = propertyValue(entity, query.relation);
    return answer(propertyMatches(value, query.object, query.relation) ? "true" : "false", "property_state");
  }
  return answer("unknown", "uncovered_category");
}

function connectedByDoor(
  snapshot: Snapshot,
  from: Id,
  to: Id,
  openOnly: boolean,
): boolean {
  return Object.keys(snapshot.entities)
    .sort()
    .some((id) => {
      const entity = snapshot.entities[id];
      if (entity === undefined || entity.template !== "door") {
        return false;
      }
      if (openOnly && entity.props.open !== true) {
        return false;
      }
      return (
        (entity.props.from === from && entity.props.to === to) ||
        (entity.props.from === to && entity.props.to === from)
      );
    });
}

function eventAt(events: WorldEvent[], eventId: Id): WorldEvent | undefined {
  return events.find((event) => event.event_id === eventId);
}

function eventLocation(snapshot: Snapshot, event: WorldEvent): Id | null {
  const location = event.data.location;
  if (typeof location === "string") {
    return location;
  }
  return snapshot.entities[event.entity]?.location ?? null;
}

function loudEvent(event: WorldEvent | undefined): boolean {
  if (event === undefined) {
    return false;
  }
  return (
    event.type === "broken" ||
    event.type === "detached" ||
    (event.type === "dropped" && typeof event.data.fall_cm === "number" && event.data.fall_cm >= 50)
  );
}

function perceive(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  events: WorldEvent[],
  query: Extract<Query, { kind: "perceive" }>,
): Answer {
  const observer = snapshot.entities[query.observer];
  if (observer === undefined) {
    return answer("false", "no_such_entity");
  }
  if (!snapshot.coverage.senses.includes(query.sense)) {
    return answer("unknown", "uncovered_sense");
  }
  if ((capacity(snapshot, registry, observer.id, query.sense) ?? 0) === 0) {
    return answer("false", "no_sense_capacity");
  }

  const event = query.event_id === undefined ? undefined : eventAt(events, query.event_id);
  if (query.event_id !== undefined && event === undefined) {
    return answer("false", "no_such_event");
  }
  if (query.event_id === undefined && query.entity === undefined) {
    return answer("false", "no_target");
  }

  const targetEntity =
    event === undefined
      ? query.entity === undefined
        ? undefined
        : snapshot.entities[query.entity]
      : snapshot.entities[event.entity];
  if (targetEntity === undefined) {
    return answer("false", "no_such_entity");
  }
  // A shut container hides what is inside it, however deep; hearing and smell do not care.
  if (query.sense === "sight" && closedEnclosure(snapshot, targetEntity.id) !== null) {
    return answer("false", "enclosed");
  }

  const observerLocation = observer.location;
  const targetLocation = event === undefined ? targetEntity.location : eventLocation(snapshot, event);
  if (observerLocation === null || targetLocation === null) {
    return answer("false", "not_perceptible");
  }
  // Hearing and smell cross a doorway whether it is open or not, and ignore shut containers.
  const crossesDoors = query.sense === "hearing" || query.sense === "smell";
  if (observerLocation === targetLocation) {
    if (crossesDoors) {
      return answer("true", "same_location");
    }
    if (query.sense === "sight") {
      const location = snapshot.entities[observerLocation];
      return location?.props.lit === true
        ? answer("true", "same_location_lit")
        : answer("false", "location_unlit");
    }
    return answer("false", "unsupported_sense");
  }

  if (query.sense === "sight") {
    const connected = connectedByDoor(snapshot, observerLocation, targetLocation, true);
    const observerRoom = snapshot.entities[observerLocation];
    const targetRoom = snapshot.entities[targetLocation];
    const bothLit = observerRoom?.props.lit === true && targetRoom?.props.lit === true;
    return connected && bothLit
      ? answer("true", "adjacent_open_door_lit")
      : answer("false", connected ? "location_unlit" : "not_perceptible");
  }
  if (crossesDoors) {
    return connectedByDoor(snapshot, observerLocation, targetLocation, false) && loudEvent(event)
      ? answer("true", "adjacent_loud_event")
      : answer("false", "not_perceptible");
  }
  return answer("false", "unsupported_sense");
}

export function query(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  events: WorldEvent[],
  q: Query,
): Answer {
  return q.kind === "fact" ? fact(snapshot, q) : perceive(snapshot, registry, events, q);
}
