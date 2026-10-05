import { deepStrictEqual, notStrictEqual, strictEqual, throws as assertThrows } from "node:assert";
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
  openWorld,
  WorldError,
  type Command,
  type Scenario,
} from "../src/index.js";
import { loadTemplates, templatesHash } from "../src/templates.js";
import { replay } from "../src/store/file-store.js";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-frozen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The world is frozen against a copy, so a test may edit the copy without touching the repo's.
function copiedTemplates(t: { after(callback: () => void): void }): string {
  const dir = join(tempDir(t), "templates");
  cpSync(templatesDir, dir, { recursive: true });
  return dir;
}

function readTemplate(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
}

function writeTemplate(dir: string, file: string, template: Record<string, unknown>): void {
  writeFileSync(join(dir, file), `${JSON.stringify(template, null, 2)}\n`, "utf8");
}

const bottleScenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  {
    template: "bottle",
    overrides: { name: "bottle", location: "e1", support: "e2" },
  },
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

const pushTable: Command = {
  command_id: "push-table",
  actor: "e4",
  verb: "push",
  target: "table",
};

function wait(id: string): Command {
  return { command_id: id, actor: "e4", verb: "wait", args: { ticks: 1 } };
}

function frozenWorld(t: { after(callback: () => void): void }, copies: string) {
  const dir = join(tempDir(t), "frozen");
  return { dir, world: createWorld(dir, bottleScenario, loadTemplates(copies)) };
}

test("a world keeps its own template set after the source templates change", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(world.command(pushTable).status, "ok");
  const before = canonicalJson(world.snapshot());

  const bottle = readTemplate(copies, "bottle.json");
  bottle.mass_g = 1;
  writeTemplate(copies, "bottle.json", bottle);

  const reopened = openWorld(dir);
  strictEqual(canonicalJson(reopened.snapshot()), before);
  deepStrictEqual(reopened.entity("e1")?.residue, { glass: 5, wine: 75 });
  strictEqual(reopened.command(wait("wait-1")).status, "ok");
});

test("a template change reaches only worlds created after it", (t) => {
  const copies = copiedTemplates(t);
  const { dir: firstDir, world: first } = frozenWorld(t, copies);
  const firstHash = first.snapshot().templates_hash;

  const bottle = readTemplate(copies, "bottle.json");
  bottle.mass_g = 1;
  writeTemplate(copies, "bottle.json", bottle);

  const secondDir = join(tempDir(t), "later");
  const second = createWorld(secondDir, bottleScenario, loadTemplates(copies));

  notStrictEqual(second.snapshot().templates_hash, firstHash);
  strictEqual(openWorld(firstDir).snapshot().templates_hash, firstHash);
  strictEqual(openWorld(secondDir).snapshot().templates_hash, second.snapshot().templates_hash);
  deepStrictEqual(first.entity("e3")?.props.liquid_amount, 75);
});

test("a world without templates.json does not open", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(world.snapshot().version, 0);
  unlinkSync(join(dir, "templates.json"));

  for (const read of [
    () => openWorld(dir).snapshot(),
    () => openWorld(dir).entity("e1"),
    () => openWorld(dir).query({ kind: "fact", subject: "e1", relation: "status" }),
    () => openWorld(dir).command(pushTable),
  ]) {
    assertThrows(
      read,
      (error: unknown) => error instanceof WorldError && error.code === "no_such_world",
    );
  }
});

test("a malformed templates.json is reported as invalid_templates", (t) => {
  const copies = copiedTemplates(t);
  const { dir } = frozenWorld(t, copies);
  writeFileSync(join(dir, "templates.json"), '{"bottle":{}}', "utf8");

  assertThrows(
    () => openWorld(dir).snapshot(),
    (error: unknown) => error instanceof WorldError && error.code === "invalid_templates",
  );
});

test("a set that still replays the world's history is adopted", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  const original = world.snapshot().templates_hash;

  const bottle = readTemplate(copies, "bottle.json");
  bottle.mass_g = 1;
  writeTemplate(copies, "bottle.json", bottle);
  writeFileSync(join(dir, "templates.json"), canonicalJson(loadTemplates(copies)), "utf8");

  const reopened = openWorld(dir);
  strictEqual(reopened.snapshot().version, 0);
  notStrictEqual(reopened.snapshot().templates_hash, original);
  strictEqual(reopened.command(pushTable).status, "ok");
  deepStrictEqual(reopened.entity("e1")?.residue, { glass: 5, wine: 75 });
});

