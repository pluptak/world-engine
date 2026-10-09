import type { Entity, Id } from "../../model.js";
import type { CapacityRequirement, CommandContext, PreconditionResult, TargetAddress, TransitionContext, Verb } from "../command.js";
import { capacityRefusal } from "../carry.js";
import { reachedAsDoor, withinReach, reachData } from "./address.js";
import { pushOccupantsAside } from "./gate.js";
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
const openRefuses = ["not_openable", "out_of_reach", "already_open", "locked"] as const;
const closeRefuses = ["not_openable", "out_of_reach", "already_closed"] as const;
const lockRefuses = ["not_openable", "out_of_reach", "already_locked", "no_key", "insufficient_manipulation"] as const;
const unlockRefuses = ["not_openable", "out_of_reach", "already_unlocked", "no_key", "insufficient_manipulation"] as const;

const refuses: Record<Kind, readonly string[]> = {
  open: openRefuses,
  close: closeRefuses,
  lock: lockRefuses,
  unlock: unlockRefuses,
};

type Target =
  | { status: "resolved"; entity: Entity }
  | { status: "failed"; result: PreconditionResult };

// A door is in reach from anywhere in either room it joins when it has no position of its own, or
// when it stands in the other room (`reachedAsDoor`); anything else is reached the ordinary way.
function inReach(context: CommandContext, entity: Entity): boolean {
  if (reachedAsDoor(context.snapshot, context.actor.id, entity)) {
    return true;
  }
  return entity.pos !== null
    ? withinReach(context, entity.id)
    : entity.location === context.actor.location;
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

  // Opening what is open, shutting what is shut, locking what is locked or unlocking what is not
  // would change nothing but the clock.
  if (kind === "open" && entity.props.open === true) {
    return { status: "refused", reason_code: "already_open" };
  }
  if (kind === "close" && entity.props.open !== true) {
    return { status: "refused", reason_code: "already_closed" };
  }
  if (kind === "lock" && entity.props.locked === true) {
    return { status: "refused", reason_code: "already_locked" };
  }
  if (kind === "unlock" && entity.props.locked !== true) {
    return { status: "refused", reason_code: "already_unlocked" };
  }
  if (kind === "open" && entity.props.locked === true) {
    return { status: "refused", reason_code: "locked" };
  }
  if (changes[kind].needsKey && !carriedKeyFor(context, entity.id)) {
    return { status: "refused", reason_code: "no_key" };
  }
  const capacity = capacityRefusal(context);
  if (capacity !== null) {
    return capacity;
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
  if (kind === "close") {
    pushOccupantsAside(context, target.entity.id, eventId);
  }

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