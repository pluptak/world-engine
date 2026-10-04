import type { Entity, Id, Pos, Snapshot } from "../../model.js";
import type { TemplateRegistry } from "../../templates.js";
import { propagateSupportLoss } from "../../resolvers/physical.js";
import { spawn, type EntityOverrides } from "../spawn.js";
import { derivedLocationOf, validateSnapshot } from "../validate.js";
import {
  WORLD_AUTHOR,
  type CommandContext,
  type PlaceEdit,
  type PreconditionResult,
  type SpawnEdit,
  type TransitionContext,
  type Verb,
  type WorldEdit,
} from "../command.js";
import { refreshSubtreeLocations, wouldLoop } from "./address.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is Id {
  return typeof value === "string" && value.length > 0;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPos(value: Record<string, unknown>[string]): value is { x: number; y: number } {
  return isRecord(value) && isInt(value.x) && isInt(value.y);
}

function isProps(value: unknown): value is Record<string, number | string | boolean> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(
    (prop) =>
      (typeof prop === "number" && Number.isFinite(prop)) ||
      typeof prop === "string" ||
      typeof prop === "boolean",
  );
}

function isPartState(value: unknown): value is { integrity: number; status: "intact" | "damaged" | "detached" | "destroyed" } {
  return (
    isRecord(value) &&
    isInt(value.integrity) &&
    (value.status === "intact" ||
      value.status === "damaged" ||
      value.status === "detached" ||
      value.status === "destroyed")
  );
}

const overrideKeys = [
  "name",
  "aliases",
  "location",
  "support",
  "contained_in",
  "pos",
  "detached_from",
  "integrity",
  "status",
  "residue",
  "modifiers",
  "props",
];

function isOverrides(value: unknown): value is EntityOverrides {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  if (!Object.keys(value).every((key) => overrideKeys.includes(key))) {
    return false;
  }
  if (value.name !== undefined && typeof value.name !== "string") {
    return false;
  }
  if (
    value.aliases !== undefined &&
    (!Array.isArray(value.aliases) || !value.aliases.every((alias) => typeof alias === "string"))
  ) {
    return false;
  }
  for (const key of ["location", "support", "contained_in"] as const) {
    const ref = value[key];
    if (ref !== undefined && ref !== null && !isId(ref)) {
      return false;
    }
  }
  if (value.pos !== undefined && value.pos !== null && !isPos(value.pos)) {
    return false;
  }
  if (value.detached_from !== undefined && value.detached_from !== null) {
    const origin = value.detached_from;
    if (!isRecord(origin) || !isId(origin.entity) || typeof origin.part !== "string" || origin.part.length === 0) {
      return false;
    }
  }
  if (value.integrity !== undefined && !isInt(value.integrity)) {
    return false;
  }
  if (
    value.status !== undefined &&
    value.status !== "intact" &&
    value.status !== "broken" &&
    value.status !== "destroyed"
  ) {
    return false;
  }
  if (
    value.residue !== undefined &&
    (!isRecord(value.residue) || !Object.values(value.residue).every(isInt))
  ) {
    return false;
  }
  if (value.modifiers !== undefined) {
    if (!Array.isArray(value.modifiers)) {
      return false;
    }
    const valid = value.modifiers.every(
      (modifier) =>
        isRecord(modifier) &&
        typeof modifier.capacity === "string" &&
        isInt(modifier.delta) &&
        (modifier.expires_at_tick === null || isInt(modifier.expires_at_tick)) &&
        isId(modifier.cause_id),
    );
    if (!valid) {
      return false;
    }
  }
  return value.props === undefined || isProps(value.props);
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseEdit(value: unknown): WorldEdit | null {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return null;
  }
  if (value.kind === "spawn") {
    if (!onlyKeys(value, ["kind", "template", "overrides"]) || !isId(value.template)) {
      return null;
    }
    if (!isOverrides(value.overrides)) {
      return null;
    }
    return value.overrides === undefined
      ? { kind: "spawn", template: value.template }
      : { kind: "spawn", template: value.template, overrides: value.overrides };
  }
  if (value.kind === "remove") {
    if (!onlyKeys(value, ["kind", "target"]) || !isId(value.target)) {
      return null;
    }
    return { kind: "remove", target: value.target };
  }
  if (value.kind === "place") {
    if (!onlyKeys(value, ["kind", "target", "support", "contained_in", "pos"]) || !isId(value.target)) {
      return null;
    }
    if (
      (value.support !== undefined && value.support !== null && !isId(value.support)) ||
      (value.contained_in !== undefined && value.contained_in !== null && !isId(value.contained_in)) ||
      (value.pos !== undefined && value.pos !== null && !isPos(value.pos))
    ) {
      return null;
    }
    const edit: PlaceEdit = { kind: "place", target: value.target };
    if (typeof value.support === "string" || value.support === null) {
      edit.support = value.support;
    }
    if (typeof value.contained_in === "string" || value.contained_in === null) {
      edit.contained_in = value.contained_in;
    }
    if (value.pos === null || isPos(value.pos)) {
      edit.pos = value.pos;
    }
    return edit;
  }
  if (value.kind === "set_props") {
    if (!onlyKeys(value, ["kind", "target", "props"]) || !isId(value.target) || !isProps(value.props)) {
      return null;
    }
    return { kind: "set_props", target: value.target, props: value.props };
  }
  if (value.kind === "set_part") {
    if (
      !onlyKeys(value, ["kind", "target", "part", "state"]) ||
      !isId(value.target) ||
      typeof value.part !== "string" ||
      value.part.length === 0 ||
      !isPartState(value.state)
    ) {
      return null;
    }
    return { kind: "set_part", target: value.target, part: value.part, state: value.state };
  }
  return null;
}

