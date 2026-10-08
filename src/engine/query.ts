import { capacity } from "./capacity.js";
import { canonicalJson } from "./canonical.js";
import { effectivePos } from "./geometry.js";
import type { Entity, Id, Perceivers, Pos, Snapshot, Tri, WorldEvent } from "../model.js";
import type { TemplateRegistry } from "../templates.js";
import { closedEnclosure, inReach, isAgent, reachedAsDoor } from "./verbs/address.js";
import { isAbstract } from "./resolve.js";
import { effectivePart } from "./parts.js";
import { computesSense } from "./capabilities.js";

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
  registry: TemplateRegistry,
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
        const template = registry[entity.template];
        return (template?.parts ?? []).some((decl) => {
          const part = effectivePart(template, entity, decl.name);
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
      const part =
        typeof partName === "string"
          ? effectivePart(registry[entity.template], entity, partName)
          : undefined;
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

function fact(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  query: Extract<Query, { kind: "fact" }>,
): Answer {
  const entity = snapshot.entities[query.subject];
  if (entity === undefined) {
    return partFact(snapshot, registry, query);
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
    // Whether the subject could lay a hand on the object now, by the same rule every verb that
    // reaches applies, so the answer cannot drift from what `take` or `give` would decide.
    if (query.relation === "reachable") {
      if (query.object === undefined) {
        return answer("false", "no_object");
      }
      if (snapshot.entities[query.object] === undefined) {
        return answer("false", "no_such_entity");
      }
      return answer(inReach(snapshot, entity.id, query.object) ? "true" : "false", "derived_reach");
    }
    return answer(relationValue(registry, entity, query.relation, query.object) ? "true" : "false", "relation_state");
  }
  if (snapshot.coverage.properties.includes(query.relation)) {
    const value = propertyValue(entity, query.relation);
    return answer(propertyMatches(value, query.object, query.relation) ? "true" : "false", "property_state");
  }
  return answer("unknown", "uncovered_category");
}

// A fact about one part, addressed `<entity>.<part>`: its status, its integrity, and whether it is
// still attached to its entity, read from the stored entry or the template default. A part is not
// an entity, so every other field is false with `not_a_part_field`. Nothing is written.
function partFact(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  query: Extract<Query, { kind: "fact" }>,
): Answer {
  const separator = query.subject.lastIndexOf(".");
  const entity = separator > 0 ? snapshot.entities[query.subject.slice(0, separator)] : undefined;
  if (entity === undefined) {
    return answer("false", "no_such_entity");
  }
  const state = effectivePart(registry[entity.template], entity, query.subject.slice(separator + 1));
  if (state === undefined) {
    return answer("false", "no_such_part");
  }
  const relation = snapshot.coverage.relations.includes(query.relation);
  if (!relation && !snapshot.coverage.properties.includes(query.relation)) {
    return answer("unknown", "uncovered_category");
  }
  const attached = state.status !== "detached" && state.status !== "destroyed";
  switch (relation ? query.relation : `property ${query.relation}`) {
    case "status":
      return answer(query.object === undefined || state.status === query.object ? "true" : "false", "part_state");
    case "attached_to":
      return answer(attached && (query.object === undefined || query.object === entity.id) ? "true" : "false", "part_state");
    case "property integrity":
      return answer(propertyMatches(state.integrity, query.object, "integrity") ? "true" : "false", "part_state");
    default:
      return answer("false", "not_a_part_field");
  }
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

// Whether a room is lit: it says so itself, or something burning in it gives light. A burning light
// counts wherever it is in the room (on the floor, on a table, in a hand or a pocket) but not shut
// away in a closed container, and not once destroyed. Nothing stores the answer.
export function isLit(snapshot: Snapshot, roomId: Id): boolean {
  const room = snapshot.entities[roomId];
  if (room === undefined) {
    return false;
  }
  if (room.props.lit === true) {
    return true;
  }
  return Object.values(snapshot.entities).some(
    (entity) =>
      entity.location === roomId &&
      entity.props.light_source === true &&
      entity.props.burning === true &&
      entity.status !== "destroyed" &&
      closedEnclosure(snapshot, entity.id) === null,
  );
}

function loudEvent(event: WorldEvent | undefined): boolean {
  if (event === undefined) {
    return false;
  }
  return (
    event.type === "broken" ||
    event.type === "detached" ||
    (event.type === "sounded" && event.data.loud === true) ||
    (event.type === "say" && event.data.volume === "shout") ||
    (event.type === "dropped" && typeof event.data.fall_cm === "number" && event.data.fall_cm >= 50)
  );
}

// One sense in one situation, as the sense table in docs/perception.md reads it: `same` decides the
// observer's own room, `door` decides across a doorway, and `basis` is what a false answer says when
// nothing about where the observer stands is wrong.
interface Sense {
  same: "always" | "odorous" | "never" | "volume";
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

// An event that happened: heard in the room and, when loud, next door; smelt nowhere.
const AUDIBLE_SENSES: EventSenses = {
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

// A knock, a bang, a bell: heard in the room and, when loud, next door; a sound is never seen.
const SOUNDED_SENSES: EventSenses = {
  hearing: AUDIBLE_SENSES.hearing,
  smell: { same: "never", door: "never", basis: "odourless" },
  touch: "never",
};

// Speech is heard by volume: a whisper only near the speaker, normal speech through the room, a
// shout across a doorway too. The words are not seen, but the speaking is, as any event is.
const SAY_SENSES: EventSenses = {
  hearing: { same: "volume", door: "loud", basis: "too_far" },
  smell: { same: "never", door: "never", basis: "odourless" },
  touch: "body",
};

// A pour releases what it pours, whatever is left in the vessel.
const POUR_SENSES: EventSenses = {
  hearing: AUDIBLE_SENSES.hearing,
  smell: { same: "always", door: "never", basis: "odourless" },
  touch: "body",
};

// A hand act makes no sound the ear reports: the hand verbs and what they cause, waits, and a
// body's own capacity changes. Footsteps, pushes, falls, breaks, spills, attacks and the openable verbs
// stay audible; sight, smell and touch read these rows exactly as before.
const SILENT_SENSES: EventSenses = {
  hearing: { same: "never", door: "never", basis: "quiet" },
  smell: AUDIBLE_SENSES.smell,
  touch: "body",
};

// A break releases what was inside, so it is smelt when the broken entity smelled.
const BROKEN_SENSES: EventSenses = {
  hearing: AUDIBLE_SENSES.hearing,
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
  move: AUDIBLE_SENSES,
  take: SILENT_SENSES,
  drop: AUDIBLE_SENSES,
  put: SILENT_SENSES,
  give: SILENT_SENSES,
  open: AUDIBLE_SENSES,
  close: AUDIBLE_SENSES,
  lock: AUDIBLE_SENSES,
  unlock: AUDIBLE_SENSES,
  push: AUDIBLE_SENSES,
  pull: AUDIBLE_SENSES,
  attack: AUDIBLE_SENSES,
  wait: SILENT_SENSES,
  // The author's clock: time passing for the world, which nobody senses; what it runs is sensed.
  advance: AUTHORED_SENSES,
  // A prop a template's process moved: seen like any event, never heard or smelt.
  changed: SILENT_SENSES,
  search: SILENT_SENSES,
  // Striking a flame or pinching one out is a hand act; the light it gives is read from the room.
  // Eating or drinking is a hand-and-mouth act the ear does not report.
  consume: SILENT_SENSES,
  consumed: SILENT_SENSES,
  light: SILENT_SENSES,
  douse: SILENT_SENSES,
  lit: SILENT_SENSES,
  doused: SILENT_SENSES,
  moved: AUDIBLE_SENSES,
  collided: AUDIBLE_SENSES,
  dropped: AUDIBLE_SENSES,
  displaced: AUDIBLE_SENSES,
  damaged: AUDIBLE_SENSES,
  destroyed: AUDIBLE_SENSES,
  detached: AUDIBLE_SENSES,
  capability_changed: SILENT_SENSES,
  // The openable verbs name their event as data rather than at the call.
  opened: AUDIBLE_SENSES,
  closed: AUDIBLE_SENSES,
  locked: AUDIBLE_SENSES,
  unlocked: AUDIBLE_SENSES,
  // A spawn the physics made — a break product, a severed part — is an event like any other; only a
  // spawn the world wrote joins the authored row, which isAuthored decides from the cause.
  spawned: AUDIBLE_SENSES,
  revealed: SILENT_SENSES,
  found: SILENT_SENSES,
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
  // An authored beat: a sound is heard, a skipped beat is the author's bookkeeping.
  sounded: SOUNDED_SENSES,
  say: SAY_SENSES,
  beat_skipped: AUTHORED_SENSES,
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
  return EVENT_SENSES[event.type] ?? AUDIBLE_SENSES;
}

// Whether a `moved` was caused by a hand act: the cause chain is walked to its root, and a take,
// give or put at the bottom silences it. A chain that names nothing is read as footsteps.
function handCaused(event: WorldEvent, events: WorldEvent[]): boolean {
  let current = event;
  for (;;) {
    if (current.cause_id === null) {
      return current.type === "take" || current.type === "give" || current.type === "put";
    }
    const parent = events.find((candidate) => candidate.event_id === current.cause_id);
    if (parent === undefined) {
      return false;
    }
    current = parent;
  }
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

// Whether speech at its volume reaches this observer in the speaker's room: a whisper only within
// `NEAR_THRESHOLD_CM` of the speaker (both positions known), anything louder the whole room. A
// speaker hears their own.
function heardAtVolume(snapshot: Snapshot, observer: Entity, speaker: Entity, event: WorldEvent | undefined): boolean {
  if (event?.data.volume !== "whisper" || observer.id === speaker.id) {
    return true;
  }
  const here = effectivePos(snapshot, observer.id);
  const there = effectivePos(snapshot, speaker.id);
  return here !== null && there !== null && withinThreshold(here, there);
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
  // Both unknown, for different reasons: a sense the engine has no rule for, or one this world
  // chose not to model.
  if (!computesSense(query.sense)) {
    return answer("unknown", "engine_incapable");
  }
  if (!snapshot.coverage.senses.includes(query.sense)) {
    return answer("unknown", "uncovered_sense");
  }
  // A destroyed body senses nothing, whatever its parts: the same end that stops it acting.
  if (observer.status === "destroyed") {
    return answer("false", "observer_destroyed");
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
    // A collision is felt by what was hit as much as by what moved.
    const struck =
      event?.type === "collided" && typeof event.data.with === "string"
        ? snapshot.entities[event.data.with]
        : undefined;
    return touchesBody(snapshot, registry, observer.id, subject) ||
      (struck !== undefined && touchesBody(snapshot, registry, observer.id, struck))
      ? answer("true", "own_body")
      : answer("false", "not_touching");
  }
  // A sound is heard, never seen, wherever the observer stands.
  if (query.sense === "sight" && event?.type === "sounded") {
    return answer("false", "unseen");
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
  // A `moved` the hands caused is as silent as the act behind it: footsteps stay audible, and the
  // door never carries what the room itself does not hear.
  if (
    query.sense === "hearing" &&
    event !== undefined &&
    event.type === "moved" &&
    handCaused(event, events)
  ) {
    return answer("false", "quiet");
  }
  // The rule has a column for each of the two senses that read it, and only those two come this far.
  const sense = query.sense === "hearing" ? rule.hearing : rule.smell;
  if (observerLocation === targetLocation) {
    if (crossesDoors) {
      if (
        sense.same === "always" ||
        (sense.same === "odorous" && smells(subject)) ||
        (sense.same === "volume" && heardAtVolume(snapshot, observer, subject, event))
      ) {
        return answer("true", "same_location");
      }
      return answer("false", sense.basis);
    }
    if (query.sense === "sight") {
      return isLit(snapshot, observerLocation)
        ? answer("true", "same_location_lit")
        : answer("false", "location_unlit");
    }
    throw new TypeError(`No rule for sense ${query.sense}`);
  }

  if (query.sense === "sight") {
    const connected = connectedByDoor(snapshot, observerLocation, targetLocation, true);
    const bothLit = isLit(snapshot, observerLocation) && isLit(snapshot, targetLocation);
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
  // Only senses the engine computes get this far (`computesSense`), and each has a rule above.
  throw new TypeError(`No rule for sense ${query.sense}`);
}

export function query(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  events: WorldEvent[],
  q: Query,
): Answer {
  return q.kind === "fact" ? fact(snapshot, registry, q) : perceive(snapshot, registry, events, q);
}

// What an agent can name in a command: itself, the room it stands in, what it senses now by a
// covered sight, smell or touch (as `observe` lists it), or what it could grope for, in reach and
// neither hidden nor shut away. A door has no position and is groped for from either room it joins.
// A hidden thing stays unnamed, by id too, until what hides it moves: nothing records that a search
// found it, and ids are sequential, so an id alone would let anyone in reach guess it out of hiding.
// Anything else resolves as though it did not exist, so no candidate list or refusal names it.
export function addressable(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  actorId: Id,
  entityId: Id,
): boolean {
  const actor = snapshot.entities[actorId];
  const entity = snapshot.entities[entityId];
  if (actor === undefined || entity === undefined) {
    return false;
  }
  if (entityId === actorId || entityId === actor.location) {
    return true;
  }
  const sensed = ["sight", "smell", "touch"].some(
    (sense) =>
      snapshot.coverage.senses.includes(sense) &&
      perceive(snapshot, registry, [], { kind: "perceive", observer: actorId, entity: entityId, sense })
        .value === "true",
  );
  return sensed || gropable(snapshot, actorId, entityId);
}

// The half of `addressable` that needs no senses and no templates: what the actor could grope for.
// A caller that already holds the actor's projection has the other half in its `entities`.
export function gropable(snapshot: Snapshot, actorId: Id, entityId: Id): boolean {
  const actor = snapshot.entities[actorId];
  const entity = snapshot.entities[entityId];
  if (actor === undefined || entity === undefined) {
    return false;
  }
  if (entity.concealed_by !== null || closedEnclosure(snapshot, entityId) !== null) {
    return false;
  }
  return reachedAsDoor(snapshot, actorId, entity) || inReach(snapshot, actorId, entityId);
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

// Whether any of these observers could sense any of `fresh`, by the rule `eventPerceivers` applies:
// a covered sense answers true before or after. `events` is every event of the command so far, for
// perceive to find them in; an observer absent from a snapshot is not asked of it.
export function sensedBy(
  before: Snapshot,
  after: Snapshot,
  registry: TemplateRegistry,
  events: readonly WorldEvent[],
  fresh: readonly WorldEvent[],
  observers: readonly Id[],
): boolean {
  const senses = ["sight", "hearing", "smell", "touch"].filter((sense) => after.coverage.senses.includes(sense));
  const all = [...events];
  for (const event of fresh) {
    for (const observer of observers) {
      for (const sense of senses) {
        for (const snapshot of [before, after]) {
          if (
            snapshot.entities[observer] !== undefined &&
            perceive(snapshot, registry, all, { kind: "perceive", observer, event_id: event.event_id, sense }).value === "true"
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
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
