import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { tempDir } from "./harness.js";

// A generator in the hall feeds a panel and a cable; the cable feeds a camera. The panel is worked
// by the AI's terminal in the control room, and the cable through the panel. Bob stands by the
// panel, the dog by the generator, and a stone lies where the camera looks.
const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "control", template: "room", overrides: { name: "control room", props: { lit: true } } },
  { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -200, y: 0 } } },
  {
    id: "panel",
    template: "panel",
    overrides: { name: "panel", location: "hall", support: "hall", pos: { x: 200, y: 0 }, props: { powered_by: "generator", controlled_by: "ai" } },
  },
  {
    id: "cable",
    template: "cable",
    overrides: { name: "cable", location: "hall", support: "hall", pos: { x: 100, y: 0 }, props: { powered_by: "generator", controlled_by: "panel" } },
  },
  {
    id: "cam",
    template: "camera",
    overrides: { name: "cam", location: "hall", support: "hall", pos: { x: 300, y: 300 }, props: { powered_by: "cable", controlled_by: "ai" } },
  },
  { id: "ai", template: "terminal", overrides: { name: "ai", location: "control", support: "control", pos: { x: 0, y: 0 }, props: { powered_by: "generator" } } },
  { id: "hal", template: "terminal", overrides: { name: "hal", location: "control", support: "control", pos: { x: 200, y: 0 } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 250, y: 0 } } },
  { id: "dog", template: "dog", overrides: { name: "dog", location: "hall", support: "hall", pos: { x: -170, y: 40 } } },
  { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
];

function open(t: { after(callback: () => void): void }) {
  const world = createWorld(join(tempDir(t), "switch"), scenario);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result => {
    seq += 1;
    return world.command({ command_id: `w${seq}`, actor, verb, ...(target !== undefined && { target }), ...(args !== undefined && { args }) });
  };
  return { world, id, run };
}

const verdict = (result: Result) => [result.status, result.reason_code, result.reason_data];

function wreck(world: World, run: (actor: Id, verb: string, target?: string) => Result, actor: Id, target: string, blows: number): void {
  for (let blow = 0; blow < blows; blow += 1) {
    strictEqual(run(actor, "attack", target).status, "ok");
  }
  strictEqual(world.entity(world.id(target)!)?.status, "destroyed");
}

test("a human at the generator switches it off and on", (t) => {
  const { world, id, run } = open(t);
  const [ann, generator] = [id("ann"), id("generator")];
  strictEqual(run(ann, "move", undefined, { to: { x: -120, y: 0 } }).status, "ok");
  const off = run(ann, "switch_off", "generator");
  strictEqual(off.status, "ok");
  strictEqual(world.entity(generator)?.props.on, false);
  deepStrictEqual([off.events.at(-1)?.type, off.events.at(-1)?.data], ["switched", { on: false }]);
  const on = run(ann, "switch_on", "generator");
  strictEqual(on.status, "ok");
  strictEqual(world.entity(generator)?.props.on, true);
  deepStrictEqual([on.events.at(-1)?.type, on.events.at(-1)?.data], ["switched", { on: true }]);
});

test("each refusal once: no power link, handless, out of reach, already that way", (t) => {
  const { id, run } = open(t);
  const [ann, dog] = [id("ann"), id("dog")];
  deepStrictEqual(verdict(run(ann, "switch_off", "stone")), ["refused", "not_switchable", undefined]);
  deepStrictEqual(verdict(run(dog, "switch_off", "generator")), ["refused", "insufficient_manipulation", { capacity: "manipulation", have: 0, need: 50 }]);
  deepStrictEqual(verdict(run(ann, "switch_off", "generator"))[0], "refused");
  strictEqual(verdict(run(ann, "switch_off", "generator"))[1], "out_of_reach");
  strictEqual(run(ann, "move", undefined, { to: { x: -120, y: 0 } }).status, "ok");
  deepStrictEqual(verdict(run(ann, "switch_on", "generator")), ["refused", "already_on", undefined]);
  strictEqual(run(ann, "switch_off", "generator").status, "ok");
  deepStrictEqual(verdict(run(ann, "switch_off", "generator")), ["refused", "already_off", undefined]);
});

test("a destroyed panel disconnects the controller's switch", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, panel] = [id("ai"), id("ann"), id("panel")];
  strictEqual(run(ann, "move", undefined, { to: { x: 120, y: 0 } }).status, "ok");
  wreck(world, run, ann, "panel", 3);
  deepStrictEqual(verdict(run(ai, "switch_off", "cable")), ["refused", "disconnected", { at: panel }]);
});

