import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorld, memoryWorld, openWorld, type Scenario } from "../src/index.js";
import { resolveScenario } from "../src/scenario.js";
import { WorldError } from "../src/errors.js";
import { tempDir } from "./harness.js";

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    ok(error instanceof WorldError, String(error));
    return error.code;
  }
  throw new Error("expected a WorldError");
}

const named = Object.freeze([
  { id: "room", template: "room", overrides: { name: "room" } },
  {
    id: "table",
    template: "table",
    overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } },
  },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "table" } },
]);

test("names map to ids in entry order", () => {
  const resolved = resolveScenario(named);
  deepStrictEqual(resolved.ids, { room: "e1", table: "e2", bottle: "e3" });
  deepStrictEqual(resolved.scenario[2]?.overrides, {
    name: "bottle",
    location: "e1",
    support: "e2",
  });
});

test("resolveScenario passes a scenario without names through unchanged", () => {
  const literal = [
    { template: "room", overrides: { name: "room" } },
    { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e1" } },
  ];
  deepStrictEqual(resolveScenario(literal).scenario, literal);
  deepStrictEqual(resolveScenario(literal).ids, {});
});

test("a name declared later resolves", () => {
  const forward = [
    { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room" } },
    { id: "room", template: "room", overrides: { name: "room" } },
  ];
  strictEqual(resolveScenario(forward).scenario[0]?.overrides?.location, "e2");
});

test("a literal id beside a name stays a literal id", () => {
  const mixed = [
    { id: "room", template: "room", overrides: { name: "room" } },
    { template: "bottle", overrides: { name: "bottle", location: "e1", support: "room" } },
  ];
  const resolved = resolveScenario(mixed);
  strictEqual(resolved.scenario[1]?.overrides?.location, "e1");
  strictEqual(resolved.scenario[1]?.overrides?.support, "e1");
});

test("detached_from resolves its entity and keeps its part", () => {
  const detached = resolveScenario([
    { id: "chair", template: "chair", overrides: { name: "chair" } },
    {
      id: "leg",
      template: "chair.leg_fl",
      overrides: { name: "leg", detached_from: { entity: "chair", part: "leg_fl" } },
    },
  ]);
  deepStrictEqual(detached.scenario[1]?.overrides?.detached_from, {
    entity: "e1",
    part: "leg_fl",
  });
});

test("an unknown reference is refused", () => {
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "room", template: "room", overrides: { name: "room" } },
        { template: "bottle", overrides: { name: "bottle", support: "table" } },
      ]),
    ),
    "unknown_name",
  );
});

test("a duplicate name is refused", () => {
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "room", template: "room", overrides: { name: "room" } },
        { id: "room", template: "room", overrides: { name: "other" } },
      ]),
    ),
    "duplicate_name",
  );
});

test("a name that looks like an allocated id is refused", () => {
  strictEqual(code(() => resolveScenario([{ id: "e2", template: "room" }])), "invalid_name");
});

test("an empty name is refused", () => {
  strictEqual(code(() => resolveScenario([{ id: "", template: "room" }])), "invalid_name");
});

test("ids follow the given first sequence number", () => {
  strictEqual(resolveScenario([{ id: "room", template: "room" }], 7).ids.room, "e7");
});

test("the three id-bearing props resolve, and every other prop stays a literal", () => {
  const resolved = resolveScenario([
    { id: "hall", template: "room", overrides: { name: "hall" } },
    { id: "yard", template: "room", overrides: { name: "yard" } },
    {
      id: "door",
      template: "door",
      overrides: { name: "door", props: { from: "hall", to: "yard", open: true } },
    },
    {
      id: "key",
      template: "stone",
      overrides: { name: "key", location: "hall", props: { opens: "door", liquid_material: "hall" } },
    },
  ]);
  deepStrictEqual(resolved.scenario[2]?.overrides?.props, { from: "e1", to: "e2", open: true });
  deepStrictEqual(resolved.scenario[3]?.overrides?.props, {
    opens: "e3",
    liquid_material: "hall",
  });
});

test("an unknown name in an id-bearing prop is refused", () => {
  strictEqual(
    code(() =>
      resolveScenario([
        { id: "hall", template: "room", overrides: { name: "hall" } },
        { id: "door", template: "door", overrides: { name: "door", props: { from: "attic" } } },
      ]),
    ),
    "unknown_name",
  );
});

