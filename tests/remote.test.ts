import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { actorWorld, aliasOf, createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { tempDir } from "./harness.js";

// A device controlled from elsewhere (`docs/power.md`): the vault door is controlled by the panel,
// the panel by the AI's terminal in the control room, and both are powered by the generator in the
// hall. The side door names the terminal too, with no power at all.
const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "control", template: "room", overrides: { name: "control room", props: { lit: true } } },
  { id: "vault", template: "room", overrides: { name: "vault", props: { lit: true } } },
  { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
  {
    id: "vault_door",
    template: "door",
    overrides: {
      name: "vault door",
      location: "hall",
      support: "hall",
      pos: { x: 0, y: 300 },
      props: { open: false, from: "hall", to: "vault", powered_by: "generator", controlled_by: "panel" },
    },
  },
  {
    id: "side_door",
    template: "door",
    overrides: { name: "side door", props: { open: false, locked: true, from: "hall", to: "yard", controlled_by: "ai" } },
  },
  { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -200, y: 0 } } },
  {
    id: "panel",
    template: "cable",
    overrides: { name: "panel", location: "hall", support: "hall", pos: { x: 200, y: 0 }, props: { powered_by: "generator", controlled_by: "ai" } },
  },
  { id: "ai", template: "terminal", overrides: { name: "ai", location: "control", support: "control", pos: { x: 0, y: 0 } } },
  { id: "hal", template: "terminal", overrides: { name: "hal", location: "control", support: "control", pos: { x: 200, y: 0 } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
];

function open(t: { after(callback: () => void): void }) {
  const world = createWorld(join(tempDir(t), "remote"), scenario);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result => {
    seq += 1;
    return world.command({
      command_id: `r${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
    });
  };
  return { world, id, run };
}

const verdict = (result: Result) => [result.status, result.reason_code, result.reason_data];

// Three of a human's blows destroy a thing of no parts at full integrity.
function wreck(world: World, run: (actor: Id, verb: string, target?: string) => Result, ann: Id, target: string): void {
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(ann, "attack", target).status, "ok");
  }
  strictEqual(world.entity(world.id(target)!)?.status, "destroyed");
}

test("a controller locks, unlocks, opens and shuts a door in another room, with no key, hands or reach", (t) => {
  const { world, id, run } = open(t);
  const [ai, door] = [id("ai"), id("vault_door")];
  for (const verb of ["lock", "unlock", "open", "close"]) {
    deepStrictEqual(verdict(run(ai, verb, "vault door")), ["ok", undefined, undefined], verb);
  }
  deepStrictEqual(world.entity(door)?.props.open, false);
  // A body beside it acts as before: no key, no lock.
  strictEqual(run(ai, "lock", "vault door").status, "ok");
  strictEqual(run(id("ann"), "move", undefined, { to: { x: 0, y: 250 } }).status, "ok");
  strictEqual(run(id("ann"), "unlock", "vault door").reason_code, "no_key");
});

test("a remote close moves what stands in the doorway aside first", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, door] = [id("ai"), id("ann"), id("vault_door")];
  strictEqual(run(ai, "open", "vault door").status, "ok");
  strictEqual(world.edit({ kind: "place", target: ann, support: id("hall"), pos: { x: 0, y: 300 } }).status, "ok");
  const closed = run(ai, "close", "vault door");
  deepStrictEqual(closed.events.map((event) => [event.type, event.entity]), [
    ["close", door],
    ["closed", door],
    ["moved", ann],
  ]);
});

test("a remote command is refused where it breaks: no power at the door, a destroyed panel, no supply", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann] = [id("ai"), id("ann")];
  // The side door has no power at all; one already locked is refused that first.
  deepStrictEqual(verdict(run(ai, "lock", "side door")), ["refused", "already_locked", undefined]);
  deepStrictEqual(verdict(run(ai, "unlock", "side door")), [
    "refused",
    "unpowered",
    { at: id("side_door"), cut: id("side_door") },
  ]);
  // A destroyed panel between door and controller disconnects it.
  strictEqual(run(ann, "move", undefined, { to: { x: 120, y: 0 } }).status, "ok");
  wreck(world, run, ann, "panel");
  deepStrictEqual(verdict(run(ai, "lock", "vault door")), ["refused", "disconnected", { at: id("panel") }]);
});

test("a destroyed source leaves the door unpowered, and names the source as the cut", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann] = [id("ai"), id("ann")];
  strictEqual(run(ann, "move", undefined, { to: { x: -120, y: 0 } }).status, "ok");
  wreck(world, run, ann, "generator");
  deepStrictEqual(verdict(run(ai, "lock", "vault door")), [
    "refused",
    "unpowered",
    { at: id("vault_door"), cut: id("generator") },
  ]);
});

test("a destroyed cable between the door and its source is the cut, not the door", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, door, panel] = [id("ai"), id("ann"), id("vault_door"), id("panel")];
  // The door now draws from the generator through the panel: the panel is both a link of the control
  // walk and of the power walk, so a destroyed panel leaves the door unpowered before it is disconnected.
  strictEqual(world.edit({ kind: "update_props", target: door, props: { powered_by: panel } }).status, "ok");
  strictEqual(run(ann, "move", undefined, { to: { x: 120, y: 0 } }).status, "ok");
  wreck(world, run, ann, "panel");
  deepStrictEqual(verdict(run(ai, "lock", "vault door")), [
    "refused",
    "unpowered",
    { at: door, cut: panel },
  ]);
  // The controller's view gives the same refusal with the cut as its alias, where it can name it.
  const view = actorWorld(world, ai);
  const refused = view.command({ command_id: "view-cut", verb: "lock", target: aliasOf(ai, door) });
  deepStrictEqual(
    [refused.reason_code, refused.reason_data],
    ["unpowered", { at: aliasOf(ai, door), cut: aliasOf(ai, panel) }],
  );
});

test("only the agent the control walk ends at names the door from another room", (t) => {
  const { id, run } = open(t);
  deepStrictEqual(verdict(run(id("hal"), "lock", "vault door")), ["unresolved", undefined, undefined]);
});

test("the controller's own view names the door by alias and offers it, without seeing it", (t) => {
  const { world, id } = open(t);
  const ai = id("ai");
  const door = aliasOf(ai, id("vault_door"));
  const view = actorWorld(world, ai);
  ok(view.options().ready.some((option) => option.verb === "lock" && option.target === door));
  ok(view.observe().entities.every((entity) => entity.id !== door));
  strictEqual(view.command({ command_id: "by-alias", verb: "open", target: door }).status, "ok");
  strictEqual(world.entity(id("vault_door"))?.props.open, true);
});

test("a link must name something, and neither walk may loop", (t) => {
  const { world, id } = open(t);
  const [door, panel, ai] = [id("vault_door"), id("panel"), id("ai")];
  const code = (result: Result) => result.reason_code;
  strictEqual(code(world.edit({ kind: "update_props", target: door, props: { powered_by: "e999" } })), "dangling_reference");
  strictEqual(code(world.edit({ kind: "remove", target: panel })), "dangling_reference");
  strictEqual(world.edit({ kind: "update_props", target: door, props: { powered_by: panel } }).status, "ok");
  strictEqual(code(world.edit({ kind: "update_props", target: panel, props: { powered_by: door } })), "power_loop");
  strictEqual(code(world.edit({ kind: "update_props", target: ai, props: { controlled_by: panel } })), "control_loop");
});
