import { own, type Entity, type Id, type Snapshot } from "../model.js";
import type { Template, TemplateRegistry } from "../templates.js";
import { heldInParts, holderLayout, packGrips, partAvailable } from "./carry.js";
import { innerDimensions, misfit } from "./fit.js";
import { effectivePart, isDefaultPart } from "./parts.js";
import { PROP_FIELDS, propTypeMatches } from "./fields.js";
import { uncomputable } from "./capabilities.js";
import { isAbstract } from "./resolve.js";
import { isRngState } from "./rng.js";
import { CAUSE_KINDS, causeInvalid } from "./schedule.js";
import { MAX_BEATS, pendingBeatIds } from "./beats.js";
import { isUtterance } from "./verbs/say.js";

export interface SnapshotIssue {
  code: string;
  path: string[];
  message: string;
}

function issue(code: string, path: string[], message: string): SnapshotIssue {
  return { code, path, message };
}

// The ids that close a loop, or null: a dangling reference cannot close one, so the walk ends where
// the world stops making sense.
function chainLoop(snapshot: Snapshot, id: Id): Id[] | null {
  const path: Id[] = [];
  const visited = new Map<Id, number>();
  let current: Id | null = id;

  while (current !== null) {
    const seenAt = visited.get(current);
    if (seenAt !== undefined) {
      return path.slice(seenAt);
    }
    visited.set(current, path.length);
    path.push(current);

    const entity: Entity | undefined = own(snapshot.entities, current);
    if (entity === undefined) {
      return null;
    }
    current = entity.contained_in ?? entity.support;
  }

  return null;
}

// The room at the end of a support or containment chain, or null when the chain ends nowhere;
// undefined when the chain cannot be read, which always has its own issue already.
export function derivedLocationOf(
  snapshot: Snapshot,
  support: Id | null,
  contained_in: Id | null,
): Id | null | undefined {
  const visited = new Set<Id>();
  let current = contained_in ?? support;

  while (current !== null) {
    if (visited.has(current)) {
      return undefined;
    }
    visited.add(current);

    const entity: Entity | undefined = own(snapshot.entities, current);
    if (entity === undefined) {
      return undefined;
    }
    if (entity.template === "room") {
      return entity.id;
    }
    current = entity.contained_in ?? entity.support;
  }

  return null;
}

export function derivedLocation(snapshot: Snapshot, id: Id): Id | null | undefined {
  const entity = own(snapshot.entities, id);
  if (entity === undefined) {
    return undefined;
  }
  return derivedLocationOf(snapshot, entity.support, entity.contained_in);
}

// Detaching a subtree spawns one entity for its root; the descendants travel inside it rather than
// becoming entities of their own, so a part is accounted for by any detached ancestor that has one.
function detachedIndex(snapshot: Snapshot): Map<string, Id> {
  const index = new Map<string, Id>();
  for (const id of Object.keys(snapshot.entities).sort()) {
    const origin = own(snapshot.entities, id)?.detached_from;
    if (origin !== null && origin !== undefined) {
      index.set(`${origin.entity} ${origin.part}`, id);
    }
  }
  return index;
}

function accountedFor(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  spawned: Map<string, Id>,
  ownerId: Id,
  partName: string,
): boolean {
  // A part already gone when its ancestor was severed rides on the severed entity as detached, and
  // is accounted for where it left from: the walk follows `detached_from` back to the origin,
  // stopping below the part that origin lost, so a severed entity never accounts for itself.
  const owners = new Set<Id>();
  let current: Id = ownerId;
  let stopAt: string | null = null;
  for (;;) {
    owners.add(current);
    const owner = own(snapshot.entities, current);
    const template = owner === undefined ? undefined : own(registry, owner.template);
    const visited = new Set<string>();
    let name: string | null = partName;
    while (name !== null && name !== stopAt) {
      if (visited.has(name)) {
        throw new TypeError(`Part cycle at ${name}`);
      }
      visited.add(name);
      if (spawned.has(`${current} ${name}`)) {
        return true;
      }
      name = template?.parts.find((part) => part.name === name)?.parent ?? null;
    }
    const origin = owner?.detached_from ?? null;
    if (origin === null || owners.has(origin.entity)) {
      return false;
    }
    current = origin.entity;
    stopAt = origin.part;
  }
}

