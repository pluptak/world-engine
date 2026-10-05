import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, memoryWorld, type Coverage, type Id, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

// The default coverage plus touch: touch answers only where coverage declares it.
const TOUCHING: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "touch"],
  properties: ["integrity", "residue", "pos"],
};

const DEAF: Coverage = { ...TOUCHING, senses: ["sight", "hearing"] };

const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "cellar", template: "room", overrides: { name: "cellar", props: { lit: false } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "cellar", support: "cellar", pos: { x: 0, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "cellar", support: "cellar", pos: { x: 60, y: 0 } } },
  { id: "rex", template: "dog", overrides: { name: "rex", location: "cellar", support: "cellar", pos: { x: -50, y: 0 } } },
  { id: "flask", template: "bottle", overrides: { name: "flask", location: "cellar", support: "cellar", pos: { x: 10, y: 0 } } },
  { id: "key", template: "key", overrides: { name: "key", location: "cellar", support: "cellar", pos: { x: 20, y: 0 } } },
  { id: "cal", template: "human", overrides: { name: "cal", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "dan", template: "human", overrides: { name: "dan", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
];

// A store world and a memory world over the same snapshot: every touch reads in both.
function touchWorlds(
  t: { after(callback: () => void): void },
  coverage: Coverage = TOUCHING,
): [World, World] {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-touch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createWorld(join(dir, "felt"), scenario, undefined, { coverage });
  const names: Record<string, Id> = {};
  for (const entry of scenario) {
    if (entry.id !== undefined) {
      const id = store.id(entry.id);
      ok(typeof id === "string", `no id for ${entry.id}`);
      names[entry.id] = id;
    }
  }
  const memory = memoryWorld(store.snapshot(), undefined, names, { coverage });
  return [store, memory];
}

function felt(world: World, type: string) {
  const events = world.since(0).events;
  const event = events.find((candidate) => candidate.type === type);
  ok(event !== undefined, `no ${type} event`);
  return event;
}

test("in a dark room ann feels her own hand come off, and the drop of what it held", (t) => {
  for (const world of touchWorlds(t)) {
    const ann = world.id("ann");
    const bob = world.id("bob");
    const flask = world.id("flask");
    ok(ann !== null && bob !== null && flask !== null);
    strictEqual(
      world.command({ command_id: "take-flask", actor: ann, verb: "take", target: "flask", perceivers: true }).status,
      "ok",
    );
    for (let index = 0; index < 2; index += 1) {
      strictEqual(
        world.command({ command_id: `hit-${index}`, actor: bob, verb: "attack", target: `${ann}.hand_l`, perceivers: true }).status,
        "ok",
      );
      strictEqual(
        world.command({ command_id: `rest-${index}`, actor: bob, verb: "wait", args: { ticks: 3 } }).status,
        "ok",
      );
    }
    const fallen = world.command({ command_id: "hit-2", actor: bob, verb: "attack", target: `${ann}.hand_l`, perceivers: true });
    strictEqual(fallen.status, "ok");
    const detached = fallen.events.find((event) => event.type === "detached");
    const dropped = fallen.events.find((event) => event.type === "dropped");
    ok(detached?.perceivers !== undefined && dropped?.perceivers !== undefined);
    // Her own body, felt; the unlit room shows nothing.
    deepStrictEqual([...(detached.perceivers?.touch ?? [])].sort(), [ann].sort());
    deepStrictEqual([...(dropped.perceivers?.touch ?? [])].sort(), [ann].sort());
    deepStrictEqual(detached.perceivers?.sight, []);
    deepStrictEqual(dropped.perceivers?.sight, []);
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("both sides feel a give, and a bystander does not", (t) => {
  for (const world of touchWorlds(t)) {
    const ann = world.id("ann");
    const bob = world.id("bob");
    const rex = world.id("rex");
    const key = world.id("key");
    ok(ann !== null && bob !== null && rex !== null && key !== null);
    strictEqual(
      world.command({ command_id: "take-key", actor: ann, verb: "take", target: "key", perceivers: true }).status,
      "ok",
    );
    const given = world.command({
      command_id: "give-key",
      actor: ann,
      verb: "give",
      target: "key",
      args: { destination: "bob" },
      perceivers: true,
    });
    strictEqual(given.status, "ok");
    for (const type of ["give", "moved"]) {
      const event = given.events.find((candidate) => candidate.type === type);
      ok(event?.perceivers !== undefined, `no perceivers on ${type}`);
      deepStrictEqual([...(event.perceivers?.touch ?? [])].sort(), [ann, bob].sort());
    }
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a pocket theft succeeds unfelt, but stays visible", (t) => {
  for (const world of touchWorlds(t)) {
    const ann = world.id("ann");
    const bob = world.id("bob");
    ok(ann !== null && bob !== null);
    strictEqual(
      world.command({ command_id: "take-key", actor: ann, verb: "take", target: "key", perceivers: true }).status,
      "ok",
    );
    strictEqual(
      world.command({
        command_id: "pocket-key",
        actor: ann,
        verb: "put",
        target: "key",
        args: { relation: "in", destination: `${ann}.pocket` },
      }).status,
      "ok",
    );
    const stolen = world.command({
      command_id: "steal-key",
      actor: bob,
      verb: "take",
      target: "key",
      perceivers: true,
    });
    strictEqual(stolen.status, "ok");
    strictEqual(world.entity(world.id("key") as string)?.contained_in, bob);
    strictEqual(world.entity(world.id("key") as string)?.in_part, "hand_l");
    for (const type of ["take", "moved"]) {
      const event = stolen.events.find((candidate) => candidate.type === type);
      ok(event?.perceivers !== undefined, `no perceivers on ${type}`);
      // Bob's grip closes on it; ann's pocket never tells her.
      deepStrictEqual([...(event.perceivers?.touch ?? [])].sort(), [bob].sort());
    }
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("in the dark a pocket theft goes unheard as well as unfelt", (t) => {
  for (const world of touchWorlds(t)) {
    const ann = world.id("ann");
    const bob = world.id("bob");
    const rex = world.id("rex");
    ok(ann !== null && bob !== null && rex !== null);
    strictEqual(
      world.command({ command_id: "take-key", actor: ann, verb: "take", target: "key", perceivers: true }).status,
      "ok",
    );
    strictEqual(
      world.command({
        command_id: "pocket-key",
        actor: ann,
        verb: "put",
        target: "key",
        args: { relation: "in", destination: `${ann}.pocket` },
      }).status,
      "ok",
    );
    // The cellar is dark and the act is silent: the victim neither feels nor hears it.
    const stolen = world.command({
      command_id: "steal-key",
      actor: bob,
      verb: "take",
      target: "key",
      perceivers: true,
    });
    strictEqual(stolen.status, "ok");
    for (const type of ["take", "moved"]) {
      const event = stolen.events.find((candidate) => candidate.type === type);
      ok(event?.perceivers !== undefined, `no perceivers on ${type}`);
      deepStrictEqual([...(event.perceivers?.touch ?? [])].sort(), [bob].sort());
      deepStrictEqual(event.perceivers?.hearing, [], `${type} heard`);
    }
    // The controls still make a sound: walking, pushing and dropping are heard in the room.
    const walked = world.command({
      command_id: "bob-steps",
      actor: bob,
      verb: "move",
      args: { to: { x: 50, y: 0 } },
      perceivers: true,
    });
    strictEqual(walked.status, "ok");
    deepStrictEqual(
      [...(walked.events.find((event) => event.type === "moved")?.perceivers?.hearing ?? [])].sort(),
      [ann, bob, rex].sort(),
    );
    const pushed = world.command({
      command_id: "bob-shove",
      actor: bob,
      verb: "push",
      target: "flask",
      args: { distance_cm: 10, dir: "+x" },
      perceivers: true,
    });
    strictEqual(pushed.status, "ok");
    deepStrictEqual(
      [...(pushed.events.find((event) => event.type === "push")?.perceivers?.hearing ?? [])].sort(),
      [ann, bob, rex].sort(),
    );
    strictEqual(
      world.command({ command_id: "take-flask", actor: bob, verb: "take", target: "flask" }).status,
      "ok",
    );
    const dropped = world.command({
      command_id: "drop-flask",
      actor: bob,
      verb: "drop",
      target: "flask",
      perceivers: true,
    });
    strictEqual(dropped.status, "ok");
    deepStrictEqual(
      [...(dropped.events.find((event) => event.type === "dropped")?.perceivers?.hearing ?? [])].sort(),
      [ann, bob, rex].sort(),
    );
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("taking from another agent's hand stays refused", (t) => {
  for (const world of touchWorlds(t)) {
    const ann = world.id("ann");
    const bob = world.id("bob");
    ok(ann !== null && bob !== null);
    strictEqual(
      world.command({ command_id: "take-key", actor: ann, verb: "take", target: "key" }).status,
      "ok",
    );
    const snatched = world.command({ command_id: "snatch-key", actor: bob, verb: "take", target: "key" });
    strictEqual(snatched.status, "refused");
    strictEqual(snatched.reason_code, "held_by_another");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("an agent touches itself and what its hands hold, nothing else", (t) => {
  for (const world of touchWorlds(t)) {
    const ann = world.id("ann");
    const bob = world.id("bob");
    ok(ann !== null && bob !== null);
    strictEqual(
      world.command({ command_id: "take-key", actor: ann, verb: "take", target: "key" }).status,
      "ok",
    );
    const key = world.id("key");
    ok(key !== null);
    const touch = (entity: string) =>
      world.query({ kind: "perceive", observer: ann, entity, sense: "touch" });
    deepStrictEqual(touch(ann), { value: "true", basis_code: "own_body" });
    deepStrictEqual(touch(key), { value: "true", basis_code: "own_body" });
    strictEqual(
      world.command({
        command_id: "pocket-key",
        actor: ann,
        verb: "put",
        target: "key",
        args: { relation: "in", destination: `${ann}.pocket` },
      }).status,
      "ok",
    );
    deepStrictEqual(touch(key), { value: "false", basis_code: "not_touching" });
    deepStrictEqual(touch(bob), { value: "false", basis_code: "not_touching" });
  }
});

test("without touch in coverage the answer is unknown", (t) => {
  for (const world of touchWorlds(t, DEAF)) {
    const ann = world.id("ann");
    ok(ann !== null);
    deepStrictEqual(world.query({ kind: "perceive", observer: ann, entity: ann, sense: "touch" }), {
      value: "unknown",
      basis_code: "uncovered_sense",
    });
    strictEqual(
      world.command({ command_id: "take-key", actor: ann, verb: "take", target: "key", perceivers: true }).status,
      "ok",
    );
    const moved = felt(world, "moved");
    ok(moved.perceivers !== undefined);
    deepStrictEqual(moved.perceivers?.unknown_senses, ["smell", "touch"]);
  }
});
