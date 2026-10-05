import { capacity } from "../capacity.js";
import { effectivePos, sweep, type Direction, type Sweep } from "../geometry.js";
import type { CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import type { Pos } from "../../model.js";
import { propagateSupportLoss, resolveImpact } from "../../resolvers/physical.js";
import { isAbstract } from "../resolve.js";
import { reachData } from "./address.js";
import { revealConcealed } from "./search.js";

interface Movement {
  distance: number;
  direction: Direction;
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

// Pull names the direction it pulls from, so its target travels the other way.
function travel(move: Movement, reverse: boolean): Direction {
  if (!reverse) {
    return move.direction;
  }
  return `${move.direction.startsWith("+") ? "-" : "+"}${move.direction.slice(1)}` as Direction;
}

function swept(context: CommandContext, targetId: string, move: Movement, reverse: boolean): Sweep {
  return sweep(context.snapshot, context.registry, targetId, travel(move, reverse), move.distance, (id) =>
    isAbstract(context.registry, context.snapshot.entities[id]),
  );
}

function preconditions(context: CommandContext, reverse: boolean): PreconditionResult {
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
    const data = reachData(context.snapshot, context.actor.id, target.id);
    return {
      status: "refused",
      reason_code: "out_of_reach",
      ...(data !== null && { reason_data: data }),
    };
  }
  const moving = capacity(context.snapshot, context.registry, context.actor.id, "moving") ?? 0;
  if (moving < 1) {
    return {
      status: "refused",
      reason_code: "insufficient_moving",
      reason_data: { capacity: "moving", have: moving, need: 1 },
    };
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
  const path = swept(context, target.id, move, reverse);
  if (move.distance > 0 && path.distance === 0 && path.obstacle !== null) {
    return { status: "refused", reason_code: "blocked", reason_data: { with: path.obstacle } };
  }
  return { status: "ok" };
}

function offset(position: Pos, direction: Direction, distance: number): Pos {
  const sign = direction.startsWith("+") ? 1 : -1;
  if (direction.endsWith("x")) {
    return { x: position.x + distance * sign, y: position.y };
  }
  return { x: position.x, y: position.y + distance * sign };
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

    const path = swept(context, target.entity_id, move, reverse);
    const movedEvent = context.emit("moved", target.entity_id, { distance_cm: path.distance }, context.root_event_id);
    context.set(target.entity_id, "pos", offset(position, travel(move, reverse), path.distance), movedEvent);
    if (path.obstacle !== null) {
      const collidedEvent = context.emit("collided", target.entity_id, { with: path.obstacle }, movedEvent);
      resolveImpact(context, target.entity_id, path.obstacle, path.distance, collidedEvent);
    }
    revealConcealed(context, target.entity_id, movedEvent);
    propagateSupportLoss(context, target.entity_id, movedEvent);
  };
}

const pushArgs = {
  distance_cm: { kind: "int" } as const,
  dir: { kind: "enum", values: ["+x", "-x", "+y", "-y"] } as const,
};
const pushRefuses = [
  "target_attached",
  "out_of_reach",
  "insufficient_moving",
  "target_carried",
  "too_heavy",
  "blocked",
] as const;

export const pushVerb: Verb = {
  requires_target: true,
  args: pushArgs,
  refuses: pushRefuses,
  preconditions: (context) => preconditions(context, false),
  transition: makeTransition(false),
};

export const pullVerb: Verb = {
  requires_target: true,
  args: pushArgs,
  refuses: pushRefuses,
  preconditions: (context) => preconditions(context, true),
  transition: makeTransition(true),
};
