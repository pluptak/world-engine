import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, WORLD_AUTHOR, type Id, type Result, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { replay } from "../src/store/file-store.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { SHARED_FIXTURES } from "./presets.js";

// A controller that hands the turn to someone wants time to run until something happens that they
// could sense. `advance` with `stop_on_perceived` ends at the first tick whose events one of the
// listed agents could sense, and says how long it ran.

const shipped = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const registry = parseRegistry({
  ...shipped,
  ...SHARED_FIXTURES,
  slow_door: { id: "slow_door", extends: "door", props: { closes_after: 6 } },
});

interface Hall {
  dir: string;
  world: World;
  ann: Id;
  carol: Id;
  rock: Id;
}

// A door that swings shut six ticks after it is opened, between the hall (ann) and the yard, and a
// vault with no door at all (carol). A hungry body in a cellar of its own (dan) keeps a process pending throughout.
function hall(t: { after(callback: () => void): void }): Hall {
  const root = mkdtempSync(join(tmpdir(), "world-engine-stop-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "w");
  const world = createWorld(dir, [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "vault", template: "room", overrides: { name: "vault", props: { lit: true } } },
    { id: "cellar", template: "room", overrides: { name: "cellar", props: { lit: true } } },
    {
      id: "door",
      template: "slow_door",
      overrides: { name: "door", props: { open: false, from: "hall", to: "yard" } },
    },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "carol", template: "human", overrides: { name: "carol", location: "vault", support: "vault", pos: { x: 0, y: 0 } } },
    { id: "dan", template: "human_hungry", overrides: { name: "dan", location: "cellar", support: "cellar", pos: { x: 0, y: 0 } } },
    { id: "rock", template: "stone", overrides: { name: "rock", location: "hall", support: "hall", pos: { x: 50, y: 0 } } },
  ], registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, ann: id("ann"), carol: id("carol"), rock: id("rock") };
}

let seq = 0;
function advance(world: World, ticks: number, stop?: Id[]): Result {
  seq += 1;
  return world.command({
    command_id: `s${seq}`,
    actor: WORLD_AUTHOR,
    verb: "advance",
    args: { ticks, ...(stop === undefined ? {} : { stop_on_perceived: stop }) },
  });
}

function opened(h: Hall): void {
  seq += 1;
  const result = h.world.command({ command_id: `o${seq}`, actor: h.ann, verb: "open", target: "door" });
  strictEqual(result.status, "ok");
}

// The tick the door shuts, read off a world that ran the whole span.
function closeTick(h: Hall): number {
  const probe = h.world.fork();
  const run = advance(probe, 20);
  const closed = run.events.find((event) => event.type === "closed");
  ok(closed !== undefined);
  return closed.tick;
}

test("an observer in the room is woken by the door shutting, and one in a sealed room is not", (t) => {
  const h = hall(t);
  opened(h);
  const start = h.world.snapshot().tick;
  const shut = closeTick(h);
  ok(shut > start && shut < start + 20);

  const woken = h.world.fork();
  const run = advance(woken, 20, [h.ann]);
  strictEqual(run.status, "ok");
  strictEqual(run.events[0]?.type, "advance");
  deepStrictEqual(run.events[0]?.data, { advanced: shut - start });
  strictEqual(woken.snapshot().tick, shut);
  // The stop never splits a tick: every event of that tick is in the result, and none after it.
  ok(run.events.some((event) => event.type === "closed" && event.tick === shut));
  ok(run.events.every((event) => event.tick <= shut));
  deepStrictEqual(validateSnapshot(woken.snapshot(), registry), []);
  // What was due after the stop is still pending: the hungry body's next rise.
  ok(woken.snapshot().schedule?.some((cause) => cause.kind === "process" && cause.due_tick > shut));

  const sealed = h.world.fork();
  const full = advance(sealed, 20, [h.carol]);
  deepStrictEqual(full.events[0]?.data, { advanced: 20 });
  strictEqual(sealed.snapshot().tick, start + 20);

  // Either of two listed agents wakes it.
  const either = h.world.fork();
  strictEqual(advance(either, 20, [h.carol, h.ann]).events[0]?.data.advanced, shut - start);
});

