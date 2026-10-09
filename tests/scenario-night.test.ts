import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  actorWorld,
  aliasOf,
  canonicalJson,
  createWorld,
  type Id,
  type Scenario,
  type World,
} from "../src/index.js";
import {
  assertNoUnknownIds,
  byTemplate,
  character,
  heardEvents,
  playRounds,
  ready,
  wait,
  type Character,
  type Policy,
  type Sent,
} from "./actor-harness.js";
import { tempDir } from "./harness.js";

// The watch played from inside, as a middleware would: each character holds only an `actorWorld`,
// and a policy chooses its next command from what that view sent it. The test holds the `World` to
// schedule the architect's beats and to judge the night afterwards, never to steer anyone. Steps
// are lettered; `docs/limits-actor.md` says what a controller could not decide from inside.

const watch = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/watch.json", import.meta.url)), "utf8"),
) as Scenario;

// Idle until something reaches her senses: the count is only a bound, and the wait ends the moment
// she could sense anything.
const watching = { verb: "wait", args: { ticks: 20, until: "sensed" } };

// The guard: she keeps watch in one wait that ends when she senses something; once she hears a knock she lights the lantern before
// the lights can fail, makes for the door, opens it and shouts a challenge into the yard. Where she
// stands by the door is worked out: the first of a few spots beside it that her footprint can take
// without overlapping the door's or anyone else's, which she reads from her inspections.
interface Guard {
  alert: boolean;
  shouted: boolean;
}
const guard: Policy<Guard> = (turn) => {
  const { view, options, last, memory, inspect } = turn;
  const alert = memory.alert || heardEvents(turn).some((event) => event.type === "sounded");
  const next = { ...memory, alert };
  if (!alert) {
    return { command: watching, memory: next };
  }
  const lantern = byTemplate(view, "lantern");
  if (lantern !== undefined && ready(options, "light", lantern.id)) {
    return { command: { verb: "light", target: lantern.id }, memory: next };
  }
  const door = byTemplate(view, "door");
  if (door === undefined) {
    return { command: wait, memory: next };
  }
  // Nothing in the view says the door is open, but the options do: `close` is ready only while it
  // stands open in her reach, and `open` is then refused `already_open`.
  const opened = ready(options, "close", door.id);
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
  const self = inspect(view.observer)?.size_cm;
  if (at === undefined || at === null || self === undefined) {
    return { command: wait, memory: next };
  }
  // Everything standing on the floor she can see, with its footprint; the door is among them.
  const taken = view.entities
    .filter((entity) => entity.id !== view.observer && entity.facts?.pos != null)
    .flatMap((entity) => {
      const size = inspect(entity.id)?.size_cm;
      return size === undefined ? [] : [{ at: entity.facts!.pos!, size }];
    });
  const overlaps = (spot: { x: number; y: number }) =>
    taken.some(
      (other) =>
        2 * Math.abs(spot.x - other.at.x) < self.w + other.size.w &&
        2 * Math.abs(spot.y - other.at.y) < self.d + other.size.d,
    );
  const spot = [
    { x: at.x - 80, y: at.y },
    { x: at.x - 60, y: at.y + 60 },
    { x: at.x - 60, y: at.y - 60 },
  ].find((candidate) => !overlaps(candidate));
  return { command: spot === undefined ? wait : { verb: "move", args: { to: spot } }, memory: next };
};

// Cal, by the guard: a knock makes him ask aloud who it is, once.
const companion: Policy<{ asked: boolean }> = (turn) => {
  if (!turn.memory.asked && heardEvents(turn).some((event) => event.type === "sounded")) {
    return { command: { verb: "say", args: { utterance: "who.knocks" } }, memory: { asked: true } };
  }
  return { command: wait, memory: turn.memory };
};

