import { effectivePos } from "./geometry.js";
import { effectivePart } from "./parts.js";
import { inReach } from "./verbs/address.js";
import { query } from "./query.js";
import type { Id, PartState, Pos, Snapshot, WorldEvent } from "../model.js";
import type { TemplateRegistry } from "../templates.js";

import { ENGINE_CAPABILITIES } from "./capabilities.js";

export const SENSES = ENGINE_CAPABILITIES.senses;

// What an observer could sense of one entity now. A thing makes no sound by being there, so an
// entity is listed by sight, smell and touch, and hearing is reported for events only. `facts`
// exists only when the entity is seen or felt: smell says that something is there, not how it
// stands. Within `facts`, a field is present when coverage declares it; a reference names another
// observed entity, the observer's own room, or is null, and a reference to anything else is left
// out rather than leaked.
export interface ObservedEntity {
  id: Id;
  template: string;
  name: string;
  senses: string[];
  facts?: {
    location?: Id | null;
    support?: Id | null;
    contained_in?: Id | null;
    in_part?: string | null;
    status?: string;
    integrity?: number;
    residue?: Record<string, number>;
    pos?: Pos | null;
  };
}

// An event names its entity when the observer sensed it by sight, smell or touch, which tell what it
// was. One only heard says where the sound came from instead, `from`, and names nobody: a voice in the
// dark carries no identity, and the source of a footstep is not told because it is in the world.
export type HeardFrom = "here" | "next_door";

export interface ObservedEvent {
  event_id: Id;
  tick: number;
  type: string;
  entity?: Id;
  from?: HeardFrom;
  senses: string[];
  // A speech act's token and volume, present only when the observer heard it: one who only saw the
  // speaker has the event and the sense `sight`, and not what was said.
  utterance?: string;
  volume?: string;
}

// Where a sound came from, by the basis of the hearing that is true: the observer's own room, or
// through a doorway. Any other basis for a true hearing is a rule this table does not know.
export function heardFrom(basis: string): HeardFrom {
  if (basis === "same_location") {
    return "here";
  }
  if (basis === "adjacent_loud_event") {
    return "next_door";
  }
  throw new TypeError(`Hearing is true with basis ${basis}`);
}

export interface Projection {
  observer: Id;
  version: number;
  unknown_senses: string[];
  entities: ObservedEntity[];
  events: ObservedEvent[];
}

// The entity half of a projection, from one snapshot. Every answer is `perceive`'s own, so a
// projection can never say more than the queries it is made of.
export function observeEntities(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  events: WorldEvent[],
  observer: Id,
): ObservedEntity[] {
  const covered = SENSES.filter(
    (sense) => sense !== "hearing" && snapshot.coverage.senses.includes(sense),
  );
  const sensed = new Map<Id, string[]>();
  for (const id of Object.keys(snapshot.entities).sort()) {
    const senses = covered.filter(
      (sense) =>
        query(snapshot, registry, events, { kind: "perceive", observer, entity: id, sense }).value ===
        "true",
    );
    if (senses.length > 0) {
      sensed.set(id, senses);
    }
  }

  const relations = snapshot.coverage.relations;
  const properties = snapshot.coverage.properties;
  const here = snapshot.entities[observer]?.location ?? null;
  const reference = (id: Id | null): Id | null | undefined =>
    id === null ? null : sensed.has(id) || id === here ? id : undefined;

  return [...sensed.entries()].map(([id, senses]) => {
    const entity = snapshot.entities[id];
    if (entity === undefined) {
      throw new TypeError(`Unknown entity ${id}`);
    }
    const observed: ObservedEntity = { id, template: entity.template, name: entity.name, senses };
    if (!senses.includes("sight") && !senses.includes("touch")) {
      return observed;
    }
    const facts: NonNullable<ObservedEntity["facts"]> = {};
    const link = (field: "location" | "support" | "contained_in", value: Id | null): void => {
      const shown = reference(value);
      if (relations.includes(field) && shown !== undefined) {
        facts[field] = shown;
      }
    };
    link("location", entity.location);
    link("support", entity.support);
    link("contained_in", entity.contained_in);
    // Which hand or pocket rides with the holder it names: no holder shown, no part shown.
    if (facts.contained_in !== undefined) {
      facts.in_part = entity.in_part;
    }
    if (relations.includes("status")) {
      facts.status = entity.status;
    }
    if (properties.includes("integrity")) {
      facts.integrity = entity.integrity;
    }
    if (properties.includes("residue")) {
      facts.residue = { ...entity.residue };
    }
    if (properties.includes("pos")) {
      facts.pos = effectivePos(snapshot, id);
    }
    observed.facts = facts;
    return observed;
  });
}

