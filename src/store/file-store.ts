import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../engine/pipeline.js";
import { canonicalJson } from "../engine/canonical.js";
import type { Command, Result } from "../engine/command.js";
import type { Snapshot, Status, WorldEvent } from "../model.js";
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
    throw new TypeError("Template hash mismatch");
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

export function submit(
  dir: string,
  command: Command,
  based_on_version?: number,
  registry?: TemplateRegistry,
): Result {
  const templates = activeRegistry(registry);
  const current = load(dir, templates);
  const basedOn = based_on_version ?? current.version;
  let result: Result;

  if (!Number.isSafeInteger(basedOn) || basedOn < 0) {
    result = invalidResult(current, command, "invalid_version");
  } else if (basedOn > current.version) {
    result = invalidResult(current, command, "future_version");
  } else {
    const applied = apply(current, templates, command);
    result = applied;
    if (basedOn < current.version && applied.status !== "ok") {
      const basedSnapshot = snapshotAtVersion(dir, basedOn, templates);
      const basedResult = basedSnapshot === null ? null : apply(basedSnapshot, templates, command);
      if (applied.status !== "invalid" && basedResult?.status === "ok") {
        result = { ...applied, status: "preempted" };
      }
    }
  }

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
