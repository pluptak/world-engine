// Test-only seeded sequence generation for the property tests: a deterministic PRNG, a
// state-aware-lite step generator (reads the snapshot, never Math.random), a delta-fold check,
// and a cause-chain check. Nothing here ships in src/.
import type { Command, WorldEdit } from "../src/engine/command.js";
import { spawn } from "../src/engine/spawn.js";
import { templatesHash, type TemplateRegistry } from "../src/templates.js";
import type { Delta, Entity, Id, Snapshot, WorldEvent } from "../src/model.js";
import type { Scenario } from "../src/api.js";

export const SCENARIO: Scenario = [
  { template: "room", overrides: { name: "room-a", props: { lit: true } } },
  { template: "room", overrides: { name: "room-b", props: { lit: true } } },
  {
    template: "door",
    overrides: { name: "door", props: { openable: true, open: true, from: "e1", to: "e2" } },
  },
  {
    template: "table",
    overrides: { name: "table", location: "e1", support: "e1", pos: { x: 30, y: 0 } },
  },
  {
    template: "chest",
    overrides: {
      name: "chest",
      location: "e1",
      support: "e1",
      pos: { x: 20, y: 0 },
      props: {
        container: true,
        topples: true,
        inner_w_cm: 55,
        inner_d_cm: 35,
        inner_h_cm: 35,
        openable: true,
        open: true,
      },
    },
  },
  { template: "bottle", overrides: { name: "bottle", location: "e1", support: "e4" } },
  {
    template: "stone",
    overrides: { name: "stone", location: "e1", support: "e1", pos: { x: 60, y: 0 } },
  },
  { template: "cup", overrides: { name: "cup", location: "e1", support: "e4" } },
  {
    template: "human",
    overrides: { name: "ann", location: "e1", support: "e1", pos: { x: -50, y: 0 } },
  },
  {
    template: "human",
    overrides: { name: "bob", location: "e1", support: "e1", pos: { x: -40, y: 0 } },
  },
  {
    template: "dog",
    overrides: { name: "rex", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
  },
  {
    template: "cat",
    overrides: { name: "kit", location: "e2", support: "e2", pos: { x: 5, y: 5 } },
  },
];

export function buildInitial(registry: TemplateRegistry): Snapshot {
  let snapshot: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  for (const entry of SCENARIO) {
    snapshot = spawn(snapshot, registry, entry.template, entry.overrides).snapshot;
  }
  return snapshot;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

function agentsOf(snapshot: Snapshot): Id[] {
  return Object.keys(snapshot.entities)
    .sort()
    .filter((id) => {
      const entity = snapshot.entities[id];
      return entity !== undefined && entity.props.agent === true && entity.detached_from === null;
    });
}

// One plausible command or edit against the given snapshot: entity-id targets always resolve,
// so outcomes vary across ok/refused/invalid without ever leaving the engine's handled paths.
export function genStep(rand: () => number, snapshot: Snapshot, commandId: string): Command | WorldEdit {
  const ids = Object.keys(snapshot.entities).sort();
  const agents = agentsOf(snapshot);
  const rooms = ids.filter((id) => snapshot.entities[id]?.template === "room");
  const openables = ids.filter((id) => snapshot.entities[id]?.props.openable === true);
  const actor = agents.length > 0 ? pick(rand, agents) : "e999";
  const target = ids.length > 0 ? pick(rand, ids) : "e999";
  const roll = rand();
  if (roll < 0.14) {
    return { command_id: commandId, actor, verb: "wait", args: { ticks: int(rand, 1, 5) } };
  }
  if (roll < 0.26) {
    return rand() < 0.5
      ? {
          command_id: commandId,
          actor,
          verb: "move",
          args: { to: { x: int(rand, -200, 200), y: int(rand, -200, 200) } },
        }
      : {
          command_id: commandId,
          actor,
          verb: "move",
          args: { location: rooms.length > 0 ? pick(rand, rooms) : "e999" },
        };
  }
  if (roll < 0.36) {
    return { command_id: commandId, actor, verb: "take", target };
  }
  if (roll < 0.42) {
    return { command_id: commandId, actor, verb: "drop", target };
  }
  if (roll < 0.5) {
    return {
      command_id: commandId,
      actor,
      verb: pick(rand, ["push", "pull"] as const),
      target,
      args: {
        distance_cm: int(rand, 0, 120),
        dir: pick(rand, ["+x", "-x", "+y", "-y"] as const),
      },
    };
  }
  if (roll < 0.58) {
    return {
      command_id: commandId,
      actor,
      verb: "put",
      target,
      args: {
        relation: pick(rand, ["on", "in"] as const),
        destination: ids.length > 0 ? pick(rand, ids) : "e999",
      },
    };
  }
  if (roll < 0.63) {
    return {
      command_id: commandId,
      actor,
      verb: "give",
      target,
      args: { destination: agents.length > 0 ? pick(rand, agents) : "e999" },
    };
  }
  if (roll < 0.69) {
    const victim = ids.length > 0 ? pick(rand, ids) : "e999";
    // Sorted: store snapshots arrive via canonical JSON (sorted keys), memory ones in template
    // order, and the same seed must pick the same part in both.
    const parts = Object.keys(snapshot.entities[victim]?.parts ?? {}).sort();
    const address = parts.length > 0 && rand() < 0.5 ? `${victim}.${pick(rand, parts)}` : victim;
    return { command_id: commandId, actor, verb: "attack", target: address };
  }
  if (roll < 0.75) {
    return {
      command_id: commandId,
      actor,
      verb: pick(rand, ["open", "close", "lock", "unlock"] as const),
      target: openables.length > 0 ? pick(rand, openables) : target,
    };
  }
  if (roll < 0.8) {
    const template = pick(rand, ["bottle", "stone", "cup", "chair", "table", "dog", "cat"] as const);
    const room = rooms.length > 0 ? pick(rand, rooms) : "e999";
    return {
      kind: "spawn",
      template,
      overrides: {
        location: room,
        support: room,
        pos: { x: int(rand, -200, 200), y: int(rand, -200, 200) },
      },
    };
  }
  if (roll < 0.84) {
    const anchor = ids.length > 0 ? pick(rand, ids) : "e999";
    return rand() < 0.5
      ? {
          kind: "place",
          target,
          support: anchor,
          pos: { x: int(rand, -200, 200), y: int(rand, -200, 200) },
        }
      : { kind: "place", target, contained_in: anchor };
  }
  if (roll < 0.88) {
    const subject = ids.length > 0 ? pick(rand, ids) : "e999";
    const entity = snapshot.entities[subject];
    const boolKeys =
      entity === undefined
        ? []
        : Object.keys(entity.props)
            .filter((key) => typeof entity.props[key] === "boolean")
            .sort();
    if (boolKeys.length === 0) {
      return { command_id: commandId, actor, verb: "wait", args: { ticks: 1 } };
    }
    const key = pick(rand, boolKeys);
    return {
      kind: "set_props",
      target: subject,
      props: { ...entity?.props, [key]: !(entity?.props[key] as boolean) },
    };
  }
  if (roll < 0.93) {
    const withParts = ids.filter((id) => Object.keys(snapshot.entities[id]?.parts ?? {}).length > 0);
    if (withParts.length === 0) {
      return { command_id: commandId, actor, verb: "wait", args: { ticks: 1 } };
    }
    const subject = pick(rand, withParts);
    const part = pick(rand, Object.keys(snapshot.entities[subject]?.parts ?? {}).sort());
    return {
      kind: "set_part",
      target: subject,
      part,
      state: {
        integrity: int(rand, 0, 100),
        status: pick(rand, ["intact", "damaged", "detached", "destroyed"] as const),
      },
    };
  }
  return { kind: "remove", target };
}

// Replays raw deltas over the initial entities: spawn ("entity" from null) adds, remove (to null)
// deletes, anything else sets the field. Must equal the live entities exactly.
export function foldEntities(
  initial: Snapshot,
  deltas: Delta[],
): Record<Id, Entity> {
  const entities: Record<Id, Entity> = structuredClone(initial.entities);
  for (const delta of deltas) {
    if (delta.field === "entity") {
      if (delta.to === null || delta.to === undefined) {
        delete entities[delta.entity];
      } else {
        entities[delta.entity] = structuredClone(delta.to) as Entity;
      }
    } else {
      const entity = entities[delta.entity];
      if (entity !== undefined) {
        (entity as unknown as Record<string, unknown>)[delta.field] = structuredClone(delta.to);
      }
    }
  }
  return entities;
}

// Every event in the full history walks its cause chain to a root: chains legitimately span
// commands (a wait that expires a modifier points at the event that caused it), so the walk
// resolves against history, not one command's events. Throws on a missing link or a cycle.
export function checkCauseChain(events: WorldEvent[]): void {
  const byId = new Map(events.map((event) => [event.event_id, event]));
  for (const event of events) {
    const seen = new Set<string>();
    let current = event;
    while (current.cause_id !== null) {
      if (seen.has(current.event_id)) {
        throw new Error(`Cause cycle at ${current.event_id}`);
      }
      seen.add(current.event_id);
      const parent = byId.get(current.cause_id);
      if (parent === undefined) {
        throw new Error(`Event ${current.event_id} names missing cause ${current.cause_id}`);
      }
      current = parent;
    }
  }
}
