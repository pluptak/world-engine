import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, createWorld, memoryWorld, openWorld, WORLD_AUTHOR, type Id, type Result, type World } from "../src/index.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { SHARED_FIXTURES } from "./presets.js";
import { fileURLToPath } from "node:url";

// `advance` is time with no one acting: only the world author may issue it, it runs whatever falls
// due in the span exactly as a wait would, and nobody senses the command itself.

interface Hall {
  dir: string;
  world: World;
  ann: Id;
  bob: Id;
  door: Id;
  yard: Id;
}

function hall(t: { after(callback: () => void): void }): Hall {
  const base = mkdtempSync(join(tmpdir(), "world-engine-advance-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "hall");
  const registry = parseRegistry({
    ...loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))),
    ...SHARED_FIXTURES,
    slow_door: { id: "slow_door", extends: "door", props: { closes_after: 5 } },
  });
  const world = createWorld(dir, [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    {
      id: "door",
      template: "slow_door",
      overrides: { name: "door", props: { open: false, from: "hall", to: "yard" } },
    },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
  ], registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, ann: id("ann"), bob: id("bob"), door: id("door"), yard: id("yard") };
}

let seq = 0;
function advance(world: World, ticks: unknown, actor: Id = WORLD_AUTHOR): Result {
  seq += 1;
  return world.command({ command_id: `a${seq}`, actor, verb: "advance", args: { ticks } });
}

function openDoor(world: World, ann: Id): Result {
  seq += 1;
  return world.command({ command_id: `o${seq}`, actor: ann, verb: "open", target: "door" });
}

test("the world author advances the clock and a due close runs inside the span", (t) => {
  const { world, ann, door } = hall(t);
  const opened = openDoor(world, ann);
  const openedEvent = opened.events.find((event) => event.type === "opened");
  ok(openedEvent);
  strictEqual(world.snapshot().tick, 1);

  // The close is due at tick 5; a short advance leaves it pending.
  const early = advance(world, 3);
  strictEqual(early.status, "ok");
  strictEqual(world.snapshot().tick, 4);
  deepStrictEqual(early.events.map((event) => event.type), ["advance"]);
  strictEqual(world.entity(door)?.props.open, true);

  const later = advance(world, 4);
  strictEqual(later.status, "ok");
  strictEqual(world.snapshot().tick, 8);
  deepStrictEqual(later.events.map((event) => [event.type, event.tick]), [
    ["advance", 4],
    ["closed", 5],
  ]);
  strictEqual(later.events[1]?.cause_id, openedEvent.event_id);
  strictEqual(world.entity(door)?.props.open, false);
  strictEqual(world.snapshot().schedule, undefined);
});

test("an agent cannot advance the clock, and a bad count is invalid", (t) => {
  const { world, ann } = hall(t);
  const before = canonicalJson(world.snapshot());
  const byAgent = advance(world, 3, ann);
  strictEqual(byAgent.status, "invalid");
  strictEqual(byAgent.reason_code, "invalid_author");
  for (const bad of [0, -2, 1.5, "3", null, undefined]) {
    const result = advance(world, bad);
    strictEqual(result.status, "invalid", String(bad));
    strictEqual(result.reason_code, "invalid_args", String(bad));
  }
  strictEqual(canonicalJson(world.snapshot()), before);
  // The author has no body, so it cannot wait like an agent: `wait` is still an agent's verb.
  const waited = world.command({ command_id: "w1", actor: WORLD_AUTHOR, verb: "wait", args: { ticks: 1 } });
  strictEqual(waited.status, "invalid");
  strictEqual(waited.reason_code, "no_such_actor");
});

test("advance works with no agent in the world and refuses to overflow the clock", () => {
  const empty = memoryWorld(
    createWorldSnapshot(),
  );
  strictEqual(advance(empty, 7).status, "ok");
  strictEqual(empty.snapshot().tick, 7);
  const overflow = advance(empty, Number.MAX_SAFE_INTEGER);
  strictEqual(overflow.status, "invalid");
  strictEqual(overflow.reason_code, "clock_overflow");
  strictEqual(empty.snapshot().tick, 7);
});

function createWorldSnapshot() {
  const base = mkdtempSync(join(tmpdir(), "world-engine-advance-empty-"));
  try {
    const world = createWorld(join(base, "w"), [{ id: "hall", template: "room", overrides: { name: "hall" } }]);
    return world.snapshot();
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("nobody senses an advance, but the consequences it runs are sensed", (t) => {
  const { world, ann, bob } = hall(t);
  openDoor(world, ann);
  const result = advance(world, 6);
  const [root, closed] = result.events;
  ok(root !== undefined && closed !== undefined);
  strictEqual(root.type, "advance");
  strictEqual(root.entity, WORLD_AUTHOR);
  for (const observer of [ann, bob]) {
    for (const sense of ["sight", "hearing"] as const) {
      const answer = world.query({ kind: "perceive", observer, sense, event_id: root.event_id });
      deepStrictEqual(answer, { value: "false", basis_code: "authored" }, `${observer} ${sense}`);
    }
  }
  // The door shutting is an ordinary event: Ann sees it, and Bob across the door heard nothing loud.
  strictEqual(world.query({ kind: "perceive", observer: ann, sense: "sight", event_id: closed.event_id }).value, "true");
});

test("advance is logged and replays: a reopened world equals the live one", (t) => {
  const { world, ann, dir } = hall(t);
  openDoor(world, ann);
  advance(world, 2);
  advance(world, 5);
  const live = canonicalJson(world.snapshot());
  const reopened = openWorld(dir);
  strictEqual(canonicalJson(reopened.snapshot()), live);
  const logged = reopened.attempts(0).filter((attempt) => attempt.command.verb === "advance");
  strictEqual(logged.length, 2);
  deepStrictEqual(logged.map((attempt) => attempt.status), ["ok", "ok"]);
});

test("check does not move the clock, and an advance based on an older version still applies", (t) => {
  const { world, ann } = hall(t);
  const based = world.snapshot().version;
  seq += 1;
  const checked = world.check({ command_id: `k${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 3 } });
  strictEqual(checked.status, "ok");
  strictEqual(world.snapshot().tick, 0);
  strictEqual(world.snapshot().version, based);
  // Something else lands first; an advance based on the older version still applies, since it
  // could not have been refused for it.
  openDoor(world, ann);
  seq += 1;
  const stale = world.command(
    { command_id: `s${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks: 2 } },
    { basedOn: based },
  );
  strictEqual(stale.status, "ok");
  strictEqual(world.snapshot().tick, 3);
});