test("with nothing to sense the full count elapses, and without the list the event is as it was", (t) => {
  const h = hall(t);
  const quiet = advance(h.world.fork(), 5, [h.ann]);
  deepStrictEqual(quiet.events[0]?.data, { advanced: 5 });
  // No list, no field: the plain advance is unchanged.
  deepStrictEqual(advance(h.world.fork(), 5).events[0]?.data, {});
});

test("two advances end where one would have, and replay reproduces the early stop", (t) => {
  const h = hall(t);
  opened(h);
  const start = h.world.snapshot().tick;

  const split = h.world.fork();
  const first = advance(split, 20, [h.ann]);
  const ran = first.events[0]?.data.advanced as number;
  ok(ran < 20);
  advance(split, 20 - ran);

  const whole = h.world.fork();
  advance(whole, 20);
  const strip = (world: World) => {
    const { version: _version, next_seq: _next, ...rest } = world.snapshot();
    return canonicalJson({ ...rest, tick: world.snapshot().tick });
  };
  strictEqual(split.snapshot().tick, start + 20);
  // Same world, bar the bookkeeping of one more command.
  deepStrictEqual(
    Object.keys(split.snapshot().entities).sort(),
    Object.keys(whole.snapshot().entities).sort(),
  );
  // The causes named differ (one more root event came between), what is pending and when does not.
  const pending = (world: World) => world.snapshot().schedule?.map((cause) => [cause.due_tick, cause.kind, cause.entity]);
  deepStrictEqual(pending(split), pending(whole));
  strictEqual(
    canonicalJson(Object.values(split.snapshot().entities).map((entity) => [entity.id, entity.props, entity.status])),
    canonicalJson(Object.values(whole.snapshot().entities).map((entity) => [entity.id, entity.props, entity.status])),
  );
  ok(strip(split).length > 0);

  // The store world: its log replays to the same early stop.
  const stopped = advance(h.world, 20, [h.ann]);
  strictEqual(stopped.status, "ok");
  strictEqual(canonicalJson(replay(h.dir, registry)), canonicalJson(h.world.snapshot()));
});

test("a listed agent that is missing, no agent, or destroyed is invalid; a bad list is invalid_args", (t) => {
  const h = hall(t);
  const spawned = h.world.edit({ kind: "spawn", template: "human", overrides: { name: "dead", status: "destroyed", location: "e1", support: "e1", pos: { x: 90, y: 90 } } });
  strictEqual(spawned.status, "ok");
  const dead = Object.values(h.world.snapshot().entities).find((entity) => entity.name === "dead")!.id;
  const before = canonicalJson(h.world.snapshot());
  const code = (stop: unknown) => {
    seq += 1;
    const result = h.world.command({ command_id: `i${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 3, stop_on_perceived: stop } });
    return [result.status, result.reason_code];
  };
  deepStrictEqual(code(["e999"]), ["invalid", "no_such_actor"]);
  deepStrictEqual(code([h.rock]), ["invalid", "no_such_actor"]);
  deepStrictEqual(code([h.ann, dead]), ["invalid", "observer_destroyed"]);
  deepStrictEqual(code([]), ["invalid", "invalid_args"]);
  deepStrictEqual(code(h.ann), ["invalid", "invalid_args"]);
  deepStrictEqual(code([5]), ["invalid", "invalid_args"]);
  strictEqual(canonicalJson(h.world.snapshot()), before);
});

test("the clock overflow is judged on the upper bound, not on where the time would stop", (t) => {
  const h = hall(t);
  opened(h);
  const result = advance(h.world, Number.MAX_SAFE_INTEGER, [h.ann]);
  deepStrictEqual([result.status, result.reason_code], ["invalid", "clock_overflow"]);
});
