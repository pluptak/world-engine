import { commandDuration } from "../clock.js";
import { WORLD_AUTHOR, type Command, type CommandContext, type PreconditionResult, type Verb } from "../command.js";
import type { Id } from "../../model.js";
import { isAgent } from "./address.js";

function preconditions(context: CommandContext): PreconditionResult {
  return commandDuration(context.verb, context.command) === null
    ? { status: "invalid", reason_code: "invalid_args" }
    : { status: "ok" };
}

// An ordinary action whose only effect is the time it takes: the pipeline advances the clock.
export const waitVerb: Verb = {
  requires_target: false,
  args: { ticks: { kind: "int" } },
  refuses: [],
  duration: { arg: "ticks" },
  preconditions,
  transition: () => {},
};

// The agents named by `stop_on_perceived`, or null when the arg is malformed.
function listed(command: Command): readonly Id[] | null {
  const value = command.args?.stop_on_perceived;
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string" && id !== "")
    ? (value as string[])
    : null;
}

function advancePreconditions(context: CommandContext): PreconditionResult {
  if (context.command.actor !== WORLD_AUTHOR) {
    return { status: "invalid", reason_code: "invalid_author" };
  }
  const base = preconditions(context);
  if (base.status !== "ok") {
    return base;
  }
  const ids = listed(context.command);
  if (ids === null) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  for (const id of ids) {
    const watcher = context.snapshot.entities[id];
    if (watcher === undefined || !isAgent(context.snapshot, id)) {
      // A body destroyed is still there, but no longer an agent: the code says which.
      return { status: "invalid", reason_code: watcher?.status === "destroyed" ? "observer_destroyed" : "no_such_actor" };
    }
  }
  return { status: "ok" };
}

// Time with no one acting: the world author lets ticks pass, so a controller that schedules several
// agents can move the clock without any of them waiting. What falls due in the span runs as it does
// for a wait.
export const advanceVerb: Verb = {
  author_only: true,
  requires_target: false,
  // `ticks` is an upper bound when `stop_on_perceived` names agents: time ends at the first tick one
  // of them could sense an event of.
  args: { ticks: { kind: "int" }, stop_on_perceived: { kind: "address_list", optional: true } },
  refuses: [],
  duration: { arg: "ticks" },
  wake_on: (command) => listed(command) ?? [],
  preconditions: advancePreconditions,
  transition: () => {},
};
