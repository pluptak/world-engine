import type { Entity, Id, Snapshot } from "../../model.js";
import type { CommandContext } from "../command.js";
import { reachedAsDoor, withinReach } from "./address.js";
import { controller, panelFault, panelFor, remoteFault, type RemoteFault } from "../power.js";

// How a device is reached by hand or worked from afar, shared by the verbs that work devices: `open`, `close`, `lock`
// and `unlock` (`openable.ts`) and the switches (`switch.ts`). The walks themselves are in `src/engine/power.ts`.

// A door is in reach from anywhere in either room it joins when it has no position of its own, or
// when it stands in the other room (`reachedAsDoor`); anything else is reached the ordinary way.
export function deviceInReach(context: CommandContext, entity: Entity): boolean {
  if (reachedAsDoor(context.snapshot, context.actor.id, entity)) {
    return true;
  }
  return entity.pos !== null
    ? withinReach(context, entity.id)
    : entity.location === context.actor.location;
}

// The panel an actor that cannot reach a device by hand works it through: it is not the device's
// controller, and a panel on the device's walk, intact and in its reach, is the one (`panelFor`).
function panelUsed(context: CommandContext, entity: Entity): Id | null {
  if (controller(context.snapshot, entity.id) === context.actor.id || deviceInReach(context, entity)) {
    return null;
  }
  return panelFor(context.snapshot, entity.id, context.actor.id);
}

// A device whose control walk ends at the actor takes its command there, and so does one an actor
// works through a panel on its walk: no reach, key or hands, only links that carry it (`docs/power.md`,
// `docs/panel.md`).
export function worksRemotely(context: CommandContext, entity: Entity): boolean {
  return controller(context.snapshot, entity.id) === context.actor.id || panelUsed(context, entity) !== null;
}

// What a remote command meets on the way: its controller's walk, or the walk as far as the panel it goes through,
// judged in `snapshot` (the world as it is, unless a verb judges the walk as it would carry the command).
export function remoteFaultFor(context: CommandContext, entity: Entity, snapshot: Snapshot = context.snapshot): RemoteFault | null {
  const panel = panelUsed(context, entity);
  return panel === null ? remoteFault(snapshot, entity.id) : panelFault(snapshot, entity.id, panel);
}
