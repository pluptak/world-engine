import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, type Id, type Result, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A sleeping body makes no command of its own and hears and sees nothing; touch and smell are its own.
// The author wakes it with an edit. Nothing here is a verb that makes a body sleep.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

interface Hall {
  world: World;
  ann: Id;
  bob: Id;
  dee: Id;
}

function hall(t: { after(callback: () => void): void }): Hall {
  const root = tempDir(t);
  const world = createWorld(join(root, "w"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: -100, y: 0 } } },
    { id: "dee", template: "human", overrides: { name: "dee", location: "hall", support: "hall", pos: { x: 100, y: 0 }, props: { asleep: true } } },
  ], registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, ann: id("ann"), bob: id("bob"), dee: id("dee") };
}

let seq = 0;
function run(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `s${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

test("a sleeping body's own commands are refused asleep, and the author's are not", (t) => {
  const h = hall(t);
  const said = run(h.world, h.dee, "say", undefined, { utterance: "hello", volume: "normal" });
  strictEqual(said.status, "refused");
  strictEqual(said.reason_code, "asleep");
  strictEqual(run(h.world, h.dee, "wait").reason_code, "asleep");
  // Others may still speak to the room, and the sleeper is still a body in it.
  strictEqual(run(h.world, h.ann, "say", undefined, { utterance: "hello", volume: "normal" }).status, "ok");
  strictEqual(h.world.snapshot().entities[h.dee]?.status, "intact");
  strictEqual(validateSnapshot(h.world.snapshot(), registry).length, 0);
});

test("a sleeping body senses nothing by sight or hearing, and touch is its own", (t) => {
  const h = hall(t);
  const said = run(h.world, h.ann, "say", undefined, { utterance: "hello", volume: "normal" });
  const event = said.events.find((e) => e.type === "say");
  ok(event !== undefined);
  deepStrictEqual(h.world.query({ kind: "perceive", observer: h.dee, event_id: event.event_id, sense: "hearing" }), { value: "false", basis_code: "asleep" });
  deepStrictEqual(h.world.query({ kind: "perceive", observer: h.dee, sense: "sight", entity: h.ann }), { value: "false", basis_code: "asleep" });
  // Bob, awake in the same room, hears and sees as anyone does.
  strictEqual(h.world.query({ kind: "perceive", observer: h.bob, event_id: event.event_id, sense: "hearing" }).value, "true");
  strictEqual(h.world.query({ kind: "perceive", observer: h.dee, sense: "touch", entity: h.ann }).basis_code === "asleep", false);
});

test("the author wakes the body, and it acts again", (t) => {
  const h = hall(t);
  strictEqual(h.world.edit({ kind: "update_props", target: h.dee, props: { asleep: false } }).status, "ok");
  strictEqual(run(h.world, h.dee, "say", undefined, { utterance: "up", volume: "normal" }).status, "ok");
  strictEqual(h.world.query({ kind: "perceive", observer: h.dee, sense: "sight", entity: h.ann }).basis_code === "asleep", false);
});
