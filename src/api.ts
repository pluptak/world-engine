import { fileURLToPath } from "node:url";
import { canonicalJson } from "./engine/canonical.js";
import { WORLD_AUTHOR, type Command, type Result, type WorldEdit } from "./engine/command.js";
import { query as queryEngine, type Answer, type Query } from "./engine/query.js";
import { spawn, type EntityOverrides } from "./engine/spawn.js";
import { validateSnapshot } from "./engine/validate.js";
import { WorldError } from "./errors.js";
import { defaultCoverage, type Entity, type Id, type Snapshot, type WorldEvent } from "./model.js";
import {
  create,
  entryCount,
  load,
  replayWithEvents,
  resolveSubmission,
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

export interface World {
  command(command: Command, options?: CommandOptions): Result;
  edit(edit: WorldEdit, options?: EditOptions): Result;
  query(query: Query): Answer;
  snapshot(): Snapshot;
  entity(id: Id): Entity | null;
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

  function submitMemory(command: Command, basedOn: number): Result {
    submissions += 1;
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
    query: (request) => queryEngine(current, templates, events, request),
    snapshot: () => current,
    entity: (id) => current.entities[id] ?? null,
  };
}

export { canonicalJson, WorldError, WORLD_AUTHOR };
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