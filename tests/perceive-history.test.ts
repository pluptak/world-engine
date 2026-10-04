import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createWorld,
  memoryWorld,
  type Scenario,
  type World,
} from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";

const baseRegistry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const chestRegistry: TemplateRegistry = {
  ...baseRegistry,
  chest: {
    ...baseRegistry.chest!,
    props: { ...baseRegistry.chest!.props, openable: true, open: true },
  },
};

const chestScenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "chest",
    overrides: { name: "chest", location: "e1", support: "e1", pos: { x: 20, y: 0 } },
  },
  {
    template: "human",
    overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
  },
  {
    template: "bottle",
    overrides: { name: "bottle", location: "e1", support: null, contained_in: "e3" },
  },
];

const doorScenario: Scenario = [
  { template: "room", overrides: { name: "room-a", props: { lit: true } } },
  { template: "room", overrides: { name: "room-b", props: { lit: true } } },
  {
    template: "door",
    overrides: { name: "door", props: { openable: true, open: true, from: "e1", to: "e2" } },
  },
  {
    template: "table",
    overrides: { name: "table", location: "e2", support: "e2", pos: { x: 30, y: 0 } },
  },
  {
    template: "bottle",
    overrides: { name: "bottle", location: "e2", support: "e4" },
  },
  {
    template: "human",
    overrides: { name: "watcher", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
  },
  {
    template: "human",
    overrides: { name: "breaker", location: "e2", support: "e2", pos: { x: -50, y: 0 } },
  },
];

function idOf(world: World, name: string): string {
  for (const [id, entity] of Object.entries(world.snapshot().entities)) {
    if (entity.name === name) {
      return id;
    }
  }
  throw new TypeError(`No entity named ${name}`);
}

// The same seed on disk and in memory, so both worlds run the same commands.
function twoWorlds(
  t: { after(callback: () => void): void },
  scenario: Scenario,
  registry: TemplateRegistry,
): { store: World; memory: World } {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-perceive-history-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createWorld(join(dir, "w"), scenario, registry);
  const memory = memoryWorld(store.snapshot(), registry);
  return { store, memory };
}

test("a put into an open chest stays visible after the chest is closed", (t) => {
  for (const world of Object.values(twoWorlds(t, chestScenario, chestRegistry))) {
    const actorId = idOf(world, "actor");
    const bottleId = idOf(world, "bottle");

    const put = world.command({
      command_id: "put-coin",
      actor: actorId,
      verb: "put",
      target: "bottle",
      args: { relation: "in", destination: "chest" },
    });
    strictEqual(put.status, "ok");
    const movedId = put.events.find((event) => event.type === "moved")?.event_id;
    ok(movedId);
    const atPut = { kind: "perceive" as const, observer: actorId, event_id: movedId, sense: "sight" };
    deepStrictEqual(world.query(atPut), { value: "true", basis_code: "same_location_lit" });

    strictEqual(
      world.command({ command_id: "close-chest", actor: actorId, verb: "close", target: "chest" })
        .status,
      "ok",
    );
    deepStrictEqual(world.query(atPut), { value: "true", basis_code: "same_location_lit" });
    deepStrictEqual(
      world.query({ kind: "perceive", observer: actorId, entity: bottleId, sense: "sight" }),
      { value: "false", basis_code: "enclosed" },
    );
  }
});

test("a break stays visible through a door closed afterwards", (t) => {
  for (const world of Object.values(twoWorlds(t, doorScenario, baseRegistry))) {
    const watcherId = idOf(world, "watcher");
    const breakerId = idOf(world, "breaker");
    const bottleId = idOf(world, "bottle");

    const push = world.command({ command_id: "push-table", actor: breakerId, verb: "push", target: "table" });
    strictEqual(push.status, "ok");
    const brokenId = push.events.find((event) => event.type === "broken")?.event_id;
    ok(brokenId);
    const atBreak = {
      kind: "perceive" as const,
      observer: watcherId,
      event_id: brokenId,
      sense: "sight",
    };
    deepStrictEqual(world.query(atBreak), { value: "true", basis_code: "adjacent_open_door_lit" });

    strictEqual(
      world.command({ command_id: "close-door", actor: watcherId, verb: "close", target: "door" })
        .status,
      "ok",
    );
    deepStrictEqual(world.query(atBreak), { value: "true", basis_code: "adjacent_open_door_lit" });
    deepStrictEqual(
      world.query({ kind: "perceive", observer: watcherId, entity: bottleId, sense: "sight" }),
      { value: "false", basis_code: "not_perceptible" },
    );
  }
});

test("an event nobody produced is still no_such_event", (t) => {
  for (const world of Object.values(twoWorlds(t, chestScenario, chestRegistry))) {
    deepStrictEqual(
      world.query({
        kind: "perceive",
        observer: idOf(world, "actor"),
        event_id: "ev999",
        sense: "sight",
      }),
      { value: "false", basis_code: "no_such_event" },
    );
  }
});

test("seeing a move from lit to dark hall: the event is perceptible at the start of the move", (t) => {
  const registry: TemplateRegistry = {
    ...baseRegistry,
  };
  const scenario: Scenario = [
    { template: "room", overrides: { name: "hall", props: { lit: true } } },
    { template: "room", overrides: { name: "yard", props: { lit: false } } },
    {
      template: "door",
      overrides: { name: "door", props: { openable: true, open: true, from: "e1", to: "e2" } },
    },
    {
      template: "human",
      overrides: { name: "ann", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "human",
      overrides: { name: "bob", location: "e1", support: "e1", pos: { x: 50, y: 0 } },
    },
  ];

  for (const world of Object.values(twoWorlds(t, scenario, registry))) {
    const annId = idOf(world, "ann");
    const bobId = idOf(world, "bob");
    const yardId = "e2";

    const move = world.command({
      command_id: "ann-move",
      actor: annId,
      verb: "move",
      args: { location: yardId },
    });
    strictEqual(move.status, "ok");

    const moveEventId = move.events.find((event) => event.type === "move")?.event_id;
    const movedEventId = move.events.find((event) => event.type === "moved")?.event_id;
    ok(moveEventId);
    ok(movedEventId);

    const sightOfMove = {
      kind: "perceive" as const,
      observer: bobId,
      event_id: moveEventId,
      sense: "sight",
    };
    const sightOfMoved = {
      kind: "perceive" as const,
      observer: bobId,
      event_id: movedEventId,
      sense: "sight",
    };

    deepStrictEqual(world.query(sightOfMove), { value: "true", basis_code: "same_location_lit" });
    deepStrictEqual(
      world.query(sightOfMoved),
      { value: "true", basis_code: "same_location_lit" },
    );
  }
});

test("seeing an arrival in a lit room: the moved event is perceptible at the end of the move", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "hall", props: { lit: false } } },
    { template: "room", overrides: { name: "yard", props: { lit: true } } },
    {
      template: "door",
      overrides: { name: "door", props: { openable: true, open: true, from: "e1", to: "e2" } },
    },
    {
      template: "human",
      overrides: { name: "ann", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "human",
      overrides: { name: "carol", location: "e2", support: "e2", pos: { x: 0, y: 0 } },
    },
  ];

  for (const world of Object.values(twoWorlds(t, scenario, baseRegistry))) {
    const annId = idOf(world, "ann");
    const carolId = idOf(world, "carol");
    const yardId = "e2";

    const move = world.command({
      command_id: "ann-move",
      actor: annId,
      verb: "move",
      args: { location: yardId },
    });
    strictEqual(move.status, "ok");

    const movedEventId = move.events.find((event) => event.type === "moved")?.event_id;
    ok(movedEventId);

    const sightOfMoved = {
      kind: "perceive" as const,
      observer: carolId,
      event_id: movedEventId,
      sense: "sight",
    };

    deepStrictEqual(world.query(sightOfMoved), { value: "true", basis_code: "same_location_lit" });
  }
});

