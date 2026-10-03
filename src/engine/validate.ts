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
      return path.slice(seenAt);
    }
    current = entity.contained_in ?? entity.support;
  }

  return null;
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

    for (const part of Object.keys(entity.parts).sort()) {
      const state = entity.parts[part];
      if (state?.status === "detached" && !accountedFor(snapshot, registry, spawned, id, part)) {
        issues.push(issue("detached_part_without_entity", [...path, "parts", part], "detached"));
      }
    }
  }

  return issues;
}