// What sits in a plain container fits its `inner_*_cm`, as `put` holds it to: a table in a chest is not a
// state `put` can reach, so no other writer may make it. A holder with parts is held to its own rules
// (`part_contents_too_large`), and a container that declares no inner dimensions is left alone.
function containerFitIssues(snapshot: Snapshot, registry: TemplateRegistry, id: Id, path: string[]): SnapshotIssue[] {
  const entity = own(snapshot.entities, id);
  const holder = entity?.contained_in == null ? undefined : own(snapshot.entities, entity.contained_in);
  if (entity === undefined || holder === undefined || entity.in_part !== null) {
    return [];
  }
  const inner = innerDimensions(holder.props);
  const size = own(registry, entity.template)?.size_cm;
  if (inner === null || size === undefined || misfit([size.w, size.d, size.h], inner) === null) {
    return [];
  }
  return [issue("container_contents_too_large", [...path, "contained_in"], `holder ${holder.id}`)];
}

const TRAIT_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_TRAITS = 16;

// Traits describe and nothing reads them: a map of at most 16 keys to opaque tokens, stored one way
// (absent when empty). Read by own keys, so `constructor` is a key like any other.
function traitIssues(entity: Entity, path: string[]): SnapshotIssue[] {
  const traits: unknown = entity.traits;
  if (traits === undefined) {
    return [];
  }
  const at = [...path, "traits"];
  if (traits === null || typeof traits !== "object" || Array.isArray(traits)) {
    return [issue("invalid_trait", at, "not a map")];
  }
  const keys = Object.keys(traits).sort();
  if (keys.length === 0 || keys.length > MAX_TRAITS) {
    return [issue("invalid_trait", at, keys.length === 0 ? "empty" : `${keys.length} traits`)];
  }
  const issues: SnapshotIssue[] = [];
  for (const key of keys) {
    if (!TRAIT_KEY.test(key)) {
      issues.push(issue("invalid_trait", [...at, key], "key"));
    } else if (!isUtterance(Object.getOwnPropertyDescriptor(traits, key)?.value)) {
      issues.push(issue("invalid_trait", [...at, key], "token"));
    }
  }
  return issues;
}

function referenceIssues(snapshot: Snapshot, id: Id, path: string[]): SnapshotIssue[] {
  const entity = own(snapshot.entities, id);
  if (entity === undefined) {
    return [];
  }

  const issues: SnapshotIssue[] = [];
  // detached_from is history, not a live link: the origin may itself be gone while the entity it
  // produced remains, so it is not checked here.
  if (entity.support !== null && own(snapshot.entities, entity.support) === undefined) {
    issues.push(issue("dangling_reference", [...path, "support"], `unknown entity ${entity.support}`));
  }
  if (entity.contained_in !== null && own(snapshot.entities, entity.contained_in) === undefined) {
    issues.push(
      issue("dangling_reference", [...path, "contained_in"], `unknown entity ${entity.contained_in}`),
    );
  }
  if (entity.location !== null && own(snapshot.entities, entity.location) === undefined) {
    issues.push(
      issue("dangling_reference", [...path, "location"], `unknown entity ${entity.location}`),
    );
  }
  // A concealer is present or nothing is hidden: unlike a key's `opens`, a name that reaches nothing
  // would leave the thing it was hiding invisible for ever.
  if (entity.concealed_by !== null && own(snapshot.entities, entity.concealed_by) === undefined) {
    issues.push(
      issue("dangling_reference", [...path, "concealed_by"], `unknown entity ${entity.concealed_by}`),
    );
  }
  // Doors name the rooms they join in props, outside the support and containment relations: a side
  // that names anything else joins nothing, so it is not a door's side at all. A door is its shape,
  // so any entity with a string `from` or `to` is held to it, whatever preset placed it.
  if (typeof entity.props.from === "string" || typeof entity.props.to === "string") {
    for (const side of ["from", "to"] as const) {
      const ref = entity.props[side];
      if (typeof ref !== "string") {
        continue;
      }
      const target = own(snapshot.entities, ref);
      if (target === undefined) {
        issues.push(issue("dangling_reference", [...path, "props", side], `unknown entity ${ref}`));
      } else if (target.template !== "room") {
        issues.push(
          issue("door_side_not_room", [...path, "props", side], `template ${target.template}`),
        );
      }
    }
  }
  // A key's `opens` is a live reference to what it can turn, but a key outlives the lock it names:
  // an absent target is left alone, one that cannot be opened is not.
  const opens = entity.props.opens;
  if (typeof opens === "string") {
    const target = own(snapshot.entities, opens);
    if (target !== undefined && target.props.openable !== true) {
      issues.push(issue("opens_target_not_openable", [...path, "props", "opens"], opens));
    }
  }
  return issues;
}

