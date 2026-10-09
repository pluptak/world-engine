import { ok } from "node:assert";
import {
  type ActorCommand,
  type ActorOptions as Options,
  type ActorProjection as Projection,
  type ActorResult,
  type ActorWorld,
  type Id,
  type Inspection,
  type ObservedEntity,
  type World,
} from "../src/index.js";

// Scenarios played from inside, as a middleware would: each character holds only an `actorWorld`,
// and a policy chooses its next command from what that view sent it. The test holds the `World` to
// set the stage and to judge the run afterwards, never to steer anyone. `scenario-night.test.ts` and
// `scenario-cell-actor.test.ts` use it; `docs/limits-actor.md` says what a controller could not
// decide from inside.

// What a controller has when it chooses: the actor's view since its last turn, what it can try now,
// what it last did and how that came out, whatever it chose to remember, and `inspect`, which looks
// closer at one thing in the view and is recorded with the turn.
export interface Turn<M> {
  view: Projection;
  options: Options;
  inspect: (entity: Id) => Inspection | null;
  last: { command: ActorCommand; result: ActorResult } | null;
  memory: M;
}
export type Choice<M> = { command: Omit<ActorCommand, "command_id">; memory: M };
export type Policy<M> = (turn: Turn<M>) => Choice<M>;

export const wait = { verb: "wait", args: { ticks: 1 } };
export const byTemplate = (view: Projection, template: string): ObservedEntity | undefined =>
  view.entities.find((entity) => entity.template === template);
export const ready = (options: Options, verb: string, target?: Id): boolean =>
  options.ready.some((option) => option.verb === verb && option.target === target);
export const heardEvents = (turn: Turn<unknown>) => [...turn.view.events, ...(turn.last?.result.observation.events ?? [])];

// A character as the loop drives it: its view, and a chooser that keeps the policy's memory to itself.
export interface Character {
  view: ActorWorld;
  choose(turn: Omit<Turn<unknown>, "memory">): Omit<ActorCommand, "command_id">;
}
export function character<M>(view: ActorWorld, policy: Policy<M>, memory: M): Character {
  let kept = memory;
  return {
    view,
    choose(turn) {
      const choice = policy({ ...turn, memory: kept });
      kept = choice.memory;
      return choice.command;
    },
  };
}

export interface Sent {
  turn: number;
  // The clock when the turn began: the judge's record, never sent to the character.
  tick: number;
  view: Projection;
  options: Options;
  // What its inspections gave, in the order it asked.
  inspected: Array<Inspection | null>;
  command: ActorCommand;
  result: ActorResult;
}

// Each character takes its turn in a fixed order, `rounds` times; every command takes its own ticks,
// so the clock moves as they act, and nobody acts at once. A command's id is `<prefix>-<actor>-<round>`.
export function playRounds(world: World, cast: readonly Character[], rounds: number, prefix: string): Record<Id, Sent[]> {
  const sent: Record<Id, Sent[]> = {};
  // Where each character last looked, by tick, and the events it has been told of: the events at
  // that tick come again, and a controller keeps them apart by id.
  const seen: Record<Id, number> = {};
  const told: Record<Id, Set<Id>> = {};
  const start = world.snapshot().tick;
  const lasts: Record<Id, { command: ActorCommand; result: ActorResult } | null> = {};
  for (let round = 0; round < rounds; round += 1) {
    for (const member of cast) {
      const actor = member.view.actor;
      const tick = world.snapshot().tick;
      const known = (told[actor] ??= new Set());
      const looked = member.view.observe({ since_tick: seen[actor] ?? start });
      const view = { ...looked, events: looked.events.filter((event) => !known.has(event.event_id)) };
      view.events.forEach((event) => known.add(event.event_id));
      const options = member.view.options({ refused: true });
      const inspected: Array<Inspection | null> = [];
      const inspect = (entity: Id) => {
        inspected.push(member.view.inspect(entity));
        return inspected.at(-1)!;
      };
      const choice = member.choose({ view, options, last: lasts[actor] ?? null, inspect });
      const command: ActorCommand = { command_id: `${prefix}-${actor}-${round}`, ...choice };
      const result = member.view.command(command);
      lasts[actor] = { command, result };
      result.observation.events.forEach((event) => known.add(event.event_id));
      seen[actor] = result.observation.tick;
      (sent[actor] ??= []).push({ turn: round, tick, view, options, inspected, command, result });
    }
  }
  return sent;
}

// Every id in what a character was sent must be one it was given: its own, its room's, or one a view
// or an offer listed (or it named itself). Returns how many ids were checked.
export function assertNoUnknownIds(world: World, sent: Record<Id, Sent[]>): number {
  const isId = (value: unknown): value is string => typeof value === "string" && /^e\d+$/.test(value);
  const idsIn = (value: unknown): string[] =>
    isId(value) ? [value] : value !== null && typeof value === "object" ? Object.values(value).flatMap(idsIn) : [];
  const entities = world.snapshot().entities;
  let checked = 0;
  for (const [actor, turns] of Object.entries(sent)) {
    const room = world.entity(actor)?.location;
    const known = new Set<Id>([actor, ...(typeof room === "string" ? [room] : [])]);
    for (const turn of turns) {
      // What this turn lists, and what the character itself named, may be referred to from now on. An
      // event introduces nothing: the entity it names must be one a view listed. A door it was listed
      // or offered names both its rooms (`inspect` gives `from` and `to`), so options may offer the one
      // on the far side as a place to move.
      const learn = (id: Id) => {
        known.add(id);
        for (const end of [entities[id]?.props.from, entities[id]?.props.to]) {
          if (typeof end === "string") known.add(end);
        }
      };
      for (const entity of [...turn.view.entities, ...turn.result.observation.entities]) learn(entity.id);
      for (const option of [...turn.options.ready, ...(turn.options.blocked ?? [])]) {
        if (option.target !== undefined) learn(option.target);
      }
      if (turn.command.target !== undefined) known.add(turn.command.target);
      for (const id of idsIn([turn.view, turn.options, turn.inspected, turn.result])) {
        ok(known.has(id), `${actor} turn ${turn.turn} was sent ${id}`);
        checked += 1;
      }
    }
  }
  return checked;
}
