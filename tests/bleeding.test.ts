import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { memoryWorld, type World } from "../src/index.js";
import { spawn } from "../src/engine/spawn.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { defaultCoverage, type Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash } from "../src/templates.js";

// Bleeding is the second scheduled cause, and the first that chains. A human who loses a part
// bleeds `bleed_damage` (5) of its own integrity every `bleed_every_ticks` (2), `bleed_times` (3)
// times, each bleed scheduled by the one before and caused by it, back to the `detached` that
// opened the wound. A body bled to 0 is destroyed and acts no more; the rest of its wound is gone.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function duel(guardIntegrity = 100): { world: World; attacker: string; guard: string } {
  const base: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(base, registry, "room", { name: "room", props: { lit: true } });
  const at = { location: room.id, support: room.id };
  // One blow takes a hand off.
  const attacker = spawn(room.snapshot, registry, "human", {
    name: "attacker",
    ...at,
    pos: { x: 0, y: 0 },
    props: { ...registry.human!.props, attack_damage: 100 },
  });
  const guard = spawn(attacker.snapshot, registry, "human", {
    name: "guard",
    ...at,
    pos: { x: 50, y: 0 },
    integrity: guardIntegrity,
  });
  return { world: memoryWorld(guard.snapshot, registry), attacker: attacker.id, guard: guard.id };
}