function invalid(reason_code: string): PreconditionResult {
  return { status: "invalid", reason_code };
}

function refused(reason_code: string): PreconditionResult {
  return { status: "refused", reason_code };
}

function missingRef(context: CommandContext, id: Id | null | undefined): boolean {
  return id !== undefined && id !== null && context.snapshot.entities[id] === undefined;
}

function spawnRefusal(context: CommandContext, edit: SpawnEdit): PreconditionResult {
  const template = context.registry[edit.template];
  if (template === undefined) {
    return invalid("unknown_template");
  }
  const overrides = edit.overrides ?? {};
  if (
    overrides.support !== undefined &&
    overrides.support !== null &&
    overrides.contained_in !== undefined &&
    overrides.contained_in !== null
  ) {
    return refused("conflicting_placement");
  }
  if (
    missingRef(context, overrides.location) ||
    missingRef(context, overrides.support) ||
    missingRef(context, overrides.contained_in)
  ) {
    return invalid("no_such_entity");
  }
  const location = spawnLocation(context.snapshot, overrides);
  if (location === undefined) {
    return invalid("invalid_location");
  }
  if (location !== null && context.snapshot.entities[location]?.template !== "room") {
    return invalid("invalid_location");
  }
  const support = overrides.support ?? null;
  if (support !== null && context.snapshot.entities[support]?.template === "room") {
    if (overrides.pos === undefined || overrides.pos === null) {
      return refused("room_support_without_pos");
    }
  } else if (overrides.pos !== undefined && overrides.pos !== null) {
    return refused("pos_without_room_support");
  }
  const origin = overrides.detached_from;
  if (origin !== undefined && origin !== null) {
    const owner = context.snapshot.entities[origin.entity];
    const ownerTemplate = owner === undefined ? undefined : context.registry[owner.template];
    if (owner === undefined || ownerTemplate === undefined) {
      return invalid("no_such_entity");
    }
    if (!ownerTemplate.parts.some((part) => part.name === origin.part)) {
      return refused("unknown_part");
    }
  }
  return { status: "ok" };
}

// An omitted location is derived from the chain, never left to drift; an explicit one must match it.
function spawnLocation(
  snapshot: Snapshot,
  overrides: EntityOverrides,
): Id | null | undefined {
  if (overrides.location !== undefined) {
    return overrides.location;
  }
  return derivedLocationOf(snapshot, overrides.support ?? null, overrides.contained_in ?? null);
}

function removeRefusal(context: CommandContext, subject: Entity): PreconditionResult {
  if (subject.template !== "room") {
    return { status: "ok" };
  }
  const inhabited = Object.keys(context.snapshot.entities)
    .sort()
    .some((id) => context.snapshot.entities[id]?.location === subject.id);
  return inhabited ? refused("occupied_room") : { status: "ok" };
}