test("createWorld resolves the shipped bottle scenario and hands back its names", (t) => {
  const world = createWorld(
    join(tempDir(t), "bottle"),
    JSON.parse(
      readFileSync(fileURLToPath(new URL("../scenarios/bottle.json", import.meta.url)), "utf8"),
    ) as Scenario,
  );
  strictEqual(world.id("table"), "e2");
  strictEqual(world.id("bottle"), "e3");
  strictEqual(world.id("pusher"), "e4");
  strictEqual(world.id("cup"), null);
  strictEqual(world.entity(world.id("bottle")!)?.name, "bottle");
});

test("a refused scenario writes nothing", (t) => {
  const dir = join(tempDir(t), "never-created");
  try {
    createWorld(dir, [
      { id: "room", template: "room", overrides: { name: "room" } },
      { template: "bottle", overrides: { name: "bottle", support: "table" } },
    ]);
    throw new Error("expected a WorldError");
  } catch (error) {
    ok(error instanceof WorldError, String(error));
    strictEqual(error.code, "unknown_name");
  }
  strictEqual(existsSync(dir), false);
});

test("a door and a key are authored by name alone", (t) => {
  const world = createWorld(join(tempDir(t), "door"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    {
      id: "door",
      template: "door",
      overrides: {
        name: "door",
        location: "hall",
        support: "hall",
        pos: { x: 0, "y": 0 },
        props: { open: false, from: "hall", to: "yard" },
      },
    },
    {
      id: "key",
      template: "stone",
      overrides: {
        name: "key",
        location: "hall",
        support: "hall",
        pos: { x: 10, y: 0 },
        props: { opens: "door" },
      },
    },
    {
      id: "guard",
      template: "human",
      overrides: { name: "guard", location: "hall", support: "hall", pos: { x: -10, y: 0 } },
    },
  ]);
  strictEqual(world.entity(world.id("door")!)?.props.from, world.id("hall"));
  strictEqual(world.entity(world.id("key")!)?.props.opens, world.id("door"));

  const moved = world.command({
    command_id: "open-then-cross",
    actor: world.id("guard")!,
    verb: "open",
    target: "door",
  });
  strictEqual(moved.status, "ok");
  const crossed = world.command({
    command_id: "cross",
    actor: world.id("guard")!,
    verb: "move",
    args: { location: world.id("yard") },
  });
  strictEqual(crossed.status, "ok");
  strictEqual(world.entity(world.id("guard")!)?.location, world.id("yard"));
});

test("a reopened world answers the names its creator did", (t) => {
  const dir = join(tempDir(t), "reopened");
  const created = createWorld(dir, [
    { id: "room", template: "room", overrides: { name: "room" } },
    { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "room", pos: { x: 5, y: 0 } } },
  ]);
  const reopened = openWorld(dir);
  strictEqual(reopened.id("bottle"), created.id("bottle"));
  strictEqual(reopened.id("bottle"), "e2");
  strictEqual(reopened.id("nothing"), null);
});

test("a world written before ids.json existed opens with no names", (t) => {
  const dir = join(tempDir(t), "nameless");
  createWorld(dir, [{ template: "room", overrides: { name: "room" } }]);
  strictEqual(existsSync(join(dir, "ids.json")), false);
  strictEqual(openWorld(dir).id("room"), null);
});

test("an unreadable ids.json is refused rather than read as no names", (t) => {
  const dir = join(tempDir(t), "corrupt");
  createWorld(dir, [{ id: "room", template: "room", overrides: { name: "room" } }]);
  writeFileSync(join(dir, "ids.json"), "{\"room\":7}", "utf8");
  try {
    openWorld(dir);
    throw new Error("expected a WorldError");
  } catch (error) {
    ok(error instanceof WorldError, String(error));
    strictEqual(error.code, "invalid_ids");
  }
});

test("a memory world takes the names it was built from", (t) => {
  const world = memoryWorld(
    createWorld(
      tempDir(t),
      [
        { id: "room", template: "room", overrides: { name: "room" } },
        { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "room", pos: { x: 5, y: 0 } } },
      ],
    ).snapshot(),
    undefined,
    { room: "e1", bottle: "e2" },
  );
  strictEqual(world.id("bottle"), "e2");
  strictEqual(memoryWorld(createWorld(tempDir(t), []).snapshot()).id("bottle"), null);
});
