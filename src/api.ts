import { fileURLToPath } from "node:url";
import { canonicalJson } from "./engine/canonical.js";
import {
  WORLD_AUTHOR,
  type Command,
  type Result,
  type WorldEdit,
} from "./engine/command.js";
import {
  inspectEntity,
  observeEntities,
  SENSES,
  type Inspection,
  type ObservedEvent,
  type Projection,
} from "./engine/projection.js";
import { query as queryEngine, queryAtEvent, type Answer, type Query } from "./engine/query.js";
import { traceQuery, VALID_ENTITY_FIELDS, type TraceQuery } from "./engine/trace.js";
import { lostField } from "./engine/upgrade.js";
import { verbCatalog } from "./engine/verbs/index.js";
import { spawn } from "./engine/spawn.js";
import { resolveScenario, type Scenario } from "./scenario.js";
import { validateSnapshot } from "./engine/validate.js";
import { WorldError } from "./errors.js";
import { defaultCoverage, type Coverage, type Delta, type Entity, type Id, type ReasonData, type Snapshot, type Status, type WorldEvent } from "./model.js";
import {
  create,
  entryCount,
  replayFold,
  load,
  readEvents,
  readWorldIds,
  readWorldTemplates,
  replayUntilEvent,
  resolveSubmission,
  since as foldSince,
  submit,
  trace as foldTrace,
  writeWorldTemplates,
} from "./store/file-store.js";
import { loadTemplates, missingCompanions, templatesHash, type TemplateRegistry } from "./templates.js";

const templatesDirectory = fileURLToPath(new URL("../templates/", import.meta.url));

export interface CommandOptions {
  basedOn?: number;
  // `command` only: attach the actor's view after the command, as `observe` would give it with
  // `since` the version the command was applied to, so a controller needs no second call.
  observe?: boolean;
}

export interface EditOptions {
  command_id?: Id;
  basedOn?: number;
  perceivers?: boolean;
}

// What a world's initial snapshot declares over the defaults. Coverage says what the engine can
// answer, so a category left out of `senses` is `unknown` rather than `false` from the first command.
export interface WorldOptions {
  coverage?: Coverage;
}

// What a dry run reports: the verdict a command would get now, without state or a log line.
export interface CheckResult {
  status: Status;
  command_id: Id;
  resolved_target: Id | null;
  candidates?: Id[];
  reason_code?: string;
  reason_data?: ReasonData;
}

export interface SinceResult {
  deltas: Delta[];
  events: WorldEvent[];
}

export interface ObserveOptions {
  since?: number;
}

export interface TraceResult {
  events: WorldEvent[];
}

export interface World {
  command(command: Command, options?: CommandOptions): Result;
  beat(commands: Command[], options?: CommandOptions): Result[];
  edit(edit: WorldEdit, options?: EditOptions): Result;
  check(command: Command): CheckResult;
  since(version: number): SinceResult;
  trace(query: TraceQuery): TraceResult;
  upgradeTemplates(registry?: TemplateRegistry): Snapshot;
  query(query: Query): Answer;
  // What one observer could sense now, and, with `since`, which events after that version it sensed.
  observe(observer: Id, options?: ObserveOptions): Projection;
  // One entity in detail, as the observer could sense it now; null when nothing of it is sensed.
  inspect(observer: Id, entity: Id): Inspection | null;
  snapshot(): Snapshot;
  entity(id: Id): Entity | null;
  // The id a scenario gave this world, or null. Names are authoring sugar rather than world state,
  // so a store world keeps them in ids.json and a memory world is handed them.
  id(name: string): Id | null;
}

function checkResult(result: Result): CheckResult {
  return {
    status: result.status,
    command_id: result.command_id,
    resolved_target: result.resolved_target,
    ...(result.candidates !== undefined && { candidates: result.candidates }),
    ...(result.reason_code !== undefined && { reason_code: result.reason_code }),
    ...(result.reason_data !== undefined && { reason_data: result.reason_data }),
  };
}

// The command's result with the actor's view attached when the caller asked for it. An ok command
// moved the world one version, so its own events are exactly those after the version before it.
function withObservation(
  world: Pick<World, "snapshot" | "since" | "query">,
  registry: TemplateRegistry,
  actor: Id,
  result: Result,
  options: CommandOptions | undefined,
): Result {
  if (options?.observe !== true || world.snapshot().entities[actor] === undefined) {
    return result;
  }
  const since = result.status === "ok" ? result.snapshot.version - 1 : world.snapshot().version;
  return { ...result, observation: observeThrough(world, registry, actor, { since }) };
}

