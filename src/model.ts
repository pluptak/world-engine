export type Id = string;
export type Tri = "true" | "false" | "unknown";

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
