import type { Id, Snapshot } from "../model.js";
import type { TargetAddress } from "./command.js";

export type TargetResolution =
  | { status: "resolved"; target: TargetAddress }
  | { status: "unresolved" }
  | { status: "ambiguous"; candidates: Id[] };

function resolved(entityId: Id, part: string | null = null): TargetResolution {
  return {
    status: "resolved",
    target: {
      entity_id: entityId,
      part,
      address: part === null ? entityId : `${entityId}.${part}`,
    },
  };
}

export function resolveTarget(
  snapshot: Snapshot,
  actorId: Id,
  text: string,
): TargetResolution {
  if (Object.hasOwn(snapshot.entities, text)) {
    return resolved(text);
  }

  const separator = text.lastIndexOf(".");
  if (separator > 0) {
    const entityId = text.slice(0, separator);
    const partName = text.slice(separator + 1);
    const entity = snapshot.entities[entityId];
    const state = entity?.parts[partName];
    if (state !== undefined && state.status !== "detached") {
      return resolved(entityId, partName);
    }
  }

  const actor = snapshot.entities[actorId];
  if (actor === undefined) {
    return { status: "unresolved" };
  }

  const search = text.toLowerCase();
  const matches = Object.keys(snapshot.entities)
    .sort()
    .filter((id) => {
      const entity = snapshot.entities[id];
      if (entity === undefined || entity.location !== actor.location) {
        return false;
      }
      return (
        entity.name.toLowerCase() === search ||
        entity.aliases.some((alias) => alias.toLowerCase() === search)
      );
    });

  if (matches.length === 0) {
    return { status: "unresolved" };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", candidates: matches };
  }
  return resolved(matches[0]!);
}
