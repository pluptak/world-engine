import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";
import { query } from "../src/engine/query.js";
import { spawn } from "../src/engine/spawn.js";
import {
  createWorld,
  type Command,
  type Scenario,
  type Snapshot,
} from "../src/index.js";
import { loadTemplates, templatesHash } from "../src/templates.js";
import { tempDir } from "./harness.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function command(actor: string, verb: string, target?: string, args?: Record<string, unknown>): Command {
  return {
    command_id: "c1",
    actor,
    verb,
    ...(target !== undefined && { target }),
    ...(args !== undefined && { args }),
  };
}

test("a dog carries a glass shard in its mouth but not a second thing", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    { template: "dog", overrides: { name: "dog", location: "e1", support: "e1", pos: { x: 0, y: 0 } } },
    { template: "glass_shard", overrides: { name: "shard", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
    { template: "cup", overrides: { name: "cup", location: "e1", support: "e1", pos: { x: 40, y: 0 } } },
  ];
  const world = createWorld(join(tempDir(t), "dog-carry"), scenario);

  const shard = world.command(command("e2", "take", "shard"));
  strictEqual(shard.status, "ok");
  strictEqual(world.entity("e3")?.contained_in, "e2");
  strictEqual(world.entity("e3")?.support, null);

  const cup = world.command(command("e2", "take", "cup"));
  strictEqual(cup.status, "refused");
  strictEqual(cup.reason_code, "mouth_full");
  strictEqual(world.entity("e4")?.contained_in, null);
});

test("a mouth refuses two-handed items by hands and heavy ones by weight", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    { template: "dog", overrides: { name: "dog", location: "e1", support: "e1", pos: { x: 0, y: 0 } } },
    {
      template: "crate",
      overrides: { name: "box", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
    },
    { template: "stone", overrides: { name: "boulder", location: "e1", support: "e1", pos: { x: 40, y: 0 } } },
    { template: "chest", overrides: { name: "wardrobe", location: "e1", support: "e1", pos: { x: 50, y: 0 } } },
  ];
  const world = createWorld(join(tempDir(t), "dog-limits"), scenario);

  // The box is light, so only the hands rule can refuse it; the boulder proves a 2 kg one-handed
  // stone is mouth-carryable, and the 12 kg wardrobe is refused by weight alone.
  const box = world.command(command("e2", "take", "box"));
  strictEqual(box.status, "refused");
  strictEqual(box.reason_code, "two_hands_required");

  const wardrobe = world.command(command("e2", "take", "wardrobe"));
  strictEqual(wardrobe.status, "refused");
  strictEqual(wardrobe.reason_code, "too_heavy");

  const boulder = world.command(command("e2", "take", "boulder"));
  strictEqual(boulder.status, "ok");
  strictEqual(world.entity("e4")?.contained_in, "e2");
});

test("a dog cannot turn a key or stash things, but can nose a door and let go", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    { template: "dog", overrides: { name: "dog", location: "e1", support: "e1", pos: { x: 0, y: 0 } } },
    {
      template: "door",
      overrides: {
        name: "gate",
        location: "e1",
        support: "e1",
        pos: { x: 50, y: 0 },
        props: { open: false, locked: true },
      },
    },
    {
      template: "stone",
      overrides: { name: "key", location: "e1", support: "e1", pos: { x: 30, y: 0 }, props: { opens: "e3" } },
    },
    {
      template: "door",
      overrides: {
        name: "flap",
        location: "e1",
        support: "e1",
        pos: { x: 60, y: 0 },
        props: { open: false },
      },
    },
    { template: "cup", overrides: { name: "cup", location: "e1", support: "e1", pos: { x: 20, y: 0 } } },
    { template: "chest", overrides: { name: "crate", location: "e1", support: "e1", pos: { x: 55, y: 0 } } },
  ];
  const world = createWorld(join(tempDir(t), "dog-hands"), scenario);

  const key = world.command(command("e2", "take", "key"));
  strictEqual(key.status, "ok");

  const unlock = world.command(command("e2", "unlock", "gate"));
  strictEqual(unlock.status, "refused");
  strictEqual(unlock.reason_code, "insufficient_manipulation");

  const released = world.command(command("e2", "drop", "key"));
  strictEqual(released.status, "ok");

  const nosed = world.command(command("e2", "open", "flap"));
  strictEqual(nosed.status, "ok");
  strictEqual(world.entity("e5")?.props.open, true);

  const pushedShut = world.command(command("e2", "close", "flap"));
  strictEqual(pushedShut.status, "ok");

  const cup = world.command(command("e2", "take", "cup"));
  strictEqual(cup.status, "ok");

  const stashed = world.command(command("e2", "put", "cup", { relation: "in", destination: "crate" }));
  strictEqual(stashed.status, "refused");
  strictEqual(stashed.reason_code, "insufficient_manipulation");
  strictEqual(world.entity("e6")?.contained_in, "e2");
});

