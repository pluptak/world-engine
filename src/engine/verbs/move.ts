import { capacity } from "../capacity.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import type { Pos } from "../../model.js";

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
        entity.props.from === from &&
        entity.props.to === to
      );
    });
}

function preconditions(context: CommandContext): PreconditionResult {
  const to = destination(context);
  if (to === null) {
    return { status: "invalid", reason_code: "invalid_args" };
  }

  if ((capacity(context.snapshot, context.registry, context.actor.id, "moving") ?? 0) < 1) {
    return { status: "refused", reason_code: "insufficient_moving" };
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

  return { status: "ok" };
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
}

export const moveVerb: Verb = {
  requires_target: false,
  preconditions,
  transition,
};
