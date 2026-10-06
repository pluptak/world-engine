import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../engine/pipeline.js";
import { canonicalJson } from "../engine/canonical.js";
import { traceQuery, type TraceQuery } from "../engine/trace.js";
import { validateSnapshot } from "../engine/validate.js";
import { lostField } from "../engine/upgrade.js";
import { attemptOf, type Attempt, type Command, type Result } from "../engine/command.js";
import { WorldError } from "../errors.js";
import type { Delta, Id, Snapshot, Status, WorldEvent } from "../model.js";
import { loadTemplates, parseRegistry, templatesHash, type TemplateRegistry } from "../templates.js";

// A log line is the attempt itself: every submission, refused and invalid ones included.
type LogEntry = Attempt;

interface Head {
  log_bytes: number;
  events_bytes: number;
  log_entries: number;
  ok_entries: number;
  templates_hash: string;
}

const snapshots = {
  current: "snapshot.json",
  initial: "initial.json",
  log: "log.jsonl",
  events: "events.jsonl",
  head: "head.json",
  templates: "templates.json",
  ids: "ids.json",
  format: "format.json",
};

// Bumped when a stored file's shape changes; a world written under another number is refused,
// never read as if it matched.
export const SCHEMA_VERSION = 5;

// A world is created from the templates directory and then never reads it again: the copy beside
// the log is the one it is bound to.
const templatesDirectory = fileURLToPath(new URL("../../templates/", import.meta.url));

function assertWorldExists(dir: string): void {
  const missing = [
    snapshots.current,
    snapshots.initial,
    snapshots.log,
    snapshots.events,
    snapshots.templates,
  ].filter((name) => !existsSync(join(dir, name)));
  if (missing.length > 0) {
    throw new WorldError("no_such_world", `No world at ${dir}: missing ${missing.join(", ")}`);
  }
  assertSchema(dir);
}

