import { capacity } from "../capacity.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import type { Pos } from "../../model.js";
import { refreshSubtreeLocations, subtreeOf } from "./address.js";
import { revealConcealed } from "./search.js";
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

// The rooms an agent can name: its own, and those a doorway of its own room leads to, open or shut,
// as `addressable` gropes for a door from either room it joins. Any other room id answers as one
// that does not exist, so `move` cannot be used to map the world.
function nameableRoom(context: CommandContext, to: string): boolean {
  const here = context.actor.location;
  if (to === here) {
    return true;
  }
  return Object.keys(context.snapshot.entities)
    .sort()
    .some((id) => {
      const props = context.snapshot.entities[id]?.props;
      return (
        props !== undefined &&
        ((props.from === here && props.to === to) || (props.from === to && props.to === here))
      );
    });
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
  // Held in someone's grip or mouth, an agent goes where it is carried.
  if (context.actor.contained_in !== null) {
    const by = context.actor.contained_in;
    return { status: "refused", reason_code: "carried", reason_data: { by } };
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
    if (location === undefined || location.template !== "room" || !nameableRoom(context, to.id)) {
      return { status: "invalid", reason_code: "invalid_location" };
    }
    if (to.id !== context.actor.location && !hasOpenDoor(context, to.id)) {
      return { status: "refused", reason_code: "no_open_door" };
    }
  }

  return refusedBy(stopFor(context, to));
}

// An agent standing on the floor walks; one standing on something else (a table an edit put it on)
// steps down, and like one arriving through a door is checked only where it lands.
function onFloor(context: CommandContext): boolean {
  return context.actor.support !== null && context.actor.support === context.actor.location;
}

function landing(context: CommandContext, room: string, pos: Pos): WalkStop {
  const { snapshot, registry, actor } = context;
  const arrived = { ...actor, location: room, support: room, pos };
  const there = { ...snapshot, entities: { ...snapshot.entities, [actor.id]: arrived } };
  return walkStop(there, registry, actor.id, pos, true);
}

// Where the walk would stop: a position is walked to in this room, and a room is arrived in at the
// same coordinates, as `transition` places it.
function stopFor(context: CommandContext, to: MoveDestination): WalkStop {
  const { snapshot, registry, actor } = context;
  if (to.kind === "position") {
    return onFloor(context)
      ? walkStop(snapshot, registry, actor.id, to.pos)
      : landing(context, actor.location!, to.pos);
  }
  const pos = effectivePos(snapshot, actor.id);
  if (pos === null || (to.id === actor.location && onFloor(context))) {
    return null;
  }
  return landing(context, to.id, pos);
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

  const from = effectivePos(context.snapshot, context.actor.id);
  const movedEvent = context.emit("moved", context.actor.id, {}, context.root_event_id);
  const room = to.kind === "position" ? context.actor.location! : to.id;
  context.set(context.actor.id, "location", room, movedEvent);
  context.set(context.actor.id, "support", room, movedEvent);
  context.set(context.actor.id, "pos", to.kind === "position" ? to.pos : from, movedEvent);
  // What the actor holds or carries moves rooms with it; a positional move changes nothing.
  refreshSubtreeLocations(context, context.actor.id, movedEvent);
  // A walker and all it carries uncover themselves and what they were hiding, as every mover does.
  for (const id of subtreeOf(context.snapshot, context.actor.id)) {
    revealConcealed(context, id, movedEvent);
  }
}

// The room on the far side of each doorway the actor can address, since reading the door gives both
// its ends, and its own room when it stands on something, to step down: on the floor, moving there
// changes nothing. A doorway it cannot address leads to a room it was never told of, so none is offered
// for it, though `move` would answer for the room if named. The position to walk to is free.
function suggest(context: CommandContext, nameable: readonly string[]): Record<string, unknown>[] {
  const { snapshot, actor } = context;
  const here = actor.location;
  const rooms = new Set<string>();
  if (here !== null) {
    rooms.add(here);
  }
  for (const id of nameable) {
    const props = snapshot.entities[id]?.props;
    if (props === undefined || typeof props.from !== "string" || typeof props.to !== "string") {
      continue;
    }
    if (props.from === here) {
      rooms.add(props.to);
    } else if (props.to === here) {
      rooms.add(props.from);
    }
  }
  return [...rooms]
    .filter((room) => snapshot.entities[room]?.template === "room" && !(room === here && onFloor(context)))
    .sort()
    .map((location) => ({ location }));
}

export const moveVerb: Verb = {
  duration: { ticks: 1 },
  requires_target: false,
  args: { to: { kind: "pos" }, location: { kind: "room" } },
  refuses: ["carried", "insufficient_moving", "no_open_door", "blocked", "out_of_bounds"],
  suggest,
  free_args: true,
  preconditions,
  transition,
};
