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

export interface Verb {
  requires_target: boolean;
  preconditions(context: CommandContext): PreconditionResult;
  transition(context: TransitionContext): void;
  validateResult?: (context: CommandContext) => PreconditionResult;
}

export type VerbRegistry = ReadonlyMap<string, Verb>;
