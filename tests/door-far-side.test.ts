import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, type Id, type Scenario, type World } from "../src/index.js";

// A door with a position stands in one room and joins two. From the room it leads to, it is reached
// as an unpositioned door is, from anywhere, so bob in the dark yard names, opens, shuts and walks
// through the gatehouse door; in its own room it keeps its position.

const watch = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/watch.json", import.meta.url)), "utf8"),
) as Scenario;

interface Gate {
  world: World;
  id: (name: string) => Id;
  bob: Id;
}

// The watch, with a cellar behind a hatch that stands in the gatehouse and leads there: a door of
// a room bob is not in and not next to.
function gate(t: { after(callback: () => void): void }): Gate {
  const root = mkdtempSync(join(tmpdir(), "world-engine-far-door-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scenario: Scenario = [
    ...watch,
    { id: "cellar", template: "room", overrides: { name: "cellar", props: { lit: true } } },
    {
      id: "hatch",
      template: "door",
      overrides: {
        name: "hatch",
        location: "gatehouse",
        support: "gatehouse",
        pos: { x: -300, y: 0 },
        props: { openable: true, open: true, from: "gatehouse", to: "cellar" },
      },
    },
  ];
  const world = createWorld(join(root, "gate"), scenario, undefined, { seed: 7 });
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, id, bob: id("bob") };
}

let seq = 0;
function act(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>) {
  seq += 1;
  return world.command({
    command_id: `far-${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

test("from the dark yard bob names, opens and shuts the gatehouse door, and walks in through it", (t) => {
  const { world, id, bob } = gate(t);
  const door = id("door");
  strictEqual(world.snapshot().entities[door]?.props.open, false);
  // By name and by id alike, though he can see nothing and the door stands in the other room.
  strictEqual(act(world, bob, "open", "door").status, "ok");
  strictEqual(world.entity(door)?.props.open, true);
  strictEqual(act(world, bob, "close", door).status, "ok");
  strictEqual(world.entity(door)?.props.open, false);
  // Shut, it is not a way in; open, it is, to where he lands.
  const shut = act(world, bob, "move", undefined, { through: "door" });
  deepStrictEqual([shut.status, shut.reason_code], ["refused", "no_open_door"]);
  strictEqual(act(world, bob, "open", "door").status, "ok");
  // Straight through lands him on the table the gatehouse has at his coordinates; he steps aside first.
  const blocked = act(world, bob, "move", undefined, { through: "door" });
  deepStrictEqual([blocked.reason_code, blocked.reason_data], ["blocked", { with: id("table") }]);
  strictEqual(act(world, bob, "move", undefined, { to: { x: 150, y: 150 } }).status, "ok");
  const walked = act(world, bob, "move", undefined, { through: door });
  strictEqual(walked.status, "ok", walked.reason_code);
  strictEqual(world.entity(bob)?.location, id("gatehouse"));
  deepStrictEqual(world.entity(bob)?.pos, { x: 150, y: 150 });
  // And back out, through the same door, from its own room.
  const back = act(world, bob, "move", undefined, { through: "door" });
  strictEqual(back.status, "ok", back.reason_code);
  strictEqual(world.entity(bob)?.location, id("yard"));
});

test("in its own room a door keeps its position, but walking through it asks no reach", (t) => {
  const { world, id } = gate(t);
  const ann = id("ann");
  const far = act(world, ann, "open", "door");
  deepStrictEqual([far.status, far.reason_code], ["refused", "out_of_reach"]);
  // Open by the author, she can still walk out through it from where she stands, not near it.
  strictEqual(
    world.edit({ kind: "set_props", target: id("door"), props: { ...world.entity(id("door"))!.props, open: true } }).status,
    "ok",
  );
  // (Straight out she would land on bob, who stands at the same coordinates in the yard.)
  strictEqual(act(world, ann, "move", undefined, { to: { x: 150, y: 150 } }).status, "ok");
  const out = act(world, ann, "move", undefined, { through: "door" });
  strictEqual(out.status, "ok", out.reason_code);
  strictEqual(world.entity(ann)?.location, id("yard"));
});

test("a door of a third room is neither reached nor walked through", (t) => {
  const { world, bob } = gate(t);
  for (const [verb, args] of [
    ["open", undefined],
    ["close", undefined],
  ] as const) {
    const result = act(world, bob, verb, "hatch", args);
    strictEqual(result.status, "unresolved", verb);
  }
  strictEqual(act(world, bob, "move", undefined, { through: "hatch" }).status, "unresolved");
});

test("through names a door of the actor's room, and nothing else", (t) => {
  const { world, id, bob } = gate(t);
  const ann = id("ann");
  // A thing she can name that is no door, and two destinations at once.
  deepStrictEqual(
    [act(world, ann, "move", undefined, { through: "table" }).status, act(world, ann, "move", undefined, { through: "table" }).reason_code],
    ["invalid", "invalid_location"],
  );
  for (const args of [
    { through: "door", location: id("yard") },
    { through: "door", to: { x: 1, y: 1 } },
    { through: "" },
    { through: 3 },
  ]) {
    const result = act(world, ann, "move", undefined, args);
    deepStrictEqual([result.status, result.reason_code], ["invalid", "invalid_args"], JSON.stringify(args));
  }
  // A name nobody has is unresolved, as a target is.
  strictEqual(act(world, bob, "move", undefined, { through: "portcullis" }).status, "unresolved");
  // `location` still works beside it: the same door, by the room beyond.
  strictEqual(act(world, bob, "open", "door").status, "ok");
  strictEqual(act(world, bob, "move", undefined, { to: { x: 150, y: 150 } }).status, "ok");
  strictEqual(act(world, bob, "move", undefined, { location: id("gatehouse") }).status, "ok");
});

test("the door bob can now name is among his options, with the room beyond it", (t) => {
  const { world, id, bob } = gate(t);
  const asked = world.options(bob, { refused: true });
  ok(asked.ready.some((entry) => entry.verb === "open" && entry.target === id("door")));
  deepStrictEqual(
    asked.blocked?.filter((entry) => entry.verb === "move"),
    [{ verb: "move", args: { location: id("gatehouse") }, reason_code: "no_open_door" }],
  );
  // The hatch is not his to name, and nor is the room behind it.
  const named = JSON.stringify(asked);
  strictEqual(named.includes(`"${id("hatch")}"`) || named.includes(`"${id("cellar")}"`), false);
});
