import { capacity } from "./capacity.js";
import { canonicalJson } from "./canonical.js";
import { effectivePos } from "./geometry.js";
import type { Entity, Id, Perceivers, Pos, Snapshot, Tri, WorldEvent } from "../model.js";
import type { TemplateRegistry } from "../templates.js";
import { closedEnclosure, isAgent } from "./verbs/address.js";
import { isAbstract } from "./resolve.js";

// The one declared threshold for `near`: two positions in the same room this far apart or closer are
// near. Squared, because the arithmetic stays integer and no square root is ever taken.
export const NEAR_THRESHOLD_CM = 100;

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

// `near` is the one relation that is never stored: it is read off two positions every time it is
// asked, so a world can answer a proximity without ever having to claim one. Both sides need a
// position derivable through their support or containment chain, and the same room at the end of it.
function nearValue(snapshot: Snapshot, entity: Entity, other: Entity): boolean {
  if (entity.location === null || entity.location !== other.location) {
    return false;
  }
  const here = effectivePos(snapshot, entity.id);
  const there = effectivePos(snapshot, other.id);
  return here !== null && there !== null && withinThreshold(here, there);
}

function withinThreshold(here: Pos, there: Pos): boolean {
  const dx = here.x - there.x;
  const dy = here.y - there.y;
  return dx * dx + dy * dy <= NEAR_THRESHOLD_CM * NEAR_THRESHOLD_CM;
}

function fact(snapshot: Snapshot, query: Extract<Query, { kind: "fact" }>): Answer {
  const entity = snapshot.entities[query.subject];
  if (entity === undefined) {
    return answer("false", "no_such_entity");
  }
  if (snapshot.coverage.relations.includes(query.relation)) {
    if (query.relation === "near") {
      // Existence is modelled, so a bad object is false rather than unknown, and only the basis
      // says which of the two ways it failed.
      if (query.object === undefined) {
        return answer("false", "no_object");
      }
      const other = snapshot.entities[query.object];
      if (other === undefined) {
        return answer("false", "no_such_entity");
      }
      return answer(nearValue(snapshot, entity, other) ? "true" : "false", "derived_near");
    }
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

// A door with no location is in either room it connects; treat it as in the observer's room
// if they're in one of them, mirroring inViewOf in resolve.ts.
function targetLocationForPerception(
  targetEntity: Entity,
  targetLocation: Id | null,
  observerLocation: Id | null,
): Id | null {
  if (targetLocation !== null) {
    return targetLocation;
  }
  const from = targetEntity.props.from;
  const to = targetEntity.props.to;
  if (typeof from === "string" && typeof to === "string" && observerLocation === from) {
    return from;
  }
  if (typeof from === "string" && typeof to === "string" && observerLocation === to) {
    return to;
  }
  return null;
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
  // An abstract entity exists and is not a thing to be sensed: it is false in either form, the
  // entity and the event alike.
  if (isAbstract(registry, targetEntity)) {
    return answer("false", "abstract");
  }
  // A shut container hides what is inside it, however deep; hearing and smell do not care.
  if (query.sense === "sight" && closedEnclosure(snapshot, targetEntity.id) !== null) {
    return answer("false", "enclosed");
  }

  const observerLocation = observer.location;
  let targetLocation = event === undefined ? targetEntity.location : eventLocation(snapshot, event);
  targetLocation = targetLocationForPerception(targetEntity, targetLocation, observerLocation);
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

// Who could have sensed each event: every agent, every covered sense, true before or after the
// events' command — the caller passes both snapshots, as in item 5. An agent is listed exactly
// when perceive would answer true for it at either end.
export function eventPerceivers(
  before: Snapshot,
  after: Snapshot,
  registry: TemplateRegistry,
  events: WorldEvent[],
): Array<{ event_id: Id; perceivers: Perceivers }> {
  const senses = ["sight", "hearing", "smell"];
  const unknown_senses = senses.filter((sense) => !after.coverage.senses.includes(sense));
  // Agents at either end: a command can introduce an entity its own events are about.
  const agents = [...new Set([...Object.keys(before.entities), ...Object.keys(after.entities)])]
    .sort()
    .filter((id) => isAgent(after.entities[id] === undefined ? before : after, id));
  const sensed = (snapshot: Snapshot, observer: Id, event: Id, sense: string): boolean =>
    perceive(snapshot, registry, events, {
      kind: "perceive",
      observer,
      event_id: event,
      sense,
    }).value === "true";
  return events.map((event) => {
    const seen: Record<string, Id[]> = { sight: [], hearing: [], smell: [] };
    for (const observer of agents) {
      for (const sense of senses) {
        if (unknown_senses.includes(sense)) {
          continue;
        }
        if (
          sensed(before, observer, event.event_id, sense) ||
          sensed(after, observer, event.event_id, sense)
        ) {
          seen[sense]?.push(observer);
        }
      }
    }
    return {
      event_id: event.event_id,
      perceivers: {
        sight: seen.sight ?? [],
        hearing: seen.hearing ?? [],
        smell: seen.smell ?? [],
        unknown_senses: [...unknown_senses],
      },
    };
  });
}

// For event-form perceive: evaluate against both snapshot before and after the command that
// produced the event. Return true if true at either end, otherwise the after answer.
export function queryAtEvent(
  before: Snapshot,
  after: Snapshot,
  registry: TemplateRegistry,
  events: WorldEvent[],
  q: Extract<Query, { kind: "perceive" }>,
): Answer {
  const afterAnswer = perceive(after, registry, events, q);
  if (afterAnswer.value === "true") {
    return afterAnswer;
  }
  const beforeAnswer = perceive(before, registry, events, q);
  if (beforeAnswer.value === "true") {
    return beforeAnswer;
  }
  return afterAnswer;
}
