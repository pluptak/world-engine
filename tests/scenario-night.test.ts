import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  actorWorld,
  canonicalJson,
  createWorld,
  type ActorCommand,
  type ActorResult,
  type ActorWorld,
  type Id,
  type ObservedEntity,
  type Options,
  type Projection,
  type Scenario,
  type World,
} from "../src/index.js";

// The watch played from inside, as a middleware would: each character holds only an `actorWorld`,
// and a policy chooses its next command from what that view sent it. The test holds the `World` to
// schedule the architect's beats and to judge the night afterwards, never to steer anyone. Steps
// are lettered; `docs/limits-actor.md` says what a controller could not decide from inside.

const watch = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/watch.json", import.meta.url)), "utf8"),
) as Scenario;

// What a controller has when it chooses: the actor's view since its last turn, what it can try now,
// what it last did and how that came out, and whatever it chose to remember.
interface Turn<M> {
  view: Projection;
  options: Options;
  last: { command: ActorCommand; result: ActorResult } | null;
  memory: M;
}
type Choice<M> = { command: Omit<ActorCommand, "command_id">; memory: M };
type Policy<M> = (turn: Turn<M>) => Choice<M>;

const wait = { verb: "wait", args: { ticks: 1 } };
const byTemplate = (view: Projection, template: string): ObservedEntity | undefined =>
  view.entities.find((entity) => entity.template === template);
const ready = (options: Options, verb: string, target?: Id): boolean =>
  options.ready.some((option) => option.verb === verb && option.target === target);
const heardEvents = (turn: Turn<unknown>) => [...turn.view.events, ...(turn.last?.result.observation.events ?? [])];

// The guard: she keeps watch a tick at a time; once she hears a knock she lights the lantern before
// the lights can fail, makes for the door, opens it and shouts a challenge into the yard. Where she
// stands by the door is a guess from the door's position, tried in turn until one is not blocked.
interface Guard {
  alert: boolean;
  spot: number;
  opened: boolean;
  shouted: boolean;
}
const guard: Policy<Guard> = ({ view, options, last, memory }) => {
  const alert = memory.alert || heardEvents({ view, options, last, memory }).some((event) => event.type === "sounded");
  // Nothing in the view says the door is open, and options offer `open` either way: she knows it
  // because she opened it.
  const opened =
    memory.opened ||
    (last?.command.verb === "open" && last.result.observation.events.some((event) => event.type === "opened"));
  const next = { ...memory, alert, opened };
  if (!alert) {
    return { command: wait, memory: next };
  }
  const lantern = byTemplate(view, "lantern");
  if (lantern !== undefined && ready(options, "light", lantern.id)) {
    return { command: { verb: "light", target: lantern.id }, memory: next };
  }
  const door = byTemplate(view, "door");
  if (door === undefined) {
    return { command: wait, memory: next };
  }
  if (opened && !memory.shouted) {
    return {
      command: { verb: "say", args: { utterance: "who.goes.there", volume: "shout" } },
      memory: { ...next, shouted: true },
    };
  }
  if (opened) {
    return { command: wait, memory: next };
  }
  if (ready(options, "open", door.id)) {
    return { command: { verb: "open", target: door.id }, memory: next };
  }
  const at = door.facts?.pos;
  if (at === undefined || at === null) {
    return { command: wait, memory: next };
  }
  const spots = [
    { x: at.x - 80, y: at.y },
    { x: at.x - 60, y: at.y + 60 },
    { x: at.x - 60, y: at.y - 60 },
  ];
  const refused = last?.command.verb === "move" && last.result.status !== "ok";
  const spot = refused ? memory.spot + 1 : memory.spot;
  if (spot >= spots.length) {
    return { command: wait, memory: { ...next, spot } };
  }
  return { command: { verb: "move", args: { to: spots[spot] } }, memory: { ...next, spot } };
};

// Cal, by the guard: a knock makes him ask aloud who it is, once.
const companion: Policy<{ asked: boolean }> = (turn) => {
  if (!turn.memory.asked && heardEvents(turn).some((event) => event.type === "sounded")) {
    return { command: { verb: "say", args: { utterance: "who.knocks" } }, memory: { asked: true } };
  }
  return { command: wait, memory: turn.memory };
};

// Bob, in the dark yard: a shout makes him answer in a whisper, once, and then he would come in, if
// anything he senses named the room behind the door.
interface Visitor {
  answered: boolean;
}
const visitor: Policy<Visitor> = (turn) => {
  const shouted = heardEvents(turn).some((event) => event.type === "say" && event.volume === "shout");
  if (!turn.memory.answered && shouted) {
    return { command: { verb: "say", args: { utterance: "friend", volume: "whisper" } }, memory: { answered: true } };
  }
  const here = turn.view.entities.find((entity) => entity.id === turn.view.observer)?.facts?.location;
  const elsewhere = turn.view.entities.find((entity) => entity.template === "room" && entity.id !== here);
  if (turn.memory.answered && elsewhere !== undefined) {
    return { command: { verb: "move", args: { location: elsewhere.id } }, memory: turn.memory };
  }
  return { command: wait, memory: turn.memory };
};

