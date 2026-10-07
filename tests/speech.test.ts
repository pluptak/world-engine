import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, createWorld, verbs, type Id, type Result, type World } from "../src/index.js";
import { replay } from "../src/store/file-store.js";

// Speech is a perception question the engine can answer; what it means is not. A speech act carries
// an opaque token the caller made up, and the engine never reads it.

interface Hall {
  dir: string;
  world: World;
  ann: Id;
  bob: Id;
  carol: Id;
  dan: Id;
  erin: Id;
  fay: Id;
  rex: Id;
}

// ann, bob (40 cm from ann) and carol (300 cm) in the hall; dan in the yard behind the door; erin and
// fay in a dark cellar; rex the dog in the hall.
function hall(t: { after(callback: () => void): void }): Hall {
  const root = mkdtempSync(join(tmpdir(), "world-engine-speech-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "w");
  const at = (room: string, x: number) => ({ location: room, support: room, pos: { x, y: 0 } });
  const world = createWorld(dir, [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "cellar", template: "room", overrides: { name: "cellar", props: { lit: false } } },
    {
      id: "door",
      template: "door",
      overrides: { name: "door", ...at("hall", 400), props: { openable: true, open: false, from: "hall", to: "yard" } },
    },
    { id: "ann", template: "human", overrides: { name: "ann", ...at("hall", 0) } },
    { id: "bob", template: "human", overrides: { name: "bob", ...at("hall", 40) } },
    { id: "carol", template: "human", overrides: { name: "carol", ...at("hall", 300) } },
    { id: "dan", template: "human", overrides: { name: "dan", ...at("yard", 0) } },
    { id: "erin", template: "human", overrides: { name: "erin", ...at("cellar", 0) } },
    { id: "fay", template: "human", overrides: { name: "fay", ...at("cellar", 50) } },
    { id: "rex", template: "dog", overrides: { name: "rex", ...at("hall", -200) } },
  ]);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return {
    dir,
    world,
    ann: id("ann"),
    bob: id("bob"),
    carol: id("carol"),
    dan: id("dan"),
    erin: id("erin"),
    fay: id("fay"),
    rex: id("rex"),
  };
}

let seq = 0;
function say(world: World, actor: Id, args: Record<string, unknown>, target?: Id, perceivers = false): Result {
  seq += 1;
  return world.command({
    command_id: `say-${seq}`,
    actor,
    verb: "say",
    ...(target === undefined ? {} : { target }),
    args,
    ...(perceivers ? { perceivers: true } : {}),
  });
}
function hears(world: World, observer: Id, event: string): boolean {
  return world.query({ kind: "perceive", observer, event_id: event, sense: "hearing" }).value === "true";
}
function sees(world: World, observer: Id, event: string): boolean {
  return world.query({ kind: "perceive", observer, event_id: event, sense: "sight" }).value === "true";
}
function spoken(result: Result) {
  const event = result.events.find((candidate) => candidate.type === "say");
  ok(event !== undefined);
  return event;
}

test("normal speech is heard everywhere in the speaker's room and not through a door", (t) => {
  const h = hall(t);
  const event = spoken(say(h.world, h.ann, { utterance: "greet.1" }));
  deepStrictEqual(event.data, { utterance: "greet.1", volume: "normal" });
  strictEqual(event.entity, h.ann);
  deepStrictEqual([h.ann, h.bob, h.carol, h.rex].map((who) => hears(h.world, who, event.event_id)), [true, true, true, true]);
  deepStrictEqual([h.dan, h.erin].map((who) => hears(h.world, who, event.event_id)), [false, false]);
});

test("a shout crosses a doorway, shut or open", (t) => {
  const h = hall(t);
  const shut = spoken(say(h.world, h.ann, { utterance: "help", volume: "shout" }));
  strictEqual(hears(h.world, h.dan, shut.event_id), true);
  strictEqual(h.world.query({ kind: "perceive", observer: h.dan, event_id: shut.event_id, sense: "hearing" }).basis_code, "adjacent_loud_event");
  strictEqual(hears(h.world, h.erin, shut.event_id), false);
  const doorId = h.world.id("door")!;
  const opened = h.world.edit({ kind: "set_props", target: doorId, props: { ...h.world.entity(doorId)!.props, open: true } });
  strictEqual(opened.reason_code, undefined);
  const open = spoken(say(h.world, h.ann, { utterance: "help", volume: "shout" }));
  strictEqual(hears(h.world, h.dan, open.event_id), true);
});

test("a whisper is heard within the near threshold of the speaker and not beyond", (t) => {
  const h = hall(t);
  const event = spoken(say(h.world, h.ann, { utterance: "psst", volume: "whisper" }));
  strictEqual(hears(h.world, h.ann, event.event_id), true, "a speaker hears their own");
  strictEqual(hears(h.world, h.bob, event.event_id), true, "40 cm");
  strictEqual(hears(h.world, h.carol, event.event_id), false, "300 cm");
  strictEqual(h.world.query({ kind: "perceive", observer: h.carol, event_id: event.event_id, sense: "hearing" }).basis_code, "too_far");
  strictEqual(hears(h.world, h.dan, event.event_id), false);
  // Speaking is seen in a lit room, its words are not heard by sight.
  strictEqual(sees(h.world, h.carol, event.event_id), true);
});

test("a dark room lets an observer hear the speaker but not see them", (t) => {
  const h = hall(t);
  const event = spoken(say(h.world, h.erin, { utterance: "who" }));
  strictEqual(hears(h.world, h.fay, event.event_id), true);
  strictEqual(sees(h.world, h.fay, event.event_id), false);
  strictEqual(h.world.query({ kind: "perceive", observer: h.fay, event_id: event.event_id, sense: "sight" }).basis_code, "location_unlit");
});

test("the addressee is recorded as a fact of the act, and the event stays on the speaker", (t) => {
  const h = hall(t);
  const event = spoken(say(h.world, h.ann, { utterance: "hello", volume: "whisper" }, h.dan));
  strictEqual(event.entity, h.ann);
  deepStrictEqual(event.data, { utterance: "hello", volume: "whisper", to: h.dan });
  // Naming dan claims nothing about whether dan heard.
  strictEqual(hears(h.world, h.dan, event.event_id), false);
});

test("the words reach an observer's projection only when they heard", (t) => {
  const h = hall(t);
  const before = h.world.snapshot().version;
  strictEqual(say(h.world, h.ann, { utterance: "secretword", volume: "whisper" }).status, "ok");
  const near = h.world.observe(h.bob, { since: before });
  const far = h.world.observe(h.carol, { since: before });
  const heard = near.events.find((event) => event.type === "say");
  ok(heard !== undefined);
  deepStrictEqual([heard.utterance, heard.volume], ["secretword", "whisper"]);
  const seen = far.events.find((event) => event.type === "say");
  ok(seen !== undefined);
  deepStrictEqual(seen.senses, ["sight"]);
  strictEqual("utterance" in seen, false);
  strictEqual("volume" in seen, false);
  strictEqual(JSON.stringify(far).includes("secretword"), false);
  // The omniscient record keeps it, as it keeps every event's data.
  ok(h.world.since(before).events.some((event) => event.type === "say" && event.data.utterance === "secretword"));
});

test("a speaker's own view of the command carries the token", (t) => {
  const h = hall(t);
  seq += 1;
  const result = h.world.command(
    { command_id: `say-${seq}`, actor: h.ann, verb: "say", args: { utterance: "mine" } },
    { observe: true },
  );
  strictEqual(result.status, "ok");
  const event = result.observation?.events.find((candidate) => candidate.type === "say");
  ok(event !== undefined);
  strictEqual(event.utterance, "mine");
});

test("what cannot speak, or was asked badly, is refused", (t) => {
  const h = hall(t);
  const code = (result: Result): [string, string | undefined] => [result.status, result.reason_code];
  deepStrictEqual(code(say(h.world, h.rex, { utterance: "woof" })), ["refused", "insufficient_speech"]);
  deepStrictEqual(code(say(h.world, h.ann, {})), ["invalid", "invalid_args"]);
  deepStrictEqual(code(say(h.world, h.ann, { utterance: "two words" })), ["invalid", "invalid_args"]);
  deepStrictEqual(code(say(h.world, h.ann, { utterance: "x".repeat(65) })), ["invalid", "invalid_args"]);
  deepStrictEqual(code(say(h.world, h.ann, { utterance: 7 })), ["invalid", "invalid_args"]);
  deepStrictEqual(code(say(h.world, h.ann, { utterance: "ok", volume: "murmur" })), ["invalid", "invalid_args"]);
  deepStrictEqual(code(say(h.world, h.ann, { utterance: "ok" }, "nobody")), ["unresolved", undefined]);
  // A head that is gone takes the voice with it, with no rule of its own.
  strictEqual(
    h.world.edit({ kind: "set_part", target: h.carol, part: "head", state: { integrity: 0, status: "destroyed" } }).status,
    "ok",
  );
  const headless = say(h.world, h.carol, { utterance: "ok" });
  deepStrictEqual(code(headless), ["refused", "insufficient_speech"]);
});

test("perceivers name exactly who heard, and the log replays the same world", (t) => {
  const h = hall(t);
  const whispered = spoken(say(h.world, h.ann, { utterance: "psst", volume: "whisper" }, undefined, true));
  deepStrictEqual(whispered.perceivers?.hearing, [h.ann, h.bob].sort());
  deepStrictEqual(whispered.perceivers?.sight, [h.ann, h.bob, h.carol, h.rex].sort());
  const shouted = spoken(say(h.world, h.ann, { utterance: "help", volume: "shout" }, undefined, true));
  deepStrictEqual(shouted.perceivers?.hearing, [h.ann, h.bob, h.carol, h.dan, h.rex].sort());
  strictEqual(canonicalJson(replay(h.dir)), canonicalJson(h.world.snapshot()));
});

test("the catalog describes the verb", () => {
  const entry = verbs().find((candidate) => candidate.verb === "say");
  ok(entry !== undefined);
  deepStrictEqual(entry.args, {
    utterance: { kind: "token" },
    volume: { kind: "enum", values: ["whisper", "normal", "shout"], optional: true },
  });
  deepStrictEqual(entry.requires, [{ capacity: "speech", at_least: 50 }]);
  deepStrictEqual(entry.refuses, ["insufficient_speech"]);
});