test("a dog cannot open a locked door but can push a chair", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    { template: "dog", overrides: { name: "dog", location: "e1", support: "e1", pos: { x: 0, y: 0 } } },
    {
      template: "door",
      overrides: {
        name: "door",
        location: "e1",
        support: "e1",
        pos: { x: 50, y: 0 },
        props: { open: false, locked: true },
      },
    },
    { template: "chair", overrides: { name: "chair", location: "e1", support: "e1", pos: { x: 40, y: 0 } } },
  ];
  const world = createWorld(join(tempDir(t), "dog-door"), scenario);

  const locked = world.command(command("e2", "open", "door"));
  strictEqual(locked.status, "refused");
  strictEqual(locked.reason_code, "locked");

  const pushed = world.command(command("e2", "push", "chair"));
  strictEqual(pushed.status, "ok");
  deepStrictEqual(world.entity("e4")?.pos, { x: 70, y: 0 });
});

test("detaching a dog's jaw drops what it carried", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    { template: "dog", overrides: { name: "dog", location: "e1", support: "e1", pos: { x: 0, y: 0 } } },
    { template: "glass_shard", overrides: { name: "shard", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
    {
      template: "human",
      overrides: { name: "attacker", location: "e1", support: "e1", pos: { x: -40, y: 0 } },
    },
  ];
  const world = createWorld(join(tempDir(t), "dog-jaw"), scenario);

  const taken = world.command(command("e2", "take", "shard"));
  strictEqual(taken.status, "ok");

  const bite = world.command(command("e4", "attack", "e2.jaw"));
  strictEqual(bite.status, "ok");
  const detached = bite.events.find((event) => event.type === "detached");
  const capability = bite.events.find(
    (event) => event.type === "capability_changed" && event.data.capacity === "mouth_carry",
  );
  const dropped = bite.events.find((event) => event.type === "dropped" && event.entity === "e3");
  ok(detached);
  ok(capability);
  ok(dropped);
  deepStrictEqual({ from: capability.data.from, to: capability.data.to }, { from: 1, to: 0 });
  // The grip part dropped what it held: the fall is caused by the detach, not the capacity change.
  strictEqual(dropped.cause_id, detached.event_id);

  strictEqual(world.entity("e3")?.contained_in, null);
  strictEqual(world.entity("e3")?.in_part, null);
  strictEqual(world.entity("e3")?.support, "e1");
  strictEqual(world.entity("e3")?.status, "intact");
  const jaw = Object.values(world.snapshot().entities).find(
    (entity) => entity.detached_from?.entity === "e2",
  );
  ok(jaw);
  strictEqual(jaw.template, "dog.jaw");
});

test("a cat hears a bottle break through a closed door but does not see it", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room-a" } },
    { template: "room", overrides: { name: "room-b" } },
    {
      template: "door",
      overrides: { name: "door", props: { open: false, from: "e1", to: "e2" } },
    },
    {
      template: "human",
      overrides: { name: "clumsy", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
    { template: "cat", overrides: { name: "cat", location: "e2", support: "e2", pos: { x: 0, y: 0 } } },
  ];
  const world = createWorld(join(tempDir(t), "cat-hears"), scenario);

  const taken = world.command(command("e4", "take", "bottle"));
  strictEqual(taken.status, "ok");
  const dropped = world.command(command("e4", "drop", "bottle"));
  strictEqual(dropped.status, "ok");
  const broken = dropped.events.find((event) => event.type === "broken");
  ok(broken);

  const heard = world.query({
    kind: "perceive",
    observer: "e6",
    event_id: broken.event_id,
    sense: "hearing",
  });
  deepStrictEqual(heard, { value: "true", basis_code: "adjacent_loud_event" });

  const seen = world.query({
    kind: "perceive",
    observer: "e6",
    event_id: broken.event_id,
    sense: "sight",
  });
  deepStrictEqual(seen, { value: "false", basis_code: "not_perceptible" });
});

function agentWorld(
  agentTemplate: string,
  senses: string[],
): { snapshot: Snapshot; agentId: string; bottleId: string } {
  const empty: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(empty, registry, "room", { name: "room" });
  const agent = spawn(room.snapshot, registry, agentTemplate, {
    name: "agent",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const bottle = spawn(agent.snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    support: room.id,
    pos: { x: 30, y: 0 },
  });
  return {
    snapshot: { ...bottle.snapshot, coverage: { ...bottle.snapshot.coverage, senses } },
    agentId: agent.id,
    bottleId: bottle.id,
  };
}

test("smell answers where a world declares it and stays unknown where it does not", () => {
  const declared = agentWorld("dog", ["sight", "hearing", "smell"]);
  deepStrictEqual(query(declared.snapshot, registry, [], {
    kind: "perceive",
    observer: declared.agentId,
    entity: declared.bottleId,
    sense: "smell",
  }), { value: "true", basis_code: "same_location" });

  const withheld = agentWorld("dog", ["sight", "hearing"]);
  deepStrictEqual(query(withheld.snapshot, registry, [], {
    kind: "perceive",
    observer: withheld.agentId,
    entity: withheld.bottleId,
    sense: "smell",
  }), { value: "unknown", basis_code: "uncovered_sense" });
});

test("a sense declared is not a sense had: a human cannot smell", () => {
  const world = agentWorld("human", ["sight", "hearing", "smell"]);
  deepStrictEqual(query(world.snapshot, registry, [], {
    kind: "perceive",
    observer: world.agentId,
    entity: world.bottleId,
    sense: "smell",
  }), { value: "false", basis_code: "no_sense_capacity" });
});
