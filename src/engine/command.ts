import type { Delta, Entity, Id, Snapshot, Status, WorldEvent } from "../model.js";
import type { TemplateRegistry } from "../templates.js";

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
  | { status: "invalid"; reason_code: string };

export interface Verb {
  requires_target: boolean;
  preconditions(context: CommandContext): PreconditionResult;
  transition(context: TransitionContext): void;
}

export type VerbRegistry = ReadonlyMap<string, Verb>;
