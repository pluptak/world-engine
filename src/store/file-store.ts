import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
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
import { pause, withLock } from "./lock.js";

// A log line is the attempt itself: every submission, refused and invalid ones included.
type LogEntry = Attempt;

interface Head {
  log_bytes: number;
  events_bytes: number;
  // Absent from a head written before deltas.jsonl existed: the file is then rebuilt, not trusted.
  deltas_bytes?: number;
  log_entries: number;
  ok_entries: number;
  templates_hash: string;
}

const snapshots = {
  current: "snapshot.json",
  initial: "initial.json",
  log: "log.jsonl",
  events: "events.jsonl",
  deltas: "deltas.jsonl",
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
    const { deltas_bytes: deltas, ...rest } = value;
    return (typeof deltas === "number" ? { ...rest, deltas_bytes: deltas } : rest) as unknown as Head;
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
  return checkedSnapshot(JSON.parse(readFileSync(path, "utf8")), path);
}

function checkedSnapshot(value: unknown, path: string): Snapshot {
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

// What load() needs of initial.json on the way in: its version and its hash. The file is written once
// and again only when a template set is settled, and parsing a large one on every submission is the
// cost, so its two fields are kept against the file's size and modification time.
const initialMeta = new Map<string, { stamp: string; version: number; templates_hash: string }>();

function readInitialMeta(path: string): { version: number; templates_hash: string } {
  const stat = statSync(path);
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const kept = initialMeta.get(path);
  if (kept !== undefined && kept.stamp === stamp) {
    return kept;
  }
  const { version, templates_hash } = readSnapshot(path);
  const meta = { stamp, version, templates_hash };
  initialMeta.set(path, meta);
  return meta;
}

function assertTemplates(snapshot: Pick<Snapshot, "templates_hash">, registry: TemplateRegistry): void {
  if (snapshot.templates_hash !== templatesHash(registry)) {
    throw new WorldError("templates_changed", "Template hash mismatch");
  }
}

// The temporary is named for the process, so a writer that does not hold the turn (a world being
// made) cannot rename another's file out from under it.
function atomicWrite(path: string, contents: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, "utf8");
  // Windows will not replace a file another process has open at that instant, and a reader that
  // found the world whole holds no turn, so the replacement is asked for again for a moment.
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(temporary, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 50 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        throw error;
      }
      pause(Math.min(attempt, 10));
    }
  }
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

// Checkpoints are a cache of the log, never a source of truth: every CHECKPOINT_EVERY accepted
// commands `submit` also writes the snapshot it just made as `checkpoints/<version>-<next_seq>.json`,
// bound to the exact bytes of the log that made it (their length, line count and SHA-256), to the
// world's `initial.json` (its SHA-256, since a log means nothing without where it started) and to the
// template set. A read that wants history from some version on starts from the newest checkpoint at
// or before it and replays only the log after it, so its cost no longer grows with the world's age.
// One that does not parse, is for another set, is ahead of the log, or whose bytes are not the log's
// own prefix is ignored, and with none usable the read replays from `initial.json` as it always did.
const CHECKPOINT_EVERY = 256;
const checkpointsDirectory = "checkpoints";
const CHECKPOINT_NAME = /^(\d+)-(\d+)\.json$/;

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeCheckpoint(dir: string, snapshot: Snapshot, logBytes: number): void {
  const log = readFileSync(join(dir, snapshots.log)).subarray(0, logBytes);
  let lines = 0;
  for (const byte of log) {
    lines += byte === 10 ? 1 : 0;
  }
  const folder = join(dir, checkpointsDirectory);
  mkdirSync(folder, { recursive: true });
  atomicWrite(
    join(folder, `${snapshot.version}-${snapshot.next_seq}.json`),
    canonicalJson({
      version: snapshot.version,
      templates_hash: snapshot.templates_hash,
      log_bytes: log.length,
      log_lines: lines,
      log_sha256: digest(log),
      initial_sha256: digest(readFileSync(join(dir, snapshots.initial))),
      snapshot,
    }),
  );
}

function dropCheckpoints(dir: string): void {
  rmSync(join(dir, checkpointsDirectory), { recursive: true, force: true });
}

