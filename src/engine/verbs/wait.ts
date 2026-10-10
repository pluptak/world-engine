import { commandDuration } from "../clock.js";
import { WORLD_AUTHOR, type Command, type CommandContext, type PreconditionResult, type StopBeat, type Verb } from "../command.js";
import { own, type Id, type Snapshot } from "../../model.js";
import { isBeatId } from "../beats.js";
import { pending } from "../pending.js";
import { isAgent } from "./address.js";

function preconditions(context: CommandContext): PreconditionResult {
  return commandDuration(context.verb, context.command) === null
    ? { status: "invalid", reason_code: "invalid_args" }
    : { status: "ok" };
}

function waitPreconditions(context: CommandContext): PreconditionResult {
  const until = context.command.args?.until;
  return until !== undefined && until !== "sensed"
    ? { status: "invalid", reason_code: "invalid_args" }
    : preconditions(context);
}

// An ordinary action whose only effect is the time it takes: the pipeline advances the clock. With
// `until: "sensed"` the count is only an upper bound, and the wait ends at the first tick the waiter
// itself could sense something, the rule `advance`'s `stop_on_perceived` applies.
export const waitVerb: Verb = {
  requires_target: false,
  args: { ticks: { kind: "int" }, until: { kind: "enum", values: ["sensed"], optional: true } },
  refuses: [],
  free_args: true,
  duration: { arg: "ticks" },
  wake_on: (command) => (command.args?.until === "sensed" ? [command.actor] : []),
  preconditions: waitPreconditions,
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
    const watcher = own(context.snapshot.entities, id);
    if (watcher === undefined || !isAgent(context.snapshot, id)) {
      // A body destroyed is still there, but no longer an agent: the code says which.
      return { status: "invalid", reason_code: watcher?.status === "destroyed" ? "observer_destroyed" : "no_such_actor" };
    }
  }
  const stop = context.command.args?.stop_before;
  if (stop === undefined) {
    return { status: "ok" };
  }
  if (typeof stop !== "string" || !isBeatId(stop)) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  const cause = pending(context.snapshot).find((entry) => entry.kind === "beat" && entry.id === stop);
  if (cause === undefined) {
    return { status: "refused", reason_code: "no_such_beat" };
  }
  // The beat falls due at the very next tick: there is no time to run up to it, so nothing passes.
  return cause.due_tick <= context.snapshot.tick + 1 ? { status: "refused", reason_code: "beat_not_ahead" } : { status: "ok" };
}

// The beat `stop_before` names, as it is pending in the snapshot the command is decided against.
function stopBeat(command: Command, snapshot: Snapshot): StopBeat | null {
  const id = command.args?.stop_before;
  if (typeof id !== "string") {
    return null;
  }
  const cause = pending(snapshot).find((entry) => entry.kind === "beat" && entry.id === id);
  return cause === undefined ? null : { id, due_tick: cause.due_tick };
}

// Time with no one acting: the world author lets ticks pass, so a controller that schedules several
// agents can move the clock without any of them waiting. What falls due in the span runs as it does
// for a wait.
export const advanceVerb: Verb = {
  author_only: true,
  requires_target: false,
  // `ticks` is an upper bound when `stop_on_perceived` names agents: time ends at the first tick one
  // of them could sense an event of. `stop_before` names a pending beat: time ends one tick before it falls due.
  args: {
    ticks: { kind: "int" },
    stop_on_perceived: { kind: "address_list", optional: true },
    stop_before: { kind: "token", optional: true },
  },
  refuses: ["no_such_beat", "beat_not_ahead"],
  duration: { arg: "ticks" },
  wake_on: (command) => listed(command) ?? [],
  stop_before: stopBeat,
  preconditions: advancePreconditions,
  transition: () => {},
};
