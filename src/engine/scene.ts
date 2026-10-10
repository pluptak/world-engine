import { WorldError } from "../errors.js";
import { own, type Id, type Odds, type PoolBeat, type Snapshot } from "../model.js";
import { REFERENCE_PROPS, type Scene, type SceneRun } from "../scenario.js";
import { actionSubject, editBeatIds, MAX_BEATS, parseScheduleBeat, pendingBeatIds } from "./beats.js";
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

// A pool beat is a beat body with no tick: checked as a beat is, and its id unique among the beats the scene
// queued and the pool's own (`docs/beats.md`). It is kept for the director to play.
function scenePool(snapshot: Snapshot, names: Readonly<Record<string, Id>>, bodies: readonly unknown[], taken: string[]): PoolBeat[] {
  const used = new Set(taken);
  return bodies.map((body, index): PoolBeat => {
    const path = `run.pool[${index}]`;
    if (!isRecord(body) || "at_tick" in body) {
      throw refused(path, "invalid_beat");
    }
    const resolved = resolveBody(body, names, path) as Record<string, unknown>;
    // The tick is a placeholder the shape check needs; a pool beat is played at a tick the director names.
    const parsed = parseScheduleBeat({ ...resolved, at_tick: 1, kind: "schedule_beat" });
    if (parsed === null) {
      throw refused(path, "invalid_beat");
    }
    subjectOf(snapshot, parsed.action, parsed.then, path);
    for (const id of editBeatIds(parsed)) {
      if (used.has(id)) {
        throw refused(path, "duplicate_beat");
      }
      used.add(id);
    }
    return {
      id: parsed.id,
      action: parsed.action,
      ...(parsed.only_if === undefined ? {} : { only_if: parsed.only_if }),
      ...(parsed.then === undefined ? {} : { then: parsed.then }),
      ...(parsed.repeat === undefined ? {} : { repeat: parsed.repeat }),
    };
  });
}

// Odds a director may steer: a door's `jam_pct`, within a range the scene sets, which must be a whole range
// from 0 to 100 (`docs/roles.md`).
function sceneOdds(snapshot: Snapshot, names: Readonly<Record<string, Id>>, odds: NonNullable<SceneRun["odds"]>): Odds[] {
  return odds.map((entry, index): Odds => {
    const path = `run.odds[${index}]`;
    const entity = named(names, entry.entity, `${path}.entity`);
    if (typeof snapshot.entities[entity]?.props.open !== "boolean") {
      throw refused(`${path}.entity`, "not_a_door");
    }
    const inRange = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 100;
    if (!inRange(entry.min) || !inRange(entry.max) || entry.min > entry.max) {
      throw refused(path, "invalid_odds");
    }
    return { entity, prop: "jam_pct", min: entry.min, max: entry.max };
  });
}

// A run names a limit, its slots, a pool or odds: a positive tick limit, agents that are its slots, beats for
// the director to play, and the odds it may steer. A run with none of these is no run to end or steer.
function sceneRun(snapshot: Snapshot, names: Readonly<Record<string, Id>>, run: SceneRun): Snapshot {
  if (run.tick_limit === undefined && run.slots === undefined && run.pool === undefined && run.odds === undefined) {
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
  const pool = run.pool === undefined ? undefined : scenePool(snapshot, names, run.pool, pendingBeatIds(snapshot.schedule ?? []));
  const odds = run.odds === undefined ? undefined : sceneOdds(snapshot, names, run.odds);
  return {
    ...snapshot,
    run: {
      ...(run.tick_limit === undefined ? {} : { tick_limit: run.tick_limit }),
      ...(run.slots === undefined ? {} : { slots }),
      ...(pool === undefined ? {} : { pool }),
      ...(odds === undefined ? {} : { odds }),
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
