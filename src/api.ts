import { fileURLToPath } from "node:url";
import { canonicalJson } from "./engine/canonical.js";
import {
  WORLD_AUTHOR,
  type Command,
  type Result,
  type WorldEdit,
} from "./engine/command.js";
import { query as queryEngine, type Answer, type Query } from "./engine/query.js";
import { verbCatalog } from "./engine/verbs/index.js";
import { spawn, type EntityOverrides } from "./engine/spawn.js";
import { validateSnapshot } from "./engine/validate.js";
import { WorldError } from "./errors.js";
import { defaultCoverage, type Delta, type Entity, type Id, type Snapshot, type Status, type WorldEvent } from "./model.js";
import {
  create,
  entryCount,
  load,
  replayWithEvents,
  resolveSubmission,
  since as foldSince,
  submit,
} from "./store/file-store.js";
import { loadTemplates, templatesHash, type TemplateRegistry } from "./templates.js";

const templatesDirectory = fileURLToPath(new URL("../templates/", import.meta.url));

export interface ScenarioEntry {
  template: string;
  overrides?: EntityOverrides;
}

export type Scenario = readonly ScenarioEntry[];

export interface CommandOptions {
  basedOn?: number;
}

export interface EditOptions {
  command_id?: Id;
  basedOn?: number;
}

// What a dry run reports: the verdict a command would get now, without state or a log line.
export interface CheckResult {
  status: Status;
  command_id: Id;
  resolved_target: Id | null;
  candidates?: Id[];
  reason_code?: string;
}

export interface SinceResult {
  deltas: Delta[];
  events: WorldEvent[];
}

export interface World {
  command(command: Command, options?: CommandOptions): Result;
  edit(edit: WorldEdit, options?: EditOptions): Result;
  check(command: Command): CheckResult;
  since(version: number): SinceResult;
  query(query: Query): Answer;
  snapshot(): Snapshot;
  entity(id: Id): Entity | null;
}

function checkResult(result: Result): CheckResult {
  return {
    status: result.status,
    command_id: result.command_id,
    resolved_target: result.resolved_target,
    ...(result.candidates !== undefined && { candidates: result.candidates }),
    ...(result.reason_code !== undefined && { reason_code: result.reason_code }),
  };
}

// The version rule with the same gate as a real submission, but never a write and never a log line:
// based on the current version, so nothing here can be preempted.
function dryRun(current: Snapshot, registry: TemplateRegistry, command: Command): Result {
  return resolveSubmission(current, registry, command, current.version, () => null);
}

function activeRegistry(registry?: TemplateRegistry): TemplateRegistry {
  return registry ?? loadTemplates(templatesDirectory);
}

// Every edit is a command by the reserved author, so it is logged and replayed like one; the
// caller names the edit, the world names the command only when the caller does not.
function editCommand(edit: WorldEdit, commandId: Id): Command {
  const command: Command = {
    command_id: commandId,
    actor: WORLD_AUTHOR,
    verb: "edit",
    args: { edit },
  };
  if ("target" in edit) {
    command.target = edit.target;
  }
  return command;
}

function initialSnapshot(registry: TemplateRegistry): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: defaultCoverage(),
    entities: {},
  };
}

// Every read goes to the store, so two handles on one directory see each other's commands.
function storeWorld(dir: string, registry: TemplateRegistry): World {
  // A world that opens is a world whose snapshot holds together.
  const opened = load(dir, registry);
  assertValid(opened, registry);

  return {
    command: (command, options) => submit(dir, command, options?.basedOn, registry),
    edit: (edit, options) => {
      // The count of logged submissions names the next edit: every submission appends exactly one
      // line, so the id follows the world rather than the handle, and the same sequence of calls
      // writes the same log through any number of handles.
      const prior = entryCount(dir);
      return submit(
        dir,
        editCommand(edit, options?.command_id ?? `edit-${prior + 1}`),
        options?.basedOn,
        registry,
      );
    },
    check: (command) => checkResult(dryRun(load(dir, registry), registry, command)),
    since: (version) => foldSince(dir, version, registry),
    query: (request) => {
      const snapshot = load(dir, registry);
      return queryEngine(snapshot, registry, replayWithEvents(dir, registry).events, request);
    },
    snapshot: () => load(dir, registry),
    entity: (id) => load(dir, registry).entities[id] ?? null,
  };
}

