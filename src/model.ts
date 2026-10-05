export type Id = string;
export type Tri = "true" | "false" | "unknown";

// Structured refusal data: ints and id strings only, never prose.
export type ReasonData = Record<string, number | string>;

export interface Pos {
  x: number;
  y: number;
}

export interface PartState {
  integrity: number;
  status: "intact" | "damaged" | "detached" | "destroyed";
}

export interface Modifier {
  capacity: string;
  delta: number;
  expires_at_tick: number | null;
  cause_id: Id;
}

export interface Entity {
  id: Id;
  template: string;
  name: string;
  aliases: string[];
  location: Id | null;
  support: Id | null;
  contained_in: Id | null;
  // The holder's part the entity is in, when its holder declares holder parts: a grip holds one
  // item (a two-handed item also occupies the lowest other grip, derived, never stored), a space
  // holds what fits. Null everywhere else, including inside plain containers.
  in_part: string | null;
  // What the entity is hidden under or behind. Sight cannot see past it; moving either end clears it.
  concealed_by: Id | null;
  pos: Pos | null;
  detached_from: { entity: Id; part: string } | null;
  integrity: number;
  status: "intact" | "broken" | "destroyed";
  parts: Record<string, PartState>;
  residue: Record<string, number>;
  modifiers: Modifier[];
  props: Record<string, number | string | boolean>;
}

export interface Coverage {
  relations: string[];
  senses: string[];
  properties: string[];
}

export function defaultCoverage(): Coverage {
  return {
    relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
    senses: ["sight", "hearing"],
    properties: ["integrity", "residue", "pos"],
  };
}

export interface Snapshot {
  version: number;
  tick: number;
  next_seq: number;
  templates_hash: string;
  coverage: Coverage;
  entities: Record<Id, Entity>;
}

export interface WorldEvent {
  event_id: Id;
  cause_id: Id | null;
  command_id: Id;
  type: string;
  entity: Id;
  data: Record<string, unknown>;
  perceivers?: Perceivers;
}

// The batch form of perceive, per event: the agents that sensed it through each covered sense.
// Senses the world's coverage does not declare cannot sense, so they are named, not mapped.
export interface Perceivers {
  sight: Id[];
  hearing: Id[];
  smell: Id[];
  unknown_senses: string[];
}

export interface Delta {
  event_id: Id;
  entity: Id;
  field: string;
  from: unknown;
  to: unknown;
}

export type Status =
  | "ok"
  | "refused"
  | "ambiguous"
  | "unresolved"
  | "preempted"
  | "invalid";
