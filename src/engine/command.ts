import type { Delta, Entity, Id, PartState, Pos, ReasonData, Snapshot, Status, WorldEvent } from "../model.js";
import type { EntityOverrides } from "./spawn.js";
import type { TemplateRegistry } from "../templates.js";
import type { Projection } from "./projection.js";

// The reserved author of direct world edits: causality, not state, so it never appears in entities.
export const WORLD_AUTHOR: Id = "world";

export interface SpawnEdit {
  kind: "spawn";
  template: string;
  overrides?: EntityOverrides;
}

export interface RemoveEdit {
  kind: "remove";
  target: Id;
}

// A position written against a named reference point rather than in centimetres: it resolves, when
// the world is written, to anchor.pos + (dx, dy) and the anchor's room as the holder. Nothing keeps
// the anchor afterwards, so it adds no relation.
export interface AnchorPos {
  anchor: Id | string;
  dx: number;
  dy: number;
}

export interface PlaceEdit {
  kind: "place";
  target: Id;
  support?: Id | null;
  contained_in?: Id | null;
  // The holder's part the entity sits in; null clears it. Omitted leaves it as it is.
  in_part?: string | null;
  // What the entity is hidden under or behind; null clears it. Omitted leaves it as it is.
  concealed_by?: Id | null;
  pos?: Pos | AnchorPos | null;
}

export interface PropsEdit {
  kind: "set_props";
  target: Id;
  props: Record<string, number | string | boolean>;
}

export interface PartEdit {
  kind: "set_part";
  target: Id;
  part: string;
  state: PartState;
}

export type WorldEdit = SpawnEdit | RemoveEdit | PlaceEdit | PropsEdit | PartEdit;

export interface Command {
  command_id: Id;
  actor: Id;
  verb: string;
  target?: string;
  args?: Record<string, unknown>;
  // Ask for the batch form of perceive: every event of an ok command names its perceivers.
  perceivers?: boolean;
}

export interface Result {
  status: Status;
  command_id: Id;
  resolved_target: Id | null;
  candidates?: Id[];
  reason_code?: string;
  reason_data?: ReasonData;
  snapshot: Snapshot;
  deltas: Delta[];
  events: WorldEvent[];
  // With `observe: true`: what the actor could sense afterwards, and which of this command's events.
  observation?: Projection;
}

// One submission as the world recorded it: what was tried, against which version, and how it came
// out. A store world keeps it as a log line; a failed one has no events and took no time.
export interface Attempt {
  command: Command;
  based_on_version: number;
  // The world's version when the command was decided; an ok one produced version + 1.
  version: number;
  status: Status;
  reason_code?: string;
  reason_data?: ReasonData;
  candidates?: Id[];
}

export function attemptOf(command: Command, basedOn: number, version: number, result: Result): Attempt {
  return {
    command,
    based_on_version: basedOn,
    version,
    status: result.status,
    ...(result.reason_code !== undefined && { reason_code: result.reason_code }),
    ...(result.reason_data !== undefined && { reason_data: result.reason_data }),
    ...(result.candidates !== undefined && { candidates: result.candidates }),
  };
}

export interface TargetAddress {
  entity_id: Id;
  part: string | null;
  address: Id;
}

export interface CommandContext {
  snapshot: Snapshot;
  registry: TemplateRegistry;
  command: Command;
  actor: Entity;
  target: TargetAddress | null;
  verb: Verb;
}

export interface TransitionContext extends CommandContext {
  root_event_id: Id;
  recordDelta(entity: Id, field: string, from: unknown, to: unknown, eventId: Id): void;
  emit(type: string, entity: Id, data: Record<string, unknown>, causeId: Id | null): Id;
  set(entity: Id, field: string, value: unknown, eventId: Id): void;
}

export type PreconditionResult =
  | { status: "ok" }
  | { status: "refused"; reason_code: string; reason_data?: ReasonData }
  | { status: "unresolved" }
  | { status: "ambiguous"; candidates: Id[] }
  | { status: "invalid"; reason_code: string };

// One way a body can hold a thing, tried in declaration order. `per_hand` scales with the item's
// `hands_required` (one hand needs per_hand, two need twice that); the flat form takes `at_least`
// of the capacity. `max_hands` refuses items needing more hands than the body part offers,
// `mass_limit_prop` names the carrier prop that caps the item's mass, and `holds` caps how many
// things the body part holds at once.
export interface CarryAlternative {
  capacity: string;
  per_hand?: number;
  at_least?: number;
  max_hands?: number;
  mass_limit_prop?: string;
  holds?: number;
}

// An unconditional capacity floor for acting at all, read from the verb's own declaration.
export interface CapacityRequirement {
  capacity: string;
  at_least: number;
}

// One way a body can strike: it needs at_least of the capacity, and the damage comes from the
// attacker's prop the mode names.
export interface AttackMode {
  capacity: string;
  at_least: number;
  damage_prop: string;
  // Across a barrier's gap: a `limb` reaches through any gap, a `body` strike (a bite) needs the
  // attacker's own smallest dimension to fit it.
  crosses_gap: "limb" | "body";
}

// One entry of a verb's declared args shape; `enum` carries its values.
export interface ArgDecl {
  kind: "address" | "pos" | "room" | "int" | "enum" | "world_edit";
  values?: readonly string[];
}

// How many ticks an ok command takes: a fixed count, or the value of the named positive int arg.
export type VerbDuration = { ticks: number } | { arg: string };

// What the engine tells a caller about one verb, read from the verb's own declarations.
export interface VerbCatalogEntry {
  verb: string;
  requires_target: boolean;
  args: Readonly<Record<string, ArgDecl>>;
  duration: VerbDuration;
  requires: readonly CapacityRequirement[];
  carry_alternatives: readonly CarryAlternative[];
  attack_modes: readonly AttackMode[];
  refuses: readonly string[];
}

export interface Verb {
  requires_target: boolean;
  args: Readonly<Record<string, ArgDecl>>;
  refuses: readonly string[];
  duration: VerbDuration;
  requires?: readonly CapacityRequirement[];
  carry_alternatives?: readonly CarryAlternative[];
  attack_modes?: readonly AttackMode[];
  preconditions(context: CommandContext): PreconditionResult;
  transition(context: TransitionContext): void;
  validateResult?: (context: CommandContext) => PreconditionResult;
}

export type VerbRegistry = ReadonlyMap<string, Verb>;
