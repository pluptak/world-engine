import type { TransitionContext } from "./command.js";
import { inSpacePart } from "./carry.js";
import { dropCarriedItem } from "./verbs/drop.js";
import { own, type Id } from "../model.js";
import { spawnUnder } from "./spawn.js";

// Takes `amount` from an entity's own integrity under a `damaged` event, or a `destroyed` one that
// sets its status when nothing is left; a body that is destroyed holds nothing, so what its grips and
// mouth held falls where it stands, each fall caused by the `destroyed`, and what is pocketed stays
// with it. Returns the event emitted, or null when the entity is gone or already destroyed. Shared
// by a bleed and by a process's `damage`, so both read as the same chain.
export function hurt(
  context: TransitionContext,
  entityId: Id,
  amount: number,
  causeId: Id | null,
): { eventId: Id; destroyed: boolean } | null {
  const entity = context.snapshot.entities[entityId];
  if (entity === undefined || entity.status === "destroyed") {
    return null;
  }
  const integrity = Math.max(0, entity.integrity - amount);
  const eventId = context.emit(integrity === 0 ? "destroyed" : "damaged", entity.id, { integrity }, causeId);
  context.set(entity.id, "integrity", integrity, eventId);
  if (integrity > 0) {
    return { eventId, destroyed: false };
  }
  context.set(entity.id, "status", "destroyed", eventId);
  const body = context.snapshot.entities[entity.id]!;
  const held = Object.keys(context.snapshot.entities)
    .sort()
    .filter((id) => {
      const item = context.snapshot.entities[id]!;
      return item.contained_in === body.id && !inSpacePart(context.registry, body, item);
    });
  for (const itemId of held) {
    dropCarriedItem(context, body.id, itemId, eventId);
  }
  // A body whose template names a successor leaves one where it lay, caused by its destruction. The body stays,
  // destroyed, and the successor's `succeeds` is the record of whose it is (`docs/templates.md`).
  const successor = own(context.registry, body.template)?.props.successor;
  if (typeof successor === "string") {
    spawnUnder(
      context,
      successor,
      { name: body.name, location: body.location, support: body.support, pos: body.pos, props: { succeeds: body.id } },
      eventId,
    );
  }
  return { eventId, destroyed: true };
}
