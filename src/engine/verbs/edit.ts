import type { Entity, Id, Pos, Snapshot } from "../../model.js";
import type { TemplateRegistry } from "../../templates.js";
import { propagateSupportLoss } from "../../resolvers/physical.js";
import { effectivePos } from "../geometry.js";
import { spawn, type EntityOverrides } from "../spawn.js";
import { derivedLocationOf, validateSnapshot } from "../validate.js";
import {
  WORLD_AUTHOR,
  type AnchorPos,
  type CommandContext,
  type PlaceEdit,
  type PreconditionResult,
  type SpawnEdit,
  type TransitionContext,
  type Verb,
  type WorldEdit,
} from "../command.js";
import { refreshSubtreeLocations, wouldLoop } from "./address.js";
import { dropCarriedItem } from "./drop.js";
import { revealConcealed } from "./search.js";
import { claimGrip, gripEvictions, holderLayout } from "../carry.js";
import { withParts } from "../parts.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is Id {
  return typeof value === "string" && value.length > 0;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

// A pos is exactly a position in centimetres: a record carrying anything else is not one, which is
// what tells the anchor form apart from a mistyped position.
function isPos(value: Record<string, unknown>[string]): value is Pos {
  return (
    isRecord(value) &&
    isInt(value.x) &&
    isInt(value.y) &&
    Object.keys(value).every((key) => key === "x" || key === "y")
  );
}

// The anchor form of a position: a reference point and an offset, never a position of its own.
function isAnchorPos(value: unknown): value is AnchorPos {
  return (
    isRecord(value) &&
    isId(value.anchor) &&
    isInt(value.dx) &&
    isInt(value.dy) &&
    Object.keys(value).every((key) => key === "anchor" || key === "dx" || key === "dy")
  );
}

