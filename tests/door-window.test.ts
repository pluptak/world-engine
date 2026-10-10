import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld, WORLD_AUTHOR, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { fileURLToPath } from "node:url";
import { tempDir } from "./harness.js";

// A door that takes time to shut (`docs/door-window.md`): the gate between the hall and the yard is a
// shut door, two ticks from its close to its shut; the plain door beside it shuts at once. The terminal
// in the yard controls the gate from there, and the gate's generator powers it.
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
  { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -300, y: 0 } } },
  {
    id: "gate",
    template: "shut_door",
    overrides: {
      name: "gate",
      location: "hall",
      support: "hall",
      pos: { x: 0, y: 300 },
      props: { open: true, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" },
    },
  },
  {
    id: "plain",
    template: "door",
    overrides: { name: "plain", location: "hall", support: "hall", pos: { x: 300, y: 300 }, props: { open: true, from: "hall", to: "yard" } },
  },
  { id: "ai", template: "terminal", overrides: { name: "ai", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 250 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "yard", support: "yard", pos: { x: 0, y: -100 } } },
];

function open(t: { after(callback: () => void): void }) {
  const world: World = createWorld(join(tempDir(t), "window"), scenario);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result => {
    seq += 1;
    return world.command({
      command_id: `w${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
    });
  };
  const advance = (ticks: number): Result => run(WORLD_AUTHOR, "advance", undefined, { ticks });
  return { world, id, run, advance };
}

const types = (result: Result) => result.events.map((event) => event.type).filter((type) => type !== "advance");
const verdict = (result: Result) => [result.status, result.reason_code];

test("a shut door is closing from the close until it shuts, and the occupant in its way is moved aside only then", (t) => {
  const { world, id, run, advance } = open(t);
  const [ann, gate] = [id("ann"), id("gate")];
  // Ann stands in the doorway the open door leaves clear.
  strictEqual(world.edit({ kind: "place", target: ann, support: id("hall"), pos: { x: 0, y: 300 } }).status, "ok");
  const closing = run(id("ai"), "close", "gate");
  deepStrictEqual(closing.events.map((event) => [event.type, event.entity]), [
    ["close", gate],
    ["closing", gate],
  ]);
  deepStrictEqual([world.entity(gate)?.props.open, world.entity(gate)?.props.closing], [true, true]);
  deepStrictEqual(world.entity(ann)?.pos, { x: 0, y: 300 });
  // The shut falls due two ticks after the close; the clock runs it, and only then is ann moved.
  const shut = advance(2);
  deepStrictEqual(
    shut.events.filter((event) => event.type === "closed" || event.type === "moved").map((event) => [event.type, event.entity]),
    [
      ["closed", gate],
      ["moved", ann],
    ],
  );
  deepStrictEqual([world.entity(gate)?.props.open, world.entity(gate)?.props.closing], [false, undefined]);
  ok(world.entity(ann)?.pos?.y !== 300, "ann was moved aside");
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("a body walks through a shut door while it is still open in its window", (t) => {
  const { world, id, run } = open(t);
  strictEqual(run(id("ai"), "close", "gate").status, "ok");
  deepStrictEqual(verdict(run(id("bob"), "move", undefined, { through: "gate" })), ["ok", undefined]);
  strictEqual(world.entity(id("bob"))?.location, id("hall"));
});

test("an open in the window stops the shut: the door stays open, and nothing shuts on the clock", (t) => {
  const { world, id, run, advance } = open(t);
  const gate = id("gate");
  strictEqual(run(id("ai"), "close", "gate").status, "ok");
  const opened = run(id("ann"), "open", "gate");
  deepStrictEqual(opened.events.map((event) => event.type), ["open", "opened"]);
  deepStrictEqual([world.entity(gate)?.props.open, world.entity(gate)?.props.closing], [true, undefined]);
  deepStrictEqual(types(advance(4)), []);
  strictEqual(world.entity(gate)?.props.open, true);
});

test("while the door is closing, a close and a lock are refused closing, by hand and by its controller", (t) => {
  const { world, id, run } = open(t);
  strictEqual(run(id("ai"), "close", "gate").status, "ok");
  deepStrictEqual(verdict(run(id("ann"), "close", "gate")), ["refused", "closing"]);
  deepStrictEqual(verdict(run(id("ai"), "close", "gate")), ["refused", "closing"]);
  // A lock needs a key; the closing refusal comes first, so ann need carry none.
  deepStrictEqual(verdict(run(id("ann"), "lock", "gate")), ["refused", "closing"]);
  deepStrictEqual(verdict(run(id("ai"), "lock", "gate")), ["refused", "closing"]);
  strictEqual(world.entity(id("gate"))?.props.locked, undefined);
});

test("a controller's close is a shut in the same window, and its lock waits until the shut", (t) => {
  const { world, id, run, advance } = open(t);
  const ai = id("ai");
  deepStrictEqual(types(run(ai, "close", "gate")), ["close", "closing"]);
  deepStrictEqual(types(advance(2)), ["closed"]);
  strictEqual(world.entity(id("gate"))?.props.open, false);
  // Shut, the gate is open to nothing; the controller's lock is ok without a key, as its close was.
  deepStrictEqual(verdict(run(ai, "lock", "gate")), ["ok", undefined]);
});

test("the rule refuses a closing window the author writes without a shut to come", (t) => {
  const { world, id } = open(t);
  deepStrictEqual(
    [world.edit({ kind: "update_props", target: id("gate"), props: { closing: true } }).status,
      world.edit({ kind: "update_props", target: id("gate"), props: { closing: true } }).reason_code],
    ["refused", "closing_without_close"],
  );
  deepStrictEqual(
    [world.edit({ kind: "update_props", target: id("plain"), props: { closing: true } }).status,
      world.edit({ kind: "update_props", target: id("plain"), props: { closing: true } }).reason_code],
    ["refused", "closing_without_close"],
  );
});

test("a door with no shut_ticks shuts at once, as before", (t) => {
  const { world, id, run } = open(t);
  strictEqual(world.edit({ kind: "place", target: id("ann"), support: id("hall"), pos: { x: 300, y: 250 } }).status, "ok");
  deepStrictEqual(types(run(id("ann"), "close", "plain")), ["close", "closed"]);
});