// The ids that close a concealment loop, or null: it is walked on its own, not with the chain, and a
// name that reaches nothing cannot close one.
function concealLoop(snapshot: Snapshot, id: Id): Id[] | null {
  const path: Id[] = [];
  const visited = new Map<Id, number>();
  let current: Id | null = id;

  while (current !== null) {
    const seenAt = visited.get(current);
    if (seenAt !== undefined) {
      return path.slice(seenAt);
    }
    visited.set(current, path.length);
    path.push(current);

    const entity: Entity | undefined = own(snapshot.entities, current);
    if (entity === undefined) {
      return null;
    }
    current = entity.concealed_by;
  }

  return null;
}

// What may hide what: a thing that is there, in the same room, and neither end abstract — an abstract
// entity is a mark, so nothing lies under it and it lies under nothing. Nothing may hide itself, or
// hide what hides it.
function concealmentIssues(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  reportedLoops: Set<Id>,
  id: Id,
  path: string[],
): SnapshotIssue[] {
  const entity = own(snapshot.entities, id);
  if (entity === undefined || entity.concealed_by === null) {
    return [];
  }
  // A missing concealer already has its dangling_reference; the rules below read the other end.
  const concealer = own(snapshot.entities, entity.concealed_by);
  if (concealer === undefined) {
    return [];
  }

  const issues: SnapshotIssue[] = [];
  if (isAbstract(registry, entity) || isAbstract(registry, concealer)) {
    issues.push(issue("concealed_by_abstract", path, entity.concealed_by));
  }
  if (entity.location === null || entity.location !== concealer.location) {
    issues.push(
      issue("concealed_by_not_same_room", path, `${String(entity.location)} ${concealer.location}`),
    );
  }
  const loop = concealLoop(snapshot, id);
  if (loop !== null) {
    const name = [...loop].sort()[0] ?? id;
    if (!reportedLoops.has(name)) {
      reportedLoops.add(name);
      issues.push(issue("concealed_by_cycle", path, `loop: ${[...loop].sort().join(", ")}`));
    }
  }
  return issues;
}

function integrityIssues(snapshot: Snapshot, id: Id, path: string[]): SnapshotIssue[] {
  const entity = own(snapshot.entities, id);
  if (entity === undefined) {
    return [];
  }

  const issues: SnapshotIssue[] = [];
  if (entity.integrity < 0 || entity.integrity > 100) {
    issues.push(issue("integrity_out_of_range", [...path, "integrity"], `integrity ${entity.integrity}`));
  }
  for (const part of Object.keys(entity.parts).sort()) {
    const value = entity.parts[part]?.integrity;
    if (value !== undefined && (value < 0 || value > 100)) {
      issues.push(
        issue("integrity_out_of_range", [...path, "parts", part, "integrity"], `integrity ${value}`),
      );
    }
  }
  return issues;
}

