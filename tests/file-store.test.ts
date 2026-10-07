import { deepStrictEqual, equal, ok, strictEqual, throws } from "node:assert";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson } from "../src/engine/canonical.js";
import { apply } from "../src/engine/pipeline.js";
import { spawn } from "../src/engine/spawn.js";
import { create, entryCount, load, replay, submit } from "../src/store/file-store.js";
import { WorldError } from "../src/errors.js";
import type { Snapshot } from "../src/model.js";
import { SCHEMA_VERSION } from "../src/store/file-store.js";
import { loadTemplates, templatesHash } from "../src/templates.js";

const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));
const registry = loadTemplates(templatesDir);

function initialSnapshot(): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
}

function temporaryDirectory(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function bottleWorld(actorX = 0) {
  const room = spawn(initialSnapshot(), registry, "room", { name: "room" });
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
  const actor = spawn(bottle.snapshot, registry, "human", {
    name: "actor",
    location: room.id,
    support: room.id,
    pos: { x: actorX, y: 0 },
  });
  return {
    snapshot: actor.snapshot,
    roomId: room.id,
    tableId: table.id,
    bottleId: bottle.id,
    actorId: actor.id,
  };
}

test("create and load preserve a canonical snapshot", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  const loaded = load(dir);
  strictEqual(canonicalJson(loaded), canonicalJson(scenario.snapshot));
  equal(readFileSync(join(dir, "snapshot.json"), "utf8"), canonicalJson(scenario.snapshot));
});

test("replay reproduces the bottle and hand scenarios byte-for-byte", (t) => {
  const dir = temporaryDirectory(t);
  const room = spawn(initialSnapshot(), registry, "room", { name: "room" });
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
  const attacker = spawn(bottle.snapshot, registry, "human", {
    name: "attacker",
    location: room.id,
    support: room.id,
    pos: { x: -50, y: 0 },
  });
  const guard = spawn(attacker.snapshot, registry, "human", {
    name: "guard",
    location: room.id,
    support: room.id,
    pos: { x: -40, y: 0 },
  });
  create(dir, guard.snapshot);

  const pushed = submit(dir, {
    command_id: "push-table",
    actor: attacker.id,
    verb: "push",
    target: "table",
  });
  strictEqual(pushed.status, "ok");

  let snapshot = pushed.snapshot;
  for (let index = 0; index < 3; index += 1) {
    const hit = submit(dir, {
      command_id: `hand-hit-${index}`,
      actor: attacker.id,
      verb: "attack",
      target: `${guard.id}.hand_r`,
    });
    strictEqual(hit.status, "ok");
    snapshot = hit.snapshot;
    if (index < 2) {
      const waited = submit(dir, {
        command_id: `wait-${index}`,
        actor: attacker.id,
        verb: "wait",
        args: { ticks: 3 },
      });
      strictEqual(waited.status, "ok");
      snapshot = waited.snapshot;
    }
  }

  const current = load(dir);
  const replayed = replay(dir);
  strictEqual(canonicalJson(current), canonicalJson(snapshot));
  strictEqual(canonicalJson(replayed), canonicalJson(current));
  equal(readFileSync(join(dir, "snapshot.json"), "utf8"), canonicalJson(current));
});

