import type { TransitionContext } from "./command.js";
import type { Id, RunEnd, Snapshot, SlotEntry } from "../model.js";
import { own } from "../model.js";
import { withSchedule } from "./pending.js";

// A run's life (`docs/run.md`): registering when the scene is built, running once started, ended for a
// reason. The gate and the clock's limit read the state here; an edit sets it and a command ends it.

// What the run's state refuses, or null. An ended run takes no command and no edit. One still registering
// takes no command but an edit: its edits are how the author sets it going. A running one takes an agent's
// command and the author's advance only in a round (`docs/rounds.md`), so a lone one is `round_only`.
export function runRefusal(snapshot: Snapshot, verb: string, authored: boolean, round: boolean): string | null {
  const state = snapshot.run?.state;
  if (state === "ended") {
    return "run_ended";
  }
  if (verb === "edit") {
    return null;
  }
  if (state === "registering") {
    return "run_not_running";
  }
  return state === "running" && !round && (!authored || verb === "advance") ? "round_only" : null;
}

// The ticks a running run may still pass before its limit, or null when no limit applies.
export function ticksLeft(snapshot: Snapshot): number | null {
  const run = snapshot.run;
  if (run === undefined || run.state !== "running" || run.tick_limit === undefined) {
    return null;
  }
  return Math.max(0, run.tick_limit - snapshot.tick);
}

// Binds a player's handle to a slot; the record keeps the order they registered in.
export function registerPlayer(context: TransitionContext, handle: string, slot: Id): void {
  const run = context.snapshot.run;
  if (run === undefined) {
    throw new TypeError("Registration without a run");
  }
  context.snapshot = { ...context.snapshot, run: { ...run, players: [...(run.players ?? []), { handle, slot }] } };
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

// The body a slot's player drives now: the slot's entity, or the newest successor along `succeeds` from it,
// and so on down the chain (`docs/templates.md`). A slot with no successor is its own body.
export function liveBodyOf(snapshot: Snapshot, slot: Id): Id {
  let current = slot;
  for (let steps = 0; steps < 256; steps += 1) {
    let next: Id | null = null;
    for (const entity of Object.values(snapshot.entities)) {
      if (entity.props.succeeds === current && (next === null || Number(entity.id.slice(1)) > Number(next.slice(1)))) {
        next = entity.id;
      }
    }
    if (next === null) {
      return current;
    }
    current = next;
  }
  return current;
}

// The bodies a slot holds, in the order the scene named them: one id, or the list a slot of several is stored as.
export function slotMembers(entry: SlotEntry): readonly Id[] {
  return typeof entry === "string" ? [entry] : entry;
}

// The first body of each slot: the id a registration names the slot by (`docs/roles.md`).
export function slotRoots(snapshot: Snapshot): Id[] {
  return (snapshot.run?.slots ?? []).map((entry) => slotMembers(entry)[0]!);
}

// The bodies a slot's player drives now, in slot order: each member's live body (`liveBodyOf`), once each. A slot
// that names no entry (a root no scene holds) is its one body alone.
export function driverBodies(snapshot: Snapshot, root: Id): Id[] {
  const entry = (snapshot.run?.slots ?? []).find((slot) => slotMembers(slot)[0] === root);
  const members = entry === undefined ? [root] : slotMembers(entry);
  return [...new Set(members.map((member) => liveBodyOf(snapshot, member)))];
}

// After an ok command or edit: a running run that has reached its limit ends for that reason, and one whose
// slots are all destroyed or gone ends for no live players. A run with no slots never ends the second way. A
// registering run never ends by itself: the author may still be fixing its scene.
export function finishRun(context: TransitionContext): void {
  const run = context.snapshot.run;
  if (run === undefined || run.state !== "running") {
    return;
  }
  if (run.tick_limit !== undefined && context.snapshot.tick >= run.tick_limit) {
    endRun(context, "tick_limit");
    return;
  }
  // A slot is alive while one of its bodies' live body is in the world and not destroyed (`liveBodyOf`).
  const alive = (body: Id): boolean => {
    const entity = own(context.snapshot.entities, liveBodyOf(context.snapshot, body));
    return entity !== undefined && entity.status !== "destroyed";
  };
  if (run.slots !== undefined && !run.slots.some((entry) => slotMembers(entry).some(alive))) {
    endRun(context, "no_live_players");
  }
}
