import type { Entity } from "../../model.js";
import type { CapacityRequirement, CommandContext, PreconditionResult, TargetAddress, TransitionContext, Verb } from "../command.js";
import { capacityRefusal } from "../carry.js";
import { reachData } from "./address.js";
import { deviceInReach as inReach, remoteFaultFor, worksRemotely as remote } from "./remote.js";

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

// A device's props with its switch on: `on` absent is on (`docs/power.md`).
function withoutOn(props: Entity["props"]): Entity["props"] {
  const { on: _on, ...rest } = props;
  return rest;
}

// A switchable target is a power source or a link toward one, reached as any device is (`remote.ts`).
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
    // A link switched off has no power of its own, so a walk through it would refuse the very command that switches it
    // back on: `switch_on` judges the walk as it would carry the command, the link on.
    const judged =
      kind === "switch_on"
        ? { ...context.snapshot, entities: { ...context.snapshot.entities, [entity.id]: { ...entity, props: withoutOn(entity.props) } } }
        : context.snapshot;
    const fault = remoteFaultFor(context, entity, judged);
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