function inspectThrough(
  world: Pick<World, "snapshot">,
  registry: TemplateRegistry,
  observer: Id,
  entity: Id,
): Inspection | null {
  const snapshot = world.snapshot();
  if (snapshot.entities[observer] === undefined) {
    throw new WorldError("no_such_entity", `Unknown observer ${observer}`);
  }
  return inspectEntity(snapshot, registry, [], observer, entity);
}

// A projection read through a world's own methods, so a store world and a memory world project
// alike: the entities from the current snapshot, each event through event-form perceive.
function observeThrough(
  world: Pick<World, "snapshot" | "since" | "query">,
  registry: TemplateRegistry,
  observer: Id,
  options: ObserveOptions,
): Projection {
  const snapshot = world.snapshot();
  if (snapshot.entities[observer] === undefined) {
    throw new WorldError("no_such_entity", `Unknown observer ${observer}`);
  }
  const covered = SENSES.filter((sense) => snapshot.coverage.senses.includes(sense));
  const events: ObservedEvent[] =
    options.since === undefined
      ? []
      : world.since(options.since).events.flatMap((event) => {
          const senses = covered.filter(
            (sense) =>
              world.query({ kind: "perceive", observer, event_id: event.event_id, sense }).value ===
              "true",
          );
          return senses.length === 0
            ? []
            : [{ event_id: event.event_id, type: event.type, entity: event.entity, senses }];
        });
  return {
    observer,
    version: snapshot.version,
    unknown_senses: SENSES.filter((sense) => !covered.includes(sense)),
    entities: observeEntities(snapshot, registry, [], observer),
    events,
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
function editCommand(edit: WorldEdit, commandId: Id, perceivers?: boolean): Command {
  const command: Command = {
    command_id: commandId,
    actor: WORLD_AUTHOR,
    verb: "edit",
    args: { edit },
  };
  if ("target" in edit) {
    command.target = edit.target;
  }
  if (perceivers === true) {
    command.perceivers = true;
  }
  return command;
}

function isCategoryList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((name) => typeof name === "string");
}

// The snapshot's own shape for the one field no engine rule reads: an unreadable coverage answers
// nothing sensibly, so it is a caller's mistake rather than a world that cannot be built. It returns
// the coverage, so a caller writes `coverage: assertCoverage(coverage)`.
function assertCoverage(coverage: Coverage): Coverage {
  for (const name of ["relations", "senses", "properties"] as const) {
    if (!isCategoryList(coverage[name])) {
      throw new TypeError(`Coverage ${name} is not a list of names`);
    }
  }
  return coverage;
}

function initialSnapshot(registry: TemplateRegistry, coverage?: Coverage): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: coverage === undefined ? defaultCoverage() : assertCoverage(coverage),
    entities: {},
  };
}

