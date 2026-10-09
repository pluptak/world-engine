import { deepStrictEqual, strictEqual, throws as assertThrows } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { lostField } from "../src/engine/upgrade.js";
import { canonicalJson, createWorld, memoryWorld, openWorld, WorldError, type Scenario } from "../src/index.js";
import { spawn } from "../src/engine/spawn.js";
import { defaultCoverage, type Snapshot } from "../src/model.js";
import { loadTemplates, missingCompanions, parseRegistry, templatesHash, type Template, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

// A world left behind on disk for the test that asked for it.
function seedWorld(t: { after(callback: () => void): void }): Snapshot {
  return createWorld(join(tempDir(t), "w"), bottleScenario).snapshot();
}

const bottleScenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  {
    template: "human",
    overrides: { name: "pusher", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
  // In the table's path, so the push stops short and the jolt knocks the bottle off.
  {
    template: "stone",
    overrides: { name: "doorstop", location: "e1", support: "e1", pos: { x: 129, y: 0 } },
  },
];

const pushTable = { command_id: "push-table", actor: "e4", verb: "push", target: "table" } as const;

function empty(): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: defaultCoverage(),
    entities: {},
  };
}

// A snapshot holding one entity of each template the rules below are about.
function subjects(snapshot: Snapshot): Snapshot {
  let current = snapshot;
  for (const [index, entry] of (
    [
      ["room", { name: "room", pos: { x: 0, y: 0 } }],
      ["table", { name: "table", support: "e1", pos: { x: 20, y: 0 } }],
      ["bottle", { name: "bottle", support: "e2" }],
      ["human", { name: "ann", support: "e1", pos: { x: -50, y: 0 } }],
    ] as const
  ).entries()) {
    current = spawn(current, registry, entry[0], entry[1]).snapshot;
    strictEqual(current.next_seq, index + 2);
  }
  return current;
}

// Ann's right hand hurt: state the template must keep declaring, unlike an untouched part.
function hurtHand(snapshot: Snapshot): Snapshot {
  const ann = snapshot.entities.e4!;
  return {
    ...snapshot,
    entities: { ...snapshot.entities, e4: { ...ann, parts: { hand_r: { integrity: 40, status: "damaged" } } } },
  };
}

function without(...ids: string[]): TemplateRegistry {
  const copy: TemplateRegistry = { ...registry };
  for (const id of ids) {
    delete copy[id];
  }
  return copy;
}

function edited(id: string, change: (template: Template) => Template): TemplateRegistry {
  const base = registry[id];
  if (base === undefined) {
    throw new Error(`no template ${id}`);
  }
  return { ...registry, [id]: change(base) };
}

const withoutHandR = (): TemplateRegistry =>
  edited("human", (human) => ({
    ...human,
    parts: human.parts.filter((part) => part.name !== "hand_r"),
  }));

test("a template that lost a part with stored state is reported against the live entity", () => {
  deepStrictEqual(lostField(hurtHand(subjects(empty())), withoutHandR()), {
    entity: "e4",
    template: "human",
    field: "parts.hand_r",
  });
});

test("a part something sits in is in use; an untouched, empty part may go with the template", () => {
  strictEqual(lostField(subjects(empty()), withoutHandR()), null);
  const holding = spawn(subjects(empty()), registry, "key", { name: "key", contained_in: "e4" }).snapshot;
  strictEqual(holding.entities.e5?.in_part, "hand_l");
  const withoutHandL = edited("human", (human) => ({
    ...human,
    parts: human.parts.filter((part) => part.name !== "hand_l"),
  }));
  deepStrictEqual(lostField(holding, withoutHandL), { entity: "e4", template: "human", field: "parts.hand_l" });
});

test("a template that is gone is reported against the live entity", () => {
  deepStrictEqual(lostField(subjects(empty()), without("bottle")), {
    entity: "e3",
    template: "bottle",
    field: "template",
  });
});

test("a break product template that is gone is reported against the bottle", () => {
  deepStrictEqual(lostField(subjects(empty()), without("glass_shard")), {
    entity: "e3",
    template: "bottle",
    field: "break_products.glass_shard",
  });
});

test("default_hit_part is not a field an entity holds: dropping it, or never having it, loses nothing", () => {
  const next = edited("human", (human) => {
    const props = { ...human.props };
    delete props.default_hit_part;
    return { ...human, props };
  });
  strictEqual(lostField(subjects(empty()), next), null);
  // The chair has parts and never declared one.
  const seated = spawn(subjects(empty()), registry, "chair", { name: "chair", support: "e1", pos: { x: -50, y: 60 } });
  strictEqual(lostField(seated.snapshot, registry), null);
});

test("scenario props and transferred residue are not template fields", () => {
  // A floor holding wine that arrived as liquid rather than as anything break_residue ever listed,
  // and a crate the scenario gave a prop no template declares.
  let snapshot = spawn(empty(), registry, "room", {
    name: "room",
    pos: { x: 0, y: 0 },
    residue: { glass: 5, wine: 75 },
  }).snapshot;
  snapshot = spawn(snapshot, registry, "stone", {
    name: "crate",
    support: "e1",
    pos: { x: 50, y: 0 },
    props: { hands_required: 2 },
  }).snapshot;

  strictEqual(lostField(snapshot, registry), null);
});