interface Checkpoint {
  snapshot: Snapshot;
  log_bytes: number;
  log_lines: number;
}

function readCheckpoint(
  path: string,
  version: number,
  nextSeq: number,
  hash: string,
  log: Buffer,
  initialDigest: string,
): Checkpoint | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      !isRecord(value) ||
      value.version !== version ||
      value.templates_hash !== hash ||
      !Number.isSafeInteger(value.log_bytes) ||
      !Number.isSafeInteger(value.log_lines) ||
      typeof value.log_sha256 !== "string" ||
      value.initial_sha256 !== initialDigest
    ) {
      return null;
    }
    const bytes = value.log_bytes as number;
    const prefix = log.subarray(0, bytes);
    if (bytes < 0 || bytes > log.length || (bytes > 0 && log[bytes - 1] !== 10) || digest(prefix) !== value.log_sha256) {
      return null;
    }
    const snapshot = checkedSnapshot(value.snapshot, path);
    if (snapshot.version !== version || snapshot.next_seq !== nextSeq || snapshot.templates_hash !== hash) {
      return null;
    }
    return { snapshot, log_bytes: bytes, log_lines: value.log_lines as number };
  } catch {
    return null;
  }
}

// Where a replay begins: a snapshot and the log entries after it (each with its line number), and
// whether that snapshot is `initial.json` itself.
interface ReplayStart {
  snapshot: Snapshot;
  entries: Array<{ entry: LogEntry; line: number }>;
  fromInitial: boolean;
}

function initialStart(dir: string, templates: TemplateRegistry): ReplayStart {
  const snapshot = readSnapshot(join(dir, snapshots.initial));
  assertTemplates(snapshot, templates);
  return {
    snapshot,
    entries: readLogEntries(dir).map((entry, index) => ({ entry, line: index + 1 })),
    fromInitial: true,
  };
}

// The newest checkpoint the caller can use (`accept` sees its version and `next_seq`, both in its
// name, so nothing is parsed to choose), or `initial.json` when none is usable.
function replayStart(
  dir: string,
  templates: TemplateRegistry,
  accept: (version: number, nextSeq: number) => boolean,
): ReplayStart {
  let names: string[];
  try {
    names = readdirSync(join(dir, checkpointsDirectory));
  } catch {
    return initialStart(dir, templates);
  }
  const candidates = names
    .flatMap((name) => {
      const found = CHECKPOINT_NAME.exec(name);
      return found === null ? [] : [{ name, version: Number(found[1]), next: Number(found[2]) }];
    })
    .filter((candidate) => accept(candidate.version, candidate.next))
    .sort((left, right) => right.version - left.version);
  if (candidates.length === 0) {
    return initialStart(dir, templates);
  }
  const log = readFileSync(join(dir, snapshots.log));
  const hash = templatesHash(templates);
  const initialDigest = digest(readFileSync(join(dir, snapshots.initial)));
  for (const candidate of candidates) {
    const checkpoint = readCheckpoint(
      join(dir, checkpointsDirectory, candidate.name),
      candidate.version,
      candidate.next,
      hash,
      log,
      initialDigest,
    );
    if (checkpoint === null) {
      continue;
    }
    const entries: ReplayStart["entries"] = [];
    const lines = log.subarray(checkpoint.log_bytes).toString("utf8").split(/\r?\n/);
    for (const text of lines) {
      if (text.length > 0) {
        const line = checkpoint.log_lines + entries.length + 1;
        entries.push({ entry: parseLogLine(text, line), line });
      }
    }
    return { snapshot: checkpoint.snapshot, entries, fromInitial: false };
  }
  return initialStart(dir, templates);
}

// events.jsonl and deltas.jsonl only grow, so what a handle has parsed of one is kept, with the bytes
// before its end (an anchor) to notice a file that was rewritten rather than extended. A change in
// size or time reads just the new lines; anything else reads the file again.
const ANCHOR_BYTES = 256;
interface LineCache {
  size: number;
  mtimeMs: number;
  anchor: Buffer;
  lines: number;
  records: unknown[];
}
const lineCaches = new Map<string, LineCache>();