// Every read goes to the store, so two handles on one directory see each other's commands.
function storeWorld(
  dir: string,
  registry: TemplateRegistry,
  names: Readonly<Record<string, Id>> = {},
): World {
  // A world that opens is a world whose snapshot holds together. The set came from the world's own
  // file, which is what tells load() it may settle a moved set rather than refuse it.
  const opened = load(dir, registry, true);
  assertValid(opened, registry);
  // The set this handle was opened with. An upgrade replaces it here; another handle keeps the old
  // one and refuses to write, which is the only honest thing it can do with a set the world has
  // left behind.
  let active = registry;

  const world: World = {
    command: (command, options) =>
      withObservation(world, active, command.actor, submit(dir, command, options?.basedOn, active), options),
    // One shared base version for the whole beat, so later commands see earlier ones as stale;
    // one log line per command, each with its own status.
    beat: (commands, options) => {
      const base = options?.basedOn ?? load(dir, active).version;
      return commands.map((command) => submit(dir, command, base, active));
    },
    edit: (edit, options) => {
      // The count of logged submissions names the next edit: every submission appends exactly one
      // line, so the id follows the world rather than the handle, and the same sequence of calls
      // writes the same log through any number of handles.
      const prior = entryCount(dir);
      return submit(
        dir,
        editCommand(edit, options?.command_id ?? `edit-${prior + 1}`, options?.perceivers),
        options?.basedOn,
        active,
      );
    },
    check: (command) => checkResult(dryRun(load(dir, active), active, command)),
    since: (version) => foldSince(dir, version, active),
    trace: (query) => foldTrace(dir, query, active),
    upgradeTemplates: (next) => {
      const target = next ?? loadTemplates(templatesDirectory);
      const missing = missingCompanions(target);
      if (missing.length > 0) {
        const [first] = missing;
        throw new WorldError("invalid_templates", `Missing detached part template ${first}`);
      }
      const current = load(dir, active);
      const lost = lostField(current, target);
      if (lost !== null) {
        throw new WorldError(
          "templates_lost_field",
          `Entity ${lost.entity} (${lost.template}) uses ${lost.field}`,
        );
      }
      // The log was produced under the old set, so a set that folds it to anything else would
      // leave a world whose history no longer reproduces its own snapshot.
      const replayed = replayFold(dir, target);
      if (
        canonicalJson(replayed.snapshot) !== canonicalJson(current) ||
        canonicalJson(replayed.events) !== canonicalJson(readEvents(dir))
      ) {
        throw new WorldError(
          "replay_diverges",
          `History replays to version ${replayed.snapshot.version}, not ${current.version}`,
        );
      }
      writeWorldTemplates(dir, target);
      active = target;
      return load(dir, active);
    },
    query: (request) => {
      // An event-form perceive reads the world at either end of that event's command: perceptible
      // if perceptible before or after it. The entity form and unknown events read the present.
      if (request.kind === "perceive" && request.event_id !== undefined) {
        const atEvent = replayUntilEvent(dir, request.event_id, active);
        if (atEvent !== null) {
          return queryAtEvent(atEvent.before, atEvent.snapshot, active, atEvent.events, request);
        }
      }
      const snapshot = load(dir, active);
      return queryEngine(snapshot, active, readEvents(dir), request);
    },
    observe: (observer, options = {}) => observeThrough(world, active, observer, options),
    inspect: (observer, entity) => inspectThrough(world, active, observer, entity),
    snapshot: () => load(dir, active),
    entity: (id) => load(dir, active).entities[id] ?? null,
    id: (name) => names[name] ?? null,
  };
  return world;
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
  options?: WorldOptions,
): World {
  const templates = activeRegistry(registry);
  const initial = initialSnapshot(templates, options?.coverage);
  // Names resolve before the first spawn, so a bad name is refused before anything is written.
  const resolved = resolveScenario(scenario, initial.next_seq);
  let snapshot = initial;
  for (const entry of resolved.scenario) {
    snapshot = spawn(snapshot, templates, entry.template, entry.overrides).snapshot;
  }
  assertValid(snapshot, templates);
  create(dir, snapshot, templates, resolved.ids);
  return storeWorld(dir, templates, resolved.ids);
}

export function openWorld(dir: string): World {
  return storeWorld(dir, readWorldTemplates(dir), readWorldIds(dir));
}