// Every entity's props are held to the same schema a template's are: each prop the engine's table
// or the template's own `fields` declares, with a value of the right type and every `requires` met
// by the template's own declared props. The entity's props never meet a requirement: the preset,
// not the story, grants what a field needs.
function propIssues(
  registry: TemplateRegistry,
  entity: Entity,
  id: Id,
  path: string[],
): SnapshotIssue[] {
  const issues: SnapshotIssue[] = [];
  const template: Partial<Template> = own(registry, entity.template) ?? {};
  for (const [name, value] of Object.entries(entity.props)) {
    const engine = PROP_FIELDS[name];
    const field = engine ?? template.fields?.[name];
    if (engine) {
      if (!propTypeMatches(engine.type, value)) {
        issues.push(issue("wrong_prop_type", [...path, "props", name], `props.${name} must be ${engine.type}`));
      }
    } else if (field !== undefined) {
      if (!propTypeMatches(field.type, value)) {
        issues.push(issue("wrong_prop_type", [...path, "props", name], `props.${name} must be ${field.type}`));
      }
    } else {
      issues.push(issue("undeclared_prop", [...path, "props", name], `props.${name} is not a declared prop`));
    }
    const requires = engine?.requires;
    if (requires && requires.some((r) => !template.props?.[r])) {
      issues.push(
        issue("unmet_requires", [...path, "props", name], `props.${name} requires ${requires.join(", ")}`),
      );
    }
  }
  return issues;
}

// What sits in a holder's part: in_part is set exactly when the holder declares holder parts,
// names one that is present, grips pack lowest-first, and space contents fit.
function holderIssues(snapshot: Snapshot, registry: TemplateRegistry, id: Id, path: string[]): SnapshotIssue[] {
  const entity = own(snapshot.entities, id);
  if (entity === undefined) {
    return [];
  }
  if (entity.contained_in === null) {
    return entity.in_part === null
      ? []
      : [issue("in_part_holder_mismatch", [...path, "in_part"], `in_part ${String(entity.in_part)}`)];
  }
  // A missing holder already has its dangling_reference; the rules below read the other end.
  const holder = own(snapshot.entities, entity.contained_in);
  if (holder === undefined) {
    return [];
  }
  const layout = holderLayout(registry, holder.template);
  const declared = [...layout.grips, ...layout.spaces.map((space) => space.name)];
  if (entity.in_part === null) {
    return declared.length === 0
      ? []
      : [issue("in_part_holder_mismatch", [...path, "in_part"], `holder ${entity.contained_in}`)];
  }
  if (declared.length === 0) {
    return [issue("in_part_holder_mismatch", [...path, "in_part"], `in_part ${String(entity.in_part)}`)];
  }
  if (!declared.includes(entity.in_part)) {
    return [issue("in_part_unknown_part", [...path, "in_part"], entity.in_part)];
  }
  if (!partAvailable(snapshot, registry, entity.contained_in, entity.in_part)) {
    return [issue("in_part_unavailable", [...path, "in_part"], entity.in_part)];
  }
  return [];
}

// Grip packing and space fit read the holder's whole contents, so they run once per holder: one
// issue per holder, however many items share the fault.
function holderPackingIssues(snapshot: Snapshot, registry: TemplateRegistry): SnapshotIssue[] {
  const issues: SnapshotIssue[] = [];
  const holders = new Set<Id>();
  for (const id of Object.keys(snapshot.entities).sort()) {
    const holder = own(snapshot.entities, id)?.contained_in;
    if (holder !== null && holder !== undefined) {
      holders.add(holder);
    }
  }
  for (const holderId of [...holders].sort()) {
    const holder = own(snapshot.entities, holderId);
    const template = holder === undefined ? undefined : own(registry, holder.template);
    if (holder === undefined || template === undefined) {
      continue;
    }
    const layout = holderLayout(registry, holder.template);
    if (layout.grips.length === 0 && layout.spaces.length === 0) {
      continue;
    }
    const available = (name: string): boolean => partAvailable(snapshot, registry, holderId, name);
    const grips = layout.grips.filter(available);
    const gripHeld = heldInParts(snapshot, holderId).filter((item) => grips.includes(item.in_part));
    if (packGrips(grips, gripHeld) === null) {
      issues.push(issue("grip_occupied", ["entities", holderId], `holder ${holderId}`));
    }
    for (const space of layout.spaces) {
      if (!available(space.name)) {
        continue;
      }
      const oversized = heldInParts(snapshot, holderId)
        .filter((item) => item.in_part === space.name)
        .find((item) => {
          const size = own(registry, own(snapshot.entities, item.id)?.template ?? "")?.size_cm;
          return size !== undefined && misfit([size.w, size.d, size.h], [...space.inner]) !== null;
        });
      if (oversized !== undefined) {
        issues.push(issue("part_contents_too_large", ["entities", oversized.id, "in_part"], space.name));
        break;
      }
    }
  }
  return issues;
}