// Nothing is both held and supported: setting one relation clears the other, and asking for both
// is refused outright.
function normalizedPlacement(
  subject: Entity,
  edit: PlaceEdit,
): { support: Id | null; contained: Id | null; pos: Pos | null } | null {
  if (
    edit.support !== undefined &&
    edit.support !== null &&
    edit.contained_in !== undefined &&
    edit.contained_in !== null
  ) {
    return null;
  }
  let support = edit.support === undefined ? subject.support : edit.support;
  let contained = edit.contained_in === undefined ? subject.contained_in : edit.contained_in;
  if (edit.support !== undefined && edit.support !== null) {
    contained = null;
  } else if (edit.contained_in !== undefined && edit.contained_in !== null) {
    support = null;
  }
  return { support, contained, pos: edit.pos === undefined ? subject.pos : edit.pos };
}

function placeRefusal(context: CommandContext, edit: PlaceEdit, subject: Entity): PreconditionResult {
  const placement = normalizedPlacement(subject, edit);
  if (placement === null) {
    return refused("conflicting_placement");
  }
  if (missingRef(context, placement.support) || missingRef(context, placement.contained)) {
    return invalid("no_such_entity");
  }
  if (placement.support !== null && wouldLoop(context, edit.target, placement.support)) {
    return refused("circular_placement");
  }
  if (placement.contained !== null && wouldLoop(context, edit.target, placement.contained)) {
    return refused("circular_placement");
  }
  if (placement.support !== null && context.snapshot.entities[placement.support]?.template === "room") {
    if (placement.pos === null) {
      return refused("room_support_without_pos");
    }
  } else if (placement.pos !== null) {
    return refused("pos_without_room_support");
  }
  return { status: "ok" };
}

function partRefusal(
  context: CommandContext,
  registry: TemplateRegistry,
  subject: Entity,
  part: string,
): PreconditionResult {
  const template = registry[subject.template];
  if (template === undefined) {
    return invalid("unknown_template");
  }
  return template.parts.some((decl) => decl.name === part)
    ? { status: "ok" }
    : refused("unknown_part");
}

function preconditions(context: CommandContext): PreconditionResult {
  if (context.command.actor !== WORLD_AUTHOR) {
    return invalid("invalid_author");
  }
  const edit = parseEdit((context.command.args ?? {}).edit);
  if (edit === null) {
    return invalid("invalid_args");
  }
  if (edit.kind === "spawn") {
    if (context.target !== null) {
      return invalid("unexpected_target");
    }
    return spawnRefusal(context, edit);
  }
  if (
    context.target === null ||
    context.target.part !== null ||
    context.target.entity_id !== edit.target
  ) {
    return invalid("mismatched_target");
  }
  const subject = context.snapshot.entities[edit.target]!;
  switch (edit.kind) {
    case "remove":
      return removeRefusal(context, subject);
    case "place":
      return placeRefusal(context, edit, subject);
    case "set_props":
      return { status: "ok" };
    case "set_part":
      return partRefusal(context, context.registry, subject, edit.part);
    default: {
      const exhaustive: never = edit;
      throw new TypeError(`Unknown edit kind ${(exhaustive as WorldEdit).kind}`);
    }
  }
}

// What is left behind when a support or a container goes: riders that would not topple on their
// own, and everything the container held. They take the relation the removed thing itself was in —
// carried by its holder, inside its container, else on the surface under it — so a stone from a cup
// in a shut chest stays shut inside the chest. Locations follow the new chains, not the old one.
function releaseDependents(
  context: TransitionContext,
  targetId: Id,
  eventId: Id,
  former: Entity,
): void {
  const carried = former.contained_in;
  const pos = former.pos === null ? null : { ...former.pos };
  const moved: Id[] = [];
  for (const id of Object.keys(context.snapshot.entities).sort()) {
    if (id === targetId) {
      continue;
    }
    const entity = context.snapshot.entities[id];
    if (entity === undefined) {
      continue;
    }
    const wasContent = entity.contained_in === targetId;
    const wasRider = entity.support === targetId && entity.props.topples !== true;
    if (!wasContent && !wasRider) {
      continue;
    }
    if (carried !== null) {
      context.set(id, "contained_in", carried, eventId);
      context.set(id, "support", null, eventId);
      context.set(id, "pos", null, eventId);
    } else if (wasContent) {
      context.set(id, "contained_in", null, eventId);
      context.set(id, "support", former.support, eventId);
      context.set(id, "pos", pos, eventId);
    } else {
      context.set(id, "support", former.support, eventId);
      context.set(id, "pos", pos, eventId);
    }
    moved.push(id);
  }
  for (const id of moved) {
    refreshSubtreeLocations(context, id, eventId);
  }
}

