import type { SnapshotIssue } from "./engine/validate.js";

export type WorldErrorCode =
  | "no_such_world"
  | "templates_changed"
  | "invalid_snapshot"
  | "invalid_version"
  | "future_version"
  | "history_unavailable"
  | "no_such_event"
  | "no_such_entity"
  | "no_such_field";

export class WorldError extends Error {
  constructor(
    readonly code: WorldErrorCode,
    message: string,
    readonly issues: readonly SnapshotIssue[] = [],
  ) {
    super(message);
  }
}