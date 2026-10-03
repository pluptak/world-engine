import type { SnapshotIssue } from "./engine/validate.js";

export type WorldErrorCode = "no_such_world" | "templates_changed" | "invalid_snapshot";

export class WorldError extends Error {
  constructor(
    readonly code: WorldErrorCode,
    message: string,
    readonly issues: readonly SnapshotIssue[] = [],
  ) {
    super(message);
  }
}