let seq = 0;
function act(world: World, actor: string, verb: string, target?: string, args?: Record<string, unknown>) {
  seq += 1;
  return world.command({
    command_id: `c${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

const typed = (events: { type: string; tick: number }[]) => events.map((event) => [event.type, event.tick]);

test("a severed hand bleeds 5 every 2 ticks, 3 times, each bleed caused by the one before", () => {
  const { world, attacker, guard } = duel();
  const cut = act(world, attacker, "attack", `${guard}.hand_r`);
  const detached = cut.events.find((event) => event.type === "detached");
  ok(detached);
  deepStrictEqual(world.snapshot().schedule, [
    { due_tick: 2, kind: "bleed", entity: guard, cause_id: detached.event_id, remaining: 3 },
  ]);

  // One long wait runs the whole wound: each bleed schedules the next inside the same span.
  const waited = act(world, attacker, "wait", undefined, { ticks: 7 });
  deepStrictEqual(typed(waited.events), [
    ["wait", 1],
    ["damaged", 2],
    ["damaged", 4],
    ["damaged", 6],
  ]);
  strictEqual(world.entity(guard)?.integrity, 85);
  strictEqual(world.snapshot().schedule, undefined);

  const chain = world.trace({ entity: guard, field: "integrity" }).events;
  deepStrictEqual(chain.map((event) => event.type), ["attack", "detached", "damaged", "damaged", "damaged"]);
});

test("two wounds bleed side by side", () => {
  const { world, attacker, guard } = duel();
  act(world, attacker, "attack", `${guard}.hand_r`);
  // The second blow, from tick 1 to 2, opens a wound due at 3, and the first wound bleeds at its
  // end and is next due at 4.
  const second = act(world, attacker, "attack", `${guard}.hand_l`);
  strictEqual(second.events.at(-1)?.type, "damaged");
  deepStrictEqual(world.snapshot().schedule?.map((cause) => [cause.due_tick, "remaining" in cause ? cause.remaining : null]), [
    [3, 3],
    [4, 2],
  ]);
  act(world, attacker, "wait", undefined, { ticks: 10 });
  strictEqual(world.entity(guard)?.integrity, 70);
});

test("a body bled out is destroyed, acts no more, and the rest of its wound is gone", () => {
  const { world, attacker, guard } = duel(8);
  act(world, attacker, "attack", `${guard}.hand_r`);
  const waited = act(world, attacker, "wait", undefined, { ticks: 7 });
  deepStrictEqual(typed(waited.events), [
    ["wait", 1],
    ["damaged", 2],
    ["destroyed", 4],
  ]);
  deepStrictEqual([world.entity(guard)?.integrity, world.entity(guard)?.status], [0, "destroyed"]);
  strictEqual(world.snapshot().schedule, undefined);
  const moved = act(world, guard, "move", undefined, { to: { x: 100, y: 0 } });
  deepStrictEqual([moved.status, moved.reason_code], ["invalid", "not_an_agent"]);
});

test("a body bled out drops what its hand held where it lies; the pocket keeps its key", () => {
  const { world, attacker, guard } = duel(8);
  const room = world.snapshot().entities[guard]!.location!;
  const holding = (template: string, name: string, part: string) => {
    const made = world.edit({
      kind: "spawn",
      template,
      overrides: { name, location: room, contained_in: guard, in_part: part },
    });
    strictEqual(made.status, "ok", `${made.reason_code}`);
    return made.events[1]!.entity;
  };
  const cup = holding("cup", "cup", "hand_l");
  const key = holding("key", "key", "pocket");
  act(world, attacker, "attack", `${guard}.hand_r`);
  const waited = act(world, attacker, "wait", undefined, { ticks: 7 });
  const destroyed = waited.events.find((event) => event.type === "destroyed");
  ok(destroyed);
  const fell = waited.events.find((event) => event.entity === cup && event.cause_id === destroyed.event_id);
  ok(fell, "the cup's fall names the body's end");
  deepStrictEqual([world.entity(cup)?.contained_in, world.entity(cup)?.support], [null, room]);
  deepStrictEqual([world.entity(key)?.contained_in, world.entity(key)?.in_part], [guard, "pocket"]);
});

test("a body bled out senses nothing: perceive, observe and inspect all say so", () => {
  const { world: seed, attacker, guard } = duel(8);
  const world = memoryWorld({ ...seed.snapshot(), coverage: defaultCoverage() }, registry);
  const sees = () => world.query({ kind: "perceive", observer: guard, entity: attacker, sense: "sight" });
  deepStrictEqual(sees(), { value: "true", basis_code: "same_location_lit" });
  act(world, attacker, "attack", `${guard}.hand_r`);
  const waited = act(world, attacker, "wait", undefined, { ticks: 7 });
  const end = waited.events.find((event) => event.type === "destroyed");
  ok(end);
  deepStrictEqual(sees(), { value: "false", basis_code: "observer_destroyed" });
  deepStrictEqual(world.observe(guard).entities, []);
  strictEqual(world.inspect(guard, attacker), null);
  // Its own end it sensed, from the moment before it: an event is perceived at either end.
  strictEqual(world.query({ kind: "perceive", observer: guard, event_id: end.event_id, sense: "sight" }).value, "true");
  // The attacker, alive, still sees the body.
  strictEqual(world.query({ kind: "perceive", observer: attacker, entity: guard, sense: "sight" }).value, "true");
});

test("only what declares bleeding bleeds: a dog's lost jaw opens no wound", () => {
  const { world, attacker } = duel();
  const dog = spawn(world.snapshot(), registry, "dog", {
    name: "rex",
    location: world.snapshot().entities[attacker]!.location,
    support: world.snapshot().entities[attacker]!.location,
    pos: { x: -60, y: 0 },
  });
  const withDog = memoryWorld(dog.snapshot, registry);
  const bitten = act(withDog, attacker, "attack", `${dog.id}.jaw`);
  ok(bitten.events.some((event) => event.type === "detached"));
  strictEqual(withDog.snapshot().schedule, undefined);
});

test("a stored bleed has at least one bleed left", () => {
  const { world, guard } = duel();
  const base = world.snapshot();
  const bleed = { due_tick: 5, kind: "bleed" as const, entity: guard, cause_id: "ev1", remaining: 1 };
  deepStrictEqual(validateSnapshot({ ...base, schedule: [bleed] }, registry), []);
  deepStrictEqual(
    validateSnapshot({ ...base, schedule: [{ ...bleed, remaining: 0 }] }, registry).map((issue) => issue.code),
    ["bleed_not_remaining"],
  );
});
