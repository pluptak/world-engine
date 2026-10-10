import type { BeatAction, BeatChild, BeatCondition, BeatRepeat } from "./engine/command.js";

export type Id = string;
export type Tri = "true" | "false" | "unknown";

// A lookup of a string that came from outside in a record keyed by ids, templates or names: only the
// record's own keys count, so `constructor` or `__proto__` find nothing instead of a member of
// Object.prototype.
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

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
  // What only describes the thing, as opaque tokens no rule reads (`docs/state.md`). Absent when empty.
  traits?: Record<string, string>;
}

export interface Coverage {
  relations: string[];
  senses: string[];
  properties: string[];
}

export function defaultCoverage(): Coverage {
  return {
    relations: ["support", "contained_in", "attached_to", "status", "location", "near", "reachable"],
    senses: ["sight", "hearing"],
    properties: ["integrity", "residue", "pos", "open"],
  };
}

// Something the world will do by itself at `due_tick`, named by the event that set it going. A
// bleed carries how many bleeds are left, this one included; each schedules the next.
export type ScheduledCause =
  // `cause_id` is null for a door a scenario placed open: nothing opened it.
  | { due_tick: number; kind: "close"; entity: Id; cause_id: Id | null }
  | { due_tick: number; kind: "bleed"; entity: Id; cause_id: Id; remaining: number }
  // A template's process, running on the entity; `cause_id` is null when the initial state started it.
  | { due_tick: number; kind: "process"; entity: Id; cause_id: Id | null; process: string }
  // An authored beat (`engine/beats.ts`): `entity` is the action's subject, `cause_id` the event of the
  // `schedule_beat` edit, or of the parent beat's action for a chained one; null for one a scene queued.
  | {
      due_tick: number;
      kind: "beat";
      entity: Id;
      cause_id: Id | null;
      id: string;
      action: BeatAction;
      only_if?: BeatCondition;
      then?: BeatChild[];
      // Runs still to come after this one, `every_ticks` apart; absent on the last.
      repeat?: BeatRepeat;
    };

// A scene's run (`engine/scene.ts`, `docs/run.md`): the tick the clock may not pass, the agents whose
// bodies the run turns on, and its state. Absent for a world that is not a run; `ended` only once ended.
export type RunState = "registering" | "running" | "ended";

export interface RunEnd {
  reason: "director" | "tick_limit" | "no_live_players";
  tick: number;
}

export interface Run {
  tick_limit?: number;
  slots?: Id[];
  state: RunState;
  ended?: RunEnd;
}

export interface Snapshot {
  version: number;
  tick: number;
  next_seq: number;
  templates_hash: string;
  coverage: Coverage;
  entities: Record<Id, Entity>;
  // Ordered by due tick, then by when each was scheduled; absent when nothing is pending.
  schedule?: ScheduledCause[];
  run?: Run;
  // The dice's 32-bit state (`engine/rng.ts`); absent in a world that was never given a seed.
  rng?: number;
}

export interface WorldEvent {
  event_id: Id;
  cause_id: Id | null;
  command_id: Id;
  // When it happened: the command's starting tick for the verb's own events, the tick something
  // fell due for what the clock does on the way.
  tick: number;
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
  touch: Id[];
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
