import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld, type Coverage, type Id, type Result, type Scenario } from "../src/index.js";
import { tempDir } from "./harness.js";

// An agent's own power (`docs/power.md`): the AI's terminal in the control room runs on the
// generator beside it; the camera, the arm and the hall door it controls run on the spare. Hal is a
// terminal with no power link at all, and ann stands by the terminal's generator.
const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "control", template: "room", overrides: { name: "control room", props: { lit: true } } },
  { id: "main", template: "generator", overrides: { name: "main", location: "control", support: "control", pos: { x: -200, y: 0 } } },
  { id: "spare", template: "generator", overrides: { name: "spare", location: "control", support: "control", pos: { x: -200, y: 300 } } },
  {
    id: "hall_door",
    template: "door",
    overrides: { name: "hall door", props: { open: false, from: "hall", to: "control", powered_by: "spare", controlled_by: "ai" } },
  },
  {
    id: "cam",
    template: "camera",
    overrides: { name: "cam", location: "hall", support: "hall", pos: { x: 300, y: 300 }, props: { powered_by: "spare", controlled_by: "ai" } },
  },
  {
    id: "arm",
    template: "arm",
    overrides: { name: "arm", location: "hall", support: "hall", pos: { x: 0, y: 0 }, props: { powered_by: "spare", controlled_by: "ai" } },
  },
  { id: "cup", template: "cup", overrides: { name: "cup", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
  { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: -300, y: -300 } } },
  { id: "ai", template: "terminal", overrides: { name: "ai", location: "control", support: "control", pos: { x: 200, y: 0 }, props: { powered_by: "main" } } },
  { id: "hal", template: "terminal", overrides: { name: "hal", location: "control", support: "control", pos: { x: 300, y: -300 } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "control", support: "control", pos: { x: -100, y: 0 } } },
];

// Touch is declared too, so every sense the engine computes is asked.
const COVERAGE: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near", "reachable"],
  senses: ["sight", "hearing", "touch"],
  properties: ["integrity", "residue", "pos", "open"],
};

function open(t: { after(callback: () => void): void }) {
  const world = createWorld(join(tempDir(t), "agent-power"), scenario, undefined, { coverage: COVERAGE });
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>, perceivers?: boolean): Result => {
    seq += 1;
    return world.command({
      command_id: `p${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
      ...(perceivers === true && { perceivers }),
    });
  };
  const perceives = (observer: Id, sense: "sight" | "hearing" | "touch", entity: Id) =>
    world.query({ kind: "perceive", observer, sense, entity });
  // Ann's three blows destroy the terminal's generator.
  const cut = (): void => {
    for (let blow = 0; blow < 3; blow += 1) {
      strictEqual(run(id("ann"), "attack", "main").status, "ok");
    }
    strictEqual(world.entity(id("main"))?.status, "destroyed");
  };
  return { world, id, run, perceives, cut };
}

const verdict = (result: Result) => [result.status, result.reason_code, result.reason_data];

test("a powered terminal acts and senses: its door, its camera, its arm, a voice beside it", (t) => {
  const { id, run, perceives } = open(t);
  const [ai, ann] = [id("ai"), id("ann")];
  deepStrictEqual(perceives(ai, "sight", id("stone")), { value: "true", basis_code: "camera" });
  const said = run(ann, "say", undefined, { utterance: "hello" }, true);
  ok(said.events[0]?.perceivers?.hearing.includes(ai));
  deepStrictEqual(verdict(run(ai, "lock", "hall door")), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(id("arm"), "take", "cup")), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ai, "wait", undefined, { ticks: 1 })), ["ok", undefined, undefined]);
});

test("with its source destroyed every command is refused unpowered, and every sense is false", (t) => {
  const { world, id, run, perceives, cut } = open(t);
  const [ai, ann, main] = [id("ai"), id("ann"), id("main")];
  cut();
  const fault = ["refused", "unpowered", { at: ai, cut: main }];
  deepStrictEqual(verdict(run(ai, "wait", undefined, { ticks: 1 })), fault);
  deepStrictEqual(verdict(run(ai, "say", undefined, { utterance: "help" })), fault);
  deepStrictEqual(verdict(run(ai, "lock", "hall door")), fault);
  strictEqual(world.entity(id("hall_door"))?.props.locked, undefined);
  for (const sense of ["sight", "hearing", "touch"] as const) {
    deepStrictEqual(perceives(ai, sense, ai), { value: "false", basis_code: "unpowered" }, sense);
  }
  // The camera still has power from the spare, but what it feeds senses nothing.
  deepStrictEqual(perceives(ai, "sight", id("stone")), { value: "false", basis_code: "unpowered" });
  strictEqual(world.observe(ai).entities.length, 0);
  // A voice beside it lists it among no one's hearers.
  const said = run(ann, "say", undefined, { utterance: "hello" }, true);
  strictEqual(said.status, "ok");
  strictEqual(said.events[0]?.perceivers?.hearing.includes(ai), false);
});

test("an arm the terminal controls is refused with the terminal's own fault", (t) => {
  const { world, id, run, cut } = open(t);
  const [ai, arm, cup, main] = [id("ai"), id("arm"), id("cup"), id("main")];
  cut();
  deepStrictEqual(verdict(run(arm, "take", "cup")), ["refused", "unpowered", { at: ai, cut: main }]);
  strictEqual(world.entity(cup)?.contained_in, null);
});

test("power back, by the author's relink to the spare, and the terminal and its arm act and sense again", (t) => {
  const { world, id, run, perceives, cut } = open(t);
  const [ai, arm, spare] = [id("ai"), id("arm"), id("spare")];
  cut();
  strictEqual(world.edit({ kind: "update_props", target: ai, props: { powered_by: spare } }).status, "ok");
  deepStrictEqual(verdict(run(ai, "lock", "hall door")), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(arm, "take", "cup")), ["ok", undefined, undefined]);
  deepStrictEqual(perceives(ai, "sight", id("stone")), { value: "true", basis_code: "camera" });
});

test("an agent with no power link is untouched: a human, and a terminal with none", (t) => {
  const { id, run, perceives, cut } = open(t);
  const [ann, hal] = [id("ann"), id("hal")];
  cut();
  deepStrictEqual(verdict(run(hal, "wait", undefined, { ticks: 1 })), ["ok", undefined, undefined]);
  deepStrictEqual(perceives(hal, "sight", ann), { value: "true", basis_code: "same_location_lit" });
  deepStrictEqual(verdict(run(ann, "move", undefined, { to: { x: 0, y: 200 } })), ["ok", undefined, undefined]);
  deepStrictEqual(perceives(ann, "sight", hal), { value: "true", basis_code: "same_location_lit" });
});