test("a switched-off source leaves a panel switch unpowered with cut the source", (t) => {
  const { id, run } = open(t);
  const [ann, bob, generator, cable] = [id("ann"), id("bob"), id("generator"), id("cable")];
  strictEqual(run(ann, "move", undefined, { to: { x: -120, y: 0 } }).status, "ok");
  strictEqual(run(ann, "switch_off", "generator").status, "ok");
  deepStrictEqual(verdict(run(bob, "switch_off", "cable")), ["refused", "unpowered", { at: cable, cut: generator }]);
});

test("the switch is seen in a lit room and not from the next room", (t) => {
  const { world, id, run } = open(t);
  const [ann, bob, hal] = [id("ann"), id("bob"), id("hal")];
  strictEqual(run(ann, "move", undefined, { to: { x: -120, y: 0 } }).status, "ok");
  const off = run(ann, "switch_off", "generator");
  strictEqual(off.status, "ok");
  const event = off.events.at(-1)?.event_id;
  ok(event !== undefined);
  deepStrictEqual(world.query({ kind: "perceive", observer: bob, event_id: event, sense: "sight" }), { value: "true", basis_code: "same_location_lit" });
  deepStrictEqual(world.query({ kind: "perceive", observer: hal, event_id: event, sense: "sight" }), { value: "false", basis_code: "not_perceptible" });
  deepStrictEqual(world.query({ kind: "perceive", observer: hal, event_id: event, sense: "hearing" }), { value: "false", basis_code: "not_perceptible" });
});

test("the AI switches a cable off through the panel and its own camera goes dark", (t) => {
  const { world, id, run } = open(t);
  const [ai, cable, stone] = [id("ai"), id("cable"), id("stone")];
  deepStrictEqual(world.query({ kind: "perceive", observer: ai, entity: stone, sense: "sight" }), { value: "true", basis_code: "camera" });
  strictEqual(run(ai, "switch_off", "cable").status, "ok");
  strictEqual(world.entity(cable)?.props.on, false);
  deepStrictEqual(world.query({ kind: "perceive", observer: ai, entity: stone, sense: "sight" }), { value: "false", basis_code: "not_perceptible" });
});

test("both switches are round moves", (t) => {
  const { world, id, run } = open(t);
  const [ann, generator] = [id("ann"), id("generator")];
  strictEqual(run(ann, "move", undefined, { to: { x: -120, y: 0 } }).status, "ok");
  strictEqual(world.round([{ command_id: "r1", actor: ann, verb: "switch_off", target: "generator" }]).status, "ok");
  strictEqual(world.entity(generator)?.props.on, false);
  strictEqual(world.round([{ command_id: "r2", actor: ann, verb: "switch_on", target: "generator" }]).status, "ok");
  strictEqual(world.entity(generator)?.props.on, true);
});

test("options offers switch_off to someone at a running generator", (t) => {
  const { world, id, run } = open(t);
  const [ann, generator] = [id("ann"), id("generator")];
  strictEqual(run(ann, "move", undefined, { to: { x: -120, y: 0 } }).status, "ok");
  ok(world.options(ann).ready.some((option) => option.verb === "switch_off" && option.target === generator));
  strictEqual(run(ann, "switch_off", "generator").status, "ok");
  ok(world.options(ann).ready.some((option) => option.verb === "switch_on" && option.target === generator));
});

test("the AI switches the cable back on through the panel, and its camera sees again", (t) => {
  // The cable off has no power of its own, but the command that switches it on is judged with it on.
  const { world, id, run } = open(t);
  const [ai, cable, stone] = [id("ai"), id("cable"), id("stone")];
  strictEqual(run(ai, "switch_off", "cable").status, "ok");
  deepStrictEqual(verdict(run(ai, "switch_on", "cable")), ["ok", undefined, undefined]);
  strictEqual(world.entity(cable)?.props.on, true);
  deepStrictEqual(world.query({ kind: "perceive", observer: ai, entity: stone, sense: "sight" }), { value: "true", basis_code: "camera" });
  // A link off upstream still refuses: the generator off leaves the cable with no power to carry the command.
  strictEqual(world.edit({ kind: "update_props", target: id("generator"), props: { on: false } }).status, "ok");
  deepStrictEqual(verdict(run(ai, "switch_off", "cable"))[0], "refused");
});
