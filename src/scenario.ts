import { WorldError } from "./errors.js";
import type { EntityOverrides } from "./engine/spawn.js";
import type { Id } from "./model.js";

export interface ScenarioEntry {
  id?: string;
  template: string;
  overrides?: EntityOverrides;
}

export type Scenario = readonly ScenarioEntry[];

export interface ResolvedScenario {
  scenario: Scenario;
  ids: Readonly<Record<string, Id>>;
}

const ALLOCATED = /^e[1-9][0-9]*$/;

// location, support and contained_in are ids; detached_from carries one alongside a part name.
// A door's from/to and a key's opens are ids too, read as props because props are free-form; these
// three are the whole list, and every other prop stays the literal the author wrote.
const REFERENCE_FIELDS = ["location", "support", "contained_in"] as const;
const REFERENCE_PROPS = ["from", "to", "opens"] as const;

// Every name is known before any reference is read, so a scenario may point forward. Ids follow
// next_seq in entry order, so the same scenario always resolves to the same world.
export function resolveScenario(scenario: Scenario, nextSeq = 1): ResolvedScenario {
  const ids: Record<string, Id> = {};
  const allocated = scenario.map((_entry, index) => `e${nextSeq + index}`);
  scenario.forEach((entry, index) => {
    const name = entry.id;
    if (name === undefined) {
      return;
    }
    if (name === "" || ALLOCATED.test(name)) {
      throw new WorldError("invalid_name", `Invalid scenario name ${name} at entry ${index}`);
    }
    if (Object.hasOwn(ids, name)) {
      throw new WorldError("duplicate_name", `Duplicate scenario name ${name} at entry ${index}`);
    }
    ids[name] = allocated[index] as Id;
  });

  const reference = (value: string, index: number): Id => {
    const named = ids[value];
    if (named !== undefined) {
      return named;
    }
    if (allocated.includes(value)) {
      return value;
    }
    throw new WorldError("unknown_name", `Unknown name ${value} at entry ${index}`);
  };

  const resolved = scenario.map((entry, index) => {
    const overrides = entry.overrides;
    if (overrides === undefined) {
      return { ...entry };
    }
    const mapped: EntityOverrides = { ...overrides };
    for (const field of REFERENCE_FIELDS) {
      const value = overrides[field];
      if (typeof value === "string") {
        mapped[field] = reference(value, index);
      }
    }
    if (overrides.detached_from !== undefined && overrides.detached_from !== null) {
      mapped.detached_from = {
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
      mapped.props = props;
    }
    return { ...entry, overrides: mapped };
  });

  return { scenario: resolved, ids };
}