function assertValid(snapshot: Snapshot, registry: TemplateRegistry): void {
  const issues = validateSnapshot(snapshot, registry);
  if (issues.length > 0) {
    const [first] = issues;
    throw new WorldError(
      "invalid_snapshot",
      `Snapshot violates ${first?.code ?? "an invariant"} (${issues.length} issue(s))`,
      issues,
    );
  }
}

export function createWorld(
  dir: string,
  scenario: Scenario,
  registry?: TemplateRegistry,
): World {
  const templates = activeRegistry(registry);
  let snapshot = initialSnapshot(templates);
  for (const entry of scenario) {
    snapshot = spawn(snapshot, templates, entry.template, entry.overrides).snapshot;
  }
  assertValid(snapshot, templates);
  create(dir, snapshot, templates);
  return storeWorld(dir, templates);
}

export function openWorld(dir: string, registry?: TemplateRegistry): World {
  const templates = activeRegistry(registry);
  return storeWorld(dir, templates);
}

// No directory, no log: what the caller hands in is the whole world, and its events are the ones its
// own commands produced.
export function memoryWorld(snapshot: Snapshot, registry?: TemplateRegistry): World {
  const templates = activeRegistry(registry);
  if (snapshot.templates_hash !== templatesHash(templates)) {
    throw new WorldError("templates_changed", "Template hash mismatch");
  }
  assertValid(snapshot, templates);

  let current = snapshot;
  const events: WorldEvent[] = [];
  // Snapshots are immutable, so past versions stay around for preemption checks for free.
  const history = new Map<number, Snapshot>([[snapshot.version, snapshot]]);
  // No log, so the count of this world's own submissions stands in for one; commands count like
  // edits, exactly like the store's lines, and the id is read before the count grows.
  let submissions = 0;
  // Each ok submission keeps its deltas and events, so since(version) can answer without a fold.
  const applied: Array<{ base: number; deltas: Delta[]; events: WorldEvent[] }> = [];
  // The version this world started from: anything older predates its records, however valid, so
  // asking below it is an error rather than an empty answer.
  const firstVersion = snapshot.version;

  function submitMemory(command: Command, basedOn: number): Result {
    submissions += 1;
    const base = current.version;
    const result = resolveSubmission(
      current,
      templates,
      command,
      basedOn,
      (version) => history.get(version) ?? null,
    );
    if (result.status === "ok") {
      current = result.snapshot;
      events.push(...result.events);
      applied.push({ base, deltas: result.deltas, events: result.events });
      history.set(current.version, current);
    }
    return result;
  }

  return {
    command: (command, options) => submitMemory(command, options?.basedOn ?? current.version),
    edit: (edit, options) =>
      submitMemory(
        editCommand(edit, options?.command_id ?? `edit-${submissions + 1}`),
        options?.basedOn ?? current.version,
      ),
    check: (command) => checkResult(dryRun(current, templates, command)),
    since: (version) => {
      if (!Number.isSafeInteger(version) || version < 0) {
        throw new WorldError("invalid_version", `Invalid version ${version}`);
      }
      if (version < firstVersion) {
        throw new WorldError("history_unavailable", `No records before version ${firstVersion}`);
      }
      if (version > current.version) {
        throw new WorldError("future_version", `Version ${version} is ahead of ${current.version}`);
      }
      const deltas: Delta[] = [];
      const sinceEvents: WorldEvent[] = [];
      for (const record of applied) {
        if (record.base >= version) {
          deltas.push(...record.deltas);
          sinceEvents.push(...record.events);
        }
      }
      return { deltas, events: sinceEvents };
    },
    query: (request) => queryEngine(current, templates, events, request),
    snapshot: () => current,
    entity: (id) => current.entities[id] ?? null,
  };
}

export { canonicalJson, verbCatalog as verbs, WorldError, WORLD_AUTHOR };
export type { WorldErrorCode } from "./errors.js";
export type { Command, Result, WorldEdit } from "./engine/command.js";
export type { Answer, Query } from "./engine/query.js";
export type {
  Coverage,
  Delta,
  Entity,
  Id,
  Pos,
  Snapshot,
  Status,
  WorldEvent,
} from "./model.js";