test("an upgrade that only adds fields and changes values reports nothing", () => {
  const next = edited("bottle", (bottle) => ({
    ...bottle,
    mass_g: 1,
    props: { ...bottle.props, waxed: true },
  }));
  strictEqual(lostField(subjects(empty()), next), null);
});

test("two offences report the lowest entity id first", () => {
  const combined: TemplateRegistry = edited("human", (human) => ({
    ...human,
    parts: human.parts.filter((part) => part.name !== "hand_r"),
  }));
  delete combined.glass_shard;

  deepStrictEqual(lostField(hurtHand(subjects(empty())), combined), {
    entity: "e3",
    template: "bottle",
    field: "break_products.glass_shard",
  });
});

test("a memory world refuses a set that orphans a live entity and adopts one that does not", (t) => {
  const world = memoryWorld(hurtHand(seedWorld(t)));

  const withoutHand: TemplateRegistry = {
    ...registry,
    human: {
      ...registry.human!,
      parts: registry.human!.parts.filter((part) => part.name !== "hand_r"),
    },
  };
  assertThrows(
    () => world.upgradeTemplates(withoutHand),
    (error: unknown) =>
      error instanceof WorldError &&
      error.code === "templates_lost_field" &&
      error.message.includes("parts.hand_r"),
  );

  const lighter: TemplateRegistry = { ...registry, bottle: { ...registry.bottle!, mass_g: 1 } };
  strictEqual(world.upgradeTemplates(lighter).templates_hash, templatesHash(lighter));
  strictEqual(world.command(pushTable).status, "ok");
  // The world's own snapshot still describes the set it answers for.
  strictEqual(memoryWorld(world.snapshot(), lighter).snapshot().version, 1);
});

test("parseRegistry rejects a registry lacking a detachable part's companion", () => {
  const missing = without("human.hand_r");
  assertThrows(
    () => parseRegistry(missing),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message.includes("human.hand_r"),
  );
});

test("a store world's upgradeTemplates refuses a registry lacking a detachable part's companion", (t) => {
  const dir = tempDir(t);
  const worldDir = join(dir, "world");
  const world = createWorld(worldDir, bottleScenario);
  const before = canonicalJson(world.snapshot());
  const beforeHash = world.snapshot().templates_hash;

  const withoutHandR = without("human.hand_r");
  assertThrows(
    () => world.upgradeTemplates(withoutHandR),
    (error: unknown) =>
      error instanceof WorldError &&
      error.code === "invalid_templates" &&
      error.message.includes("human.hand_r"),
  );

  const after = canonicalJson(world.snapshot());
  strictEqual(after, before);
  strictEqual(world.snapshot().templates_hash, beforeHash);
  strictEqual(canonicalJson(openWorld(worldDir).snapshot()), before);
  const stored = JSON.parse(readFileSync(join(worldDir, "templates.json"), "utf8"));
  strictEqual(Object.keys(stored).length, Object.keys(registry).length);
});

test("a memory world's upgradeTemplates refuses a registry lacking a detachable part's companion", (t) => {
  const world = memoryWorld(hurtHand(seedWorld(t)));
  const before = canonicalJson(world.snapshot());
  const beforeHash = world.snapshot().templates_hash;

  const withoutHandR = without("human.hand_r");
  assertThrows(
    () => world.upgradeTemplates(withoutHandR),
    (error: unknown) =>
      error instanceof WorldError &&
      error.code === "invalid_templates" &&
      error.message.includes("human.hand_r"),
  );

  const after = canonicalJson(world.snapshot());
  strictEqual(after, before);
  strictEqual(world.snapshot().templates_hash, beforeHash);
});

test("after refusing a registry lacking a companion, a store world still allows attacks that detach", (t) => {
  const dir = tempDir(t);
  const handScenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    {
      template: "human",
      overrides: {
        name: "attacker",
        location: "e1",
        support: "e1",
        pos: { x: 0, y: 0 },
      },
    },
    {
      template: "human",
      overrides: {
        name: "guard",
        location: "e1",
        support: "e1",
        pos: { x: 50, y: 0 },
      },
    },
  ];
  const world = createWorld(join(dir, "w"), handScenario);
  const withoutHandR = without("human.hand_r");

  assertThrows(
    () => world.upgradeTemplates(withoutHandR),
    (error: unknown) => error instanceof WorldError && error.code === "invalid_templates",
  );

  for (let index = 0; index < 3; index += 1) {
    const result = world.command({
      command_id: `attack-${index}`,
      actor: "e2",
      verb: "attack",
      target: "e3.hand_r",
    });
    strictEqual(result.status, "ok", `attack ${index} failed: ${result.reason_code}`);
  }

  const guard = world.entity("e3");
  strictEqual(guard?.parts.hand_r?.status, "detached");
});

test("missingCompanions identifies all detachable parts without companions", () => {
  const custom: TemplateRegistry = {
    ...registry,
    foo: {
      ...registry.human!,
      id: "foo",
      parts: registry.human!.parts.map((part) =>
        part.detachable ? { ...part } : part,
      ),
    },
  };
  deepStrictEqual(missingCompanions(custom), [
    "foo.arm_l",
    "foo.arm_r",
    "foo.hand_l",
    "foo.hand_r",
  ]);
});
