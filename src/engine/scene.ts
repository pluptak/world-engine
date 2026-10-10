import { WorldError } from "../errors.js";
import { own, type Id, type Snapshot } from "../model.js";
import { REFERENCE_PROPS, type Scene, type SceneRun } from "../scenario.js";
import { actionSubject, editBeatIds, MAX_BEATS, parseScheduleBeat } from "./beats.js";
import type { BeatAction, BeatChild } from "./command.js";
import { withCause } from "./pending.js";
import { isAgent } from "./verbs/address.js";

// A scene's beats name entities by their scenario ids; these keys hold one. A prop that holds one is
// listed in REFERENCE_PROPS, as an entry's prop is.
const REFERENCE_KEYS = ["entity", "target", "in", "room", "location", "support", "contained_in", "concealed_by"];

function refused(path: string, rule: string): WorldError {
  return new WorldError("invalid_scenario", `${path}: ${rule}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function named(names: Readonly<Record<string, Id>>, name: string, path: string): Id {
  const id = own(names, name);
  if (id === undefined) {
    throw refused(path, "no_such_entity");
  }
  return id;
}

function resolveProps(props: Record<string, unknown>, names: Readonly<Record<string, Id>>, path: string): Record<string, unknown> {
  const resolved = { ...props };
  for (const key of REFERENCE_PROPS) {
    const value = resolved[key];
    if (typeof value === "string") {
      resolved[key] = named(names, value, `${path}.${key}`);
    }
  }
  return resolved;
}

// The beat's body with every name it reads replaced by the id it names, wherever the body holds one: an
// action's target, a condition's entity or room, a follower's action and condition.
function resolveBody(value: unknown, names: Readonly<Record<string, Id>>, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => resolveBody(item, names, `${path}[${index}]`));
  }
  if (!isRecord(value)) {
    return value;
  }
  const body: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (typeof field === "string" && REFERENCE_KEYS.includes(key)) {
      body[key] = named(names, field, at);
    } else if (key === "props" && isRecord(field)) {
      body[key] = resolveProps(field, names, at);
    } else {
      body[key] = resolveBody(field, names, at);
    }
  }
  return body;
}

// Every subject a beat and its followers act on is an entity of the world, as it is for a `schedule_beat`.
function subjectOf(snapshot: Snapshot, action: BeatAction, then: readonly BeatChild[] | undefined, path: string): Id {
  const subject = actionSubject(action);
  if (subject === null || own(snapshot.entities, subject) === undefined) {
    throw refused(path, "no_such_entity");
  }
  (then ?? []).forEach((child, index) => subjectOf(snapshot, child.action, child.then, `${path}.then[${index}]`));
  return subject;
}

// Each beat is checked as a `schedule_beat` would be, against the entities the scene made, and queued
// with no cause: no event set it going, so a null is its root, as a process the initial state started.
function queueBeats(snapshot: Snapshot, names: Readonly<Record<string, Id>>, beats: readonly unknown[]): Snapshot {
  let next = snapshot;
  const taken = new Set<string>();
  beats.forEach((body, index) => {
    const path = `beats[${index}]`;
    if (!isRecord(body)) {
      throw refused(path, "invalid_beat");
    }
    const resolved = resolveBody(body, names, path) as Record<string, unknown>;
    const parsed = parseScheduleBeat({ ...resolved, kind: "schedule_beat" });
    if (parsed === null) {
      throw refused(path, "invalid_beat");
    }
    if (parsed.at_tick < 1) {
      throw refused(path, "beat_in_past");
    }
    const subject = subjectOf(next, parsed.action, parsed.then, path);
    for (const id of editBeatIds(parsed)) {
      if (taken.has(id)) {
        throw refused(path, "duplicate_beat");
      }
      taken.add(id);
    }
    if (taken.size > MAX_BEATS) {
      throw refused(path, "too_many_beats");
    }
    next = withCause(next, {
      kind: "beat",
      due_tick: parsed.at_tick,
      entity: subject,
      cause_id: null,
      id: parsed.id,
      action: parsed.action,
      ...(parsed.only_if === undefined ? {} : { only_if: parsed.only_if }),
      ...(parsed.then === undefined ? {} : { then: parsed.then }),
      ...(parsed.repeat === undefined ? {} : { repeat: parsed.repeat }),
    });
  });
  return next;
}

// A run names a limit or its slots: a positive tick limit, and slots that are agents the scene made, each once.
function sceneRun(snapshot: Snapshot, names: Readonly<Record<string, Id>>, run: SceneRun): Snapshot {
  if (run.tick_limit === undefined && run.slots === undefined) {
    throw refused("run", "empty_run");
  }
  if (run.tick_limit !== undefined && (!Number.isSafeInteger(run.tick_limit) || run.tick_limit < 1)) {
    throw refused("run.tick_limit", "invalid_run");
  }
  if (run.slots !== undefined && run.slots.length === 0) {
    throw refused("run.slots", "invalid_run");
  }
  const slots: Id[] = [];
  (run.slots ?? []).forEach((name, index) => {
    const path = `run.slots[${index}]`;
    const id = named(names, name, path);
    if (!isAgent(snapshot, id)) {
      throw refused(path, "not_an_agent");
    }
    if (slots.includes(id)) {
      throw refused(path, "duplicate_slot");
    }
    slots.push(id);
  });
  return {
    ...snapshot,
    run: {
      ...(run.tick_limit === undefined ? {} : { tick_limit: run.tick_limit }),
      ...(run.slots === undefined ? {} : { slots }),
      state: "registering",
    },
  };
}

// The scene's beats and run, put on the snapshot its spawns made. A refusal names its path (`beats[2]`,
// `beats[0].then[1]`, `run.slots[0]`) and its rule, and nothing is written: the world is created only after this.
export function sceneSnapshot(snapshot: Snapshot, names: Readonly<Record<string, Id>>, scene: Scene): Snapshot {
  const withBeats = scene.beats === undefined ? snapshot : queueBeats(snapshot, names, scene.beats);
  return scene.run === undefined ? withBeats : sceneRun(withBeats, names, scene.run);
}