function transitionSpawn(context: TransitionContext, edit: SpawnEdit): void {
  const overrides = edit.overrides ?? {};
  const created = spawn(context.snapshot, context.registry, edit.template, {
    ...overrides,
    location: spawnLocation(context.snapshot, overrides) ?? null,
  });
  context.snapshot = created.snapshot;
  const spawnedEvent = context.emit(
    "spawned",
    created.id,
    { template: edit.template },
    context.root_event_id,
  );
  context.recordDelta(created.id, "entity", null, context.snapshot.entities[created.id], spawnedEvent);
}

function transitionRemove(context: TransitionContext, targetId: Id): void {
  const doomed = context.snapshot.entities[targetId];
  if (doomed === undefined) {
    throw new TypeError("Edit subject changed after validation");
  }
  const removedEvent = context.emit("removed", targetId, {}, context.root_event_id);
  context.recordDelta(targetId, "entity", doomed, null, removedEvent);
  propagateSupportLoss(context, targetId, removedEvent);
  releaseDependents(context, targetId, removedEvent, doomed);
  const entities = { ...context.snapshot.entities };
  delete entities[targetId];
  context.snapshot = { ...context.snapshot, entities };
}

function transitionPlace(context: TransitionContext, edit: PlaceEdit, subject: Entity): void {
  const placement = normalizedPlacement(subject, edit);
  if (placement === null) {
    throw new TypeError("Edit placement changed after validation");
  }
  const placedEvent = context.emit("placed", edit.target, {}, context.root_event_id);
  if (subject.support !== null && placement.support === null && placement.contained === null) {
    propagateSupportLoss(context, edit.target, placedEvent);
  }
  context.set(edit.target, "contained_in", placement.contained, placedEvent);
  context.set(edit.target, "support", placement.support, placedEvent);
  context.set(edit.target, "pos", placement.pos, placedEvent);
  refreshSubtreeLocations(context, edit.target, placedEvent);
}

function transition(context: TransitionContext): void {
  const edit = parseEdit((context.command.args ?? {}).edit);
  if (edit === null) {
    throw new TypeError("Edit changed after validation");
  }
  if (edit.kind === "spawn") {
    transitionSpawn(context, edit);
    return;
  }
  const target = context.target;
  if (target === null || target.part !== null || target.entity_id !== edit.target) {
    throw new TypeError("Edit target changed after validation");
  }
  const subject = context.snapshot.entities[edit.target];
  if (subject === undefined) {
    throw new TypeError("Edit subject changed after validation");
  }
  switch (edit.kind) {
    case "remove":
      transitionRemove(context, edit.target);
      break;
    case "place":
      transitionPlace(context, edit, subject);
      break;
    case "set_props": {
      const editedEvent = context.emit("edited", edit.target, { field: "props" }, context.root_event_id);
      context.set(edit.target, "props", { ...edit.props }, editedEvent);
      break;
    }
    case "set_part": {
      const editedEvent = context.emit(
        "edited",
        edit.target,
        { field: "parts", part: edit.part },
        context.root_event_id,
      );
      context.set(
        edit.target,
        "parts",
        { ...subject.parts, [edit.part]: { ...edit.state } },
        editedEvent,
      );
      break;
    }
    default: {
      const exhaustive: never = edit;
      throw new TypeError(`Unknown edit kind ${(exhaustive as WorldEdit).kind}`);
    }
  }
}

// The guard item 2 was written for: whatever the transition built, the snapshot must still hold.
function validateResult(context: CommandContext): PreconditionResult {
  const [first] = validateSnapshot(context.snapshot, context.registry);
  if (first === undefined) {
    return { status: "ok" };
  }
  if (first.code === "support_or_containment_cycle") {
    return refused("circular_placement");
  }
  return refused(first.code);
}

export const editVerb: Verb = {
  requires_target: false,
  args: { edit: { kind: "world_edit" } },
  refuses: [
    "conflicting_placement",
    "room_support_without_pos",
    "pos_without_room_support",
    "circular_placement",
    "occupied_room",
    "unknown_part",
    "integrity_out_of_range",
    "detached_part_without_entity",
    "location_mismatch",
    "dangling_reference",
    "id_not_below_next_seq",
    "support_or_containment_cycle",
    "support_and_contained_in",
    "door_side_not_room",
    "opens_target_not_openable",
  ],
  preconditions,
  transition,
  validateResult,
};
