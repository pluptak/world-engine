import type { SnapshotIssue } from "./engine/validate.js";

export type WorldErrorCode =
  | "no_such_world"
  | "unsupported_schema"
  | "templates_changed"
  | "invalid_templates"
  | "templates_lost_field"
  | "replay_diverges"
  | "invalid_snapshot"
  | "invalid_version"
  | "future_version"
  | "history_unavailable"
  | "no_such_event"
  | "no_such_entity"
  | "no_such_field"
  | "invalid_name"
  | "duplicate_name"
  | "unknown_name"
  | "unknown_anchor"
  | "anchor_not_room_supported"
  | "conflicting_placement"
  | "invalid_ids"
  | "store_busy"
  | "derived_field"
  | "field_not_editable"
  | "invalid_form"
  | "form_not_applicable"
  | "no_liquid_material";

export class WorldError extends Error {
  constructor(
    readonly code: WorldErrorCode,
    message: string,
    readonly issues: readonly SnapshotIssue[] = [],
  ) {
    super(message);
  }
}