test("a set that no longer replays the world's history is refused", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(world.command(pushTable).status, "ok");

  const bottle = readTemplate(copies, "bottle.json");
  (bottle.break_residue as Record<string, number>).glass = 9;
  writeTemplate(copies, "bottle.json", bottle);
  writeFileSync(join(dir, "templates.json"), canonicalJson(loadTemplates(copies)), "utf8");

  assertThrows(
    () => openWorld(dir).snapshot(),
    (error: unknown) => error instanceof WorldError && error.code === "templates_changed",
  );
});

test("an upgrade that changes how the log replays is refused", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(world.command(pushTable).status, "ok");
  const before = world.snapshot().templates_hash;

  const bottle = readTemplate(copies, "bottle.json");
  (bottle.break_residue as Record<string, number>).glass = 9;
  writeTemplate(copies, "bottle.json", bottle);

  assertThrows(
    () => world.upgradeTemplates(loadTemplates(copies)),
    (error: unknown) => error instanceof WorldError && error.code === "replay_diverges",
  );
  strictEqual(openWorld(dir).snapshot().templates_hash, before);
  deepStrictEqual(openWorld(dir).entity("e1")?.residue, { glass: 5, wine: 75 });
});

test("an upgrade that adds a template succeeds and leaves the log untouched", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(world.command(pushTable).status, "ok");
  const logBefore = readFileSync(join(dir, "log.jsonl"), "utf8");
  const eventsBefore = readFileSync(join(dir, "events.jsonl"), "utf8");

  writeTemplate(copies, "pebble.json", {
    id: "pebble",
    size_cm: { w: 4, d: 4, h: 4 },
    mass_g: 20,
    parts: [],
    props: {},
    break_products: [],
    break_residue: {},
  });

  const upgraded = world.upgradeTemplates(loadTemplates(copies));
  strictEqual(upgraded.version, 1);
  strictEqual(upgraded.templates_hash, templatesHash(loadTemplates(copies)));
  strictEqual(readFileSync(join(dir, "log.jsonl"), "utf8"), logBefore);
  strictEqual(readFileSync(join(dir, "events.jsonl"), "utf8"), eventsBefore);

  // The handle that upgraded keeps working under the set it now has.
  strictEqual(world.command(wait("wait-1")).status, "ok");
  strictEqual(canonicalJson(replay(dir)), canonicalJson(world.snapshot()));
  strictEqual(
    world.edit({ kind: "spawn", template: "pebble", overrides: { name: "pebble", support: "e2" } }).status,
    "ok",
  );
});

test("an upgrade is refused when a live entity's template lost a field", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  const before = world.snapshot().templates_hash;

  const human = readTemplate(copies, "human.json");
  human.parts = (human.parts as Array<{ name: string }>).filter((part) => part.name !== "hand_r");
  writeTemplate(copies, "human.json", human);

  assertThrows(
    () => world.upgradeTemplates(loadTemplates(copies)),
    (error: unknown) =>
      error instanceof WorldError &&
      error.code === "templates_lost_field" &&
      error.message.includes("e4") &&
      error.message.includes("parts.hand_r"),
  );
  strictEqual(openWorld(dir).snapshot().templates_hash, before);
  strictEqual(world.command(wait("wait-1")).status, "ok");
});

test("a handle opened before an upgrade refuses to write after it", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  const stale = openWorld(dir);

  const bottle = readTemplate(copies, "bottle.json");
  bottle.mass_g = 1;
  writeTemplate(copies, "bottle.json", bottle);
  world.upgradeTemplates(loadTemplates(copies));

  assertThrows(
    () => stale.command(wait("stale-1")),
    (error: unknown) => error instanceof WorldError && error.code === "templates_changed",
  );
  strictEqual(openWorld(dir).command(wait("fresh-1")).status, "ok");
});

test("an interrupted upgrade is repaired on the next open", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(world.command(pushTable).status, "ok");

  const bottle = readTemplate(copies, "bottle.json");
  bottle.mass_g = 1;
  writeTemplate(copies, "bottle.json", bottle);
  world.upgradeTemplates(loadTemplates(copies));

  // The set was written and the process died before the snapshots were stamped with its hash.
  const head = JSON.parse(readFileSync(join(dir, "head.json"), "utf8")) as Record<string, unknown>;
  const stale = JSON.parse(readFileSync(join(dir, "initial.json"), "utf8")) as { templates_hash: string };
  writeFileSync(
    join(dir, "head.json"),
    canonicalJson({ ...head, templates_hash: stale.templates_hash }),
    "utf8",
  );

  const repaired = openWorld(dir).snapshot();
  strictEqual(repaired.version, 1);
  strictEqual(repaired.templates_hash, templatesHash(loadTemplates(copies)));
  deepStrictEqual(repaired.entities.e1?.residue, { glass: 5, wine: 75 });
  strictEqual(
    JSON.parse(readFileSync(join(dir, "head.json"), "utf8")).templates_hash,
    repaired.templates_hash,
  );
});

