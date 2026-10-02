import { capacity } from "../capacity.js";
import { effectivePos } from "../geometry.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import type { Pos } from "../../model.js";
import { propagateSupportLoss } from "../../resolvers/physical.js";

interface Movement {
  distance: number;
  direction: "+x" | "-x" | "+y" | "-y";
}

function movement(context: CommandContext): Movement | null {
  const args = context.command.args ?? {};
  const distance = args.distance_cm === undefined ? 30 : args.distance_cm;
  const direction = args.dir === undefined ? "+x" : args.dir;
  if (
    typeof distance !== "number" ||
    !Number.isSafeInteger(distance) ||
    distance < 0 ||
    (direction !== "+x" && direction !== "-x" && direction !== "+y" && direction !== "-y")
  ) {
    return null;
  }
  return { distance, direction };
}

function preconditions(context: CommandContext): PreconditionResult {
  const move = movement(context);
  if (move === null) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  if (context.target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  if (context.target.part !== null) {
    return { status: "refused", reason_code: "target_attached" };
  }

  const target = context.snapshot.entities[context.target.entity_id];
  if (target === undefined) {
    return { status: "invalid", reason_code: "no_such_entity" };
  }
  const actorPos = effectivePos(context.snapshot, context.actor.id);
  const targetPos = effectivePos(context.snapshot, target.id);
  const reach = context.actor.props.reach_cm;
  if (
    actorPos === null ||
    targetPos === null ||
    target.location !== context.actor.location ||
    typeof reach !== "number" ||
    (actorPos.x - targetPos.x) ** 2 + (actorPos.y - targetPos.y) ** 2 > reach ** 2
  ) {
    return { status: "refused", reason_code: "out_of_reach" };
  }
  const moving = capacity(context.snapshot, context.registry, context.actor.id, "moving") ?? 0;
  if (moving < 1) {
    return { status: "refused", reason_code: "insufficient_moving" };
  }
  if (target.contained_in !== null) {
    return { status: "refused", reason_code: "target_carried" };
  }

  const targetTemplate = context.registry[target.template];
  if (targetTemplate === undefined) {
    return { status: "invalid", reason_code: "unknown_template" };
  }
  const force = moving * 10;
  if (targetTemplate.mass_g > force * 20) {
    return { status: "refused", reason_code: "too_heavy" };
  }
  return { status: "ok" };
}

function offset(position: Pos, move: Movement, reverse: boolean): Pos {
  const directionSign = move.direction.startsWith("+") ? 1 : -1;
  const sign = reverse ? -directionSign : directionSign;
  if (move.direction.endsWith("x")) {
    return { x: position.x + move.distance * sign, y: position.y };
  }
  return { x: position.x, y: position.y + move.distance * sign };
}

function makeTransition(reverse: boolean) {
  return (context: TransitionContext): void => {
    const target = context.target;
    const move = movement(context);
    if (target === null || move === null) {
      throw new TypeError("Push target or movement changed after validation");
    }
    const position = effectivePos(context.snapshot, target.entity_id);
    if (position === null) {
      throw new TypeError("Push target has no position");
    }

    const movedEvent = context.emit("moved", target.entity_id, { distance_cm: move.distance }, context.root_event_id);
    context.set(target.entity_id, "pos", offset(position, move, reverse), movedEvent);
    propagateSupportLoss(context, target.entity_id, movedEvent);
  };
}

export const pushVerb: Verb = {
  requires_target: true,
  preconditions,
  transition: makeTransition(false),
};

export const pullVerb: Verb = {
  requires_target: true,
  preconditions,
  transition: makeTransition(true),
};
