import type { Entity, Id } from "../../model.js";
import type { CapacityRequirement, CommandContext, PreconditionResult, TargetAddress, TransitionContext, Verb } from "../command.js";
import { capacityRefusal } from "../carry.js";
import { reachedAsDoor, withinReach, reachData } from "./address.js";
import { controller, panelFault, panelFor, remoteFault, type RemoteFault } from "../power.js";

type Kind = "switch_on" | "switch_off";

// Flipping a switch takes hands, as turning a key does.
const requirements: readonly CapacityRequirement[] = [{ capacity: "manipulation", at_least: 50 }];

const switchArgs: Readonly<Record<string, never>> = {};
const switchRefuses = ["not_switchable", "out_of_reach", "disconnected", "unpowered", "insufficient_manipulation"] as const;
const onRefuses = [...switchRefuses, "already_on"] as const;
const offRefuses = [...switchRefuses, "already_off"] as const;

const refuses: Record<Kind, readonly string[]> = {
  switch_on: onRefuses,
  switch_off: offRefuses,
};

const value: Record<Kind, boolean> = {
  switch_on: true,
  switch_off: false,
};

type Target =
  | { status: "resolved"; entity: Entity }
  | { status: "failed"; result: PreconditionResult };

// A switchable target is a power source or a link toward one. A door without a door position is
// reached from either room it joins, as an openable is; anything else the ordinary way.
function inReach(context: CommandContext, entity: Entity): boolean {
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
  if (controller(context.snapshot, entity.id) === context.actor.id || inReach(context, entity)) {
    return null;
  }
  return panelFor(context.snapshot, entity.id, context.actor.id);
}

// A device whose control walk ends at the actor takes its command there, and so does one an actor
// works through a panel on its walk: no reach or hands, only links that carry it, exactly as `open`
// does (`docs/power.md`, `docs/panel.md`; the walks themselves in `src/engine/power.ts`).
function remote(context: CommandContext, entity: Entity): boolean {
  return controller(context.snapshot, entity.id) === context.actor.id || panelUsed(context, entity) !== null;
}

// What a remote command meets on the way: its controller's walk, or the walk as far as the panel it goes through.
function remoteFaultFor(context: CommandContext, entity: Entity): RemoteFault | null {
  const panel = panelUsed(context, entity);
  return panel === null ? remoteFault(context.snapshot, entity.id) : panelFault(context.snapshot, entity.id, panel);
}

function switchTarget(context: CommandContext, address: TargetAddress | null): Target {
  if (address === null) {
    return { status: "failed", result: { status: "invalid", reason_code: "missing_target" } };
  }
  const entity = context.snapshot.entities[address.entity_id];
  if (entity === undefined) {
    return { status: "failed", result: { status: "invalid", reason_code: "no_such_entity" } };
  }
  if (entity.props.power_source !== true && typeof entity.props.powered_by !== "string") {
    return { status: "failed", result: { status: "refused", reason_code: "not_switchable" } };
  }
  if (!remote(context, entity) && !inReach(context, entity)) {
    const data = reachData(context.snapshot, context.actor.id, entity.id);
    return {
      status: "failed",
      result: {
        status: "refused",
        reason_code: "out_of_reach",
        ...(data !== null && { reason_data: data }),
      },
    };
  }
  return { status: "resolved", entity };
}

function preconditions(context: CommandContext, kind: Kind): PreconditionResult {
  const target = switchTarget(context, context.target);
  if (target.status === "failed") {
    return target.result;
  }
  const entity = target.entity;

  // Flipping a switch already that way would change nothing but the clock.
  if (kind === "switch_on" && entity.props.on !== false) {
    return { status: "refused", reason_code: "already_on" };
  }
  if (kind === "switch_off" && entity.props.on === false) {
    return { status: "refused", reason_code: "already_off" };
  }
  if (remote(context, entity)) {
    const fault = remoteFaultFor(context, entity);
    return fault === null ? { status: "ok" } : { status: "refused", ...fault };
  }
  const capacity = capacityRefusal(context);
  if (capacity !== null) {
    return capacity;
  }
  return { status: "ok" };
}

function transition(context: TransitionContext, kind: Kind): void {
  const target = switchTarget(context, context.target);
  if (target.status === "failed") {
    throw new TypeError("Switch target changed after validation");
  }
  const on = value[kind];
  const eventId = context.emit("switched", target.entity.id, { on }, context.root_event_id);
  context.set(target.entity.id, "props", { ...target.entity.props, on }, eventId);
}

function makeVerb(kind: Kind): Verb {
  return {
    requires_target: true,
    args: switchArgs,
    refuses: refuses[kind],
    duration: { ticks: 1 },
    requires: requirements,
    preconditions: (context) => preconditions(context, kind),
    transition: (context) => transition(context, kind),
  };
}

export const switchOnVerb = makeVerb("switch_on");
export const switchOffVerb = makeVerb("switch_off");
