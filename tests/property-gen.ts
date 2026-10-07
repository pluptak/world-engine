// Test-only seeded sequence generation for the property tests: a deterministic PRNG, a
// state-aware-lite step generator (reads the snapshot, never Math.random), a delta-fold check,
// and a cause-chain check. Nothing here ships in src/.
import { fileURLToPath } from "node:url";
import { WORLD_AUTHOR, type Command, type WorldEdit } from "../src/engine/command.js";
import { spawn } from "../src/engine/spawn.js";
import { resolveScenario } from "../src/scenario.js";
import { startProcesses } from "../src/engine/process.js";
import { loadTemplates, parseRegistry, templatesHash, type TemplateRegistry } from "../src/templates.js";
import type { Delta, Entity, Id, Snapshot, WorldEvent } from "../src/model.js";
import type { Scenario } from "../src/api.js";

// Two templates that exist for the property test: a candle that burns down while `burning` is true
// (the generator's prop edits flip it), and moss that grows from the start up to a cap. Random runs
// start, withdraw, restart and overtake processes under every property.
export function withProcessFixtures(base: TemplateRegistry): TemplateRegistry {
  return parseRegistry({
    ...base,
    candle: {
      id: "candle",
      extends: "stone",
      props: { burning: false, fuel: 5 },
      processes: [
        {
          id: "burn",
          every_ticks: 2,
          while: { prop: "burning", op: "eq", value: true },
          effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } },
        },
      ],
    },
    moss: {
      id: "moss",
      extends: "stone",
      props: { size: 1 },
      processes: [{ id: "grow", every_ticks: 3, effect: { adjust_prop: { prop: "size", by: 1, max: 4 } } }],
    },
  });
}