function parseLines<T>(text: string, firstLine: number, parse: (line: string, lineNumber: number) => T): T[] {
  const records: T[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.length > 0) {
      records.push(parse(line, firstLine + index));
    }
  }
  return records;
}

function cachedEvents(dir: string): readonly WorldEvent[] {
  return cachedLines(join(dir, snapshots.events), parseEventLine);
}

function cachedDeltas(dir: string): readonly Delta[] {
  return cachedLines(join(dir, snapshots.deltas), parseDeltaLine);
}

function cachedLines<T>(path: string, parse: (line: string, lineNumber: number) => T): readonly T[] {
  const stat = statSync(path);
  const kept = lineCaches.get(path);
  if (kept !== undefined && kept.size === stat.size && kept.mtimeMs === stat.mtimeMs) {
    return kept.records as T[];
  }
  // A file that only grew is read from the anchor on; anything else, whole.
  let base: LineCache | undefined;
  let tail: Buffer | undefined;
  if (kept !== undefined && stat.size > kept.size) {
    const from = Math.max(0, kept.size - ANCHOR_BYTES);
    const bytes = Buffer.alloc(stat.size - from);
    const fd = openSync(path, "r");
    try {
      readSync(fd, bytes, 0, bytes.length, from);
    } finally {
      closeSync(fd);
    }
    if (bytes.subarray(0, kept.size - from).equals(kept.anchor)) {
      base = kept;
      tail = bytes.subarray(kept.size - from);
    }
  }
  tail ??= readFileSync(path);
  const fresh = parseLines(tail.toString("utf8"), (base?.lines ?? 0) + 1, parse);
  const records = base === undefined ? fresh : [...(base.records as T[]), ...fresh];
  // A file that does not end on a line is being written, or damaged: answer from it, keep nothing.
  if (tail.length > 0 && tail[tail.length - 1] !== 10) {
    lineCaches.delete(path);
    return records;
  }
  const seen = base === undefined ? tail : Buffer.concat([base.anchor, tail]);
  lineCaches.set(path, {
    size: (base?.size ?? 0) + tail.length,
    mtimeMs: stat.mtimeMs,
    anchor: Buffer.from(seen.subarray(Math.max(0, seen.length - ANCHOR_BYTES))),
    lines: records.length,
    records,
  });
  return records;
}