test("a stale take is preempted after the bottle is broken and moved out of reach", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld(-50);
  create(dir, scenario.snapshot);
  const basedOn = scenario.snapshot.version;

  const pushed = submit(
    dir,
    {
      command_id: "push-table",
      actor: scenario.actorId,
      verb: "push",
      target: "table",
    },
    basedOn,
  );
  strictEqual(pushed.status, "ok");

  const staleTake = submit(
    dir,
    {
      command_id: "take-bottle",
      actor: scenario.actorId,
      verb: "take",
      target: "bottle",
    },
    basedOn,
  );
  strictEqual(staleTake.status, "preempted");
  // Out of reach in an unlit room, the bottle is no longer one the actor can name, so the command
  // fails now as unresolved and carries no refusal code.
  strictEqual(staleTake.reason_code, undefined);
  strictEqual(staleTake.snapshot.version, pushed.snapshot.version);
  strictEqual(load(dir).version, pushed.snapshot.version);
  const entries = readFileSync(join(dir, "log.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as { status: string });
  deepStrictEqual(entries.map((entry) => entry.status), ["ok", "preempted"]);
});

test("a stale unknown verb remains invalid", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);
  const basedOn = scenario.snapshot.version;
  const moved = submit(dir, {
    command_id: "move-actor",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 1, y: 0 } },
  }, basedOn);
  strictEqual(moved.status, "ok");

  const stale = submit(dir, {
    command_id: "unknown-verb",
    actor: scenario.actorId,
    verb: "fly",
  }, basedOn);
  strictEqual(stale.status, "invalid");
  strictEqual(stale.reason_code, "unknown_verb");
});

test("a stale take that fails reach at both versions remains refused", (t) => {
  const dir = temporaryDirectory(t);
  // Lit and seen, so the far bottle is named and refused rather than unresolved.
  const seeing = { ...initialSnapshot(), coverage: { relations: [], senses: ["sight"], properties: [] } };
  const room = spawn(seeing, registry, "room", { name: "room", props: { lit: true } });
  const actor = spawn(room.snapshot, registry, "human", {
    name: "actor",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const bottle = spawn(actor.snapshot, registry, "bottle", {
    name: "bottle",
    location: room.id,
    support: room.id,
    pos: { x: 200, y: 0 },
  });
  create(dir, bottle.snapshot);

  const moved = submit(dir, {
    command_id: "move-actor",
    actor: actor.id,
    verb: "move",
    args: { to: { x: 10, y: 0 } },
  }, bottle.snapshot.version);
  strictEqual(moved.status, "ok");

  const stale = submit(dir, {
    command_id: "take-bottle",
    actor: actor.id,
    verb: "take",
    target: "bottle",
  }, bottle.snapshot.version);
  strictEqual(stale.status, "refused");
  strictEqual(stale.reason_code, "out_of_reach");
});

test("load recovers a logged accepted command after a snapshot-write crash", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);
  const command = {
    command_id: "move-before-crash",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  };
  const expected = apply(scenario.snapshot, registry, command);
  strictEqual(expected.status, "ok");

  appendFileSync(
    join(dir, "log.jsonl"),
    `${canonicalJson({
      command,
      based_on_version: scenario.snapshot.version,
      version: scenario.snapshot.version,
      status: "ok",
    })}\n`,
    "utf8",
  );

  const recovered = load(dir);
  const replayed = replay(dir);
  strictEqual(canonicalJson(recovered), canonicalJson(expected.snapshot));
  strictEqual(canonicalJson(recovered), canonicalJson(replayed));
  equal(readFileSync(join(dir, "snapshot.json"), "utf8"), canonicalJson(recovered));
});