// A character as the loop drives it: its view, and a chooser that keeps the policy's memory to itself.
interface Character {
  view: ActorWorld;
  choose(turn: Omit<Turn<unknown>, "memory">): Omit<ActorCommand, "command_id">;
}
function character<M>(view: ActorWorld, policy: Policy<M>, memory: M): Character {
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

interface Sent {
  turn: number;
  // The clock when the turn began: the judge's record, never sent to the character.
  tick: number;
  view: Projection;
  options: Options;
  command: ActorCommand;
  result: ActorResult;
}

interface Night {
  dir: string;
  world: World;
  ids: Record<string, Id>;
  sent: Record<Id, Sent[]>;
}

// The architect's night, as `tests/scenario-watch.test.ts` schedules it: a loud knock at tick 5, and
// three ticks later the lights fail unless the lantern burns.
function play(t: { after(callback: () => void): void }, rounds: number): Night {
  const root = mkdtempSync(join(tmpdir(), "world-engine-night-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "night");
  const world = createWorld(dir, watch, undefined, { seed: 7 });
  const ids: Record<string, Id> = {};
  for (const name of ["ann", "cal", "dee", "bob", "door", "gatehouse", "yard", "lantern", "note", "table"]) {
    const id = world.id(name);
    ok(id !== null, name);
    ids[name] = id;
  }
  const scheduled = world.edit({
    kind: "schedule_beat",
    id: "knock",
    at_tick: 5,
    action: { kind: "sound", entity: ids.door!, loud: true },
    then: [
      {
        id: "lights",
        delay_ticks: 3,
        action: { kind: "set_props", target: ids.gatehouse!, props: { lit: false } },
        only_if: { entity: ids.lantern!, prop: "burning", op: "eq", value: false },
      },
    ],
  });
  strictEqual(scheduled.status, "ok");

  // Each character takes its turn in a fixed order; every command takes its own ticks, so the clock
  // moves as they act, and nobody acts at once.
  const cast: Character[] = [
    character(actorWorld(world, ids.ann!), guard, { alert: false, spot: 0, opened: false, shouted: false }),
    character(actorWorld(world, ids.cal!), companion, { asked: false }),
    character(actorWorld(world, ids.bob!), visitor, { answered: false }),
  ];
  const sent: Record<Id, Sent[]> = {};
  const seen: Record<Id, number> = {};
  const lasts: Record<Id, { command: ActorCommand; result: ActorResult } | null> = {};
  for (let round = 0; round < rounds; round += 1) {
    for (const member of cast) {
      const actor = member.view.actor;
      const tick = world.snapshot().tick;
      const view = member.view.observe({ since: seen[actor] ?? world.snapshot().version });
      const options = member.view.options({ refused: true });
      const choice = member.choose({ view, options, last: lasts[actor] ?? null });
      const command: ActorCommand = { command_id: `night-${actor}-${round}`, ...choice };
      const result = member.view.command(command);
      lasts[actor] = { command, result };
      seen[actor] = result.observation.version;
      (sent[actor] ??= []).push({ turn: round, tick, view, options, command, result });
    }
  }
  return { dir, world, ids, sent };
}

// Every message a character was sent, in order, as one list of plain JSON.
function messages(night: Night, actor: Id): unknown[] {
  return (night.sent[actor] ?? []).flatMap((turn) => [turn.view, turn.options, turn.result]);
}

test("the night plays out from inside: knock, lantern, door, challenge, answer", (t) => {
  const night = play(t, 8);
  const { ids, world } = night;
  const ann = night.sent[ids.ann!]!;
  const bob = night.sent[ids.bob!]!;
  const verbs = (turns: Sent[]) => turns.map((turn) => turn.command.verb);

  // A. The guard keeps watch a tick at a time; the knock reaches her at her next turn, heard from her
  // own room and naming nothing, since a knock is never seen, and reaches bob from next door.
  deepStrictEqual(verbs(ann).slice(0, 2), ["wait", "wait"]);
  const knockedFor = (turns: Sent[]) =>
    turns.flatMap((turn) => turn.view.events).filter((event) => event.type === "sounded");
  deepStrictEqual(knockedFor(ann).map((event) => [event.senses, "entity" in event, event.from]), [[["hearing"], false, "here"]]);
  deepStrictEqual(knockedFor(bob).map((event) => [event.senses, "entity" in event, event.from]), [[["hearing"], false, "next_door"]]);

  // B. She lights the lantern on that turn, the one turn she has before the lights would fail: the
  // knock falls at tick 5, her turn comes at 6, the lights are due at 8 and her next turn is at 9.
  const knock = world.since(0).events.find((event) => event.type === "sounded");
  deepStrictEqual([knock?.tick, ann[2]?.tick, ann[3]?.tick], [5, 6, 9]);
  strictEqual(ann[2]?.command.verb, "light");
  strictEqual(ann[2]?.result.status, "ok");
  const record = world.since(0).events;
  const skipped = record.find((event) => event.type === "beat_skipped");
  deepStrictEqual(skipped?.data, { id: "lights", reason: "condition" });
  strictEqual(world.entity(ids.gatehouse!)?.props.lit, true);

  // C. Her first spot by the door is taken: the refusal names dee, whom she can see. The next spot is
  // free and in reach of the door, which she opens.
  deepStrictEqual([ann[3]?.command.verb, ann[3]?.result.reason_code, ann[3]?.result.reason_data], ["move", "blocked", { with: ids.dee }]);
  deepStrictEqual([ann[4]?.result.status, ann[5]?.command.verb, ann[5]?.result.status], ["ok", "open", "ok"]);
  strictEqual(world.entity(ids.door!)?.props.open, true);

  // D. Through the open door her shout reaches bob, who answers in a whisper that crosses no door.
  deepStrictEqual(ann[6]?.command.args, { utterance: "who.goes.there", volume: "shout" });
  const challenge = bob.flatMap((turn) => turn.view.events).find((event) => event.type === "say");
  deepStrictEqual([challenge?.utterance, challenge?.from, "entity" in (challenge ?? {})], ["who.goes.there", "next_door", false]);
  deepStrictEqual(bob[6]?.command.args, { utterance: "friend", volume: "whisper" });

  // E. Bob would come in, and cannot say where: the door stands in the gatehouse, so from the dark yard
  // he neither sees nor gropes for it, and nothing he was sent names the room behind it.
  for (const name of ["door", "gatehouse"]) {
    strictEqual(JSON.stringify(messages(night, ids.bob!)).includes(`"${ids[name]}"`), false, name);
  }
  deepStrictEqual(verbs(bob).slice(7), ["wait"]);
  strictEqual(world.entity(ids.bob!)?.location, ids.yard);
});

test("every word reaches exactly who could hear it, and each view says so", (t) => {
  const night = play(t, 8);
  const says = night.world.since(0).events.filter((event) => event.type === "say");
  deepStrictEqual(says.map((event) => event.data.utterance), ["who.knocks", "who.goes.there", "friend"]);
  for (const actor of Object.keys(night.sent)) {
    const told = new Set(
      (night.sent[actor] ?? [])
        .flatMap((turn) => [...turn.view.events, ...turn.result.observation.events])
        .flatMap((event) => (event.utterance === undefined ? [] : [event.event_id])),
    );
    for (const say of says) {
      const heard =
        night.world.query({ kind: "perceive", observer: actor, event_id: say.event_id, sense: "hearing" }).value === "true";
      strictEqual(told.has(say.event_id), heard, `${actor} and ${String(say.data.utterance)}`);
    }
  }
});

test("no character is sent an id it was not given: each is its own, its room's, or one its views listed", (t) => {
  const night = play(t, 8);
  const isId = (value: unknown): value is string => typeof value === "string" && /^e\d+$/.test(value);
  const idsIn = (value: unknown): string[] =>
    isId(value) ? [value] : value !== null && typeof value === "object" ? Object.values(value).flatMap(idsIn) : [];
  let checked = 0;
  for (const [actor, turns] of Object.entries(night.sent)) {
    const room = night.world.entity(actor)?.location;
    const known = new Set<Id>([actor, ...(typeof room === "string" ? [room] : [])]);
    for (const turn of turns) {
      // What this turn lists, and what the character itself named, may be referred to from now on. An
      // event introduces nothing: the entity it names must be one a view listed.
      // A door it was listed names both its rooms (`inspect` gives `from` and `to`), so options may offer
      // the one on the far side as a place to move.
      for (const entity of [...turn.view.entities, ...turn.result.observation.entities]) {
        known.add(entity.id);
        for (const end of [night.world.entity(entity.id)?.props.from, night.world.entity(entity.id)?.props.to]) {
          if (typeof end === "string") known.add(end);
        }
      }
      for (const option of [...turn.options.ready, ...(turn.options.blocked ?? [])]) {
        if (option.target !== undefined) known.add(option.target);
      }
      if (turn.command.target !== undefined) known.add(turn.command.target);
      for (const id of idsIn([turn.view, turn.options, turn.result])) {
        ok(known.has(id), `${actor} turn ${turn.turn} was sent ${id}`);
        checked += 1;
      }
    }
  }
  ok(checked > 100, `checked ${checked}`);
});

test("the same night twice is the same record", (t) => {
  const first = play(t, 8);
  const second = play(t, 8);
  strictEqual(canonicalJson(first.sent), canonicalJson(second.sent));
  strictEqual(canonicalJson(first.world.attempts(0)), canonicalJson(second.world.attempts(0)));
  strictEqual(canonicalJson(first.world.snapshot()), canonicalJson(second.world.snapshot()));
});
