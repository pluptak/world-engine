import type { TransitionContext } from "./command.js";
import type { RunEnd, Snapshot } from "../model.js";
import { own } from "../model.js";
import { withSchedule } from "./pending.js";

// A run's life (`docs/run.md`): registering when the scene is built, running once started, ended for a
// reason. The gate and the clock's limit read the state here; an edit sets it and a command ends it.

// What the run's state refuses, or null. An ended run takes no command and no edit. One still registering
// takes no command but an edit: its edits are how the author sets it going.
export function runRefusal(snapshot: Snapshot, isEdit: boolean): string | null {
  const state = snapshot.run?.state;
  if (state === "ended") {
    return "run_ended";
  }
  return state === "registering" && !isEdit ? "run_not_running" : null;
}

// The ticks a running run may still pass before its limit, or null when no limit applies.
export function ticksLeft(snapshot: Snapshot): number | null {
  const run = snapshot.run;
  if (run === undefined || run.state !== "running" || run.tick_limit === undefined) {
    return null;
  }
  return Math.max(0, run.tick_limit - snapshot.tick);
}

export function startRun(context: TransitionContext): void {
  const run = context.snapshot.run;
  if (run === undefined) {
    throw new TypeError("Run edit without a run");
  }
  context.snapshot = { ...context.snapshot, run: { ...run, state: "running" } };
}

// The run ends at the tick it is at, and what is still scheduled is dropped with nothing recorded: no
// time passes again, and the modifiers stay as they are.
export function endRun(context: TransitionContext, reason: RunEnd["reason"]): void {
  const run = context.snapshot.run;
  if (run === undefined) {
    throw new TypeError("Run end without a run");
  }
  const ended: RunEnd = { reason, tick: context.snapshot.tick };
  context.snapshot = withSchedule({ ...context.snapshot, run: { ...run, state: "ended", ended } }, []);
}

// After an ok command or edit: a run that has reached its limit ends for that reason, and a run whose slots
// are all destroyed or gone ends for no live players. A run with no slots never ends the second way.
export function finishRun(context: TransitionContext): void {
  const run = context.snapshot.run;
  if (run === undefined || run.state === "ended") {
    return;
  }
  if (run.tick_limit !== undefined && context.snapshot.tick >= run.tick_limit) {
    endRun(context, "tick_limit");
    return;
  }
  // A slot is alive while its body is in the world and not destroyed.
  const alive = (id: string): boolean => {
    const entity = own(context.snapshot.entities, id);
    return entity !== undefined && entity.status !== "destroyed";
  };
  if (run.slots !== undefined && !run.slots.some(alive)) {
    endRun(context, "no_live_players");
  }
}