// Bob, in the dark yard: a shout makes him answer in a whisper, once, and then he comes in. He sees
// nothing, but the door the guard opened is among what he can name, and the one thing his options let
// him shut is an open door; he walks through it, and steps aside once if the landing is taken.
interface Visitor {
  answered: boolean;
  aside: boolean;
  crossed: boolean;
}
const visitor: Policy<Visitor> = (turn) => {
  const { memory, last, options } = turn;
  const shouted = heardEvents(turn).some((event) => event.type === "say" && event.volume === "shout");
  if (!memory.answered && shouted) {
    return { command: { verb: "say", args: { utterance: "friend", volume: "whisper" } }, memory: { ...memory, answered: true } };
  }
  const crossed = memory.crossed || (last?.command.args?.through !== undefined && last.result.status === "ok");
  const door = options.ready.find((option) => option.verb === "close")?.target;
  if (!memory.answered || crossed || door === undefined) {
    return { command: wait, memory: { ...memory, crossed } };
  }
  const taken = last?.command.args?.through !== undefined && last.result.reason_code === "blocked";
  if (taken && !memory.aside) {
    return { command: { verb: "move", args: { to: { x: 150, y: 150 } } }, memory: { ...memory, aside: true } };
  }
  return { command: { verb: "move", args: { through: door } }, memory };
};

interface Night {
  dir: string;
  world: World;
  ids: Record<string, Id>;
  sent: Record<Id, Sent[]>;
}

// The architect's night, as `tests/scenario-watch.test.ts` schedules it: a loud knock at tick 5, and
// three ticks later the lights fail unless the lantern burns.
function play(t: { after(callback: () => void): void }, rounds: number): Night {
  const root = tempDir(t);
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

  const cast: Character[] = [
    character(actorWorld(world, ids.ann!), guard, { alert: false, shouted: false }),
    character(actorWorld(world, ids.cal!), companion, { asked: false }),
    character(actorWorld(world, ids.bob!), visitor, { answered: false, aside: false, crossed: false }),
  ];
  const sent = playRounds(world, cast, rounds, "night");
  return { dir, world, ids, sent };
}