// No directory, no log: what the caller hands in is the whole world, and its events are the ones its
// own commands produced.
export function memoryWorld(
  snapshot: Snapshot,
  registry?: TemplateRegistry,
  names: Readonly<Record<string, Id>> = {},
  options?: WorldOptions,
): World {
  let templates = activeRegistry(registry);
  // What the caller handed in is the whole world, so a coverage option says the same thing about a
  // snapshot it came from: this memory world's initial snapshot declares that instead.
  const initial =
    options?.coverage === undefined
      ? snapshot
      : { ...snapshot, coverage: assertCoverage(options.coverage) };
  if (initial.templates_hash !== templatesHash(templates)) {
    throw new WorldError("templates_changed", "Template hash mismatch");
  }
  assertValid(initial, templates);

  let current = initial;
  const events: WorldEvent[] = [];
  // Snapshots are immutable, so past versions stay around for preemption checks for free.
  const history = new Map<number, Snapshot>([[initial.version, initial]]);
  // No log, so the count of this world's own submissions stands in for one; commands count like
  // edits, exactly like the store's lines, and the id is read before the count grows.
  let submissions = 0;
  // Each ok submission keeps its deltas and events, so since(version) can answer without a fold.
  const applied: Array<{ base: number; deltas: Delta[]; events: WorldEvent[] }> = [];
  // The version this world started from: anything older predates its records, however valid, so
  // asking below it is an error rather than an empty answer.
  const firstVersion = initial.version;

  // The snapshots before and after the command that produced an event: event-form perceive
  // evaluates against both via queryAtEvent, while the entity form keeps the current snapshot.
  function snapshotAtEvent(
    eventId: Id,
  ): { before: Snapshot; snapshot: Snapshot; events: WorldEvent[] } | null {
    const collected: WorldEvent[] = [];
    for (const record of applied) {
      collected.push(...record.events);
      if (record.events.some((event) => event.event_id === eventId)) {
        const before = history.get(record.base);
        const after = history.get(record.base + 1);
        return before === undefined || after === undefined
          ? null
          : { before, snapshot: after, events: collected };
      }
    }
    return null;
  }

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

  const world: World = {
    command: (command, options) =>
      withObservation(world, templates, command.actor, submitMemory(command, options?.basedOn ?? current.version), options),
    beat: (commands, options) => {
      const base = options?.basedOn ?? current.version;
      return commands.map((command) => submitMemory(command, base));
    },
    edit: (edit, options) =>
      submitMemory(
        editCommand(edit, options?.command_id ?? `edit-${submissions + 1}`, options?.perceivers),
        options?.basedOn ?? current.version,
      ),
    check: (command) => checkResult(dryRun(current, templates, command)),
    // A memory world keeps its snapshots rather than a log, so its past cannot be falsified by a
    // new set: only commands from here on resolve against it. The lost-field rule still applies,
    // because the entities it would orphan are the ones these snapshots hold.
    upgradeTemplates: (next) => {
      const target = next ?? loadTemplates(templatesDirectory);
      const missing = missingCompanions(target);
      if (missing.length > 0) {
        const [first] = missing;
        throw new WorldError("invalid_templates", `Missing detached part template ${first}`);
      }
      const lost = lostField(current, target);
      if (lost !== null) {
        throw new WorldError(
          "templates_lost_field",
          `Entity ${lost.entity} (${lost.template}) uses ${lost.field}`,
        );
      }
      templates = target;
      // Re-stamped so the world stays consistent with the set it now answers for: handing this
      // snapshot to memoryWorld again must not read as a changed set.
      current = { ...current, templates_hash: templatesHash(target) };
      history.set(current.version, current);
      return current;
    },
    trace: (query) => {
      const allDeltas: Delta[] = [];
      for (const record of applied) {
        allDeltas.push(...record.deltas);
      }
      if ("entity" in query) {
        const known =
          current.entities[query.entity] !== undefined ||
          allDeltas.some((delta) => delta.entity === query.entity) ||
          events.some((event) => event.entity === query.entity);
        if (!known) {
          throw new WorldError("no_such_entity", `No such entity ${query.entity}`);
        }

        const field = query.field as string;
        if (!VALID_ENTITY_FIELDS.includes(field as typeof VALID_ENTITY_FIELDS[number])) {
          throw new WorldError(
            "no_such_field",
            `No such field ${field}`,
          );
        }

        if (field !== "entity") {
          const hasDelta = allDeltas.some(
            (delta) => delta.entity === query.entity && delta.field === field,
          );
          const hasSpawn = allDeltas.some(
            (delta) => delta.entity === query.entity && delta.field === "entity",
          );
          if (!hasDelta && !hasSpawn && initial.entities[query.entity] !== undefined) {
            throw new WorldError(
              "history_unavailable",
              `No history for ${query.entity}.${field} before this memory world was created`,
            );
          }
        }
      }
      return { events: traceQuery(events, allDeltas, query) };
    },
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
    query: (request) => {
      if (request.kind === "perceive" && request.event_id !== undefined) {
        const atEvent = snapshotAtEvent(request.event_id);
        if (atEvent !== null) {
          return queryAtEvent(atEvent.before, atEvent.snapshot, templates, atEvent.events, request);
        }
      }
      return queryEngine(current, templates, events, request);
    },
    observe: (observer, options = {}) => observeThrough(world, templates, observer, options),
    inspect: (observer, entity) => inspectThrough(world, templates, observer, entity),
    snapshot: () => current,
    entity: (id) => current.entities[id] ?? null,
    id: (name) => names[name] ?? null,
  };
  return world;
}

export { canonicalJson, verbCatalog as verbs, WorldError, WORLD_AUTHOR };
export { ENGINE_CAPABILITIES } from "./engine/capabilities.js";
export type { WorldErrorCode } from "./errors.js";
export type { Scenario, ScenarioEntry } from "./scenario.js";
export type { Command, Result, WorldEdit } from "./engine/command.js";
export type { Answer, Query } from "./engine/query.js";
export type { Inspection, ObservedEntity, ObservedEvent, Projection } from "./engine/projection.js";
export type { TraceQuery } from "./engine/trace.js";
export type {
  Coverage,
  Delta,
  Entity,
  Id,
  Perceivers,
  Pos,
  ReasonData,
  Snapshot,
  Status,
  WorldEvent,
} from "./model.js";