// Test-only seeded sequence generation for the property tests: a deterministic PRNG, a
// state-aware-lite step generator (reads the snapshot, never Math.random), a delta-fold check,
// and a cause-chain check. Nothing here ships in src/.
import type { Command, WorldEdit } from "../src/engine/command.js";
import { spawn } from "../src/engine/spawn.js";
import { resolveScenario } from "../src/scenario.js";
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
  {
    template: "stone",
    overrides: {
      name: "key",
      location: "e1",
      support: "e1",
      pos: { x: 70, y: 0 },
      props: { opens: "e3" },
    },
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
  // The scenario goes through the resolver every world is built from, anchors and all.
  for (const entry of resolveScenario(SCENARIO).scenario) {
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

// What one generator entry reads: the draws are shared, the snapshot is the current state.
export interface GenContext {
  rand: () => number;
  snapshot: Snapshot;
  commandId: string;
  actor: Id;
  target: Id;
  ids: Id[];
  agents: Id[];
  rooms: Id[];
  openables: Id[];
  // Where the selection roll fell inside its own verb's band, from 0 to 1. `edit` reads it to pick
  // its kind: one draw chose both, and a band added before `edit` cannot starve any kind.
  roll: number;
}

export type VerbEntry = (context: GenContext, options?: { ticks?: number }) => Command | WorldEdit;

// One entry per registered verb, in the registry's order; `catalog.test.ts` fails when one is
// missing. `wait` takes the tick count through `options` so an edit that has nothing to write can
// still emit one without spending a draw.
export const VERB_TABLE: Record<string, VerbEntry> = {
  move: (context) =>
    context.rand() < 0.5
      ? {
          command_id: context.commandId,
          actor: context.actor,
          verb: "move",
          args: { to: { x: int(context.rand, -200, 200), y: int(context.rand, -200, 200) } },
        }
      : {
          command_id: context.commandId,
          actor: context.actor,
          verb: "move",
          args: {
            location: context.rooms.length > 0 ? pick(context.rand, context.rooms) : "e999",
          },
        },
  take: (context) => ({
    command_id: context.commandId,
    actor: context.actor,
    verb: "take",
    target: context.target,
  }),
  drop: (context) => ({
    command_id: context.commandId,
    actor: context.actor,
    verb: "drop",
    target: context.target,
  }),
  put: (context) => ({
    command_id: context.commandId,
    actor: context.actor,
    verb: "put",
    target: context.target,
    args: {
      relation: pick(context.rand, ["on", "in"] as const),
      destination: context.ids.length > 0 ? pick(context.rand, context.ids) : "e999",
    },
  }),
  give: (context) => ({
    command_id: context.commandId,
    actor: context.actor,
    verb: "give",
    target: context.target,
    args: {
      destination: context.agents.length > 0 ? pick(context.rand, context.agents) : "e999",
    },
  }),
  // A plausible source: what the actor holds, preferring a vessel that has liquid, so a pour
  // reaches the transition instead of stopping at not_carried. Ids are sorted, so the choice does
  // not depend on key order.
  pour: (context) => {
    const held = context.ids.filter(
      (id) => context.snapshot.entities[id]?.contained_in === context.actor,
    );
    const withLiquid = held.filter((id) => {
      const entity = context.snapshot.entities[id];
      return (
        typeof entity?.props.liquid_material === "string" &&
        entity.props.liquid_material.length > 0 &&
        typeof entity.props.liquid_amount === "number" &&
        entity.props.liquid_amount > 0
      );
    });
    const sources = withLiquid.length > 0 ? withLiquid : held;
    const receivers = context.ids.filter((id) => {
      const entity = context.snapshot.entities[id];
      return (
        entity !== undefined &&
        (entity.props.container === true ||
          entity.props.surface === true ||
          entity.template === "room")
      );
    });

    return {
      command_id: context.commandId,
      actor: context.actor,
      verb: "pour",
      target: sources.length > 0 ? pick(context.rand, sources) : context.target,
      args: {
        destination:
          receivers.length > 0 ? pick(context.rand, receivers) : context.ids[0] ?? "e999",
        ...(context.rand() < 0.5 && { amount: int(context.rand, 1, 100) }),
      },
    };
  },
  open: (context) => openable(context, "open"),
  close: (context) => openable(context, "close"),
  lock: (context) => openable(context, "lock"),
  unlock: (context) => openable(context, "unlock"),
  push: (context) => shifted(context, "push"),
  pull: (context) => shifted(context, "pull"),
  attack: (context) => {
    const victim = context.ids.length > 0 ? pick(context.rand, context.ids) : "e999";
    // Sorted: store snapshots arrive via canonical JSON (sorted keys), memory ones in template
    // order, and the same seed must pick the same part in both.
    const parts = Object.keys(context.snapshot.entities[victim]?.parts ?? {}).sort();
    const address =
      parts.length > 0 && context.rand() < 0.5 ? `${victim}.${pick(context.rand, parts)}` : victim;
    return {
      command_id: context.commandId,
      actor: context.actor,
      verb: "attack",
      target: address,
    };
  },
  wait: (context, options) => waiting(context, options?.ticks),
  // The five edit kinds, not five verbs: the roll that chose `edit` chooses among them too.
  edit: (context) => {
    if (context.roll < 0.08) {
      const template = pick(context.rand, [
        "bottle",
        "stone",
        "cup",
        "chair",
        "table",
        "dog",
        "cat",
      ] as const);
      const room = context.rooms.length > 0 ? pick(context.rand, context.rooms) : "e999";
      const [first, second] = context.rooms;
      // A location the chain does not lead to: derived state, refused with location_mismatch.
      if (first !== undefined && second !== undefined && context.rand() < 0.25) {
        return {
          kind: "spawn",
          template,
          overrides: {
            location: second,
            support: first,
            pos: { x: int(context.rand, -200, 200), y: int(context.rand, -200, 200) },
          },
        };
      }
      return {
        kind: "spawn",
        template,
        overrides: {
          location: room,
          support: room,
          pos: { x: int(context.rand, -200, 200), y: int(context.rand, -200, 200) },
        },
      };
    }
    if (context.roll < 0.24) {
      return conflictingPlacement(context);
    }
    if (context.roll < 0.4) {
      const anchor = context.ids.length > 0 ? pick(context.rand, context.ids) : "e999";
      // An entity cannot set itself down: refused circular_placement.
      if (context.rand() < 0.25) {
        return { kind: "place", target: context.target, support: context.target, pos: null };
      }
      return context.rand() < 0.5
        ? {
            kind: "place",
            target: context.target,
            support: anchor,
            pos: { x: int(context.rand, -200, 200), y: int(context.rand, -200, 200) },
          }
        : { kind: "place", target: context.target, contained_in: anchor };
    }
    if (context.roll < 0.56) {
      const subject = context.ids.length > 0 ? pick(context.rand, context.ids) : "e999";
      const entity = context.snapshot.entities[subject];
      const boolKeys =
        entity === undefined
          ? []
          : Object.keys(entity.props)
              .filter((key) => typeof entity.props[key] === "boolean")
              .sort();
      if (boolKeys.length === 0) {
        return waiting(context, 1);
      }
      const key = pick(context.rand, boolKeys);
      return {
        kind: "set_props",
        target: subject,
        props: { ...entity?.props, [key]: !(entity?.props[key] as boolean) },
      };
    }
    if (context.roll < 0.72) {
      const withParts = context.ids.filter(
        (id) => Object.keys(context.snapshot.entities[id]?.parts ?? {}).length > 0,
      );
      if (withParts.length === 0) {
        return waiting(context, 1);
      }
      const subject = pick(context.rand, withParts);
      const part = pick(
        context.rand,
        Object.keys(context.snapshot.entities[subject]?.parts ?? {}).sort(),
      );
      return {
        kind: "set_part",
        target: subject,
        part,
        state: {
          integrity: int(context.rand, 0, 100),
          status: pick(context.rand, ["intact", "damaged", "detached", "destroyed"] as const),
        },
      };
    }
    if (context.roll < 0.86) {
      return brokenReference(context);
    }
    return { kind: "remove", target: context.target };
  },
};

// Both relations at once, which no entity holds: refused conflicting_placement before anything runs.
function conflictingPlacement(context: GenContext): Command | WorldEdit {
  const anchor = context.ids.length > 0 ? pick(context.rand, context.ids) : "e999";
  const other = context.ids.length > 0 ? pick(context.rand, context.ids) : "e999";
  if (context.rand() < 0.5) {
    return {
      kind: "spawn",
      template: "bottle",
      overrides: { support: anchor, contained_in: other },
    };
  }
  return { kind: "place", target: context.target, support: anchor, contained_in: other };
}

// A relation prop aimed at the wrong kind of entity: a door side that is not a room, or an `opens`
// naming something that cannot be opened. Refused with the rule's own code.
function brokenReference(context: GenContext): Command | WorldEdit {
  const rooms = new Set(context.rooms);
  const notRooms = context.ids.filter((id) => !rooms.has(id));
  if (context.rand() < 0.5) {
    const doors = context.ids.filter((id) => context.snapshot.entities[id]?.template === "door");
    if (doors.length === 0 || notRooms.length === 0) {
      return waiting(context, 1);
    }
    const door = pick(context.rand, doors);
    const side = context.rand() < 0.5 ? "from" : "to";
    return {
      kind: "set_props",
      target: door,
      props: { ...context.snapshot.entities[door]?.props, [side]: pick(context.rand, notRooms) },
    };
  }
  const shut = context.ids.filter((id) => !context.openables.includes(id));
  if (context.ids.length === 0 || shut.length === 0) {
    return waiting(context, 1);
  }
  const subject = pick(context.rand, context.ids);
  return {
    kind: "set_props",
    target: subject,
    props: { ...context.snapshot.entities[subject]?.props, opens: pick(context.rand, shut) },
  };
}

// A caller that already knows the tick count (an edit with nothing to write) spends no draw.
function waiting(context: GenContext, ticks?: number): Command {
  return {
    command_id: context.commandId,
    actor: context.actor,
    verb: "wait",
    args: { ticks: ticks ?? int(context.rand, 1, 5) },
  };
}

function openable(context: GenContext, verb: "open" | "close" | "lock" | "unlock"): Command {
  return {
    command_id: context.commandId,
    actor: context.actor,
    verb,
    target: context.openables.length > 0 ? pick(context.rand, context.openables) : context.target,
  };
}

function shifted(context: GenContext, verb: "push" | "pull"): Command {
  return {
    command_id: context.commandId,
    actor: context.actor,
    verb,
    target: context.target,
    args: {
      distance_cm: int(context.rand, 0, 120),
      dir: pick(context.rand, ["+x", "-x", "+y", "-y"] as const),
    },
  };
}

// One slot per band of the roll; a slot with several verbs spends a draw to choose between them.
const SLOTS: readonly { below: number; verbs: readonly string[] }[] = [
  { below: 0.14, verbs: ["wait"] },
  { below: 0.26, verbs: ["move"] },
  { below: 0.36, verbs: ["take"] },
  { below: 0.42, verbs: ["drop"] },
  { below: 0.5, verbs: ["push", "pull"] },
  { below: 0.58, verbs: ["put"] },
  { below: 0.63, verbs: ["give"] },
  { below: 0.69, verbs: ["attack"] },
  { below: 0.75, verbs: ["open", "close", "lock", "unlock"] },
  { below: 0.81, verbs: ["pour"] },
  { below: 1, verbs: ["edit"] },
];

function chooseVerb(context: GenContext, verbs: readonly string[]): string {
  if (verbs.length === 1) {
    const [only] = verbs;
    if (only === undefined) {
      throw new Error("A verb slot needs at least one verb");
    }
    return only;
  }
  return pick(context.rand, verbs);
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
  const slotIndex = SLOTS.findIndex((candidate) => roll < candidate.below);
  const slot = SLOTS[slotIndex];
  if (slot === undefined) {
    throw new Error(`No verb slot covers roll ${roll}`);
  }
  const start = slotIndex === 0 ? 0 : (SLOTS[slotIndex - 1]?.below ?? 0);
  const context: GenContext = {
    rand,
    snapshot,
    commandId,
    actor,
    target,
    ids,
    agents,
    rooms,
    openables,
    roll: (roll - start) / (slot.below - start),
  };
  const verb = chooseVerb(context, slot.verbs);
  const entry = VERB_TABLE[verb];
  if (entry === undefined) {
    throw new Error(`No generator entry for verb ${verb}`);
  }
  return entry(context);
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
