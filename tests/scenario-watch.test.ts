import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, WORLD_AUTHOR, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { replay } from "../src/store/file-store.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";

// Beats and speech together, as `camp` did for processes: a gatehouse with a door to a dark yard,
// a guard, a knock the architect scheduled, and lights that fail unless a lantern burns. Steps are
// lettered; `docs/limits-watch.md` says what the scene could not express.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const watch = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/watch.json", import.meta.url)), "utf8"),
) as Scenario;

interface Watch {
  dir: string;
  world: World;
  ann: Id;
  cal: Id;
  dee: Id;
  bob: Id;
  door: Id;
  gatehouse: Id;
  lantern: Id;
  note: Id;
}

function open(t: { after(callback: () => void): void }): Watch {
  const root = mkdtempSync(join(tmpdir(), "world-engine-watch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "watch");
  const world = createWorld(dir, watch);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return {
    dir,
    world,
    ann: id("ann"),
    cal: id("cal"),
    dee: id("dee"),
    bob: id("bob"),
    door: id("door"),
    gatehouse: id("gatehouse"),
    lantern: id("lantern"),
    note: id("note"),
  };
}

let seq = 0;
function run(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `watch${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}
function advance(world: World, ticks: number, stop?: Id[]): Result {
  seq += 1;
  return world.command({
    command_id: `watch${seq}`,
    actor: WORLD_AUTHOR,
    verb: "advance",
    args: { ticks, ...(stop === undefined ? {} : { stop_on_perceived: stop }) },
  });
}

// The architect's night: at tick 5 a loud knock at the door, and three ticks after it the lights
// fail, unless the lantern is burning when they would.
function schedule(w: Watch): void {
  const result = w.world.edit({
    kind: "schedule_beat",
    id: "knock",
    at_tick: 5,
    action: { kind: "sound", entity: w.door, loud: true },
    then: [
      {
        id: "lights",
        delay_ticks: 3,
        action: { kind: "set_props", target: w.gatehouse, props: { lit: false } },
        only_if: { entity: w.lantern, prop: "burning", op: "eq", value: false },
      },
    ],
  });
  strictEqual(result.status, "ok");
}

const heard = (world: World, observer: Id, event: string) =>
  world.query({ kind: "perceive", observer, event_id: event, sense: "hearing" }).value === "true";
const sees = (world: World, observer: Id, entity: Id) =>
  world.query({ kind: "perceive", observer, sense: "sight", entity });

test("a knock stops the guard's wait, a shout crosses the door, and a lit lantern keeps the lights", (t) => {
  const w = open(t);
  schedule(w);

  // A. time runs for the guard only as far as the knock: five ticks, and everyone near hears it.
  const wait = advance(w.world, 20, [w.ann]);
  strictEqual(wait.status, "ok");
  strictEqual(wait.events[0]?.data.advanced, 5);
  const knock = wait.events.find((event) => event.type === "sounded");
  ok(knock !== undefined);
  deepStrictEqual([w.ann, w.cal, w.dee, w.bob].map((who) => heard(w.world, who, knock.event_id)), [true, true, true, true]);
  strictEqual(w.world.query({ kind: "perceive", observer: w.ann, event_id: knock.event_id, sense: "sight" }).basis_code, "unseen");
  strictEqual(w.world.snapshot().tick, 5);
  // A knock is never seen, so no hearer is told the door it came from, whether the room is theirs or the
  // next one: only where it was heard from.
  const knocked = (who: Id) => w.world.observe(who, { since: 0 }).events.filter((event) => event.type === "sounded");
  deepStrictEqual(
    [w.ann, w.bob].map((who) => knocked(who).map((event) => [event.senses, "entity" in event, event.from])),
    [[[["hearing"], false, "here"]], [[["hearing"], false, "next_door"]]],
  );
  strictEqual(knock.entity, w.door);

  // B. ann shouts a token and bob in the yard hears it; she whispers another to cal, and dee, 300 cm
  // off, hears nothing of it.
  const shout = run(w.world, w.ann, "say", undefined, { utterance: "halt.who", volume: "shout" });
  const shouted = shout.events.find((event) => event.type === "say")!;
  strictEqual(heard(w.world, w.bob, shouted.event_id), true);
  const whisper = run(w.world, w.ann, "say", w.cal, { utterance: "keep.quiet", volume: "whisper" });
  const whispered = whisper.events.find((event) => event.type === "say")!;
  strictEqual(whispered.data.to, w.cal);
  deepStrictEqual(
    [w.cal, w.dee, w.bob].map((who) => heard(w.world, who, whispered.event_id)),
    [true, false, false],
  );

  // Lighting the lantern is what the lights check: when they would fail, it burns, and the beat
  // skips with its reason.
  const lit = run(w.world, w.ann, "light", "lantern");
  strictEqual(lit.status, "ok");
  const skipped = lit.events.find((event) => event.type === "beat_skipped");
  ok(skipped !== undefined);
  deepStrictEqual(skipped.data, { id: "lights", reason: "condition" });
  strictEqual(w.world.entity(w.gatehouse)?.props.lit, true);
  strictEqual(w.world.snapshot().schedule?.some((cause) => cause.kind === "beat") ?? false, false);

  // D. bob's view has the shout's words and not the whisper's; the log replays to the same world.
  const bob = w.world.observe(w.bob, { since: 0 });
  const words = bob.events.filter((event) => event.type === "say").map((event) => event.utterance);
  deepStrictEqual(words, ["halt.who"]);
  strictEqual(JSON.stringify(bob).includes("keep.quiet"), false);
  deepStrictEqual(validateSnapshot(w.world.snapshot(), registry), []);
  strictEqual(canonicalJson(replay(w.dir, registry)), canonicalJson(w.world.snapshot()));
});

test("with the lantern out the same chain darkens the gatehouse: still heard, no longer seen", (t) => {
  const w = open(t);
  schedule(w);
  const night = advance(w.world, 20);
  strictEqual(night.status, "ok");
  deepStrictEqual(night.events.map((event) => event.type).filter((type) => type !== "advance"), ["sounded", "edited"]);
  strictEqual(w.world.entity(w.gatehouse)?.props.lit, false);

  // C. ann cannot see the note, or cal, but cal's words reach her.
  deepStrictEqual(sees(w.world, w.ann, w.note), { value: "false", basis_code: "location_unlit" });
  deepStrictEqual(sees(w.world, w.ann, w.cal), { value: "false", basis_code: "location_unlit" });
  const said = run(w.world, w.cal, "say", undefined, { utterance: "who.goes" });
  const event = said.events.find((candidate) => candidate.type === "say")!;
  strictEqual(heard(w.world, w.ann, event.event_id), true);
  strictEqual(w.world.query({ kind: "perceive", observer: w.ann, event_id: event.event_id, sense: "sight" }).value, "false");
  const projected = w.world.observe(w.ann, { since: w.world.snapshot().version - 1 });
  const overheard = projected.events.filter((candidate) => candidate.type === "say");
  deepStrictEqual(overheard.map((candidate) => candidate.utterance), ["who.goes"]);
  // A voice heard in the dark names nobody: the controller knows it was cal only because it issued the
  // command, and ann's view says only that the sound came from her own room.
  deepStrictEqual(overheard.map((candidate) => [candidate.senses, "entity" in candidate, candidate.from]), [
    [["hearing"], false, "here"],
  ]);
  // The omniscient record still names the speaker.
  strictEqual(event.entity, w.cal);

  // The lights stay out once the lantern is lit: a flame, not the room's prop, gives light now.
  strictEqual(run(w.world, w.ann, "light", "lantern").status, "ok");
  deepStrictEqual(sees(w.world, w.ann, w.note), { value: "true", basis_code: "same_location_lit" });
  deepStrictEqual(validateSnapshot(w.world.snapshot(), registry), []);
});