test("the night plays out from inside: knock, lantern, door, challenge, answer", (t) => {
  const night = play(t, 10);
  const { ids, world } = night;
  const ann = night.sent[ids.ann!]!;
  const bob = night.sent[ids.bob!]!;
  const verbs = (turns: Sent[]) => turns.map((turn) => turn.command.verb);

  // A. The guard keeps watch in a single wait that ends as the knock falls, at tick 5 with that many
  // ticks run, and the knock is in its result: heard from her own room and naming nothing, since a
  // knock is never seen. It reaches bob from next door.
  deepStrictEqual(ann[0]?.command, { command_id: `night-${ids.ann}-0`, ...watching });
  const watched = world.since(0).events.find((event) => event.command_id === ann[0]?.command.command_id);
  deepStrictEqual([watched?.tick, watched?.data], [0, { advanced: 5 }]);
  const knockedFor = (turns: Sent[]) =>
    turns.flatMap((turn) => [...turn.view.events, ...turn.result.observation.events]).filter((event) => event.type === "sounded");
  deepStrictEqual(knockedFor(ann).map((event) => [event.senses, "entity" in event, event.from]), [[["hearing"], false, "here"]]);
  deepStrictEqual(knockedFor(bob).map((event) => [event.senses, "entity" in event, event.from]), [[["hearing"], false, "next_door"]]);

  // B. She lights the lantern on her next turn, the one turn she has before the lights would fail: the
  // knock falls at tick 5, cal and bob act at 5 and 6, her turn comes at 7, the lights are due at 8 and
  // her next turn is at 10.
  const knock = world.since(0).events.find((event) => event.type === "sounded");
  deepStrictEqual([knock?.tick, ann[1]?.tick, ann[2]?.tick], [5, 7, 10]);
  strictEqual(ann[1]?.command.verb, "light");
  strictEqual(ann[1]?.result.status, "ok");
  const record = world.since(0).events;
  const skipped = record.find((event) => event.type === "beat_skipped");
  deepStrictEqual(skipped?.data, { id: "lights", reason: "condition" });
  strictEqual(world.entity(ids.gatehouse!)?.props.lit, true);

  // C. She works out where to stand from the footprints she inspected, hers, dee's and the door's: the
  // spot 80 from the door's centre would overlap dee, who stands at 300, so she takes the next, and her
  // first move is ok. In reach of the door from there, she opens it.
  // Each character was sent its own aliases of what the judge names by world id.
  const toAnn = (id: string) => aliasOf(ids.ann!, id);
  const toBob = (id: string) => aliasOf(ids.bob!, id);
  deepStrictEqual(ann[2]?.inspected.find((found) => found?.id === toAnn(ids.door!))?.size_cm, { w: 90, d: 10, h: 200 });
  deepStrictEqual([ann[2]?.command.verb, ann[2]?.command.args, ann[2]?.result.status], ["move", { to: { x: 340, y: 60 } }, "ok"]);
  deepStrictEqual([ann[3]?.command.verb, ann[3]?.result.status], ["open", "ok"]);
  strictEqual(world.entity(ids.door!)?.props.open, true);
  // Her next turn is offered the open door's state: it can be shut, and opening it again is refused.
  ok(ready(ann[4]!.options, "close", toAnn(ids.door!)));
  deepStrictEqual(
    ann[4]!.options.blocked?.filter((entry) => entry.verb === "open" && entry.target === toAnn(ids.door!)),
    [{ verb: "open", target: toAnn(ids.door!), reason_code: "already_open" }],
  );

  // D. Through the open door her shout reaches bob, who answers in a whisper that crosses no door.
  deepStrictEqual(ann[4]?.command.args, { utterance: "who.goes.there", volume: "shout" });
  const challenge = bob.flatMap((turn) => turn.view.events).find((event) => event.type === "say");
  deepStrictEqual([challenge?.utterance, challenge?.from, "entity" in (challenge ?? {})], ["who.goes.there", "next_door", false]);
  deepStrictEqual(bob[4]?.command.args, { utterance: "friend", volume: "whisper" });

  // E. Bob comes in. The door stands in the gatehouse, yet from the dark yard he can name it: his options
  // offer it, the one thing he can shut is the open door, and he walks in through it. The table stands
  // at the coordinates he lands on, so the first try is refused `blocked` (and, as it names something he
  // cannot tell is there, without saying what) and he tries again from a spot beside it.
  const crossings = bob.filter((turn) => turn.command.args?.through !== undefined);
  deepStrictEqual(crossings.map((turn) => turn.command.args), [{ through: toBob(ids.door!) }, { through: toBob(ids.door!) }]);
  deepStrictEqual(crossings.map((turn) => [turn.result.status, turn.result.reason_code]), [["refused", "blocked"], ["ok", undefined]]);
  strictEqual(crossings[0]?.result.reason_data?.with, undefined);
  strictEqual(world.entity(ids.bob!)?.location, ids.gatehouse);
  strictEqual(verbs(bob).at(-1), "wait");
});

test("every word reaches exactly who could hear it, and each view says so", (t) => {
  const night = play(t, 10);
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
      strictEqual(told.has(aliasOf(actor, say.event_id)), heard, `${actor} and ${String(say.data.utterance)}`);
    }
  }
});

test("no character is sent an id it was not given: each is its own, its room's, or one its views listed", (t) => {
  const night = play(t, 10);
  const checked = assertNoUnknownIds(night.world, night.sent);
  ok(checked > 100, `checked ${checked}`);
});

test("the same night twice is the same record", (t) => {
  const first = play(t, 10);
  const second = play(t, 10);
  strictEqual(canonicalJson(first.sent), canonicalJson(second.sent));
  strictEqual(canonicalJson(first.world.attempts(0)), canonicalJson(second.world.attempts(0)));
  strictEqual(canonicalJson(first.world.snapshot()), canonicalJson(second.world.snapshot()));
});
