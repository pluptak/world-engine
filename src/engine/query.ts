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

function eventLocation(event: WorldEvent, fallback: Entity): Id | null {
  const location = event.data.location;
  if (typeof location === "string") {
    return location;
  }
  return fallback.location;
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

// One sense in one situation, as the sense table in docs/perception.md reads it: `same` decides the
// observer's own room, `door` decides across a doorway, and `basis` is what a false answer says when
// nothing about where the observer stands is wrong.
interface Sense {
  same: "always" | "odorous" | "never";
  door: "loud" | "never";
  basis: string;
}

interface EventSenses {
  hearing: Sense;
  smell: Sense;
  // Touch reads the body, not the room: `body` feels what the observer is and holds, and every
  // other class answers who wrote it.
  touch: "body" | "never";
}

// An event that happened: heard next door, smelt nowhere.
const QUIET_SENSES: EventSenses = {
  hearing: { same: "always", door: "loud", basis: "odourless" },
  smell: { same: "never", door: "never", basis: "odourless" },
  touch: "body",
};

// The world author's own work: nobody senses it, and `basis` says why.
const AUTHORED_SENSES: EventSenses = {
  hearing: { same: "never", door: "never", basis: "authored" },
  smell: { same: "never", door: "never", basis: "authored" },
  touch: "never",
};

// A pour releases what it pours, whatever is left in the vessel.
const POUR_SENSES: EventSenses = {
  hearing: QUIET_SENSES.hearing,
  smell: { same: "always", door: "never", basis: "odourless" },
  touch: "body",
};

// A break releases what was inside, so it is smelt when the broken entity smelled.
const BROKEN_SENSES: EventSenses = {
  hearing: QUIET_SENSES.hearing,
  smell: { same: "odorous", door: "loud", basis: "odourless" },
  touch: "body",
};

// The entity form: no event, so nothing is ever loud, and what there is to smell is the entity.
const ENTITY_SENSES: EventSenses = {
  hearing: { same: "always", door: "never", basis: "odourless" },
  smell: { same: "odorous", door: "never", basis: "odourless" },
  touch: "body",
};

// The rows of the sense table, keyed by every event type the engine can emit: a verb's root event
// carries the verb's name, and everything else is named where it is emitted. A type that is not
// listed here is one this build does not know — a foreign or hand-written events file — and is read
// like the `event` row, which is what it would be if the engine had emitted it. `tests/senses.test.ts`
// walks this table against the catalog and the sources, so a new type is added here on purpose.
export const EVENT_SENSES: Readonly<Record<string, EventSenses>> = {
  // A thing that happened: every verb's root event but a pour's and an edit's, and the physical
  // events a verb or the resolver emits.
  move: QUIET_SENSES,
  take: QUIET_SENSES,
  drop: QUIET_SENSES,
  put: QUIET_SENSES,
  give: QUIET_SENSES,
  open: QUIET_SENSES,
  close: QUIET_SENSES,
  lock: QUIET_SENSES,
  unlock: QUIET_SENSES,
  push: QUIET_SENSES,
  pull: QUIET_SENSES,
  attack: QUIET_SENSES,
  wait: QUIET_SENSES,
  search: QUIET_SENSES,
  moved: QUIET_SENSES,
  dropped: QUIET_SENSES,
  displaced: QUIET_SENSES,
  damaged: QUIET_SENSES,
  destroyed: QUIET_SENSES,
  detached: QUIET_SENSES,
  capability_changed: QUIET_SENSES,
  // The openable verbs name their event as data rather than at the call.
  opened: QUIET_SENSES,
  closed: QUIET_SENSES,
  locked: QUIET_SENSES,
  unlocked: QUIET_SENSES,
  // A spawn the physics made — a break product, a severed part — is an event like any other; only a
  // spawn the world wrote joins the authored row, which isAuthored decides from the cause.
  spawned: QUIET_SENSES,
  revealed: QUIET_SENSES,
  found: QUIET_SENSES,
  // A pour releases what it pours.
  pour: POUR_SENSES,
  poured: POUR_SENSES,
  // A spill releases what the fall shook loose, smelled like a pour.
  spilled: POUR_SENSES,
  // A break releases what was inside, so it is smelt when the broken entity smelled.
  broken: BROKEN_SENSES,
  // What the world writes.
  edit: AUTHORED_SENSES,
  placed: AUTHORED_SENSES,
  edited: AUTHORED_SENSES,
  removed: AUTHORED_SENSES,
};

// Whether the world authored this event. It is decided from the event's own type and one step up its
// cause chain, never from an actor: the events list carries no author, and an edit's spawns hang off
// the `edit` event that wrote them.
function isAuthored(event: WorldEvent, events: WorldEvent[]): boolean {
  if (EVENT_SENSES[event.type] === AUTHORED_SENSES) {
    return true;
  }
  if (event.type !== "spawned" || event.cause_id === null) {
    return false;
  }
  const cause = events.find((candidate) => candidate.event_id === event.cause_id);
  return cause !== undefined && EVENT_SENSES[cause.type] === AUTHORED_SENSES;
}

function sensesFor(event: WorldEvent | undefined, events: WorldEvent[]): EventSenses {
  if (event === undefined) {
    return ENTITY_SENSES;
  }
  // A spawn the world wrote reads as authored, wherever its row would otherwise point.
  if (isAuthored(event, events)) {
    return AUTHORED_SENSES;
  }
  return EVENT_SENSES[event.type] ?? QUIET_SENSES;
}

// Whether the observer feels the subject through its body: the subject is the observer itself,
// or sits in one of the observer's grips. Pockets don't feel, and rooms, light and doors play
// no part, so this is the whole of touch, in either form.
function touchesBody(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  observerId: Id,
  subject: Entity,
): boolean {
  if (subject.id === observerId) {
    return true;
  }
  if (subject.contained_in !== observerId || subject.in_part === null) {
    return false;
  }
  const template = registry[snapshot.entities[observerId]?.template ?? ""];
  return (
    template?.parts.some((part) => part.name === subject.in_part && part.holds?.kind === "grip") ===
    true
  );
}

// What an entity offers the nose: a liquid it holds, or residue spilled on it.
function smells(subject: Entity): boolean {
  const material = subject.props.liquid_material;
  if (typeof material === "string" && material.length > 0) {
    return true;
  }
  return Object.keys(subject.residue).some((name) => (subject.residue[name] ?? 0) > 0);
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

  // What the world writes is not something that happened in front of anybody: no sense reports it,
  // and its consequences, which did happen, are events of their own. It is read from the event's own
  // type and one step up its cause chain, never from an actor, and before the sight rules below.
  const authored = event !== undefined && isAuthored(event, events);
  const named =
    event === undefined
      ? query.entity === undefined
        ? undefined
        : snapshot.entities[query.entity]
      : snapshot.entities[event.entity];
  if (named === undefined) {
    // A `removed` event names an entity that is no longer there to be sensed; what made it is that
    // the world wrote it.
    return authored ? answer("false", "authored") : answer("false", "no_such_entity");
  }
  // A `found` event is where the search happened, not what was under it: it is read against the
  // concealer, so whoever can see where it was looked for can see that it was found there.
  const subject =
    event !== undefined && event.type === "found" && typeof event.data.concealer === "string"
      ? (snapshot.entities[event.data.concealer] ?? named)
      : named;
  // An abstract entity exists and is not a thing to be sensed: it is false in either form, the
  // entity and the event alike. That is a stronger claim about the subject than who wrote the event.
  if (isAbstract(registry, subject)) {
    return answer("false", "abstract");
  }
  if (authored) {
    return answer("false", "authored");
  }
  // Touch reads the body instead of the room: the table says which classes can be felt at all,
  // and the body rule says whether this observer felt this one.
  if (query.sense === "touch") {
    if (sensesFor(event, events).touch !== "body") {
      return answer("false", "authored");
    }
    return touchesBody(snapshot, registry, observer.id, subject)
      ? answer("true", "own_body")
      : answer("false", "not_touching");
  }
  // What is hidden under or behind something is not seen, by anybody, until the relation is broken.
  if (query.sense === "sight" && subject.concealed_by !== null) {
    return answer("false", "concealed");
  }
  // A shut container hides what is inside it, however deep; hearing and smell do not care.
  if (query.sense === "sight" && closedEnclosure(snapshot, subject.id) !== null) {
    return answer("false", "enclosed");
  }

  const observerLocation = observer.location;
  let targetLocation = event === undefined ? subject.location : eventLocation(event, subject);
  targetLocation = targetLocationForPerception(subject, targetLocation, observerLocation);
  if (observerLocation === null || targetLocation === null) {
    return answer("false", "not_perceptible");
  }
  const crossesDoors = query.sense === "hearing" || query.sense === "smell";
  const rule = sensesFor(event, events);
  // The rule has a column for each of the two senses that read it, and only those two come this far.
  const sense = query.sense === "hearing" ? rule.hearing : rule.smell;
  if (observerLocation === targetLocation) {
    if (crossesDoors) {
      if (sense.same === "always" || (sense.same === "odorous" && smells(subject))) {
        return answer("true", "same_location");
      }
      return answer("false", sense.basis);
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
    return connectedByDoor(snapshot, observerLocation, targetLocation, false) &&
      sense.door === "loud" &&
      loudEvent(event)
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
  const senses = ["sight", "hearing", "smell", "touch"];
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
    const seen: Record<string, Id[]> = { sight: [], hearing: [], smell: [], touch: [] };
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
        touch: seen.touch ?? [],
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