test("an upgrade interrupted before the snapshots are stamped is repaired", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(world.command(pushTable).status, "ok");

  const bottle = readTemplate(copies, "bottle.json");
  bottle.mass_g = 1;
  writeTemplate(copies, "bottle.json", bottle);
  const next = loadTemplates(copies);

  // The set and the initial snapshot were written; the current snapshot and the head were not.
  const head = JSON.parse(readFileSync(join(dir, "head.json"), "utf8")) as Record<string, unknown>;
  const current = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")) as {
    templates_hash: string;
  };
  writeFileSync(join(dir, "templates.json"), canonicalJson(next), "utf8");
  writeFileSync(
    join(dir, "initial.json"),
    canonicalJson({ ...JSON.parse(readFileSync(join(dir, "initial.json"), "utf8")), templates_hash: templatesHash(next) }),
    "utf8",
  );
  writeFileSync(join(dir, "head.json"), canonicalJson({ ...head, templates_hash: current.templates_hash }), "utf8");

  const repaired = openWorld(dir).snapshot();
  strictEqual(repaired.version, 1);
  strictEqual(repaired.templates_hash, templatesHash(next));
  deepStrictEqual(repaired.entities.e1?.residue, { glass: 5, wine: 75 });
});

test("a set that orphans a live entity is never adopted", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  const before = world.snapshot().templates_hash;

  const human = readTemplate(copies, "human.json");
  const whole = JSON.stringify(human, null, 2);
  human.parts = (human.parts as Array<{ name: string }>).filter((part) => part.name !== "hand_r");
  writeTemplate(copies, "human.json", human);
  const orphaned = loadTemplates(copies);
  writeFileSync(join(dir, "templates.json"), canonicalJson(orphaned), "utf8");

  assertThrows(
    () => openWorld(dir).snapshot(),
    (error: unknown) =>
      error instanceof WorldError &&
      error.code === "templates_lost_field" &&
      error.message.includes("parts.hand_r"),
  );
  writeTemplate(copies, "human.json", JSON.parse(whole) as Record<string, unknown>);
  writeFileSync(join(dir, "templates.json"), canonicalJson(loadTemplates(copies)), "utf8");
  strictEqual(openWorld(dir).snapshot().templates_hash, before);
});

test("an upgrade that changes what an accepted command emits is refused", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(world.command({ ...pushTable, perceivers: true }).status, "ok");

  // Sight contributes through a part capacity, so this changes who sensed each event already in
  // the log without changing a single snapshot field.
  const human = readTemplate(copies, "human.json");
  human.parts = (human.parts as Array<Record<string, unknown>>).map((part) =>
    part.name === "head" ? { ...part, contributes: {} } : part,
  );
  writeTemplate(copies, "human.json", human);

  assertThrows(
    () => world.upgradeTemplates(loadTemplates(copies)),
    (error: unknown) => error instanceof WorldError && error.code === "replay_diverges",
  );
  strictEqual(openWorld(dir).command(wait("wait-1")).status, "ok");
});

test("an upgrade under which a logged command fails is refused, not a crash", (t) => {
  const copies = copiedTemplates(t);
  const { dir, world } = frozenWorld(t, copies);
  strictEqual(
    world.command({ command_id: "take-bottle", actor: "e4", verb: "take", target: "bottle" }).status,
    "ok",
  );

  // Nothing left to take it with, so the command the log accepted is refused on the fold.
  const human = readTemplate(copies, "human.json");
  human.parts = (human.parts as Array<Record<string, unknown>>).map((part) =>
    (part.name as string).startsWith("hand_") ? { ...part, contributes: {} } : part,
  );
  writeTemplate(copies, "human.json", human);

  assertThrows(
    () => world.upgradeTemplates(loadTemplates(copies)),
    (error: unknown) => error instanceof WorldError && error.code === "replay_diverges",
  );
  strictEqual(openWorld(dir).snapshot().version, 1);
});