test("stale commands on unrelated entities both apply to the current snapshot", (t) => {
  const dir = temporaryDirectory(t);
  const room = spawn(initialSnapshot(), registry, "room", { name: "room" });
  const actor = spawn(room.snapshot, registry, "human", {
    name: "actor",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const first = spawn(actor.snapshot, registry, "bottle", {
    name: "bottle-a",
    location: room.id,
    support: room.id,
    pos: { x: 10, y: 0 },
  });
  const second = spawn(first.snapshot, registry, "bottle", {
    name: "bottle-b",
    location: room.id,
    support: room.id,
    pos: { x: 20, y: 0 },
  });
  create(dir, second.snapshot);

  const firstTake = submit(
    dir,
    { command_id: "take-a", actor: actor.id, verb: "take", target: "bottle-a" },
    second.snapshot.version,
  );
  const secondTake = submit(
    dir,
    { command_id: "take-b", actor: actor.id, verb: "take", target: "bottle-b" },
    second.snapshot.version,
  );

  strictEqual(firstTake.status, "ok");
  strictEqual(secondTake.status, "ok");
  strictEqual(secondTake.snapshot.entities[first.id]?.contained_in, actor.id);
  strictEqual(secondTake.snapshot.entities[second.id]?.contained_in, actor.id);
});

test("load reads the world's own template set", (t) => {
  const root = temporaryDirectory(t);
  const worldDir = join(root, "world");
  const copiedTemplates = join(root, "templates");
  cpSync(templatesDir, copiedTemplates, { recursive: true });
  const scenario = bottleWorld();
  create(worldDir, scenario.snapshot, registry);

  const bottlePath = join(copiedTemplates, "bottle.json");
  const bottle = JSON.parse(readFileSync(bottlePath, "utf8")) as {
    props: { break_fall_cm: number };
  };
  bottle.props.break_fall_cm += 1;
  writeFileSync(bottlePath, JSON.stringify(bottle), "utf8");

  strictEqual(canonicalJson(load(worldDir)), canonicalJson(scenario.snapshot));
  const head = JSON.parse(readFileSync(join(worldDir, "head.json"), "utf8")) as {
    templates_hash: string;
  };
  strictEqual(head.templates_hash, templatesHash(registry));
});

test("head.json is created and matches after create", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  const headPath = join(dir, "head.json");
  ok(existsSync(headPath));
  const head = JSON.parse(readFileSync(headPath, "utf8")) as {
    log_bytes: number;
    events_bytes: number;
    log_entries: number;
  };
  strictEqual(head.log_bytes, 0);
  strictEqual(head.events_bytes, 0);
  strictEqual(head.log_entries, 0);
});

test("head.json is updated after submit", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  submit(dir, {
    command_id: "move-1",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  });

  const headPath = join(dir, "head.json");
  const head = JSON.parse(readFileSync(headPath, "utf8")) as {
    log_bytes: number;
    events_bytes: number;
    log_entries: number;
  };
  strictEqual(head.log_entries, 1);
  ok(head.log_bytes > 0);
  ok(head.events_bytes > 0);
});

test("head.json matches after multiple ok and refused submits", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  const ok1 = submit(dir, {
    command_id: "move-1",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  });
  strictEqual(ok1.status, "ok");

  const refused = submit(dir, {
    command_id: "impossible",
    actor: scenario.actorId,
    verb: "fly",
  });
  strictEqual(refused.status, "invalid");

  const ok2 = submit(dir, {
    command_id: "move-2",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 10, y: 0 } },
  });
  strictEqual(ok2.status, "ok");

  const headPath = join(dir, "head.json");
  const head = JSON.parse(readFileSync(headPath, "utf8")) as {
    log_bytes: number;
    events_bytes: number;
    log_entries: number;
  };
  strictEqual(head.log_entries, 3);
});

test("load skips log read when head.json matches", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  submit(dir, {
    command_id: "move-1",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  });

  const loaded = load(dir);
  strictEqual(loaded.version, 1);
});

test("missing head.json: load recovers correctly and rewrites it", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  submit(dir, {
    command_id: "move-1",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  });

  const headPath = join(dir, "head.json");
  rmSync(headPath);
  ok(!existsSync(headPath));

  const loaded = load(dir);
  strictEqual(loaded.version, 1);
  ok(existsSync(headPath));

  const head = JSON.parse(readFileSync(headPath, "utf8")) as {
    log_bytes: number;
    events_bytes: number;
    log_entries: number;
  };
  strictEqual(head.log_entries, 1);
});

