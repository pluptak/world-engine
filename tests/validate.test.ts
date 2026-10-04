import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createWorld,
  openWorld,
  WorldError,
  type Command,
  type Scenario,
  type Snapshot,
} from "../src/index.js";
import { spawn } from "../src/engine/spawn.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates, templatesHash } from "../src/templates.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-validate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A room with a table, a bottle on the table and a human on the floor: valid to begin with.
function baseSnapshot(): Snapshot {
  const empty: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(empty, registry, "room", { name: "room" });
  const table = spawn(room.snapshot, registry, "table", {
    name: "table",
    location: room.id,
    support: room.id,
    pos: { x: 30, y: 0 },
  });
  const bottle = spawn(table.snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    support: table.id,
  });
  const human = spawn(bottle.snapshot, registry, "human", {
    name: "human",
    location: room.id,
    support: room.id,
    pos: { x: -50, y: 0 },
  });
  return human.snapshot;
}

function codes(snapshot: Snapshot): string[] {
  return validate(snapshot).map((issue) => issue.code);
}

function validate(snapshot: Snapshot) {
  return validateSnapshot(snapshot, registry);
}

test("a snapshot the engine built reports nothing", () => {
  deepStrictEqual(codes(baseSnapshot()), []);
});

test("each rule fires on a snapshot wrong in exactly one way", () => {
  const wrong = (mutate: (snapshot: Snapshot) => void): string[] => {
    const snapshot = baseSnapshot();
    mutate(snapshot);
    return codes(snapshot);
  };
  const entity = (snapshot: Snapshot, id: string) => {
    const found = snapshot.entities[id];
    ok(found);
    return found;
  };

  deepStrictEqual(
    wrong((snapshot) => {
      entity(snapshot, "e2").support = "e3";
      entity(snapshot, "e2").pos = null;
    }),
    ["support_or_containment_cycle"],
  );

  deepStrictEqual(
    wrong((snapshot) => {
      entity(snapshot, "e3").pos = { x: 5, y: 0 };
    }),
    ["pos_without_room_support"],
  );

  deepStrictEqual(
    wrong((snapshot) => {
      entity(snapshot, "e2").pos = null;
    }),
    ["room_support_without_pos"],
  );

  deepStrictEqual(
    wrong((snapshot) => {
      entity(snapshot, "e4").integrity = 101;
    }),
    ["integrity_out_of_range"],
  );

  deepStrictEqual(
    wrong((snapshot) => {
      entity(snapshot, "e4").parts.hand_r = { integrity: 0, status: "detached" };
    }),
    ["detached_part_without_entity"],
  );

  deepStrictEqual(
    wrong((snapshot) => {
      snapshot.next_seq = 4;
    }),
    ["id_not_below_next_seq"],
  );

  deepStrictEqual(
    wrong((snapshot) => {
      entity(snapshot, "e3").support = "e99";
    }),
    ["dangling_reference"],
  );

  deepStrictEqual(
    wrong((snapshot) => {
      entity(snapshot, "e3").location = "e2";
    }),
    ["location_mismatch"],
  );

  const cyclic = baseSnapshot();
  entity(cyclic, "e2").support = "e3";
  entity(cyclic, "e2").pos = null;
  deepStrictEqual(validate(cyclic)[0]?.path, ["entities", "e2"]);
});

test("a door to a removed room names the dangling prop", () => {
  const built = spawn(baseSnapshot(), registry, "door", {
    name: "door",
    props: { open: true, openable: true, from: "e1", to: "e99" },
  });
  deepStrictEqual(codes(built.snapshot), ["dangling_reference"]);
  deepStrictEqual(validate(built.snapshot)[0]?.path, ["entities", built.id, "props", "to"]);
});