function anchorOffset(pos: Pos | AnchorPos | null | undefined): AnchorPos | null {
  return isAnchorPos(pos) ? pos : null;
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
  "in_part",
  "concealed_by",
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
  for (const key of ["location", "support", "contained_in", "concealed_by"] as const) {
    const ref = value[key];
    if (ref !== undefined && ref !== null && !isId(ref)) {
      return false;
    }
  }
  if (value.in_part !== undefined && value.in_part !== null && typeof value.in_part !== "string") {
    return false;
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
    if (
      !onlyKeys(value, ["kind", "target", "support", "contained_in", "in_part", "concealed_by", "pos"]) ||
      !isId(value.target)
    ) {
      return null;
    }
    if (
      (value.support !== undefined && value.support !== null && !isId(value.support)) ||
      (value.contained_in !== undefined && value.contained_in !== null && !isId(value.contained_in)) ||
      (value.in_part !== undefined && value.in_part !== null && !isId(value.in_part)) ||
      (value.concealed_by !== undefined && value.concealed_by !== null && !isId(value.concealed_by)) ||
      (value.pos !== undefined && value.pos !== null && !isPos(value.pos) && !isAnchorPos(value.pos))
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
    if (typeof value.in_part === "string" || value.in_part === null) {
      edit.in_part = value.in_part;
    }
    if (typeof value.concealed_by === "string" || value.concealed_by === null) {
      edit.concealed_by = value.concealed_by;
    }
    if (value.pos === null || isPos(value.pos) || isAnchorPos(value.pos)) {
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
  edit: ResolvedPlaceEdit,
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

// A place edit whose position is already a plain one, which is what every rule below reads.
type ResolvedPlaceEdit = PlaceEdit & { pos?: Pos | null };

// An anchor resolves to a plain position before any placement rule reads one: the offset against
// the anchor's own position, and the anchor's room as the holder. Nothing records the anchor, so
// the entity afterwards is simply in that room at that position. An anchor that is not standing in
// a room has no position to offset from, and is refused rather than guessed at.
function anchoredPlace(snapshot: Snapshot, edit: PlaceEdit): ResolvedPlaceEdit | PreconditionResult {
  const offset = anchorOffset(edit.pos);
  if (offset === null) {
    // Parsing admits only a plain position or an anchor form, so anything else is already resolved.
    return edit as ResolvedPlaceEdit;
  }
  // An anchor says where the entity is, so it cannot sit beside a holder the author also named.
  if (
    (edit.support !== undefined && edit.support !== null) ||
    (edit.contained_in !== undefined && edit.contained_in !== null)
  ) {
    return refused("conflicting_placement");
  }
  const anchor = snapshot.entities[offset.anchor];
  if (anchor === undefined) {
    return invalid("no_such_entity");
  }
  const room = anchor.support === null ? null : snapshot.entities[anchor.support];
  const base = room?.template === "room" ? effectivePos(snapshot, anchor.id) : null;
  if (base === null) {
    return refused("anchor_not_room_supported");
  }
  return {
    ...edit,
    support: anchor.support,
    contained_in: null,
    pos: { x: base.x + offset.dx, y: base.y + offset.dy },
  };
}

function isPlacement(value: ResolvedPlaceEdit | PreconditionResult): value is ResolvedPlaceEdit {
  return !("status" in value);
}

function placeRefusal(
  context: CommandContext,
  edit: ResolvedPlaceEdit,
  subject: Entity,
): PreconditionResult {
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
    case "place": {
      const placed = anchoredPlace(context.snapshot, edit);
      return isPlacement(placed) ? placeRefusal(context, placed, subject) : placed;
    }
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
    // A part name travels only onto a holder that declares it; what newly lands in grips
    // takes the first free one, the way a spawn does. Otherwise it is cleared.
    const keepPart = (holder: Id | null): string | null => {
      if (holder === null) {
        return null;
      }
      if (entity.in_part !== null) {
        const next = context.snapshot.entities[holder];
        const declared = context.registry[next?.template ?? ""];
        return declared?.parts.some(
          (decl) => decl.name === entity.in_part && decl.holds !== undefined,
        ) === true
          ? entity.in_part
          : null;
      }
      const next = context.snapshot.entities[holder];
      if (
        next === undefined ||
        holderLayout(context.registry, next.template).grips.length === 0
      ) {
        return null;
      }
      const claimed = claimGrip(context.snapshot, context.registry, holder, entity);
      return "part" in claimed ? claimed.part : null;
    };
    if (carried !== null) {
      context.set(id, "contained_in", carried, eventId);
      context.set(id, "in_part", keepPart(carried), eventId);
      context.set(id, "support", null, eventId);
      context.set(id, "pos", null, eventId);
    } else if (wasContent) {
      context.set(id, "contained_in", null, eventId);
      context.set(id, "in_part", null, eventId);
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
  if (!removeEntity(context, targetId, context.root_event_id)) {
    throw new TypeError("Edit subject changed after validation");
  }
}

// Takes one entity out of the world under a `removed` event caused by `causeId`, uncovering what it
// hid and letting go of what it held or carried. False, and nothing written, for an entity that is
// gone or a room someone is in: the same rule the author's `remove` is held to.
export function removeEntity(context: TransitionContext, targetId: Id, causeId: Id): boolean {
  const doomed = context.snapshot.entities[targetId];
  if (doomed === undefined || removeRefusal(context, doomed).status !== "ok") {
    return false;
  }
  const removedEvent = context.emit("removed", targetId, {}, causeId);
  context.recordDelta(targetId, "entity", doomed, null, removedEvent);
  // What the removed thing was hiding is uncovered rather than orphaned: the hidden things stay in
  // the world, and stay where they were.
  revealConcealed(context, targetId, removedEvent);
  propagateSupportLoss(context, targetId, removedEvent);
  releaseDependents(context, targetId, removedEvent, doomed);
  const entities = { ...context.snapshot.entities };
  delete entities[targetId];
  context.snapshot = { ...context.snapshot, entities };
  return true;
}

function samePosition(left: Pos | null, right: Pos | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.x === right.x && left.y === right.y;
}

function transitionPlace(context: TransitionContext, edit: PlaceEdit, subject: Entity): void {
  const anchored = anchoredPlace(context.snapshot, edit);
  if (!isPlacement(anchored)) {
    throw new TypeError("Edit placement changed after validation");
  }
  const placement = normalizedPlacement(subject, anchored);
  if (placement === null) {
    throw new TypeError("Edit placement changed after validation");
  }
  const placedEvent = context.emit("placed", edit.target, {}, context.root_event_id);
  if (subject.support !== null && placement.support === null && placement.contained === null) {
    propagateSupportLoss(context, edit.target, placedEvent);
  }
  context.set(edit.target, "contained_in", placement.contained, placedEvent);
  // A placement into a holder fills the first free grip when the edit leaves it unnamed, the way
  // a spawn does; a placement out of one clears it, and one that stays held keeps it.
  let part: string | null;
  if (anchored.in_part !== undefined) {
    part = anchored.in_part;
  } else if (anchored.contained_in !== undefined && anchored.contained_in !== null) {
    const claimed = claimGrip(context.snapshot, context.registry, anchored.contained_in, subject);
    part = "part" in claimed ? claimed.part : null;
  } else if (placement.contained === null) {
    part = null;
  } else {
    part = subject.in_part;
  }
  context.set(edit.target, "in_part", part, placedEvent);
  context.set(edit.target, "support", placement.support, placedEvent);
  context.set(edit.target, "pos", placement.pos, placedEvent);
  // A placement that changes where the entity is uncovers what it was hiding. An explicit
  // `concealed_by` in the same edit is written after that, so an author can hide a thing where they
  // put it.
  if (
    placement.support !== subject.support ||
    placement.contained !== subject.contained_in ||
    !samePosition(placement.pos, subject.pos)
  ) {
    revealConcealed(context, edit.target, placedEvent);
  }
  context.set(
    edit.target,
    "concealed_by",
    anchored.concealed_by === undefined ? subject.concealed_by : anchored.concealed_by,
    placedEvent,
  );
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
        withParts(context.registry[subject.template]!, subject.parts, { [edit.part]: edit.state }),
        editedEvent,
      );
      // Destroying a holder part spills what it held; a detached part is refused by validation,
      // so only destruction reaches here with contents still inside.
      for (const itemId of gripEvictions(context.snapshot, context.registry, edit.target)) {
        dropCarriedItem(context, edit.target, itemId, editedEvent);
      }
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
  author_only: true,
  // The author states facts; no time passes in the world for them.
  duration: { ticks: 0 },
  requires_target: false,
  args: { edit: { kind: "world_edit" } },
  refuses: [
    "room_placed",
    "conflicting_placement",
    "room_support_without_pos",
    "pos_without_room_support",
    "anchor_not_room_supported",
    "circular_placement",
    "occupied_room",
    "unknown_part",
    "integrity_out_of_range",
    "detached_part_without_entity",
    "part_at_default",
    "part_under_detached",
    "coverage_not_computable",
    "location_mismatch",
    "dangling_reference",
    "id_not_below_next_seq",
    "support_or_containment_cycle",
    "support_and_contained_in",
    "door_side_not_room",
    "opens_target_not_openable",
    "concealed_by_abstract",
    "concealed_by_not_same_room",
    "concealed_by_cycle",
    "in_part_holder_mismatch",
    "in_part_unknown_part",
    "in_part_unavailable",
    "grip_occupied",
    "part_contents_too_large",
  ],
  preconditions,
  transition,
  validateResult,
};
