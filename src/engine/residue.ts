import type { Id } from "../model.js";
import type { TransitionContext } from "./command.js";

export function addResidue(
  context: TransitionContext,
  surfaceId: Id,
  additions: Record<string, number>,
  eventId: Id,
): void {
  const surface = context.snapshot.entities[surfaceId];
  if (surface === undefined) {
    throw new TypeError(`Unknown residue surface ${surfaceId}`);
  }

  const residue = { ...surface.residue };
  for (const material of Object.keys(additions).sort()) {
    residue[material] = (residue[material] ?? 0) + (additions[material] ?? 0);
  }
  context.set(surfaceId, "residue", residue, eventId);
}