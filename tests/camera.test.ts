import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { actorWorld, aliasOf, createWorld, type Id, type Result, type Scenario } from "../src/index.js";
import { tempDir } from "./harness.js";

// A camera's sight is the sight of the agent its feed reaches (`docs/camera.md`). The hall's camera
// feeds ai in the control room over a wire from the generator; the cellar's, in the dark, feeds ai
// too; bea's own camera in the hall feeds her. The yard is through the hall's open door.
const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "cellar", template: "room", overrides: { name: "cellar" } },
  { id: "control", template: "room", overrides: { name: "control room", props: { lit: true } } },
  { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
  { id: "gate", template: "door", overrides: { name: "gate", props: { open: true, from: "hall", to: "yard" } } },
  { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -300, y: 0 } } },
  {
    id: "wire",
    template: "cable",
    overrides: { name: "wire", location: "hall", support: "hall", pos: { x: -200, y: 200 }, props: { powered_by: "generator" } },
  },
  {
    id: "cam",
    template: "camera",
    overrides: { name: "cam", location: "hall", support: "hall", pos: { x: 100, y: 0 }, props: { powered_by: "wire", controlled_by: "ai" } },
  },
  {
    id: "deep",
    template: "camera",
    overrides: { name: "deep", location: "cellar", support: "cellar", pos: { x: 0, y: 0 }, props: { powered_by: "generator", controlled_by: "ai" } },
  },
  {
    id: "bea_cam",
    template: "camera",
    overrides: { name: "bea cam", location: "hall", support: "hall", pos: { x: 300, y: 300 }, props: { powered_by: "generator", controlled_by: "bea" } },
  },
  { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 0, y: 100 } } },
  { id: "book", template: "book", overrides: { name: "book", location: "hall", support: "hall", pos: { x: 200, y: -200 } } },
  { id: "note", template: "note", overrides: { name: "note", location: "hall", support: "hall", pos: { x: 200, y: -200 }, concealed_by: "book" } },
  { id: "chest", template: "locked_chest", overrides: { name: "chest", location: "hall", support: "hall", pos: { x: -200, y: -200 } } },
  { id: "coin", template: "key", overrides: { name: "coin", location: "hall", contained_in: "chest" } },
  { id: "pebble", template: "stone", overrides: { name: "pebble", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
  { id: "lump", template: "stone", overrides: { name: "lump", location: "cellar", support: "cellar", pos: { x: 100, y: 0 } } },
  { id: "ai", template: "terminal", overrides: { name: "ai", location: "control", support: "control", pos: { x: 0, y: 0 } } },
  { id: "hal", template: "terminal", overrides: { name: "hal", location: "control", support: "control", pos: { x: 200, y: 0 } } },
  { id: "bea", template: "human", overrides: { name: "bea", location: "control", support: "control", pos: { x: -200, y: 0 } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
];

function open(t: { after(callback: () => void): void }) {
  const world = createWorld(join(tempDir(t), "camera"), scenario);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>, perceivers?: boolean): Result => {
    seq += 1;
    return world.command({
      command_id: `c${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
      ...(perceivers === true && { perceivers }),
    });
  };
  const sees = (observer: string, entity: string) =>
    world.query({ kind: "perceive", observer: id(observer), sense: "sight", entity: id(entity) });
  return { world, id, run, sees };
}

test("a fed agent sees what stands in the camera's lit room, and nothing a body there could not", (t) => {
  const { sees } = open(t);
  deepStrictEqual(sees("ai", "stone"), { value: "true", basis_code: "camera" });
  // Hidden and shut away stay so; the cellar is dark; the yard is through a door the camera does not see across.
  deepStrictEqual(sees("ai", "note"), { value: "false", basis_code: "concealed" });
  deepStrictEqual(sees("ai", "coin"), { value: "false", basis_code: "enclosed" });
  strictEqual(sees("ai", "lump").value, "false");
  strictEqual(sees("ai", "pebble").value, "false");
  // An agent the feed does not reach sees nothing of the hall.
  strictEqual(sees("hal", "stone").value, "false");
  // The body's own sight is still its own: ann in the hall sees the stone as before.
  deepStrictEqual(sees("ann", "stone"), { value: "true", basis_code: "same_location_lit" });
});

for (const [what, target] of [
  ["the camera", "cam"],
  ["its source", "generator"],
  ["a link on the way", "wire"],
] as const) {
  test(`destroying ${what} ends the feed`, (t) => {
    const { world, id, run, sees } = open(t);
    const ann = id("ann");
    const at = world.entity(id(target))!.pos!;
    strictEqual(run(ann, "move", undefined, { to: { x: at.x, y: at.y - 60 } }).status, "ok");
    for (let blow = 0; blow < 3; blow += 1) {
      strictEqual(run(ann, "attack", target).status, "ok");
    }
    strictEqual(world.entity(id(target))?.status, "destroyed");
    strictEqual(sees("ai", "stone").value, "false");
  });
}

test("an observer with no sight of its own sees nothing through a camera", (t) => {
  const { world, id, sees } = open(t);
  deepStrictEqual(sees("bea", "stone"), { value: "true", basis_code: "camera" });
  strictEqual(world.edit({ kind: "set_part", target: id("bea"), part: "head", state: { integrity: 0, status: "destroyed" } }).status, "ok");
  deepStrictEqual(sees("bea", "stone"), { value: "false", basis_code: "no_sense_capacity" });
});

test("an act in the camera's room lists the fed agent by sight, and its views list what it shows", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, stone] = [id("ai"), id("ann"), id("stone")];
  const took = run(ann, "take", "stone", undefined, true);
  strictEqual(took.status, "ok");
  for (const event of took.events) {
    ok(event.perceivers?.sight.includes(ai), event.type);
    deepStrictEqual(event.perceivers?.hearing.includes(ai), false);
  }
  ok(world.observe(ai).entities.some((entity) => entity.id === ann));
  const view = actorWorld(world, ai);
  ok(view.observe().entities.some((entity) => entity.id === aliasOf(ai, ann)));
  // It names what it sees; its own reach still keeps it from acting there.
  strictEqual(run(ann, "drop", "stone").status, "ok");
  const reached = view.command({ command_id: "grab", verb: "take", target: aliasOf(ai, stone) });
  strictEqual(reached.status, "refused");
  strictEqual(world.entity(stone)?.contained_in, null);
});