// One part of a body as it stands: its status, which is the part's own unless an ancestor is detached or
// destroyed and it went with it, and its integrity where coverage declares that property.
export interface PartView {
  name: string;
  status: PartState["status"];
  integrity?: number;
}

// The parts of a body whose template declares some, in declaration order, as an observer who sees or
// feels it could tell. Part status is a fact like an entity's `status`, so a world that does not cover
// that relation shows no parts. The caller has already established the sight or touch.
export function bodyParts(snapshot: Snapshot, registry: TemplateRegistry, entityId: Id): PartView[] | undefined {
  const entity = snapshot.entities[entityId];
  const template = entity === undefined ? undefined : registry[entity.template];
  if (entity === undefined || template === undefined || template.parts.length === 0) {
    return undefined;
  }
  if (!snapshot.coverage.relations.includes("status")) {
    return undefined;
  }
  const withIntegrity = snapshot.coverage.properties.includes("integrity");
  return template.parts.map((decl) => {
    const state = effectivePart(template, entity, decl.name)!;
    return { name: decl.name, status: state.status, ...(withIntegrity && { integrity: state.integrity }) };
  });
}

// The parts of a body the observer sees or feels now, or undefined: its sight and touch are the
// senses that tell how a thing stands, as in `observe`.
export function visibleParts(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  observer: Id,
  entityId: Id,
): PartView[] | undefined {
  const entity = snapshot.entities[entityId];
  if (entity === undefined || (registry[entity.template]?.parts.length ?? 0) === 0) {
    return undefined;
  }
  const feels = ["sight", "touch"].some(
    (sense) =>
      snapshot.coverage.senses.includes(sense) &&
      query(snapshot, registry, [], { kind: "perceive", observer, entity: entityId, sense }).value === "true",
  );
  return feels ? bodyParts(snapshot, registry, entityId) : undefined;
}

// One entity in more detail than `observe` lists it, for a controller asking about a single thing:
// the same senses and facts, plus the props the world covers as properties (`open`, `locked`,
// `liquid_amount`, ... whatever coverage names), whether the observer could reach it, and what it
// visibly holds or carries. Null when the observer senses nothing of it. Props, holdings, the
// footprint (the template's `size_cm`, which positions are measured against) and a body's parts come
// only with sight or touch, as facts do.
export interface Inspection extends ObservedEntity {
  props?: Record<string, number | string | boolean>;
  size_cm?: { w: number; d: number; h: number };
  parts?: PartView[];
  reachable?: boolean;
  holds?: Id[];
}

export function inspectEntity(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  events: WorldEvent[],
  observer: Id,
  entityId: Id,
): Inspection | null {
  const observed = observeEntities(snapshot, registry, events, observer);
  const found = observed.find((candidate) => candidate.id === entityId);
  const entity = snapshot.entities[entityId];
  if (found === undefined || entity === undefined) {
    return null;
  }
  const inspection: Inspection = { ...found };
  if (snapshot.coverage.relations.includes("reachable")) {
    inspection.reachable = inReach(snapshot, observer, entityId);
  }
  if (found.facts === undefined) {
    return inspection;
  }
  const props: Record<string, number | string | boolean> = {};
  for (const key of Object.keys(entity.props).sort()) {
    if (snapshot.coverage.properties.includes(key)) {
      props[key] = entity.props[key]!;
    }
  }
  inspection.props = props;
  const size = registry[entity.template]?.size_cm;
  if (size !== undefined) {
    inspection.size_cm = { w: size.w, d: size.d, h: size.h };
  }
  const parts = bodyParts(snapshot, registry, entityId);
  if (parts !== undefined) {
    inspection.parts = parts;
  }
  inspection.holds = observed
    .filter((other) => other.facts?.contained_in === entityId || other.facts?.support === entityId)
    .map((other) => other.id);
  return inspection;
}