function snapshotAtVersion(
  dir: string,
  version: number,
  registry: TemplateRegistry,
): Snapshot | null {
  const start = replayStart(dir, registry, (candidate) => candidate <= version);
  let snapshot = start.snapshot;
  if (snapshot.version > version) {
    return null;
  }

  for (const { entry, line } of start.entries) {
    if (snapshot.version === version) {
      return snapshot;
    }
    if (entry.status !== "ok") {
      continue;
    }
    const result = apply(snapshot, registry, entry.command);
    if (result.status !== "ok") {
      throw new TypeError(`Accepted command failed during replay at line ${line}`);
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
  writeFileSync(join(dir, snapshots.deltas), "", "utf8");
  writeHead(dir, {
    log_bytes: 0,
    events_bytes: 0,
    deltas_bytes: 0,
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

// Run `body` as the one writer of the world at `dir`: other processes' writers wait their turn, and
// one that waits past `WORLD_LOCK_TIMEOUT_MS` fails `store_busy`. Re-entrant. Reads that find the
// files agreeing take no turn (load()); a caller that decides from the world and then writes, as
// `edit` does with the next default id, takes it around both.
export function withWorldLock<T>(dir: string, body: () => T): T {
  // Only enough to keep a lock out of a directory that is no world: the body's own load() checks
  // the rest, and a full check here would be paid twice by every submission.
  if (!existsSync(join(dir, snapshots.format))) {
    assertWorldExists(dir);
  }
  return withLock(dir, body);
}

// The snapshot, if the files agree on it without a rebuild: the head names this template set, the
// three JSONL files are the sizes it says, and the snapshot is at the version its accepted entries
// make. Otherwise null, and the caller settles it under the turn. A writer mid-command always
// disagrees (it appends the log before the head), so a read that overlaps one lands there and waits.
function trustedSnapshot(dir: string, templates: TemplateRegistry): Snapshot | null {
  const snapshot = readSnapshot(join(dir, snapshots.current));
  const initial = readInitialMeta(join(dir, snapshots.initial));
  const head = readHead(dir);
  if (head === null || head.templates_hash !== templatesHash(templates)) {
    return null;
  }
  assertTemplates(snapshot, templates);
  assertTemplates(initial, templates);
  try {
    if (
      statSync(join(dir, snapshots.log)).size === head.log_bytes &&
      statSync(join(dir, snapshots.events)).size === head.events_bytes &&
      statSync(join(dir, snapshots.deltas)).size === head.deltas_bytes &&
      snapshot.version === initial.version + head.ok_entries
    ) {
      return snapshot;
    }
  } catch {
    // Fall through to the full check
  }
  return null;
}

// `setIsTheWorlds` says the registry came from the world's own templates.json rather than from a
// caller, which is what lets load() settle a moved set instead of refusing it: only the world's own
// file may take the world over.
export function load(dir: string, registry?: TemplateRegistry, setIsTheWorlds = false): Snapshot {
  assertWorldExists(dir);
  const templates = activeRegistry(dir, registry);
  const trusted = trustedSnapshot(dir, templates);
  if (trusted !== null) {
    return trusted;
  }
  // Anything below rewrites files, so only the one writer may do it, and it looks again first: the
  // writer it waited for may have left the world whole.
  return withLock(dir, () => settle(dir, templates, setIsTheWorlds));
}

function settle(dir: string, templates: TemplateRegistry, setIsTheWorlds: boolean): Snapshot {
  const trusted = trustedSnapshot(dir, templates);
  if (trusted !== null) {
    return trusted;
  }
  const snapshot = readSnapshot(join(dir, snapshots.current));
  const initialPath = join(dir, snapshots.initial);
  const initial = readInitialMeta(initialPath);

  const head = readHead(dir);
  const logPath = join(dir, snapshots.log);
  const eventsPath = join(dir, snapshots.events);
  const deltasPath = join(dir, snapshots.deltas);
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
      canonicalJson(folded.events) !== canonicalJson(readEvents(dir)) ||
      (head.deltas_bytes !== undefined &&
        existsSync(join(dir, snapshots.deltas)) &&
        canonicalJson(folded.deltas) !== canonicalJson(readDeltas(dir)))
    ) {
      throw new WorldError("templates_changed", "Template hash mismatch");
    }
    dropCheckpoints(dir);
    atomicWrite(initialPath, canonicalJson({ ...readSnapshot(initialPath), templates_hash: frozenHash }));
    atomicWrite(join(dir, snapshots.current), canonicalJson({ ...snapshot, templates_hash: frozenHash }));
    writeHead(dir, { ...head, templates_hash: frozenHash });
    return load(dir);
  }

  assertTemplates(snapshot, templates);
  assertTemplates(initial, templates);

  // A crash between the log, event, delta, and snapshot appends leaves them disagreeing; the log is
  // the source of truth, so replay rebuilds the files, events and deltas first, and any later open
  // finds them consistent again.
  const entries = readLogEntries(dir);
  const okEntries = entries.filter((entry) => entry.status === "ok");
  const expectedVersion = initial.version + okEntries.length;
  if (snapshot.version !== expectedVersion) {
    const { snapshot: recovered, events, deltas } = replayWithEvents(dir, templates);
    atomicWrite(eventsPath, events.map((event) => `${canonicalJson(event)}\n`).join(""));
    atomicWrite(deltasPath, deltaLines(deltas));
    atomicWrite(join(dir, snapshots.current), canonicalJson(recovered));
    writeHead(dir, {
      log_bytes: statSync(logPath).size,
      events_bytes: statSync(eventsPath).size,
      deltas_bytes: statSync(deltasPath).size,
      log_entries: entries.length,
      ok_entries: okEntries.length,
      templates_hash: frozenHash,
    });
    return recovered;
  }
  // The deltas are appended after the events and before the snapshot, so with the snapshot at the
  // log's version they are whole unless the file is missing, was never kept (a head with no size for
  // it: a world made before the file existed, or a lost head), or is shorter than the head says it
  // was, which no crash can do. Then they are rebuilt from the log.
  if (
    head === null ||
    head.deltas_bytes === undefined ||
    !existsSync(deltasPath) ||
    statSync(deltasPath).size < head.deltas_bytes
  ) {
    atomicWrite(deltasPath, deltaLines(replayWithEvents(dir, templates).deltas));
  }
  writeHead(dir, {
    log_bytes: statSync(logPath).size,
    events_bytes: statSync(eventsPath).size,
    deltas_bytes: statSync(deltasPath).size,
    log_entries: entries.length,
    ok_entries: okEntries.length,
    templates_hash: frozenHash,
  });
  return snapshot;
}

function deltaLines(deltas: readonly Delta[]): string {
  return deltas.map((delta) => `${canonicalJson(delta)}\n`).join("");
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
  return withWorldLock(dir, () => submitLocked(dir, command, based_on_version, registry));
}

function submitLocked(
  dir: string,
  command: Command,
  based_on_version: number | undefined,
  registry: TemplateRegistry | undefined,
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
  const deltasPath = join(dir, snapshots.deltas);

  appendFileSync(logPath, `${canonicalJson(entry)}\n`, "utf8");
  for (const event of result.events) {
    appendFileSync(eventsPath, `${canonicalJson(event)}\n`, "utf8");
  }
  // Only an accepted command's deltas are history; load() trusts the file once the snapshot below
  // has been written after it.
  if (result.status === "ok" && result.deltas.length > 0) {
    appendFileSync(deltasPath, deltaLines(result.deltas), "utf8");
  }

  if (result.status === "ok") {
    atomicWrite(join(dir, snapshots.current), canonicalJson(result.snapshot));
  }

  const logStat = statSync(logPath);
  const eventsStat = statSync(eventsPath);
  const deltasStat = statSync(deltasPath);
  const head = readHead(dir);
  const logEntries = head !== null ? head.log_entries + 1 : 1;
  const okEntries =
    head !== null ? (result.status === "ok" ? head.ok_entries + 1 : head.ok_entries) : result.status === "ok" ? 1 : 0;
  writeHead(dir, {
    log_bytes: logStat.size,
    events_bytes: eventsStat.size,
    deltas_bytes: deltasStat.size,
    log_entries: logEntries,
    ok_entries: okEntries,
    templates_hash: templatesHash(templates),
  });
  // The cache is written last and may fail without costing the command anything.
  if (result.status === "ok" && result.snapshot.version % CHECKPOINT_EVERY === 0) {
    try {
      writeCheckpoint(dir, result.snapshot, logStat.size);
    } catch {
      // A missing checkpoint only means a longer replay.
    }
  }

  return result;
}

// The stored event list in file order: what submit() appended, one canonical line per event.
export function readEvents(dir: string): WorldEvent[] {
  assertWorldExists(dir);
  // A copy of the list the handle keeps; the events in it are shared and never written to.
  return [...cachedEvents(dir)];
}

// The stored deltas in file order: every accepted command's, one canonical line each.
export function readDeltas(dir: string): Delta[] {
  assertWorldExists(dir);
  // A copy of the list the handle keeps, as readEvents does.
  return [...cachedDeltas(dir)];
}

function parseDeltaLine(line: string, lineNumber: number): Delta {
  const value: unknown = JSON.parse(line);
  if (
    !isRecord(value) ||
    typeof value.event_id !== "string" ||
    typeof value.entity !== "string" ||
    typeof value.field !== "string"
  ) {
    throw new TypeError(`Invalid delta entry at line ${lineNumber}`);
  }
  return value as unknown as Delta;
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
  deltas: Delta[];
  snapshot: Snapshot;
  events: WorldEvent[];
}

// Install a new set. The head is written last, as everywhere else in this file, so any interruption
// leaves it naming the hash the snapshots still carry and load() can settle the rest; the log, the
// event file, and every version are untouched, because an upgrade changes what the world may spawn,
// never what it has been.
export function writeWorldTemplates(dir: string, registry: TemplateRegistry): void {
  withWorldLock(dir, () => {
    const hash = templatesHash(registry);
    const initial = readSnapshot(join(dir, snapshots.initial));
    const snapshot = readSnapshot(join(dir, snapshots.current));
    dropCheckpoints(dir);
    atomicWrite(join(dir, snapshots.templates), canonicalJson(registry));
    atomicWrite(join(dir, snapshots.initial), canonicalJson({ ...initial, templates_hash: hash }));
    atomicWrite(join(dir, snapshots.current), canonicalJson({ ...snapshot, templates_hash: hash }));
    writeHead(dir, { ...(readHead(dir) ?? emptyHead()), templates_hash: hash });
  });
}

// Every ok command folded over the initial snapshot. Deliberately without the hash assertion the
// replay path makes: this is what decides whether a set the snapshots have not been stamped with
// yet is a successor to the one they carry. A command the log accepted and this set refuses is a
// WorldError rather than a TypeError, so a caller hears a code and not a crash.
export function replayFold(dir: string, registry: TemplateRegistry): Fold {
  let snapshot = readSnapshot(join(dir, snapshots.initial));
  const events: WorldEvent[] = [];
  const deltas: Delta[] = [];

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
    deltas.push(...result.deltas);
    snapshot = result.snapshot;
  }

  return { snapshot, events, deltas };
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
  // Event ids number the same counter the snapshot's `next_seq` does, so a checkpoint whose
  // `next_seq` is at or below the event's number was made before the command that wrote it.
  const number = /^ev(\d+)$/.exec(eventId);
  const start =
    number === null
      ? initialStart(dir, templates)
      : replayStart(dir, templates, (_, next) => next <= Number(number[1]));
  let snapshot = start.snapshot;
  const events: WorldEvent[] = [];

  for (const { entry, line } of start.entries) {
    if (entry.status !== "ok") {
      continue;
    }
    const before = snapshot;
    const result = apply(snapshot, templates, entry.command);
    if (result.status !== "ok") {
      throw new TypeError(`Accepted command failed during replay at line ${line}`);
    }
    events.push(...result.events);
    snapshot = result.snapshot;
    if (result.events.some((event) => event.event_id === eventId)) {
      return { before, snapshot, events: start.fromInitial ? events : eventsThrough(dir, eventId) ?? events };
    }
  }

  return null;
}

// Every event up to the end of the command that wrote this one, from the events file: what a replay
// from the start would have collected, without replaying. Null when the file does not hold it.
function eventsThrough(dir: string, eventId: Id): WorldEvent[] | null {
  const stored = cachedEvents(dir);
  const at = stored.findIndex((event) => event.event_id === eventId);
  if (at < 0) {
    return null;
  }
  let end = at;
  while (end + 1 < stored.length && stored[end + 1]!.command_id === stored[at]!.command_id) {
    end += 1;
  }
  return stored.slice(0, end + 1);
}

// The cause chain for one event or one entity field, read from the stored events and deltas in
// command order, which are what replaying the log would collect; field mode resolves to the last raw
// delta for that entity and field, or the entity spawn event if the field was never explicitly set.
// A field with no delta and no spawn event returns an empty chain (entity existed in the initial
// snapshot).
export function trace(
  dir: string,
  query: TraceQuery,
  registry?: TemplateRegistry,
): { events: WorldEvent[] } {
  const templates = activeRegistry(dir, registry);
  const current = load(dir, templates);
  const initial = readInitialMeta(join(dir, snapshots.initial));
  assertTemplates(current, templates);
  assertTemplates(initial, templates);
  const events = cachedEvents(dir);
  if ("event_id" in query) {
    return { events: traceQuery(events, [], query) };
  }
  const deltas = cachedDeltas(dir);
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

  const start = replayStart(dir, templates, (candidate) => candidate <= version);
  let snapshot = start.snapshot;
  const deltas: Delta[] = [];
  const events: WorldEvent[] = [];
  for (const { entry, line } of start.entries) {
    if (entry.status !== "ok") {
      continue;
    }
    const result = apply(snapshot, templates, entry.command);
    if (result.status !== "ok") {
      throw new TypeError(`Accepted command failed during replay at line ${line}`);
    }
    if (snapshot.version >= version) {
      deltas.push(...result.deltas);
      events.push(...result.events);
    }
    snapshot = result.snapshot;
  }

  return { deltas, events };
}