export function validateSnapshot(snapshot: Snapshot, registry: TemplateRegistry): SnapshotIssue[] {
  const issues: SnapshotIssue[] = [];
  const spawned = detachedIndex(snapshot);
  // One issue per loop, however many entities sit in it.
  const reportedLoops = new Set<Id>();
  const reportedConcealLoops = new Set<Id>();

  // Coverage chooses among what the engine computes; a name it has no rule for would answer false
  // where the world meant "modelled", so it is refused rather than answered.
  for (const { category, name } of uncomputable(snapshot.coverage)) {
    issues.push(issue("coverage_not_computable", ["coverage", category, name], name));
  }

  for (const id of Object.keys(snapshot.entities).sort()) {
    const entity = own(snapshot.entities, id);
    if (entity === undefined) {
      continue;
    }
    const path = ["entities", id];

    const numericId = /^e(\d+)$/.exec(id);
    if (numericId !== null && Number(numericId[1]) >= snapshot.next_seq) {
      issues.push(issue("id_not_below_next_seq", path, `next_seq ${snapshot.next_seq}`));
    }
    // A template is one of the registry's own keys: `constructor` is no template, and an entity of it
    // would break every read that trusts the registry to answer.
    if (own(registry, entity.template) === undefined) {
      issues.push(issue("unknown_template", [...path, "template"], entity.template));
    }
    issues.push(...integrityIssues(snapshot, id, path));
    issues.push(...referenceIssues(snapshot, id, path));
    issues.push(...containerFitIssues(snapshot, registry, id, path));
    issues.push(...traitIssues(entity, path));
    issues.push(...concealmentIssues(snapshot, registry, reportedConcealLoops, id, path));
    issues.push(...holderIssues(snapshot, registry, id, path));
    issues.push(...propIssues(registry, entity, id, path));

    // A room is where things are, never a thing somewhere: nothing holds, supports or hides it.
    if (
      entity.template === "room" &&
      (entity.support !== null || entity.contained_in !== null || entity.concealed_by !== null)
    ) {
      const where = `support ${entity.support} contained_in ${entity.contained_in}`;
      issues.push(issue("room_placed", path, where));
    }

    // One entity sits in one place: it is either set down on something or inside something, never
    // both, which also keeps the chain single-valued for the walk below.
    if (entity.support !== null && entity.contained_in !== null) {
      issues.push(
        issue(
          "support_and_contained_in",
          path,
          `support ${entity.support} contained_in ${entity.contained_in}`,
        ),
      );
    }

    // A missing link already has its issue; the rules below read chains, so they stay out of the
    // way rather than pile onto it.
    const chainDangles =
      (entity.support !== null && own(snapshot.entities, entity.support) === undefined) ||
      (entity.contained_in !== null && own(snapshot.entities, entity.contained_in) === undefined);
    if (!chainDangles) {
      const loop = chainLoop(snapshot, id);
      if (loop !== null) {
        const name = [...loop].sort()[0] ?? id;
        if (!reportedLoops.has(name)) {
          reportedLoops.add(name);
          issues.push(issue("support_or_containment_cycle", path, `loop: ${[...loop].sort().join(", ")}`));
        }
      }

      const support = entity.support === null ? undefined : own(snapshot.entities, entity.support);
      if (support?.template === "room") {
        if (entity.pos === null) {
          issues.push(issue("room_support_without_pos", path, `support ${entity.support}`));
        }
      } else if (entity.pos !== null) {
        issues.push(issue("pos_without_room_support", path, `support ${String(entity.support)}`));
      }

      // Location is derived state: the room at the end of the support or containment chain.
      if (entity.location === null || own(snapshot.entities, entity.location) !== undefined) {
        const expected = derivedLocation(snapshot, id);
        if (expected !== undefined && entity.location !== expected) {
          issues.push(issue("location_mismatch", path, `location ${String(entity.location)}`));
        }
      }
    }

    const template = own(registry, entity.template);
    for (const part of Object.keys(entity.parts).sort()) {
      const state = entity.parts[part];
      if (state?.status === "detached" && !accountedFor(snapshot, registry, spawned, id, part)) {
        issues.push(issue("detached_part_without_entity", [...path, "parts", part], "detached"));
      }
      // A part at its template default is never stored, so each state has one stored form.
      const decl = template?.parts.find((candidate) => candidate.name === part);
      if (state !== undefined && decl !== undefined && isDefaultPart(decl, state)) {
        issues.push(issue("part_at_default", [...path, "parts", part], "default"));
      }
      // A severed subtree is stored as its root alone; below it, state lives on the severed entity.
      if (
        state !== undefined &&
        state.status !== "detached" &&
        effectivePart(template, entity, part)?.status === "detached"
      ) {
        issues.push(issue("part_under_detached", [...path, "parts", part], state.status));
      }
    }
  }

  issues.push(...holderPackingIssues(snapshot, registry));
  issues.push(...scheduleIssues(snapshot));
  if (snapshot.rng !== undefined && !isRngState(snapshot.rng)) {
    issues.push(issue("invalid_rng", ["rng"], String(snapshot.rng)));
  }

  return issues;
}

