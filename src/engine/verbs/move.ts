import { capacity } from "../capacity.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import type { Pos } from "../../model.js";
import { refreshSubtreeLocations } from "./address.js";
import { effectivePos, walkStop, type WalkStop } from "../geometry.js";

type MoveDestination = { kind: "position"; pos: Pos } | { kind: "location"; id: string };

function destination(context: CommandContext): MoveDestination | null {
  const args = context.command.args;
  if (args === undefined) {
    return null;
  }

  if (args.to !== undefined && args.location === undefined) {
    const pos = args.to;
    if (
      pos !== null &&
      typeof pos === "object" &&
      !Array.isArray(pos) &&
      "x" in pos &&
      "y" in pos &&
      Number.isSafeInteger(pos.x) &&
      Number.isSafeInteger(pos.y)
    ) {
      return { kind: "position", pos: { x: pos.x as number, y: pos.y as number } };
    }
    return null;
  }

  if (args.location !== undefined && args.to === undefined && typeof args.location === "string") {
    return { kind: "location", id: args.location };
  }
  return null;
}

function hasOpenDoor(context: CommandContext, to: string): boolean {
  const from = context.actor.location;
  return Object.keys(context.snapshot.entities)
    .sort()
    .some((id) => {
      const entity = context.snapshot.entities[id];
      return (
        entity !== undefined &&
        entity.template === "door" &&
        entity.props.open === true &&
        ((entity.props.from === from && entity.props.to === to) ||
          (entity.props.from === to && entity.props.to === from))
      );
    });
}

function preconditions(context: CommandContext): PreconditionResult {
  const to = destination(context);
  if (to === null) {
    return { status: "invalid", reason_code: "invalid_args" };
  }

  const moving = capacity(context.snapshot, context.registry, context.actor.id, "moving") ?? 0;
  if (moving < 1) {
    return {
      status: "refused",
      reason_code: "insufficient_moving",
      reason_data: { capacity: "moving", have: moving, need: 1 },
    };
  }

  if (to.kind === "location") {
    const location = context.snapshot.entities[to.id];
    if (location === undefined || location.template !== "room") {
      return { status: "invalid", reason_code: "invalid_location" };
    }
    if (to.id !== context.actor.location && !hasOpenDoor(context, to.id)) {
      return { status: "refused", reason_code: "no_open_door" };
    }
  }

  return refusedBy(stopFor(context, to));
}

// Where the walk would stop: a position is walked to in this room, and a room is arrived in at the
// same coordinates, as `transition` places it.
function stopFor(context: CommandContext, to: MoveDestination): WalkStop {
  const { snapshot, registry, actor } = context;
  if (to.kind === "position") {
    return walkStop(snapshot, registry, actor.id, to.pos);
  }
  const pos = effectivePos(snapshot, actor.id);
  if (pos === null || to.id === actor.location || actor.support !== actor.location) {
    return null;
  }
  const arrived = { ...actor, location: to.id, support: to.id };
  return walkStop({ ...snapshot, entities: { ...snapshot.entities, [actor.id]: arrived } }, registry, actor.id, pos, true);
}

function refusedBy(stop: WalkStop): PreconditionResult {
  if (stop === null) {
    return { status: "ok" };
  }
  return stop.reason === "blocked"
    ? { status: "refused", reason_code: "blocked", reason_data: { with: stop.with } }
    : { status: "refused", reason_code: "out_of_bounds" };
}

function transition(context: TransitionContext): void {
  const to = destination(context);
  if (to === null) {
    throw new TypeError("Move destination changed after validation");
  }

  const movedEvent = context.emit("moved", context.actor.id, {}, context.root_event_id);
  if (to.kind === "position") {
    context.set(context.actor.id, "pos", to.pos, movedEvent);
  } else {
    context.set(context.actor.id, "location", to.id, movedEvent);
    context.set(context.actor.id, "support", to.id, movedEvent);
  }
  // What the actor holds or carries moves rooms with it; a positional move changes nothing.
  refreshSubtreeLocations(context, context.actor.id, movedEvent);
}

export const moveVerb: Verb = {
  duration: { ticks: 1 },
  requires_target: false,
  args: { to: { kind: "pos" }, location: { kind: "room" } },
  refuses: ["insufficient_moving", "no_open_door", "blocked", "out_of_bounds"],
  preconditions,
  transition,
};
