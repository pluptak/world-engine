import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../engine/pipeline.js";
import { canonicalJson } from "../engine/canonical.js";
import { validateSnapshot } from "../engine/validate.js";
import type { Command, Result } from "../engine/command.js";
import { WorldError } from "../errors.js";
import type { Delta, Snapshot, Status, WorldEvent } from "../model.js";
import { loadTemplates, templatesHash, type TemplateRegistry } from "../templates.js";

interface LogEntry {
  command: Command;
  based_on_version: number;
  status: Status;
}

const snapshots = {
  current: "snapshot.json",
  initial: "initial.json",
  log: "log.jsonl",
};

const templatesDirectory = fileURLToPath(new URL("../../templates/", import.meta.url));

function assertWorldExists(dir: string): void {
  const missing = [snapshots.current, snapshots.initial, snapshots.log].filter(
    (name) => !existsSync(join(dir, name)),
  );
  if (missing.length > 0) {
    throw new WorldError("no_such_world", `No world at ${dir}: missing ${missing.join(", ")}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function activeRegistry(registry?: TemplateRegistry): TemplateRegistry {
  return registry ?? loadTemplates(templatesDirectory);
}

function readSnapshot(path: string): Snapshot {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isRecord(value) ||
    typeof value.templates_hash !== "string" ||
    !Number.isSafeInteger(value.version) ||
    !Number.isSafeInteger(value.tick) ||
    !Number.isSafeInteger(value.next_seq) ||
    !isRecord(value.coverage) ||
    !Array.isArray(value.coverage.relations) ||
    !Array.isArray(value.coverage.senses) ||
    !Array.isArray(value.coverage.properties) ||
    !isRecord(value.entities)
  ) {
    throw new TypeError(`Invalid snapshot file ${path}`);
  }
  return value as unknown as Snapshot;
}

function assertTemplates(snapshot: Snapshot, registry: TemplateRegistry): void {
  if (snapshot.templates_hash !== templatesHash(registry)) {
    throw new WorldError("templates_changed", "Template hash mismatch");
  }
}

function atomicWrite(path: string, contents: string): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, path);
}

function invalidResult(snapshot: Snapshot, command: Command, reason_code: string): Result {
  return {
    status: "invalid",
    command_id: command.command_id,
    resolved_target: null,
    reason_code,
    snapshot,
    deltas: [],
    events: [],
  };
}

function parseLogLine(line: string, lineNumber: number): LogEntry {
  const value: unknown = JSON.parse(line);
  if (
    !isRecord(value) ||
    typeof value.based_on_version !== "number" ||
    typeof value.status !== "string" ||
    !Object.hasOwn(value, "command")
  ) {
    throw new TypeError(`Invalid log entry at line ${lineNumber}`);
  }
  const entry = value as unknown as LogEntry;
  if (
    !["ok", "refused", "ambiguous", "unresolved", "preempted", "invalid"].includes(entry.status) ||
    entry.command === null ||
    typeof entry.command !== "object" ||
    typeof entry.command.command_id !== "string" ||
    typeof entry.command.actor !== "string" ||
    typeof entry.command.verb !== "string"
  ) {
    throw new TypeError(`Invalid log entry at line ${lineNumber}`);
  }
  return entry;
}

function readLogEntries(dir: string): LogEntry[] {
  const lines = readFileSync(join(dir, snapshots.log), "utf8").split(/\r?\n/);
  const entries: LogEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length > 0) {
      entries.push(parseLogLine(line, index + 1));
    }
  }
  return entries;
}

function snapshotAtVersion(
  dir: string,
  version: number,
  registry: TemplateRegistry,
): Snapshot | null {
  let snapshot = readSnapshot(join(dir, snapshots.initial));
  assertTemplates(snapshot, registry);
  if (snapshot.version > version) {
    return null;
  }

  for (const [index, entry] of readLogEntries(dir).entries()) {
    if (snapshot.version === version) {
      return snapshot;
    }
    if (entry.status !== "ok") {
      continue;
    }
    const result = apply(snapshot, registry, entry.command);
    if (result.status !== "ok") {
      throw new TypeError(`Accepted command failed during replay at line ${index + 1}`);
    }
    snapshot = result.snapshot;
  }

  return snapshot.version === version ? snapshot : null;
}

export function create(
  dir: string,
  initialSnapshot: Snapshot,
  registry?: TemplateRegistry,
): void {
  const templates = activeRegistry(registry);
  assertTemplates(initialSnapshot, templates);
  mkdirSync(dir, { recursive: true });
  atomicWrite(join(dir, snapshots.initial), canonicalJson(initialSnapshot));
  atomicWrite(join(dir, snapshots.current), canonicalJson(initialSnapshot));
  writeFileSync(join(dir, snapshots.log), "", "utf8");
}

export function load(dir: string, registry?: TemplateRegistry): Snapshot {
  assertWorldExists(dir);
  const templates = activeRegistry(registry);
  const snapshot = readSnapshot(join(dir, snapshots.current));
  const initial = readSnapshot(join(dir, snapshots.initial));
  assertTemplates(snapshot, templates);
  assertTemplates(initial, templates);

  const expectedVersion =
    initial.version + readLogEntries(dir).filter((entry) => entry.status === "ok").length;
  if (snapshot.version !== expectedVersion) {
    const recovered = replay(dir, templates);
    atomicWrite(join(dir, snapshots.current), canonicalJson(recovered));
    return recovered;
  }
  return snapshot;
}

// Log entries so far: every submission appends exactly one line, refused or not, so this count is
// unique per world state and safe to build a default id from.
export function entryCount(dir: string): number {
  assertWorldExists(dir);
  return readFileSync(join(dir, snapshots.log), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0).length;
}

// The last gate before anything is believed: an accepted command whose result breaks a snapshot
// invariant is not applied. A verb bug must never persist a world that cannot open.
function acceptedResult(
  current: Snapshot,
  registry: TemplateRegistry,
  command: Command,
  applied: Result,
): Result {
  if (applied.status !== "ok") {
    return applied;
  }
  const [first] = validateSnapshot(applied.snapshot, registry);
  return first === undefined ? applied : invalidResult(current, command, first.code);
}

// The version rule, with no disk of its own: a command against a version the world has already left
// is preempted when it would have succeeded there, so a caller that raced sees why it lost.
export function resolveSubmission(
  current: Snapshot,
  registry: TemplateRegistry,
  command: Command,
  basedOn: number,
  snapshotAt: (version: number) => Snapshot | null,
): Result {
  if (!Number.isSafeInteger(basedOn) || basedOn < 0) {
    return invalidResult(current, command, "invalid_version");
  }
  if (basedOn > current.version) {
    return invalidResult(current, command, "future_version");
  }

  const result = acceptedResult(current, registry, command, apply(current, registry, command));
  if (basedOn >= current.version || result.status === "ok" || result.status === "invalid") {
    return result;
  }

  const basedSnapshot = snapshotAt(basedOn);
  const basedResult =
    basedSnapshot === null
      ? null
      : acceptedResult(basedSnapshot, registry, command, apply(basedSnapshot, registry, command));
  return basedResult?.status === "ok" ? { ...result, status: "preempted" } : result;
}

export function submit(
  dir: string,
  command: Command,
  based_on_version?: number,
  registry?: TemplateRegistry,
): Result {
  const templates = activeRegistry(registry);
  const current = load(dir, templates);
  const basedOn = based_on_version ?? current.version;
  const result = resolveSubmission(current, templates, command, basedOn, (version) =>
    snapshotAtVersion(dir, version, templates),
  );

  const entry: LogEntry = {
    command,
    based_on_version: basedOn,
    status: result.status,
  };
  appendFileSync(join(dir, snapshots.log), `${canonicalJson(entry)}\n`, "utf8");

  if (result.status === "ok") {
    atomicWrite(join(dir, snapshots.current), canonicalJson(result.snapshot));
  }
  return result;
}

export function replayWithEvents(
  dir: string,
  registry?: TemplateRegistry,
): { snapshot: Snapshot; events: WorldEvent[] } {
  const templates = activeRegistry(registry);
  let snapshot = readSnapshot(join(dir, snapshots.initial));
  assertTemplates(snapshot, templates);
  const events: WorldEvent[] = [];

  for (const [index, entry] of readLogEntries(dir).entries()) {
    if (entry.status !== "ok") {
      continue;
    }
    const result = apply(snapshot, templates, entry.command);
    if (result.status !== "ok") {
      throw new TypeError(`Accepted command failed during replay at line ${index + 1}`);
    }
    events.push(...result.events);
    snapshot = result.snapshot;
  }

  return { snapshot, events };
}

export function replay(dir: string, registry?: TemplateRegistry): Snapshot {
  return replayWithEvents(dir, registry).snapshot;
}

// The snapshots before and after the command that produced an event, with the events up to and
// including that command: event-form perceive evaluates against both via queryAtEvent.
export function replayUntilEvent(
  dir: string,
  eventId: string,
  registry?: TemplateRegistry,
): { before: Snapshot; snapshot: Snapshot; events: WorldEvent[] } | null {
  const templates = activeRegistry(registry);
  let snapshot = readSnapshot(join(dir, snapshots.initial));
  assertTemplates(snapshot, templates);
  const events: WorldEvent[] = [];

  for (const [index, entry] of readLogEntries(dir).entries()) {
    if (entry.status !== "ok") {
      continue;
    }
    const before = snapshot;
    const result = apply(snapshot, templates, entry.command);
    if (result.status !== "ok") {
      throw new TypeError(`Accepted command failed during replay at line ${index + 1}`);
    }
    events.push(...result.events);
    snapshot = result.snapshot;
    if (result.events.some((event) => event.event_id === eventId)) {
      return { before, snapshot, events };
    }
  }

  return null;
}

// Every ok command after `version`, folded from the log: their deltas and events in command order.
// A command counts when it was applied at `version` or later, so the fold walks the whole log and
// only collects past the cut.
export function since(
  dir: string,
  version: number,
  registry?: TemplateRegistry,
): { deltas: Delta[]; events: WorldEvent[] } {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new WorldError("invalid_version", `Invalid version ${version}`);
  }
  const templates = activeRegistry(registry);
  const current = load(dir, templates);
  if (version > current.version) {
    throw new WorldError("future_version", `Version ${version} is ahead of ${current.version}`);
  }

  let snapshot = readSnapshot(join(dir, snapshots.initial));
  assertTemplates(snapshot, templates);
  const deltas: Delta[] = [];
  const events: WorldEvent[] = [];
  for (const [index, entry] of readLogEntries(dir).entries()) {
    if (entry.status !== "ok") {
      continue;
    }
    const result = apply(snapshot, templates, entry.command);
    if (result.status !== "ok") {
      throw new TypeError(`Accepted command failed during replay at line ${index + 1}`);
    }
    if (snapshot.version >= version) {
      deltas.push(...result.deltas);
      events.push(...result.events);
    }
    snapshot = result.snapshot;
  }

  return { deltas, events };
}
