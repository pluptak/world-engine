import { capacityRefusal } from "../carry.js";
import type { CapacityRequirement, CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import { closedEnclosure, refuseOutOfReach } from "./address.js";

type Kind = "light" | "douse";

const changes: Record<Kind, { event: string; burning: boolean }> = {
  light: { event: "lit", burning: true },
  douse: { event: "doused", burning: false },
};

// Striking a flame or pinching one out takes hands.
const requires: readonly CapacityRequirement[] = [{ capacity: "manipulation", at_least: 50 }];

const refuses: Record<Kind, readonly string[]> = {
  light: ["target_attached", "not_a_light", "container_closed", "out_of_reach", "already_burning", "no_fuel", "insufficient_manipulation"],
  douse: ["target_attached", "not_a_light", "container_closed", "out_of_reach", "not_burning", "insufficient_manipulation"],
};

function preconditions(context: CommandContext, kind: Kind): PreconditionResult {
  const target = context.target;
  if (target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  // A part is not a thing to light, only the entity that declares it.
  if (target.part !== null) {
    return { status: "refused", reason_code: "target_attached" };
  }
  const light = context.snapshot.entities[target.entity_id];
  if (light === undefined) {
    return { status: "invalid", reason_code: "no_such_entity" };
  }
  if (light.props.light_source !== true) {
    return { status: "refused", reason_code: "not_a_light" };
  }
  const enclosure = closedEnclosure(context.snapshot, light.id);
  if (enclosure !== null) {
    return { status: "refused", reason_code: "container_closed", reason_data: { enclosure } };
  }
  const reach = refuseOutOfReach(context, light.id);
  if (reach !== null) {
    return reach;
  }
  if (kind === "light") {
    if (light.props.burning === true) {
      return { status: "refused", reason_code: "already_burning" };
    }
    // A light with a `fuel` prop needs some; one that declares none burns on its own.
    if (typeof light.props.fuel === "number" && light.props.fuel <= 0) {
      return { status: "refused", reason_code: "no_fuel" };
    }
  } else if (light.props.burning !== true) {
    return { status: "refused", reason_code: "not_burning" };
  }
  const capacity = capacityRefusal(context);
  if (capacity !== null) {
    return capacity;
  }
  return { status: "ok" };
}

// Lighting or dousing writes `burning` under a `lit` or `doused` event; a template's burn process
// starts or stops from that write, and whether the room is lit is read, never stored.
function transition(context: TransitionContext, kind: Kind): void {
  const target = context.target;
  const light = target === null ? undefined : context.snapshot.entities[target.entity_id];
  if (light === undefined) {
    throw new TypeError("Light target changed after validation");
  }
  const change = changes[kind];
  const eventId = context.emit(change.event, light.id, {}, context.root_event_id);
  context.set(light.id, "props", { ...light.props, burning: change.burning }, eventId);
}

function makeVerb(kind: Kind): Verb {
  return {
    duration: { ticks: 1 },
    requires_target: true,
    args: {},
    refuses: refuses[kind],
    requires,
    preconditions: (context) => preconditions(context, kind),
    transition: (context) => transition(context, kind),
  };
}

export const lightVerb = makeVerb("light");
export const douseVerb = makeVerb("douse");
