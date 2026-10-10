import { WorldError } from "./errors.js";
import type { AnchorPos } from "./engine/command.js";
import type { ArchitectForms } from "./engine/forms.js";
import type { EntityOverrides } from "./engine/spawn.js";
import type { Id, Pos } from "./model.js";

export type { AnchorPos };

// A scenario may give a position against an anchor instead of in centimetres.
export type ScenarioOverrides = Omit<EntityOverrides, "pos"> & {
  pos?: Pos | AnchorPos | null;
} & ArchitectForms;

export interface ScenarioEntry {
  id?: string;
  template: string;
  overrides?: ScenarioOverrides;
}

export type Scenario = readonly ScenarioEntry[];

// What resolveScenario leaves behind: every reference is an id and every position a plain pos.
export interface ResolvedEntry {
  id?: string;
  template: string;
  overrides?: EntityOverrides & ArchitectForms;
}

export interface ResolvedScenario {
  scenario: readonly ResolvedEntry[];
  ids: Readonly<Record<string, Id>>;
}

const ALLOCATED = /^e[1-9][0-9]*$/;
const ROOM = "room";
const ANCHOR_KEYS = ["anchor", "dx", "dy"];

// location, support and contained_in are ids; detached_from carries one alongside a part name.
// A door's from/to, a key's opens and a device's powered_by and controlled_by are ids too, read as
// props because props are free-form; these are the whole list, and every other prop stays the
// literal the author wrote.
const REFERENCE_FIELDS = ["location", "support", "contained_in", "concealed_by"] as const;
const HOLDER_FIELDS = ["location", "support", "contained_in"] as const;
const REFERENCE_PROPS = ["from", "to", "opens", "powered_by", "controlled_by"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPos(value: unknown): value is Pos {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.x) &&
    Number.isSafeInteger(value.y) &&
    Object.keys(value).every((key) => key === "x" || key === "y")
  );
}

function isAnchorPos(value: unknown): value is AnchorPos {
  return (
    isRecord(value) &&
    typeof value.anchor === "string" &&
    Number.isSafeInteger(value.dx) &&
    Number.isSafeInteger(value.dy) &&
    Object.keys(value).every((key) => ANCHOR_KEYS.includes(key))
  );
}

// Every name is known before any reference is read, so a scenario may point forward. Ids follow
// next_seq in entry order, so the same scenario always resolves to the same world.
export function resolveScenario(scenario: Scenario, nextSeq = 1): ResolvedScenario {
  // A map, not a plain object: a name such as `__proto__` or `constructor` is a name like any other.
  const ids = new Map<string, Id>();
  const allocated = scenario.map((_entry, index) => `e${nextSeq + index}`);
  scenario.forEach((entry, index) => {
    const name = entry.id;
    if (name === undefined) {
      return;
    }
    if (name === "" || ALLOCATED.test(name)) {
      throw new WorldError("invalid_name", `Invalid scenario name ${name} at entry ${index}`);
    }
    if (ids.has(name)) {
      throw new WorldError("duplicate_name", `Duplicate scenario name ${name} at entry ${index}`);
    }
    ids.set(name, allocated[index] as Id);
  });

  // A declared name, else a literal id this scenario allocates.
  const known = (value: string): Id | null => {
    const named = ids.get(value);
    if (named !== undefined) {
      return named;
    }
    return allocated.includes(value) ? value : null;
  };

  const reference = (value: string, index: number): Id => {
    const found = known(value);
    if (found === null) {
      throw new WorldError("unknown_name", `Unknown name ${value} at entry ${index}`);
    }
    return found;
  };

  const mapped: ResolvedEntry[] = scenario.map((entry, index): ResolvedEntry => {
    const overrides = entry.overrides;
    if (overrides === undefined) {
      const { overrides: _unused, ...rest } = entry;
      return rest;
    }
    // A pos is either already a position or an anchor to resolve against one below; anything else
    // is no position at all, which the snapshot's own rules then refuse.
    const { pos, ...rest } = overrides;
    const resolved: EntityOverrides = { ...rest };
    if (isPos(pos)) {
      resolved.pos = pos;
    }
    for (const field of REFERENCE_FIELDS) {
      const value = overrides[field];
      if (typeof value === "string") {
        resolved[field] = reference(value, index);
      }
    }
    if (overrides.detached_from !== undefined && overrides.detached_from !== null) {
      resolved.detached_from = {
        ...overrides.detached_from,
        entity: reference(overrides.detached_from.entity, index),
      };
    }
    if (overrides.props !== undefined) {
      const props: Record<string, number | string | boolean> = { ...overrides.props };
      for (const key of REFERENCE_PROPS) {
        const value = props[key];
        if (typeof value === "string") {
          props[key] = reference(value, index);
        }
      }
      resolved.props = props;
    }
    return { ...entry, overrides: resolved };
  });

  // Read after every reference is resolved, so an anchor may be named forward.
  const byId = new Map<Id, ResolvedEntry>();
  mapped.forEach((entry, index) => byId.set(allocated[index] as Id, entry));

  const resolved = mapped.map((entry, index): ResolvedEntry => {
    // Read from the entry as written: the pass above kept only the positions it could resolve.
    const written = scenario[index]?.overrides?.pos;
    if (!isAnchorPos(written)) {
      return entry;
    }
    const { dx, dy } = written;
    const overrides = scenario[index]?.overrides;
    // An anchor says where the entity is, so it cannot sit beside a holder the author also named.
    if (HOLDER_FIELDS.some((field) => overrides?.[field] !== undefined && overrides[field] !== null)) {
      throw new WorldError(
        "conflicting_placement",
        `Entry ${index} names a holder and an anchor position`,
      );
    }
    const anchorId = known(written.anchor);
    if (anchorId === null) {
      throw new WorldError("unknown_anchor", `Unknown anchor ${written.anchor} at entry ${index}`);
    }
    const anchor = byId.get(anchorId);
    const room = anchor?.overrides?.support ?? null;
    const base = anchor?.overrides?.pos ?? null;
    // An anchor is a fixed point: it stands in a room, and its own position is not another anchor.
    if (anchor === undefined || room === null || byId.get(room)?.template !== ROOM || !isPos(base)) {
      throw new WorldError(
        "anchor_not_room_supported",
        `Anchor ${written.anchor} at entry ${index} is not a fixed point in a room`,
      );
    }
    // The offset becomes a stored pos and the anchor's room the holder. The anchor is not recorded:
    // the entity is simply in that room at that position, exactly as if it had been written there.
    return {
      ...entry,
      overrides: {
        ...entry.overrides,
        location: room,
        support: room,
        pos: { x: base.x + dx, y: base.y + dy },
      },
    };
  });

  // fromEntries defines own properties, so a name `__proto__` survives into the record.
  return { scenario: resolved, ids: Object.fromEntries(ids) };
}