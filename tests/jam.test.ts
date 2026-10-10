import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { canonicalJson } from "../src/engine/canonical.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A device's remote command may jam (`docs/jam.md`). The hall's doors are all controlled by the yard's
// terminal, the generator in the hall powers them, and a hand stands beside one of them. A template's
// `jam_pct` is a definition, so the test's own two doors come from templates written beside the repo's.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));

function registry(t: { after(callback: () => void): void }): TemplateRegistry {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  writeFileSync(join(dir, "jam_all_door.json"), JSON.stringify({ id: "jam_all_door", extends: "shut_door", props: { jam_pct: 100 } }));
  writeFileSync(join(dir, "jam_none_door.json"), JSON.stringify({ id: "jam_none_door", extends: "door", props: { jam_pct: 0 } }));
  return loadTemplates(dir);
}

function scenario(camera: boolean): Scenario {
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -400, y: 0 } } },
    {
      id: "open_door",
      template: "jam_all_door",
      overrides: { name: "open door", location: "hall", support: "hall", pos: { x: 300, y: 300 }, props: { open: true, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" } },
    },
    {
      id: "locked_door",
      template: "jam_all_door",
      overrides: { name: "locked door", location: "hall", support: "hall", pos: { x: 0, y: 300 }, props: { open: false, locked: true, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" } },
    },
    {
      id: "shut_door",
      template: "jam_all_door",
      overrides: { name: "shut door", location: "hall", support: "hall", pos: { x: -300, y: 300 }, props: { open: false, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" } },
    },
    {
      id: "quiet_door",
      template: "jam_none_door",
      overrides: { name: "quiet door", location: "hall", support: "hall", pos: { x: 600, y: 300 }, props: { open: true, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" } },
    },
    {
      id: "flaky_door",
      template: "jamming_door",
      overrides: { name: "flaky door", location: "hall", support: "hall", pos: { x: -600, y: 300 }, props: { open: true, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" } },
    },
    {
      id: "plain_door",
      template: "door",
      overrides: { name: "plain door", location: "hall", support: "hall", pos: { x: 900, y: 300 }, props: { open: true, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" } },
    },
    ...(camera
      ? [
          {
            id: "camera",
            template: "camera",
            overrides: { name: "camera", location: "hall", support: "hall", pos: { x: -100, y: -300 }, props: { powered_by: "generator", controlled_by: "ai" } },
          } as const,
        ]
      : []),
    { id: "ai", template: "terminal", overrides: { name: "ai", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 300, y: 250 } } },
  ];
}

function open(t: { after(callback: () => void): void }, camera = false, seed?: number, dirName = "world"): { world: World; id: (name: string) => Id; run: (actor: Id, verb: string, target?: string, perceivers?: boolean) => Result } {
  const world: World = createWorld(join(tempDir(t), dirName), scenario(camera), registry(t), seed === undefined ? undefined : { seed });
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, perceivers?: boolean): Result => {
    seq += 1;
    return world.command({
      command_id: `j${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(perceivers === true && { perceivers: true }),
    });
  };
  return { world, id, run };
}

test("with jam_pct 100 every remote command is jammed: the tick passes, nothing else changes, and no shut is scheduled", (t) => {
  const { world, id, run } = open(t, false, 5);
  const ai = id("ai");
  const before = world.snapshot();
  for (const [verb, target, device] of [
    ["close", "open door", "open_door"],
    ["lock", "open door", "open_door"],
    ["unlock", "locked door", "locked_door"],
    ["open", "shut door", "shut_door"],
  ] as const) {
    const entitiesBefore = canonicalJson(world.snapshot().entities);
    const tick = world.snapshot().tick;
    const result = run(ai, verb, target);
    deepStrictEqual([result.status, result.reason_code], ["ok", undefined], verb);
    deepStrictEqual(result.events.map((event) => event.type), [verb, "jammed"], verb);
    deepStrictEqual(result.events[1]?.data, { verb });
    strictEqual(result.events[1]?.entity, id(device), verb);
    strictEqual(world.snapshot().tick, tick + 1, verb);
    strictEqual(canonicalJson(world.snapshot().entities), entitiesBefore, verb);
  }
  deepStrictEqual(world.snapshot().schedule ?? [], []);
  ok(world.snapshot().tick > before.tick);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry(t)), []);
});

test("with jam_pct 0 no remote command rolls and none jams, and a hand on a jamming door never rolls", (t) => {
  const { world, id, run } = open(t, false, 5);
  const ai = id("ai");
  const rng = world.snapshot().rng;
  const quiet = run(ai, "close", "quiet door");
  deepStrictEqual(quiet.events.map((event) => event.type), ["close", "closed"]);
  strictEqual(world.snapshot().rng, rng);
  // Ann beside the jam_all door shuts it by hand: no roll, no jam, the door closes in its window.
  const ann = id("ann");
  const handRng = world.snapshot().rng;
  const hand = run(ann, "close", "open door");
  deepStrictEqual(hand.events.map((event) => event.type), ["close", "closing"]);
  strictEqual(world.snapshot().rng, handRng);
});

test("a seeded world jams the same commands on every replay", (t) => {
  const outcomes = (dirName: string) => {
    const { id, run } = open(t, false, 9, dirName);
    const ai = id("ai");
    const flaky: string[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = run(ai, attempt % 2 === 0 ? "close" : "open", "flaky door");
      flaky.push(`${result.status}:${result.events.map((event) => event.type).join(",")}`);
    }
    return flaky;
  };
  const first = outcomes("first");
  deepStrictEqual(outcomes("second"), first);
  ok(first.some((outcome) => outcome.includes("jammed")), "the seed jams one of the eight");
  ok(first.some((outcome) => !outcome.includes("jammed")), "and lets another through");
});

test("a world with no seed refuses a jamming device's remote command no_seed and changes nothing; a device without jam_pct works", (t) => {
  const { world, id, run } = open(t);
  const ai = id("ai");
  const before = canonicalJson(world.snapshot());
  const refused = run(ai, "close", "open door");
  deepStrictEqual([refused.status, refused.reason_code], ["refused", "no_seed"]);
  strictEqual(canonicalJson(world.snapshot()), before);
  const plain = run(ai, "close", "plain door");
  deepStrictEqual([plain.status, plain.events.map((event) => event.type)], ["ok", ["close", "closed"]]);
});

test("the controller perceives a jam through a camera, and not without one", (t) => {
  // Only the locked door stands in the hall: an open doorway would let the yard see the hall without a camera.
  const jamWith = (dirName: string, camera: boolean): { result: Result; ai: Id } => {
    const entities: Scenario = [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
      { id: "generator", template: "generator", overrides: { name: "generator", location: "hall", support: "hall", pos: { x: -400, y: 0 } } },
      {
        id: "locked_door",
        template: "jam_all_door",
        overrides: { name: "locked door", location: "hall", support: "hall", pos: { x: 0, y: 300 }, props: { open: false, locked: true, from: "hall", to: "yard", powered_by: "generator", controlled_by: "ai" } },
      },
      { id: "ai", template: "terminal", overrides: { name: "ai", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
      ...(camera
        ? [{ id: "camera", template: "camera", overrides: { name: "camera", location: "hall", support: "hall", pos: { x: -100, y: -300 }, props: { powered_by: "generator", controlled_by: "ai" } } } as const]
        : []),
    ];
    const world = createWorld(join(tempDir(t), dirName), entities, registry(t), { seed: 5 });
    const ai = world.id("ai");
    ok(ai !== null);
    const result = world.command({ command_id: "perceive-jam", actor: ai, verb: "unlock", target: "locked door", perceivers: true });
    return { result, ai };
  };

  const withCamera = jamWith("camera", true);
  deepStrictEqual(withCamera.result.events.map((event) => event.type), ["unlock", "jammed"]);
  ok(withCamera.result.events[1]?.perceivers?.sight.includes(withCamera.ai));
  const bare = jamWith("bare", false);
  deepStrictEqual(bare.result.events.map((event) => event.type), ["unlock", "jammed"]);
  ok(!bare.result.events[1]?.perceivers?.sight.includes(bare.ai));
});
