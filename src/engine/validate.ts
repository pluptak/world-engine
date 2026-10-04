import type { Entity, Id, Snapshot } from "../model.js";
import type { TemplateRegistry } from "../templates.js";

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

    const entity: Entity | undefined = snapshot.entities[current];
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

    const entity: Entity | undefined = snapshot.entities[current];
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
  const entity = snapshot.entities[id];
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
    const origin = snapshot.entities[id]?.detached_from;
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
  const owner = snapshot.entities[ownerId];
  const template = owner === undefined ? undefined : registry[owner.template];
  const visited = new Set<string>();
  let name: string | null = partName;

  while (name !== null) {
    if (visited.has(name)) {
      throw new TypeError(`Part cycle at ${name}`);
    }
    visited.add(name);

    if (spawned.has(`${ownerId} ${name}`)) {
      return true;
    }
    name = template?.parts.find((part) => part.name === name)?.parent ?? null;
  }

  return false;
}

function referenceIssues(snapshot: Snapshot, id: Id, path: string[]): SnapshotIssue[] {
  const entity = snapshot.entities[id];
  if (entity === undefined) {
    return [];
  }

  const issues: SnapshotIssue[] = [];
  // detached_from is history, not a live link: the origin may itself be gone while the entity it
  // produced remains, so it is not checked here.
  if (entity.support !== null && snapshot.entities[entity.support] === undefined) {
    issues.push(issue("dangling_reference", [...path, "support"], `unknown entity ${entity.support}`));
  }
  if (entity.contained_in !== null && snapshot.entities[entity.contained_in] === undefined) {
    issues.push(
      issue("dangling_reference", [...path, "contained_in"], `unknown entity ${entity.contained_in}`),
    );
  }
  if (entity.location !== null && snapshot.entities[entity.location] === undefined) {
    issues.push(
      issue("dangling_reference", [...path, "location"], `unknown entity ${entity.location}`),
    );
  }
  // Doors name the rooms they join in props, outside the support and containment relations: a side
  // that names anything else joins nothing, so it is not a door's side at all.
  if (entity.template === "door") {
    for (const side of ["from", "to"] as const) {
      const ref = entity.props[side];
      if (typeof ref !== "string") {
        continue;
      }
      const target = snapshot.entities[ref];
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
    const target = snapshot.entities[opens];
    if (target !== undefined && target.props.openable !== true) {
      issues.push(issue("opens_target_not_openable", [...path, "props", "opens"], opens));
    }
  }
  return issues;
}

function integrityIssues(snapshot: Snapshot, id: Id, path: string[]): SnapshotIssue[] {
  const entity = snapshot.entities[id];
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

export function validateSnapshot(snapshot: Snapshot, registry: TemplateRegistry): SnapshotIssue[] {
  const issues: SnapshotIssue[] = [];
  const spawned = detachedIndex(snapshot);
  // One issue per loop, however many entities sit in it.
  const reportedLoops = new Set<Id>();

  for (const id of Object.keys(snapshot.entities).sort()) {
    const entity = snapshot.entities[id];
    if (entity === undefined) {
      continue;
    }
    const path = ["entities", id];

    const numericId = /^e(\d+)$/.exec(id);
    if (numericId !== null && Number(numericId[1]) >= snapshot.next_seq) {
      issues.push(issue("id_not_below_next_seq", path, `next_seq ${snapshot.next_seq}`));
    }
    issues.push(...integrityIssues(snapshot, id, path));
    issues.push(...referenceIssues(snapshot, id, path));

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
      (entity.support !== null && snapshot.entities[entity.support] === undefined) ||
      (entity.contained_in !== null && snapshot.entities[entity.contained_in] === undefined);
    if (!chainDangles) {
      const loop = chainLoop(snapshot, id);
      if (loop !== null) {
        const name = [...loop].sort()[0] ?? id;
        if (!reportedLoops.has(name)) {
          reportedLoops.add(name);
          issues.push(issue("support_or_containment_cycle", path, `loop: ${[...loop].sort().join(", ")}`));
        }
      }

      const support = entity.support === null ? undefined : snapshot.entities[entity.support];
      if (support?.template === "room") {
        if (entity.pos === null) {
          issues.push(issue("room_support_without_pos", path, `support ${entity.support}`));
        }
      } else if (entity.pos !== null) {
        issues.push(issue("pos_without_room_support", path, `support ${String(entity.support)}`));
      }

      // Location is derived state: the room at the end of the support or containment chain.
      if (entity.location === null || snapshot.entities[entity.location] !== undefined) {
        const expected = derivedLocation(snapshot, id);
        if (expected !== undefined && entity.location !== expected) {
          issues.push(issue("location_mismatch", path, `location ${String(entity.location)}`));
        }
      }
    }

    for (const part of Object.keys(entity.parts).sort()) {
      const state = entity.parts[part];
      if (state?.status === "detached" && !accountedFor(snapshot, registry, spawned, id, part)) {
        issues.push(issue("detached_part_without_entity", [...path, "parts", part], "detached"));
      }
    }
  }

  return issues;
}