function assertSchema(dir: string): void {
  const path = join(dir, snapshots.format);
  let found: unknown = null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    found = isRecord(value) ? value.schema_version : null;
  } catch {
    // A world written before the marker existed has no file: the same refusal as a wrong number.
  }
  if (found !== SCHEMA_VERSION) {
    throw new WorldError(
      "unsupported_schema",
      `World at ${dir} has schema_version ${JSON.stringify(found)}, this engine reads ${SCHEMA_VERSION}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The set this world was created with: a world is self-contained, so the templates directory a
// caller happens to be editing is none of its business.
export function readWorldTemplates(dir: string): TemplateRegistry {
  assertWorldExists(dir);
  const path = join(dir, snapshots.templates);
  try {
    return parseRegistry(JSON.parse(readFileSync(path, "utf8")) as unknown, snapshots.templates);
  } catch (error) {
    throw new WorldError(
      "invalid_templates",
      `Unreadable template set at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function activeRegistry(dir: string, registry?: TemplateRegistry): TemplateRegistry {
  return registry ?? readWorldTemplates(dir);
}

function readHead(dir: string): Head | null {
  const headPath = join(dir, snapshots.head);
  if (!existsSync(headPath)) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(readFileSync(headPath, "utf8"));
    if (
      !isRecord(value) ||
      typeof value.log_bytes !== "number" ||
      typeof value.events_bytes !== "number" ||
      typeof value.log_entries !== "number" ||
      typeof value.ok_entries !== "number" ||
      typeof value.templates_hash !== "string"
    ) {
      return null;
    }
    return value as unknown as Head;
  } catch {
    return null;
  }
}

function writeHead(dir: string, head: Head): void {
  atomicWrite(join(dir, snapshots.head), canonicalJson(head));
}

function emptyHead(): Head {
  return { log_bytes: 0, events_bytes: 0, log_entries: 0, ok_entries: 0, templates_hash: "" };
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
    !isRecord(value.entities) ||
    (value.schedule !== undefined && !Array.isArray(value.schedule))
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
    !Number.isSafeInteger(value.version) ||
    typeof value.status !== "string" ||
    (value.reason_code !== undefined && typeof value.reason_code !== "string") ||
    (value.reason_data !== undefined && !isRecord(value.reason_data)) ||
    (value.candidates !== undefined && !Array.isArray(value.candidates)) ||
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
  ids: Readonly<Record<string, Id>> = {},
): void {
  const templates = registry ?? loadTemplates(templatesDirectory);
  assertTemplates(initialSnapshot, templates);
  mkdirSync(dir, { recursive: true });
  atomicWrite(join(dir, snapshots.format), canonicalJson({ schema_version: SCHEMA_VERSION }));
  atomicWrite(join(dir, snapshots.templates), canonicalJson(templates));
  atomicWrite(join(dir, snapshots.initial), canonicalJson(initialSnapshot));
  atomicWrite(join(dir, snapshots.current), canonicalJson(initialSnapshot));
  // Written only when a scenario named something, so a world without names and a world written
  // before ids.json existed are the same thing on disk: no file, no names.
  if (Object.keys(ids).length > 0) {
    atomicWrite(join(dir, snapshots.ids), canonicalJson(ids));
  }
  writeFileSync(join(dir, snapshots.log), "", "utf8");
  writeFileSync(join(dir, snapshots.events), "", "utf8");
  writeHead(dir, {
    log_bytes: 0,
    events_bytes: 0,
    log_entries: 0,
    ok_entries: 0,
    templates_hash: templatesHash(templates),
  });
}

// The names the scenario gave this world, so a reopened world answers them like the handle that
// created it. Absence means none; a file that is there and unreadable is a broken world, not a
// world without names.
export function readWorldIds(dir: string): Readonly<Record<string, Id>> {
  const path = join(dir, snapshots.ids);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      !isRecord(value) ||
      Object.values(value).some((id) => typeof id !== "string")
    ) {
      throw new TypeError("ids.json is not a map of names to ids");
    }
    return value as Record<string, Id>;
  } catch (error) {
    throw new WorldError(
      "invalid_ids",
      `Unreadable name map at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// `setIsTheWorlds` says the registry came from the world's own templates.json rather than from a
// caller, which is what lets load() settle a moved set instead of refusing it: only the world's own
// file may take the world over.
export function load(dir: string, registry?: TemplateRegistry, setIsTheWorlds = false): Snapshot {
  assertWorldExists(dir);
  const templates = activeRegistry(dir, registry);
  const snapshot = readSnapshot(join(dir, snapshots.current));
  const initial = readSnapshot(join(dir, snapshots.initial));

  const head = readHead(dir);
  const logPath = join(dir, snapshots.log);
  const eventsPath = join(dir, snapshots.events);
  const frozenHash = templatesHash(templates);

  // An upgrade stamps the snapshots before the head, so a head still naming the old hash means the
  // set moved and the write may have been interrupted somewhere in between. Only the set in the file
  // may take the world over: a registry handed in by a caller is a claim about the set, checked and
  // refused when it no longer holds, never written. Which of an edit and an interruption moved the
  // set cannot be told from the files, so it is settled by proof — a set that leaves every live
  // entity whole and still folds the log to the stored snapshot is a successor, and one that does
  // not is refused rather than silently rewriting history. The comparison is over the world with
  // both hashes normalized, because which file was stamped before a crash is exactly what is unknown.
  // This runs before the hash assertions below, which would read the interruption itself as a world
  // whose files disagree.
  if (head !== null && head.templates_hash !== frozenHash) {
    if (!setIsTheWorlds) {
      throw new WorldError("templates_changed", "Template hash mismatch");
    }
    const lost = lostField(snapshot, templates);
    if (lost !== null) {
      throw new WorldError(
        "templates_lost_field",
        `Entity ${lost.entity} (${lost.template}) uses ${lost.field}`,
      );
    }
    const folded = replayFold(dir, templates);
    if (
      canonicalJson({ ...folded.snapshot, templates_hash: frozenHash }) !==
      canonicalJson({ ...snapshot, templates_hash: frozenHash }) ||
      canonicalJson(folded.events) !== canonicalJson(readEvents(dir))
    ) {
      throw new WorldError("templates_changed", "Template hash mismatch");
    }
    atomicWrite(join(dir, snapshots.initial), canonicalJson({ ...initial, templates_hash: frozenHash }));
    atomicWrite(join(dir, snapshots.current), canonicalJson({ ...snapshot, templates_hash: frozenHash }));
    writeHead(dir, { ...head, templates_hash: frozenHash });
    return load(dir);
  }

  assertTemplates(snapshot, templates);
  assertTemplates(initial, templates);

  if (head !== null) {
    try {
      const logStat = statSync(logPath);
      const eventsStat = statSync(eventsPath);
      if (logStat.size === head.log_bytes && eventsStat.size === head.events_bytes) {
        const expectedVersion = initial.version + head.ok_entries;
        if (snapshot.version === expectedVersion) {
          return snapshot;
        }
      }
    } catch {
      // Fall through to full check
    }
  }

  // A crash between the log, event, and snapshot appends leaves them disagreeing; the log is
  // the source of truth, so replay rebuilds both files, events first, and any later open finds
  // them consistent again.
  const entries = readLogEntries(dir);
  const okEntries = entries.filter((entry) => entry.status === "ok");
  const expectedVersion = initial.version + okEntries.length;
  if (snapshot.version !== expectedVersion) {
    const { snapshot: recovered, events } = replayWithEvents(dir, templates);
    atomicWrite(
      join(dir, snapshots.events),
      events.map((event) => `${canonicalJson(event)}\n`).join(""),
    );
    atomicWrite(join(dir, snapshots.current), canonicalJson(recovered));
    writeHead(dir, {
      log_bytes: statSync(logPath).size,
      events_bytes: statSync(eventsPath).size,
      log_entries: entries.length,
      ok_entries: okEntries.length,
      templates_hash: frozenHash,
    });
    return recovered;
  }
  writeHead(dir, {
    log_bytes: statSync(logPath).size,
    events_bytes: statSync(eventsPath).size,
    log_entries: entries.length,
    ok_entries: okEntries.length,
    templates_hash: frozenHash,
  });
  return snapshot;
}

// Log entries so far: every submission appends exactly one line, refused or not, so this count is
// unique per world state and safe to build a default id from.
export function entryCount(dir: string): number {
  assertWorldExists(dir);
  const head = readHead(dir);
  const logPath = join(dir, snapshots.log);
  if (head !== null) {
    try {
      if (statSync(logPath).size === head.log_bytes) {
        return head.log_entries;
      }
    } catch {
      // Fall through to line counting
    }
  }
  return readFileSync(logPath, "utf8")
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
  const templates = activeRegistry(dir, registry);
  const current = load(dir, templates);
  const basedOn = based_on_version ?? current.version;
  const result = resolveSubmission(current, templates, command, basedOn, (version) =>
    snapshotAtVersion(dir, version, templates),
  );

  const entry: LogEntry = attemptOf(command, basedOn, current.version, result);
  const logPath = join(dir, snapshots.log);
  const eventsPath = join(dir, snapshots.events);

  appendFileSync(logPath, `${canonicalJson(entry)}\n`, "utf8");
  for (const event of result.events) {
    appendFileSync(eventsPath, `${canonicalJson(event)}\n`, "utf8");
  }

  if (result.status === "ok") {
    atomicWrite(join(dir, snapshots.current), canonicalJson(result.snapshot));
  }

  const logStat = statSync(logPath);
  const eventsStat = statSync(eventsPath);
  const head = readHead(dir);
  const logEntries = head !== null ? head.log_entries + 1 : 1;
  const okEntries =
    head !== null ? (result.status === "ok" ? head.ok_entries + 1 : head.ok_entries) : result.status === "ok" ? 1 : 0;
  writeHead(dir, {
    log_bytes: logStat.size,
    events_bytes: eventsStat.size,
    log_entries: logEntries,
    ok_entries: okEntries,
    templates_hash: templatesHash(templates),
  });

  return result;
}

// The stored event list in file order: what submit() appended, one canonical line per event.
export function readEvents(dir: string): WorldEvent[] {
  assertWorldExists(dir);
  const events: WorldEvent[] = [];
  for (const [index, line] of readFileSync(join(dir, snapshots.events), "utf8")
    .split(/\r?\n/)
    .entries()) {
    if (line.length === 0) {
      continue;
    }
    events.push(parseEventLine(line, index + 1));
  }
  return events;
}

function parseEventLine(line: string, lineNumber: number): WorldEvent {
  const value: unknown = JSON.parse(line);
  if (
    !isRecord(value) ||
    typeof value.event_id !== "string" ||
    (value.cause_id !== null && typeof value.cause_id !== "string") ||
    typeof value.command_id !== "string" ||
    !Number.isSafeInteger(value.tick) ||
    typeof value.type !== "string" ||
    typeof value.entity !== "string" ||
    !isRecord(value.data)
  ) {
    throw new TypeError(`Invalid event entry at line ${lineNumber}`);
  }
  return value as unknown as WorldEvent;
}

export interface Fold {
  snapshot: Snapshot;
  events: WorldEvent[];
}

// Install a new set. The head is written last, as everywhere else in this file, so any interruption
// leaves it naming the hash the snapshots still carry and load() can settle the rest; the log, the
// event file, and every version are untouched, because an upgrade changes what the world may spawn,
// never what it has been.
export function writeWorldTemplates(dir: string, registry: TemplateRegistry): void {
  const hash = templatesHash(registry);
  const initial = readSnapshot(join(dir, snapshots.initial));
  const snapshot = readSnapshot(join(dir, snapshots.current));
  atomicWrite(join(dir, snapshots.templates), canonicalJson(registry));
  atomicWrite(join(dir, snapshots.initial), canonicalJson({ ...initial, templates_hash: hash }));
  atomicWrite(join(dir, snapshots.current), canonicalJson({ ...snapshot, templates_hash: hash }));
  writeHead(dir, { ...(readHead(dir) ?? emptyHead()), templates_hash: hash });
}

// Every ok command folded over the initial snapshot. Deliberately without the hash assertion the
// replay path makes: this is what decides whether a set the snapshots have not been stamped with
// yet is a successor to the one they carry. A command the log accepted and this set refuses is a
// WorldError rather than a TypeError, so a caller hears a code and not a crash.
export function replayFold(dir: string, registry: TemplateRegistry): Fold {
  let snapshot = readSnapshot(join(dir, snapshots.initial));
  const events: WorldEvent[] = [];

  for (const [index, entry] of readLogEntries(dir).entries()) {
    if (entry.status !== "ok") {
      continue;
    }
    const result = apply(snapshot, registry, entry.command);
    if (result.status !== "ok") {
      throw new WorldError(
        "replay_diverges",
        `Accepted command failed during replay at line ${index + 1}`,
      );
    }
    events.push(...result.events);
    snapshot = result.snapshot;
  }

  return { snapshot, events };
}

export function replayWithEvents(dir: string, registry?: TemplateRegistry): Fold {
  const templates = activeRegistry(dir, registry);
  assertTemplates(readSnapshot(join(dir, snapshots.initial)), templates);
  return replayFold(dir, templates);
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
  const templates = activeRegistry(dir, registry);
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

// The cause chain for one event or one entity field, folded from the whole log in command
// order; field mode resolves to the last raw delta for that entity and field, or the entity
// spawn event if the field was never explicitly set. A field with no delta and no spawn
// event returns an empty chain (entity existed in the initial snapshot).
export function trace(
  dir: string,
  query: TraceQuery,
  registry?: TemplateRegistry,
): { events: WorldEvent[] } {
  const templates = activeRegistry(dir, registry);
  const current = load(dir, templates);
  const initial = readSnapshot(join(dir, snapshots.initial));
  assertTemplates(current, templates);
  assertTemplates(initial, templates);
  let snapshot = initial;
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
    deltas.push(...result.deltas);
    events.push(...result.events);
    snapshot = result.snapshot;
  }
  if ("entity" in query) {
    const known =
      current.entities[query.entity] !== undefined ||
      deltas.some((delta) => delta.entity === query.entity) ||
      events.some((event) => event.entity === query.entity);
    if (!known) {
      throw new WorldError("no_such_entity", `No such entity ${query.entity}`);
    }
  }
  return { events: traceQuery(events, deltas, query) };
}

// Every ok command after `version`, folded from the log: their deltas and events in command order.
// A command counts when it was applied at `version` or later, so the fold walks the whole log and
// only collects past the cut.
// Every submission decided at `version` or later, in the order it came, ok or not: what was tried
// and how it came out, read straight from the log with no replay.
export function attempts(dir: string, version: number, registry?: TemplateRegistry): Attempt[] {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new WorldError("invalid_version", `Invalid version ${version}`);
  }
  const current = load(dir, activeRegistry(dir, registry));
  if (version > current.version) {
    throw new WorldError("future_version", `Version ${version} is ahead of ${current.version}`);
  }
  return readLogEntries(dir).filter((entry) => entry.version >= version);
}

export function since(
  dir: string,
  version: number,
  registry?: TemplateRegistry,
): { deltas: Delta[]; events: WorldEvent[] } {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new WorldError("invalid_version", `Invalid version ${version}`);
  }
  const templates = activeRegistry(dir, registry);
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