// What is pending is stored one way: no empty list, every cause still ahead of the clock (the
// clock runs what falls due, so nothing due is ever left), in due order, on an entity that exists.
function scheduleIssues(snapshot: Snapshot): SnapshotIssue[] {
  if (snapshot.schedule === undefined) {
    return [];
  }
  if (snapshot.schedule.length === 0) {
    return [issue("empty_schedule", ["schedule"], "empty")];
  }
  const issues: SnapshotIssue[] = [];
  let previous = -Infinity;
  const running = new Set<string>();
  snapshot.schedule.forEach((cause, index) => {
    const path = ["schedule", String(index)];
    if (!CAUSE_KINDS.includes(cause.kind)) {
      issues.push(issue("unknown_cause_kind", path, String(cause.kind)));
    }
    if (!Number.isSafeInteger(cause.due_tick) || cause.due_tick <= snapshot.tick) {
      issues.push(issue("schedule_not_ahead", path, `due ${cause.due_tick} at tick ${snapshot.tick}`));
    } else if (cause.due_tick < previous) {
      issues.push(issue("schedule_unordered", path, `due ${cause.due_tick} after ${previous}`));
    }
    previous = Math.max(previous, cause.due_tick);
    if (own(snapshot.entities, cause.entity) === undefined) {
      issues.push(issue("schedule_dangling", path, cause.entity));
    }
    // A process runs at most once at a time on an entity: reconcile never schedules a second.
    if (cause.kind === "process") {
      const key = `${cause.entity}/${cause.process}`;
      if (running.has(key)) {
        issues.push(issue("duplicate_process", path, key));
      }
      running.add(key);
    }
    const broken = causeInvalid(cause);
    if (broken !== null) {
      issues.push(issue(broken.code, path, broken.detail));
    }
  });
  // Beats share one namespace of ids, their followers' included, and a bounded number of them.
  const ids = pendingBeatIds(snapshot.schedule);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push(issue("duplicate_beat", ["schedule"], id));
    }
    seen.add(id);
  }
  if (ids.length > MAX_BEATS) {
    issues.push(issue("too_many_beats", ["schedule"], String(ids.length)));
  }
  return issues;
}