test("every command of a long sequence leaves a valid snapshot", (t) => {
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    {
      template: "table",
      overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
    },
    { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
    {
      template: "human",
      overrides: { name: "actor", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
    },
    {
      template: "chest",
      overrides: { name: "chest", location: "e1", support: "e1", pos: { x: 40, y: 0 } },
    },
  ];
  const world = createWorld(join(tempDir(t), "world"), scenario);
  const commands: Command[] = [
    { command_id: "take-bottle", actor: "e4", verb: "take", target: "bottle" },
    {
      command_id: "put-on-table",
      actor: "e4",
      verb: "put",
      target: "bottle",
      args: { relation: "on", destination: "table" },
    },
    { command_id: "take-again", actor: "e4", verb: "take", target: "bottle" },
    {
      command_id: "put-in-chest",
      actor: "e4",
      verb: "put",
      target: "bottle",
      args: { relation: "in", destination: "chest" },
    },
    { command_id: "push-table", actor: "e4", verb: "push", target: "table" },
    { command_id: "wait", actor: "e4", verb: "wait", args: { ticks: 3 } },
  ];

  for (const command of commands) {
    const result = world.command(command);
    deepStrictEqual(codes(result.snapshot), [], `${command.command_id} (${result.status})`);
  }
});

test("a severed limb is accounted for by the entity it became", (t) => {
  const world = createWorld(join(tempDir(t), "hand-world"), [
    { template: "room", overrides: { name: "room" } },
    {
      template: "human",
      overrides: { name: "attacker", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
    },
    {
      template: "human",
      overrides: { name: "guard", location: "e1", support: "e1", pos: { x: 50, y: 0 } },
    },
  ]);

  let snapshot: Snapshot | undefined;
  for (let index = 0; index < 3; index += 1) {
    const result = world.command({
      command_id: `cut-arm-${index}`,
      actor: "e2",
      verb: "attack",
      target: "e3.arm_r",
    });
    strictEqual(result.status, "ok");
    snapshot = result.snapshot;
    deepStrictEqual(codes(result.snapshot), [], `cut-arm-${index}`);
  }

  ok(snapshot);
  const guard = snapshot.entities.e3;
  ok(guard);
  strictEqual(guard.parts.arm_r?.status, "detached");
  strictEqual(guard.parts.hand_r?.status, "detached");
  const arm = Object.values(snapshot.entities).find(
    (entity) => entity.detached_from?.entity === "e3",
  );
  ok(arm);
  strictEqual(arm.parts.hand_r?.status, "intact");
});

test("a corrupted snapshot fixture fails to open and names the rule", (t) => {
  const dir = join(tempDir(t), "corrupted");
  createWorld(dir, [
    { template: "room", overrides: { name: "room" } },
    {
      template: "table",
      overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
    },
    { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e2" } },
  ]);

  const snapshotPath = join(dir, "snapshot.json");
  const stored = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    entities: Record<string, { pos: unknown }>;
  };
  stored.entities.e3!.pos = { x: 5, y: 0 };
  writeFileSync(snapshotPath, JSON.stringify(stored), "utf8");

  for (const read of [() => openWorld(dir).snapshot(), () => openWorld(dir).entity("e3")]) {
    try {
      read();
      throw new Error("Expected the world to refuse the snapshot");
    } catch (error) {
      ok(error instanceof WorldError, String(error));
      strictEqual(error.code, "invalid_snapshot");
      strictEqual(error.issues[0]?.code, "pos_without_room_support");
    }
  }

  const cli = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ op: "snapshot", world: dir }),
  });
  strictEqual(cli.status, 2, cli.stderr);
  const response = JSON.parse(cli.stdout) as { issues: Array<{ code: string; path: string[] }> };
  strictEqual(response.issues[0]?.code, "invalid_snapshot");
  strictEqual(response.issues[1]?.code, "pos_without_room_support");
  deepStrictEqual(response.issues[1]?.path, ["entities", "e3"]);
});

test("a world built from an invalid scenario is never written", (t) => {
  const dir = join(tempDir(t), "never-created");
  const invalid: Scenario = [
    { template: "room", overrides: { name: "room" } },
    // A bottle on the floor with a position of its own but nothing supporting it.
    { template: "bottle", overrides: { name: "bottle", location: "e1", pos: { x: 5, y: 0 } } },
  ];

  try {
    createWorld(dir, invalid);
    throw new Error("Expected the scenario to be refused");
  } catch (error) {
    ok(error instanceof WorldError, String(error));
    strictEqual(error.code, "invalid_snapshot");
  }
  strictEqual(existsSync(dir), false);
});