import type { Id } from "../../model.js";
import type { TransitionContext } from "../command.js";
import { occupantsIn, pushAsideDestination } from "../geometry.js";
import { revealConcealed } from "./search.js";

// A gate or door that shuts, by hand or by itself, first moves everything on its footprint just
// clear, as a placement: nothing is swept, and a thing may end up overlapping what stands there.
// Each `moved` is caused by the `closed`, and a moved thing uncovers what it hid, as every mover
// does.
export function pushOccupantsAside(context: TransitionContext, gateId: Id, closedEvent: Id): void {
  for (const occupantId of occupantsIn(context.snapshot, context.registry, gateId)) {
    const destination = pushAsideDestination(context.snapshot, context.registry, gateId, occupantId);
    const movedEvent = context.emit("moved", occupantId, {}, closedEvent);
    context.set(occupantId, "pos", destination, movedEvent);
    revealConcealed(context, occupantId, movedEvent);
  }
}
