import { commandDuration } from "../clock.js";
import { WORLD_AUTHOR, type CommandContext, type PreconditionResult, type Verb } from "../command.js";

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

function advancePreconditions(context: CommandContext): PreconditionResult {
  return context.command.actor === WORLD_AUTHOR
    ? preconditions(context)
    : { status: "invalid", reason_code: "invalid_author" };
}

// Time with no one acting: the world author lets ticks pass, so a controller that schedules several
// agents can move the clock without any of them waiting. What falls due in the span runs as it does
// for a wait.
export const advanceVerb: Verb = {
  author_only: true,
  requires_target: false,
  args: { ticks: { kind: "int" } },
  refuses: [],
  duration: { arg: "ticks" },
  preconditions: advancePreconditions,
  transition: () => {},
};
