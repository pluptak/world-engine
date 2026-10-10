import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { actorWorld, createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { tempDir } from "./harness.js";

// An intercom carries its room's sound to the agent that controls it, and that agent's `say` into its
// room (`docs/intercom.md`). The hall holds the intercom, the terminal in the yard controls it, the
// generator in the hall powers it; the cell is through an open door, next door to the hall.
const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
  { id: "cell", template: "room", overrides: { name: "cell", props: { lit: true } } },
  { id: "hall_yard", template: "door", overrides: { name: "hall yard door", location: "hall", support: "hall", pos: { x: 0, y: 450 }, props: { open: true, from: "hall", to: "yard" } } },
  { id: "hall_cell", template: "door", overrides: { name: "hall cell door", location: "hall", support: "hall", pos: { x: -450, y: 0 }, props: { open: true, from: "hall", to: "cell" } } },
  { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -400, y: 300 } } },
  {
    id: "intercom",
    template: "intercom",
    overrides: { name: "intercom", location: "hall", support: "hall", pos: { x: 0, y: 0 }, props: { powered_by: "generator", controlled_by: "ai" } },
  },
  { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 250, y: 0 } } },
  { id: "ai", template: "terminal", overrides: { name: "ai", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
  { id: "hal", template: "terminal", overrides: { name: "hal", location: "yard", support: "yard", pos: { x: 200, y: 0 } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 300, y: 0 } } },
  { id: "dee", template: "human", overrides: { name: "dee", location: "hall", support: "hall", pos: { x: -300, y: 100 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "cell", support: "cell", pos: { x: 0, y: 0 } } },
  { id: "eve", template: "human", overrides: { name: "eve", location: "yard", support: "yard", pos: { x: 100, y: 0 } } },
];

function open(t: { after(callback: () => void): void }): { world: World; id: (name: string) => Id; run: (actor: Id, verb: string, target?: string, args?: Record<string, unknown>) => Result } {
  const world = createWorld(join(tempDir(t), "intercom"), scenario);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result => {
    seq += 1;
    return world.command({
      command_id: `n${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
    });
  };
  return { world, id, run };
}

// The hearing answer of an observer about an event: its value and its basis.
const heard = (world: World, observer: Id, event: string) => world.query({ kind: "perceive", observer, event_id: event, sense: "hearing" });

test("a fed agent hears a normal say in the intercom's room, but not a whisper far from it, a take, or a sound next door", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, bob] = [id("ai"), id("ann"), id("bob")];
  // Ann is 300 cm from the intercom: her normal speech reaches the terminal through it, her whisper does not.
  const normal = run(ann, "say", undefined, { utterance: "hello" });
  deepStrictEqual(heard(world, ai, normal.events[0]!.event_id), { value: "true", basis_code: "intercom" });
  const whisper = run(ann, "say", undefined, { utterance: "psst", volume: "whisper" });
  strictEqual(heard(world, ai, whisper.events[0]!.event_id).value, "false");
  // A take is hand work: quiet, and not carried.
  const take = run(ann, "take", "stone");
  strictEqual(take.status, "ok");
  const moved = take.events.find((event) => event.type === "moved")!;
  deepStrictEqual(heard(world, ai, moved.event_id), { value: "false", basis_code: "quiet" });
  // Bob in the cell speaks: the terminal hears nothing of it through the intercom.
  const next = run(bob, "say", undefined, { utterance: "over" });
  strictEqual(heard(world, ai, next.events[0]!.event_id).value, "false");
});

test("the terminal's own say is heard in the intercom's room, a whisper only near it, and not next door", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, bob] = [id("ai"), id("ann"), id("bob")];
  // Ann stands 300 cm away: the terminal's whisper does not reach her, its normal speech does.
  const whisper = run(ai, "say", undefined, { utterance: "psst", volume: "whisper" });
  strictEqual(heard(world, ann, whisper.events[0]!.event_id).value, "false");
  const normal = run(ai, "say", undefined, { utterance: "wake" });
  deepStrictEqual(heard(world, ann, normal.events[0]!.event_id), { value: "true", basis_code: "intercom" });
  // Bob in the cell is not in the intercom's room: nothing carries it there.
  strictEqual(heard(world, bob, normal.events[0]!.event_id).value, "false");
  // Ann walks next to the intercom: now the whisper reaches her.
  strictEqual(run(ann, "move", undefined, { to: { x: 60, y: 0 } }).status, "ok");
  const near = run(ai, "say", undefined, { utterance: "psst", volume: "whisper" });
  deepStrictEqual(heard(world, ann, near.events[0]!.event_id), { value: "true", basis_code: "intercom" });
});

test("a human's say beside the controller is not carried out", (t) => {
  const { world, id, run } = open(t);
  // Eve speaks in the yard with the terminal, which is not her intercom: Dee in the hall hears nothing.
  const said = run(id("eve"), "say", undefined, { utterance: "quiet" });
  strictEqual(heard(world, id("dee"), said.events[0]!.event_id).value, "false");
});

test("a destroyed or unpowered intercom carries nothing, and one restored carries again", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, dee, intercom] = [id("ai"), id("ann"), id("dee"), id("intercom")];
  strictEqual(world.edit({ kind: "update_props", target: intercom, props: { powered_by: ai } }).status, "ok");
  const unpowered = run(ann, "say", undefined, { utterance: "hello" });
  strictEqual(heard(world, ai, unpowered.events[0]!.event_id).value, "false");
  strictEqual(world.edit({ kind: "update_props", target: intercom, props: { powered_by: id("generator") } }).status, "ok");
  const restored = run(ann, "say", undefined, { utterance: "again" });
  deepStrictEqual(heard(world, ai, restored.events[0]!.event_id), { value: "true", basis_code: "intercom" });
  // Dee beats the intercom to pieces beside it: three blows, a thing at full integrity.
  strictEqual(run(dee, "move", undefined, { to: { x: -60, y: 0 } }).status, "ok");
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(dee, "attack", "intercom").status, "ok");
  }
  strictEqual(world.entity(intercom)?.status, "destroyed");
  const broken = run(ann, "say", undefined, { utterance: "gone" });
  strictEqual(heard(world, ai, broken.events[0]!.event_id).value, "false");
});

test("an agent the intercom does not feed hears nothing through it", (t) => {
  const { world, id, run } = open(t);
  const said = run(id("ann"), "say", undefined, { utterance: "hello" });
  deepStrictEqual(heard(world, id("hal"), said.events[0]!.event_id), { value: "false", basis_code: "not_perceptible" });
});

test("a subject's actor view lists the controller's say", (t) => {
  const { world, id, run } = open(t);
  run(id("ai"), "say", undefined, { utterance: "wake" });
  const view = actorWorld(world, id("dee")).observe({ since_tick: 0 });
  deepStrictEqual(view.events.filter((event) => event.type === "say").map((event) => event.utterance), ["wake"]);
});
