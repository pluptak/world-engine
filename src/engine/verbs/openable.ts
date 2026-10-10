import type { Entity, Id } from "../../model.js";
import type { CapacityRequirement, CommandContext, PreconditionResult, TargetAddress, TransitionContext, Verb } from "../command.js";
import { capacityRefusal } from "../carry.js";
import { reachedAsDoor, withinReach, reachData } from "./address.js";
import { pushOccupantsAside } from "./gate.js";
import { cancel, schedule } from "../schedule.js";
import { controller, remoteFault } from "../power.js";

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
const remoteRefuses = ["disconnected", "unpowered"] as const;
const openRefuses = ["not_openable", "out_of_reach", "already_open", "locked", ...remoteRefuses] as const;
const closeRefuses = ["not_openable", "out_of_reach", "already_closed", "closing", ...remoteRefuses] as const;
const lockRefuses = [
  "not_openable",
  "out_of_reach",
  "already_locked",
  "closing",
  "no_key",
  "insufficient_manipulation",
  ...remoteRefuses,
] as const;
const unlockRefuses = [
  "not_openable",
  "out_of_reach",
  "already_unlocked",
  "no_key",
  "insufficient_manipulation",
  ...remoteRefuses,
] as const;

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

// A device whose control walk ends at the actor takes its command there: no reach, key or hands,
// only links that carry it (`docs/power.md`).
function remote(context: CommandContext, entity: Entity): boolean {
  return controller(context.snapshot, entity.id) === context.actor.id;
}

function preconditions(context: CommandContext, kind: Kind): PreconditionResult {
  const target = openableTarget(context, context.target);
  if (target.status === "failed") {
    return target.result;
  }
  const entity = target.entity;

  // Opening what is open, shutting what is shut, locking what is locked or unlocking what is not
  // would change nothing but the clock.
  // A door on its way shut is open still, so `open` is not a no-op for it: it stops the shut.
  if (kind === "open" && entity.props.open === true && entity.props.closing !== true) {
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
  // Until a door on its way shut has shut, neither a shut nor a lock can be made of it.
  if ((kind === "close" || kind === "lock") && entity.props.closing === true) {
    return { status: "refused", reason_code: "closing" };
  }
  if (remote(context, entity)) {
    const fault = remoteFault(context.snapshot, entity.id);
    return fault === null ? { status: "ok" } : { status: "refused", ...fault };
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

// A door with `shut_ticks` is shut that many ticks on, not at once: the window opens here, under a
// `closing` event, and the shut is a scheduled close caused by it. It stays open until then, so
// `move` goes through, and nothing is moved aside yet.
function startClosing(context: TransitionContext, entity: Entity, shutTicks: number): void {
  const eventId = context.emit("closing", entity.id, {}, context.root_event_id);
  context.set(entity.id, "props", { ...entity.props, closing: true }, eventId);
  cancel(context, "close", entity.id);
  schedule(context, {
    due_tick: context.snapshot.tick + shutTicks,
    kind: "close",
    entity: entity.id,
    cause_id: eventId,
  });
}

// A remote command to a device with a `jam_pct` rolls once, and a roll under the chance jams it: the
// tick is spent and the device does nothing else. A hand never rolls.
function jams(context: TransitionContext, entity: Entity): boolean {
  const pct = entity.props.jam_pct;
  if (typeof pct !== "number" || pct <= 0 || !remote(context, entity)) {
    return false;
  }
  return context.random() * 100 < pct;
}

function transition(context: TransitionContext, kind: Kind): void {
  const target = openableTarget(context, context.target);
  if (target.status === "failed") {
    throw new TypeError("Openable target changed after validation");
  }

  if (jams(context, target.entity)) {
    context.emit("jammed", target.entity.id, { verb: kind }, context.root_event_id);
    return;
  }

  // Opening stops a shut on its way, and a shut that has come clears the window (`schedule.ts`); an
  // unlock in the window leaves it as it is, the shut still to come.
  const current = context.snapshot.entities[target.entity.id]?.props ?? {};
  const { closing: _closing, ...others } = current;
  const shutTicks = target.entity.props.shut_ticks;
  const shutsLater =
    kind === "close" && typeof shutTicks === "number" && shutTicks > 0 && Number.isSafeInteger(context.snapshot.tick + shutTicks);
  if (shutsLater) {
    startClosing(context, target.entity, shutTicks);
    return;
  }

  const change = changes[kind];
  const props = { ...(kind === "open" ? others : current), [change.prop]: change.value };
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