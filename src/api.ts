import { fileURLToPath } from "node:url";
import { canonicalJson } from "./engine/canonical.js";
import {
  attemptOf,
  WORLD_AUTHOR,
  type Attempt,
  type Command,
  type Result,
  type WorldEdit,
} from "./engine/command.js";
import {
  heardFrom,
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
import { definitionWritten, derivedFieldWritten } from "./engine/verbs/edit.js";
import { startProcesses } from "./engine/process.js";
import { isRngState } from "./engine/rng.js";
import { resolveScenario, type Scenario } from "./scenario.js";
import { validateSnapshot } from "./engine/validate.js";
import { WorldError } from "./errors.js";
import { defaultCoverage, type Coverage, type Delta, type Entity, type Id, type ReasonData, type Snapshot, type Status, type WorldEvent } from "./model.js";
import {
  attempts as readAttempts,
  create,
  entryCount,
  replayFold,
  load,
  readDeltas,
  readEvents,
  readWorldIds,
  readWorldTemplates,
  replayUntilEvent,
  resolveSubmission,
  since as foldSince,
  submit,
  trace as foldTrace,
  verify as verifyStore,
  type Verification,
  withWorldLock,
  writeWorldTemplates,
} from "./store/file-store.js";
import { loadTemplates, missingCompanions, templatesHash, type TemplateRegistry } from "./templates.js";
import { listOptions, type Options, type OptionsRequest } from "./options.js";

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
  // The state the world's dice start from, a whole number from 0 to 2^32 - 1. Without one the world
  // has none, and anything that would roll is refused `no_seed`. For `memoryWorld` it replaces the
  // snapshot's own.
  seed?: number;
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
  // What the actor can try now: the commands that would be accepted, the verbs that need args to be
  // judged, and with `refused` the ones that would be refused and why. Nothing is logged.
  options(actor: Id, options?: OptionsRequest): Options;
  since(version: number): SinceResult;
  // Every submission decided at that version or later, ok or not, with its status and reason.
  attempts(version: number): Attempt[];
  trace(query: TraceQuery): TraceResult;
  upgradeTemplates(registry?: TemplateRegistry): Snapshot;
  // A store world replays its log from initial.json and compares what that makes with the files:
  // the first place they differ, or the entries and version they agree on. Writes nothing. A memory
  // world keeps no log to replay and throws `history_unavailable`.
  verify(): Verification;
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
  // A memory world that starts from this world's snapshot as it is now, with the same templates,
  // names, coverage and dice state. Its history begins at this version, and it shares nothing mutable
  // with its parent: what either does afterwards the other never sees.
  fork(): World;
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
          const senses: string[] = [];
          let hearing = "";
          for (const sense of covered) {
            const answer = world.query({ kind: "perceive", observer, event_id: event.event_id, sense });
            if (answer.value === "true") {
              senses.push(sense);
              hearing = sense === "hearing" ? answer.basis_code : hearing;
            }
          }
          return senses.length === 0
            ? []
            : [
                {
                  event_id: event.event_id,
                  tick: event.tick,
                  type: event.type,
                  ...(senses.length === 1 && senses[0] === "hearing"
                    ? { from: heardFrom(hearing) }
                    : { entity: event.entity }),
                  senses,
                  ...(event.type === "say" && senses.includes("hearing") && typeof event.data.utterance === "string"
                    ? { utterance: event.data.utterance, volume: String(event.data.volume) }
                    : {}),
                },
              ];
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

// A seed that is no state is a caller's mistake, refused before anything is built.
function assertSeed(seed: number): number {
  if (!isRngState(seed)) {
    throw new TypeError("Seed must be a whole number from 0 to 4294967295");
  }
  return seed;
}

function initialSnapshot(registry: TemplateRegistry, coverage?: Coverage, seed?: number): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: coverage === undefined ? defaultCoverage() : assertCoverage(coverage),
    entities: {},
    ...(seed !== undefined && { rng: assertSeed(seed) }),
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

  // What happened at an event never changes once it has happened, and one observation asks about the
  // same event once per sense, so the last few replays are kept, newest last.
  const replays = new Map<string, NonNullable<ReturnType<typeof replayUntilEvent>>>();
  const replayedAt = (eventId: Id): ReturnType<typeof replayUntilEvent> => {
    const kept = replays.get(eventId);
    if (kept !== undefined) {
      return kept;
    }
    const replayed = replayUntilEvent(dir, eventId, active);
    if (replayed !== null) {
      if (replays.size >= 16) {
        replays.delete(replays.keys().next().value!);
      }
      replays.set(eventId, replayed);
    }
    return replayed;
  };

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
      // writes the same log through any number of handles. The count and the submission are one turn,
      // or two processes editing at once would both name the same next edit.
      return withWorldLock(dir, () =>
        submit(
          dir,
          editCommand(edit, options?.command_id ?? `edit-${entryCount(dir) + 1}`, options?.perceivers),
          options?.basedOn,
          active,
        ),
      );
    },
    check: (command) => checkResult(dryRun(load(dir, active), active, command)),
    options: (actor, request = {}) => {
      const snapshot = load(dir, active);
      return listOptions(snapshot, active, actor, request, (command) => dryRun(snapshot, active, command));
    },
    since: (version) => foldSince(dir, version, active),
    attempts: (version) => readAttempts(dir, version, active),
    trace: (query) => foldTrace(dir, query, active),
    upgradeTemplates: (next) => {
      const target = next ?? loadTemplates(templatesDirectory);
      const missing = missingCompanions(target);
      if (missing.length > 0) {
        const [first] = missing;
        throw new WorldError("invalid_templates", `Missing detached part template ${first}`);
      }
      // The proof and the write are one turn: a command logged between them would not have been
      // replayed under the new set.
      return withWorldLock(dir, () => {
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
          canonicalJson(replayed.events) !== canonicalJson(readEvents(dir)) ||
          canonicalJson(replayed.deltas) !== canonicalJson(readDeltas(dir))
        ) {
          throw new WorldError(
            "replay_diverges",
            `History replays to version ${replayed.snapshot.version}, not ${current.version}`,
          );
        }
        writeWorldTemplates(dir, target);
        active = target;
        replays.clear();
        return load(dir, active);
      });
    },
    verify: () => verifyStore(dir, active),
    query: (request) => {
      // An event-form perceive reads the world at either end of that event's command: perceptible
      // if perceptible before or after it. The entity form and unknown events read the present.
      if (request.kind === "perceive" && request.event_id !== undefined) {
        const atEvent = replayedAt(request.event_id);
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
    fork: () => memoryWorld(structuredClone(load(dir, active)), active, names),
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
  const initial = initialSnapshot(templates, options?.coverage, options?.seed);
  // Names resolve before the first spawn, so a bad name is refused before anything is written.
  const resolved = resolveScenario(scenario, initial.next_seq);
  let snapshot = initial;
  for (const [index, entry] of resolved.scenario.entries()) {
    const written = derivedFieldWritten(snapshot, entry.overrides ?? {});
    if (written !== null) {
      throw new WorldError("derived_field", `Scenario entry ${index} writes the derived field ${written}`);
    }
    // A template no set declares is left to spawn's own TypeError, as it was before this check.
    const template = templates[entry.template];
    const definition =
      template === undefined
        ? null
        : definitionWritten(template, { ...template.props, ...entry.overrides?.props });
    if (definition !== null) {
      throw new WorldError(
        "field_not_editable",
        `Scenario entry ${index} writes the definition ${definition}`,
      );
    }
    snapshot = spawn(snapshot, templates, entry.template, entry.overrides).snapshot;
  }
  // What the templates set going has no event behind it yet; its first `changed` is a root.
  snapshot = startProcesses(snapshot, templates);
  assertValid(snapshot, templates);
  create(dir, snapshot, templates, resolved.ids);
  return storeWorld(dir, templates, resolved.ids);
}

export function openWorld(dir: string): World {
  return storeWorld(dir, readWorldTemplates(dir), readWorldIds(dir));
}

// `World.verify()` for a world that is not open. Opening settles a world whose files disagree, which
// puts right the very differences verify looks for, and refuses one it cannot settle; this reads the
// files as they are, with the set the world carries.
export function verifyWorld(dir: string): Verification {
  return verifyStore(dir);
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
  const initial: Snapshot = {
    ...snapshot,
    ...(options?.coverage !== undefined && { coverage: assertCoverage(options.coverage) }),
    ...(options?.seed !== undefined && { rng: assertSeed(options.seed) }),
  };
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
  // Every submission, ok or not, as a store world's log would hold it.
  const tried: Attempt[] = [];
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
    tried.push(attemptOf(command, basedOn, base, result));
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
    options: (actor, request = {}) =>
      listOptions(current, templates, actor, request, (command) => dryRun(current, templates, command)),
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
    verify: () => {
      throw new WorldError("history_unavailable", "A memory world keeps no log to replay");
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
    attempts: (version) => {
      if (!Number.isSafeInteger(version) || version < 0) {
        throw new WorldError("invalid_version", `Invalid version ${version}`);
      }
      if (version < firstVersion) {
        throw new WorldError("history_unavailable", `No records before version ${firstVersion}`);
      }
      if (version > current.version) {
        throw new WorldError("future_version", `Version ${version} is ahead of ${current.version}`);
      }
      return structuredClone(tried.filter((attempt) => attempt.version >= version));
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
    fork: () => memoryWorld(structuredClone(current), templates, names),
  };
  return world;
}

export { canonicalJson, verbCatalog as verbs, WorldError, WORLD_AUTHOR };
export { ENGINE_CAPABILITIES } from "./engine/capabilities.js";
export type { WorldErrorCode } from "./errors.js";
export type { Scenario, ScenarioEntry } from "./scenario.js";
export { startProcesses } from "./engine/process.js";
export type { Attempt, Command, Result, WorldEdit } from "./engine/command.js";
export type { Answer, Query } from "./engine/query.js";
export type { HeardFrom, Inspection, ObservedEntity, ObservedEvent, Projection } from "./engine/projection.js";
export type { BlockedOption, Options, OptionsRequest, ReadyOption } from "./options.js";
export type { TraceQuery } from "./engine/trace.js";
export type { Divergence, Verification } from "./store/file-store.js";
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