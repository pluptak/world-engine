import type { Delta, Entity, Id, PartState, Pos, Snapshot, Status, WorldEvent } from "../model.js";
import type { EntityOverrides } from "./spawn.js";
import type { TemplateRegistry } from "../templates.js";

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

export interface PlaceEdit {
  kind: "place";
  target: Id;
  support?: Id | null;
  contained_in?: Id | null;
  pos?: Pos | null;
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
  snapshot: Snapshot;
  deltas: Delta[];
  events: WorldEvent[];
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
  | { status: "refused"; reason_code: string }
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
}

// One entry of a verb's declared args shape; `enum` carries its values.
export interface ArgDecl {
  kind: "address" | "pos" | "room" | "int" | "enum" | "world_edit";
  values?: readonly string[];
}

// What the engine tells a caller about one verb, read from the verb's own declarations.
export interface VerbCatalogEntry {
  verb: string;
  requires_target: boolean;
  args: Readonly<Record<string, ArgDecl>>;
  requires: readonly CapacityRequirement[];
  carry_alternatives: readonly CarryAlternative[];
  attack_modes: readonly AttackMode[];
  refuses: readonly string[];
}

export interface Verb {
  requires_target: boolean;
  args: Readonly<Record<string, ArgDecl>>;
  refuses: readonly string[];
  requires?: readonly CapacityRequirement[];
  carry_alternatives?: readonly CarryAlternative[];
  attack_modes?: readonly AttackMode[];
  preconditions(context: CommandContext): PreconditionResult;
  transition(context: TransitionContext): void;
  validateResult?: (context: CommandContext) => PreconditionResult;
}

export type VerbRegistry = ReadonlyMap<string, Verb>;