test("stale head.json: load recovers correctly and rewrites it", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  submit(dir, {
    command_id: "move-1",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  });

  const command = {
    command_id: "move-before-crash",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 10, y: 0 } },
  };
  const expected = apply(scenario.snapshot, registry, command);
  strictEqual(expected.status, "ok");

  appendFileSync(
    join(dir, "log.jsonl"),
    `${canonicalJson({
      command,
      based_on_version: 1,
      version: 1,
      status: "ok",
    })}\n`,
    "utf8",
  );

  const recovered = load(dir);
  strictEqual(recovered.version, 2);

  const headPath = join(dir, "head.json");
  const head = JSON.parse(readFileSync(headPath, "utf8")) as {
    log_bytes: number;
    events_bytes: number;
    log_entries: number;
  };
  strictEqual(head.log_entries, 2);
});

test("entryCount uses head.json when available", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  submit(dir, {
    command_id: "move-1",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  });

  strictEqual(entryCount(dir), 1);

  submit(dir, {
    command_id: "move-2",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 10, y: 0 } },
  });

  strictEqual(entryCount(dir), 2);
});

test("head.json records both log_entries and ok_entries after mixed submissions", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  const ok1 = submit(dir, {
    command_id: "move-1",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  });
  strictEqual(ok1.status, "ok");

  const refused = submit(dir, {
    command_id: "impossible",
    actor: scenario.actorId,
    verb: "fly",
  });
  strictEqual(refused.status, "invalid");

  const ok2 = submit(dir, {
    command_id: "move-2",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 10, y: 0 } },
  });
  strictEqual(ok2.status, "ok");

  const headPath = join(dir, "head.json");
  const head = JSON.parse(readFileSync(headPath, "utf8")) as {
    log_bytes: number;
    events_bytes: number;
    log_entries: number;
    ok_entries: number;
  };
  strictEqual(head.log_entries, 3);
  strictEqual(head.ok_entries, 2);
});

test("fast path is taken after refused commands (corrupted log line same size)", (t) => {
  const dir = temporaryDirectory(t);
  const scenario = bottleWorld();
  create(dir, scenario.snapshot);

  submit(dir, {
    command_id: "refused-1",
    actor: scenario.actorId,
    verb: "fly",
  });

  const ok1 = submit(dir, {
    command_id: "move-1",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 5, y: 0 } },
  });
  strictEqual(ok1.status, "ok");

  const ok2 = submit(dir, {
    command_id: "move-2",
    actor: scenario.actorId,
    verb: "move",
    args: { to: { x: 10, y: 0 } },
  });
  strictEqual(ok2.status, "ok");

  const logPath = join(dir, "log.jsonl");
  const logContent = readFileSync(logPath, "utf8");
  const lines = logContent.split("\n").filter((line) => line.length > 0);

  const firstLine = lines[0]!;
  let corrupted: string;
  if (firstLine.includes('"invalid"')) {
    corrupted = firstLine.replace('"invalid"', '"refusef"');
  } else {
    throw new Error("Unexpected log line format");
  }
  strictEqual(firstLine.length, corrupted.length);
  ok(firstLine !== corrupted);

  const newContent = corrupted + "\n" + lines.slice(1).join("\n") + "\n";
  writeFileSync(logPath, newContent, "utf8");

  const loaded = load(dir);
  strictEqual(loaded.version, 2);
});

test("a world with no schema marker or another number is refused, never read", (t) => {
  const dir = temporaryDirectory(t);
  create(dir, initialSnapshot(), registry);
  const marker = join(dir, "format.json");
  deepStrictEqual(JSON.parse(readFileSync(marker, "utf8")), { schema_version: SCHEMA_VERSION });
  load(dir, registry);

  writeFileSync(marker, canonicalJson({ schema_version: SCHEMA_VERSION + 1 }), "utf8");
  throws(() => load(dir, registry), (error: unknown) => error instanceof WorldError && error.code === "unsupported_schema");

  rmSync(marker);
  throws(() => load(dir, registry), (error: unknown) => error instanceof WorldError && error.code === "unsupported_schema");
});
