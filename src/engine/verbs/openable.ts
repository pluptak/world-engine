import { capacities } from "../capacity.js";
import type { Entity, Id } from "../../model.js";
import type { CapacityRequirement, CommandContext, PreconditionResult, TargetAddress, TransitionContext, Verb } from "../command.js";
import { insufficientCode, meetsRequirements, unmetRequirement } from "../carry.js";
import { withinReach, reachData } from "./address.js";
import { cancel, schedule } from "../schedule.js";

type Kind = "open" | "close" | "lock" | "unlock";

interface Change {
  prop: string;
  value: boolean;
  event: string;
  needsKey: boolean;
}

const changes: Record<Kind, Change> = {
  open: { prop: "open", value: true, event: "opened", needsKey: false },
  close: { prop: "open", value: false, event: "closed", needsKey: false },
  lock: { prop: "locked", value: true, event: "locked", needsKey: true },
  unlock: { prop: "locked", value: false, event: "unlocked", needsKey: true },
};

// Turning a key needs hands; nosing a door open or shut does not.
const requirements: Record<Kind, readonly CapacityRequirement[] | undefined> = {
  open: undefined,
  close: undefined,
  lock: [{ capacity: "manipulation", at_least: 50 }],
  unlock: [{ capacity: "manipulation", at_least: 50 }],
};

const openableArgs: Readonly<Record<string, never>> = {};
const openRefuses = ["not_openable", "out_of_reach", "locked"] as const;
const closeRefuses = ["not_openable", "out_of_reach"] as const;
const keyRefuses = ["not_openable", "out_of_reach", "no_key", "insufficient_manipulation"] as const;

const refuses: Record<Kind, readonly string[]> = {
  open: openRefuses,
  close: closeRefuses,
  lock: keyRefuses,
  unlock: keyRefuses,
};

type Target =
  | { status: "resolved"; entity: Entity }
  | { status: "failed"; result: PreconditionResult };

// A door stands in the boundary between two rooms and carries no position of its own, so it is in
// reach from either room it joins; anything else is reached the ordinary way.
function inReach(context: CommandContext, entity: Entity): boolean {
  if (entity.pos !== null) {
    return withinReach(context, entity.id);
  }
  return (
    entity.location === context.actor.location ||
    entity.props.from === context.actor.location ||
    entity.props.to === context.actor.location
  );
}

function carriedKeyFor(context: CommandContext, targetId: Id): boolean {
  return Object.keys(context.snapshot.entities)
    .sort()
    .some((id) => {
      const entity = context.snapshot.entities[id];
      return entity?.contained_in === context.actor.id && entity.props.opens === targetId;
    });
}

function openableTarget(context: CommandContext, address: TargetAddress | null): Target {
  if (address === null) {
    return { status: "failed", result: { status: "invalid", reason_code: "missing_target" } };
  }

  const entity = context.snapshot.entities[address.entity_id];
  if (entity === undefined) {
    return { status: "failed", result: { status: "invalid", reason_code: "no_such_entity" } };
  }
  if (entity.props.openable !== true) {
    return { status: "failed", result: { status: "refused", reason_code: "not_openable" } };
  }
  if (!inReach(context, entity)) {
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
  const target = openableTarget(context, context.target);
  if (target.status === "failed") {
    return target.result;
  }
  const entity = target.entity;

  if (kind === "open" && entity.props.locked === true) {
    return { status: "refused", reason_code: "locked" };
  }
  if (changes[kind].needsKey && !carriedKeyFor(context, entity.id)) {
    return { status: "refused", reason_code: "no_key" };
  }
  const required = context.verb.requires ?? [];
  if (
    !meetsRequirements(capacities(context.snapshot, context.registry, context.actor.id), required)
  ) {
    const data = unmetRequirement(
      capacities(context.snapshot, context.registry, context.actor.id),
      required,
    );
    return {
      status: "refused",
      reason_code: insufficientCode(required),
      ...(data !== null && { reason_data: data }),
    };
  }

  return { status: "ok" };
}

function transition(context: TransitionContext, kind: Kind): void {
  const target = openableTarget(context, context.target);
  if (target.status === "failed") {
    throw new TypeError("Openable target changed after validation");
  }

  const change = changes[kind];
  const props = { ...context.snapshot.entities[target.entity.id]?.props, [change.prop]: change.value };
  const eventId = context.emit(change.event, target.entity.id, {}, context.root_event_id);
  context.set(target.entity.id, "props", props, eventId);

  // A target with `closes_after` swings shut that many ticks after it is opened; opening it again
  // starts the count over, and shutting it by hand leaves nothing to come.
  if (kind === "open" || kind === "close") {
    cancel(context, "close", target.entity.id);
  }
  const closesAfter = props.closes_after;
  if (kind === "open" && typeof closesAfter === "number" && closesAfter > 0) {
    const due = context.snapshot.tick + closesAfter;
    if (Number.isSafeInteger(due)) {
      schedule(context, { due_tick: due, kind: "close", entity: target.entity.id, cause_id: eventId });
    }
  }
}

function makeVerb(kind: Kind): Verb {
  return {
    requires_target: true,
    args: openableArgs,
    refuses: refuses[kind],
    duration: { ticks: 1 },
    ...(requirements[kind] !== undefined && { requires: requirements[kind] }),
    preconditions: (context) => preconditions(context, kind),
    transition: (context) => transition(context, kind),
  };
}

export const openVerb = makeVerb("open");
export const closeVerb = makeVerb("close");
export const lockVerb = makeVerb("lock");
export const unlockVerb = makeVerb("unlock");