export const SCENARIO: Scenario = [
  { template: "room", overrides: { name: "room-a", props: { lit: true } } },
  { template: "room", overrides: { name: "room-b", props: { lit: true } } },
  {
    template: "door",
    // Both openables shut themselves, so random sequences schedule, withdraw and overtake closes.
    overrides: { name: "door", props: { openable: true, open: true, from: "e1", to: "e2", closes_after: 2 } },
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
        closes_after: 3,
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
    // Bob strikes hard enough to take a part off in one blow.
    overrides: {
      name: "bob",
      location: "e1",
      support: "e1",
      pos: { x: -40, y: 0 },
      props: {
        agent: true,
        reach_cm: 100,
        hand_height_cm: 100,
        attack_damage: 100,
        default_hit_part: "torso",
        bleed_damage: 5,
        bleed_every_ticks: 2,
        bleed_times: 3,
      },
    },
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
  {
    // An anchor is abstract: nothing can address it and nothing may hide under it, so the generator
    // has a mark to aim concealment at.
    template: "anchor",
    overrides: { name: "mark", location: "e1", support: "e1", pos: { x: 90, y: 0 } },
  },
  { template: "candle", overrides: { name: "candle", location: "e1", support: "e1", pos: { x: 110, y: 20 } } },
  { template: "moss", overrides: { name: "moss", location: "e2", support: "e2", pos: { x: -60, y: 20 } } },
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
  return startProcesses(snapshot, registry);
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

const templates = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

// The parts of an entity that can come off and are still on it, sorted.
function detachableParts(snapshot: Snapshot, id: Id): string[] {
  const entity = snapshot.entities[id];
  return (templates[entity?.template ?? ""]?.parts ?? [])
    .filter((part) => part.detachable && entity?.parts[part.name]?.status !== "detached")
    .map((part) => part.name)
    .sort();
}

// The parts an entity's template declares, sorted. Part state is sparse, so the stored record
// names only the parts something has changed; the template names every one there is.
function declaredParts(snapshot: Snapshot, id: Id): string[] {
  const entity = snapshot.entities[id];
  return (templates[entity?.template ?? ""]?.parts ?? []).map((part) => part.name).sort();
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
  search: (context) => {
    // A concealer currently hides something; otherwise any entity, a search is still ok.
    const concealers = context.ids.filter((id) =>
      context.ids.some((other) => context.snapshot.entities[other]?.concealed_by === id),
    );
    return {
      command_id: context.commandId,
      actor: context.actor,
      verb: "search",
      target: concealers.length > 0 ? pick(context.rand, concealers) : context.target,
    };
  },
  push: (context) => shifted(context, "push"),
  pull: (context) => shifted(context, "pull"),
  attack: (context) => {
    // Half the blows are aimed at a part that can come off another agent, so wounds open and bleed;
    // the rest land anywhere, on anything.
    const aimable = context.agents.filter(
      (id) => id !== context.actor && detachableParts(context.snapshot, id).length > 0,
    );
    if (aimable.length > 0 && context.rand() < 0.5) {
      const victim = pick(context.rand, aimable);
      return {
        command_id: context.commandId,
        actor: context.actor,
        verb: "attack",
        target: `${victim}.${pick(context.rand, detachableParts(context.snapshot, victim))}`,
      };
    }
    const victim = context.ids.length > 0 ? pick(context.rand, context.ids) : "e999";
    const parts = declaredParts(context.snapshot, victim);
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
  // The author's clock: time passes with no one acting.
  advance: (context) => ({
    command_id: context.commandId,
    actor: WORLD_AUTHOR,
    verb: "advance",
    args: { ticks: int(context.rand, 1, 6) },
  }),
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
      // Some of these edits are aimed at whatever can burn, so a process is started and withdrawn.
      const burners = context.ids.filter((id) => typeof context.snapshot.entities[id]?.props.burning === "boolean");
      const aimed = burners.length > 0 && context.rand() < 0.4;
      const subject = aimed ? pick(context.rand, burners) : context.ids.length > 0 ? pick(context.rand, context.ids) : "e999";
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
        (id) => declaredParts(context.snapshot, id).length > 0,
      );
      if (withParts.length === 0) {
        return waiting(context, 1);
      }
      const subject = pick(context.rand, withParts);
      const part = pick(
        context.rand,
        declaredParts(context.snapshot, subject),
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
    if (context.roll < 0.92) {
      return concealmentEdit(context);
    }
    if (context.roll < 0.96) {
      return holderPartEdit(context);
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

// A `place` that only writes concealed_by: nothing moves, so the entity stays exactly where it was
// and is simply hidden under (or not) whatever the roll picks. Three of the four break a rule the
// relation has; the fourth is a real concealment, which the movers then have to uncover.
function concealmentEdit(context: GenContext): Command | WorldEdit {
  if (context.ids.length === 0) {
    return waiting(context, 1);
  }
  const target = pick(context.rand, context.ids);
  const room = context.snapshot.entities[target]?.location ?? null;
  const anchors = context.ids.filter((id) => context.snapshot.entities[id]?.template === "anchor");
  const elsewhere = context.ids.filter(
    (id) => context.snapshot.entities[id]?.location !== room,
  );
  const here = context.ids.filter((id) => context.snapshot.entities[id]?.location === room);
  const roll = context.rand();

  // A name that reaches nothing: whatever it was hiding stays hidden for ever.
  if (roll < 0.2) {
    return { kind: "place", target, concealed_by: "e999" };
  }
  // An abstract entity is a mark, so nothing lies under it.
  if (roll < 0.4 && anchors.length > 0) {
    return { kind: "place", target, concealed_by: pick(context.rand, anchors) };
  }
  // Something in another room hides nothing here.
  if (roll < 0.6 && elsewhere.length > 0) {
    return { kind: "place", target, concealed_by: pick(context.rand, elsewhere) };
  }
  const concealers = here.length > 0 ? here : context.ids;
  return { kind: "place", target, concealed_by: pick(context.rand, concealers) };
}

// A `place` that only writes in_part: a part named where no holder is, or a name no holder
// declares. Refused with the holder rule's own code.
function holderPartEdit(context: GenContext): Command | WorldEdit {
  if (context.agents.length === 0) {
    return waiting(context, 1);
  }
  const holder = pick(context.rand, context.agents);
  if (context.rand() < 0.5) {
    const support = context.rooms.length > 0 ? pick(context.rand, context.rooms) : "e999";
    return {
      kind: "place",
      target: context.target,
      support,
      pos: { x: int(context.rand, -200, 200), y: int(context.rand, -200, 200) },
      in_part: "hand_l",
    };
  }
  return { kind: "place", target: context.target, contained_in: holder, pos: null, in_part: "elbow" };
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
  { below: 0.14, verbs: ["wait", "advance"] },
  { below: 0.26, verbs: ["move"] },
  { below: 0.36, verbs: ["take"] },
  { below: 0.42, verbs: ["drop"] },
  { below: 0.5, verbs: ["push", "pull"] },
  { below: 0.58, verbs: ["put"] },
  { below: 0.63, verbs: ["give"] },
  { below: 0.69, verbs: ["attack"] },
  { below: 0.75, verbs: ["open", "close", "lock", "unlock"] },
  { below: 0.81, verbs: ["pour"] },
  { below: 0.84, verbs: ["search"] },
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

const PART_EVENTS = new Set(["damaged", "destroyed", "detached", "edited"]);

// Stored part state is written only where an event says a part changed: a damaged, destroyed,
// detached or edited event on that entity naming the part or an ancestor that took it along. A new
// entity stores parts only as a severed part, spawned by a detachment. So carrying, pocketing,
// perceiving, pushing and every other verb leave the record alone.
export function checkPartTriggers(before: Snapshot, after: Snapshot, events: WorldEvent[]): void {
  const byId = new Map(events.map((event) => [event.event_id, event]));
  const same = (a: Entity["parts"][string] | undefined, b: Entity["parts"][string] | undefined) =>
    a?.integrity === b?.integrity && a?.status === b?.status;
  for (const id of Object.keys(after.entities).sort()) {
    const now = after.entities[id]!;
    const was = before.entities[id];
    if (was === undefined) {
      if (Object.keys(now.parts).length === 0) {
        continue;
      }
      const spawned = events.find((event) => event.type === "spawned" && event.entity === id);
      const cause = spawned?.cause_id === undefined || spawned.cause_id === null ? undefined : byId.get(spawned.cause_id);
      if (cause?.type !== "detached") {
        throw new Error(`New entity ${id} stores parts without being severed`);
      }
      continue;
    }
    const parents = new Map((templates[now.template]?.parts ?? []).map((part) => [part.name, part.parent]));
    for (const name of [...new Set([...Object.keys(was.parts), ...Object.keys(now.parts)])].sort()) {
      if (same(was.parts[name], now.parts[name])) {
        continue;
      }
      const lineage = new Set<string>();
      for (let current: string | null = name; current !== null && !lineage.has(current); ) {
        lineage.add(current);
        current = parents.get(current) ?? null;
      }
      const named = events.some(
        (event) =>
          event.entity === id &&
          PART_EVENTS.has(event.type) &&
          typeof event.data.part === "string" &&
          lineage.has(event.data.part),
      );
      if (!named) {
        throw new Error(`Part ${id}.${name} changed under no part event`);
      }
    }
  }
}
