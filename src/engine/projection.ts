import { effectivePos } from "./geometry.js";
import { query } from "./query.js";
import type { Id, Pos, Snapshot, WorldEvent } from "../model.js";
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

export interface ObservedEvent {
  event_id: Id;
  type: string;
  entity: Id;
  senses: string[];
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
