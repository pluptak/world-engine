import { commandDuration } from "../clock.js";
import type { CommandContext, PreconditionResult, Verb } from "../command.js";

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