test("seeing a door close from the other room: the closed event is perceptible before", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "hall", props: { lit: true } } },
    { template: "room", overrides: { name: "yard", props: { lit: true } } },
    {
      template: "door",
      overrides: { name: "door", props: { openable: true, open: true, from: "e1", to: "e2" } },
    },
    {
      template: "human",
      overrides: { name: "ann", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "human",
      overrides: { name: "bob", location: "e2", support: "e2", pos: { x: 0, y: 0 } },
    },
  ];

  for (const world of Object.values(twoWorlds(t, scenario, baseRegistry))) {
    const annId = idOf(world, "ann");
    const bobId = idOf(world, "bob");
    const doorId = idOf(world, "door");

    // Entity form perceive: Bob sees the door in the yard (lit room)
    deepStrictEqual(
      world.query({ kind: "perceive", observer: bobId, entity: doorId, sense: "sight" }),
      { value: "true", basis_code: "same_location_lit" },
    );

    const close = world.command({
      command_id: "ann-close-door",
      actor: annId,
      verb: "close",
      target: "door",
    });
    strictEqual(close.status, "ok");

    const closedEventId = close.events.find((event) => event.type === "closed")?.event_id;
    ok(closedEventId);

    const sightOfClosed = {
      kind: "perceive" as const,
      observer: bobId,
      event_id: closedEventId,
      sense: "sight",
    };

    deepStrictEqual(world.query(sightOfClosed), { value: "true", basis_code: "same_location_lit" });
  }
});

test("the door's visibility depends on the observer's room lighting", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "hall", props: { lit: true } } },
    { template: "room", overrides: { name: "yard", props: { lit: false } } },
    {
      template: "door",
      overrides: { name: "door", props: { openable: true, open: true, from: "e1", to: "e2" } },
    },
    {
      template: "human",
      overrides: { name: "bob", location: "e2", support: "e2", pos: { x: 0, y: 0 } },
    },
  ];

  for (const world of Object.values(twoWorlds(t, scenario, baseRegistry))) {
    const bobId = idOf(world, "bob");
    const doorId = idOf(world, "door");

    deepStrictEqual(
      world.query({ kind: "perceive", observer: bobId, entity: doorId, sense: "sight" }),
      { value: "false", basis_code: "location_unlit" },
    );
  }
});
