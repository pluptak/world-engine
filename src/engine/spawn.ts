import { defaultCoverage, own } from "../model.js";
import type { Entity, Id, Snapshot } from "../model.js";
import type { TemplateRegistry } from "../templates.js";
import { claimGrip, holderLayout } from "./carry.js";

export type EntityOverrides = Partial<Omit<Entity, "id" | "template" | "parts">>;

function copyOverrides(overrides: EntityOverrides): EntityOverrides {
  return {
    ...overrides,
    ...(overrides.aliases !== undefined && { aliases: [...overrides.aliases] }),
    ...(overrides.pos !== undefined && {
      pos: overrides.pos === null ? null : { ...overrides.pos },
    }),
    ...(overrides.detached_from !== undefined && {
      detached_from:
        overrides.detached_from === null ? null : { ...overrides.detached_from },
    }),
    ...(overrides.residue !== undefined && { residue: { ...overrides.residue } }),
    ...(overrides.modifiers !== undefined && {
      modifiers: overrides.modifiers.map((modifier) => ({ ...modifier })),
    }),
    ...(overrides.props !== undefined && { props: { ...overrides.props } }),
    // Copied whatever it is; what is not a map of tokens is validation's to refuse.
    ...(overrides.traits !== undefined && { traits: structuredClone(overrides.traits) }),
  };
}

function isEmptyMap(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}

export function spawn(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  templateId: string,
  overrides: EntityOverrides = {},
): { snapshot: Snapshot; id: Id } {
  const template = own(registry, templateId);
  if (template === undefined) {
    throw new TypeError(`Unknown template ${templateId}`);
  }

  const id = `e${snapshot.next_seq}`;
  if (Object.hasOwn(snapshot.entities, id)) {
    throw new TypeError(`Entity id ${id} already exists`);
  }

  const entity: Entity = {
    id,
    template: templateId,
    name: templateId,
    aliases: [],
    location: null,
    support: null,
    contained_in: null,
    in_part: null,
    concealed_by: null,
    pos: null,
    detached_from: null,
    integrity: 100,
    status: "intact",
    // Every declared part starts at its template default, which is never stored (parts.ts).
    parts: {},
    residue: {},
    modifiers: [],
    props: { ...template.props },
    ...copyOverrides(overrides),
  };
  // An override's props merge onto the template's, as `update_props` merges, so a scenario names
  // only what it changes and never has to repeat a definition to keep it.
  if (overrides.props !== undefined) {
    entity.props = { ...template.props, ...overrides.props };
  }
  // Stored one way: an empty map is no traits at all.
  if (isEmptyMap(entity.traits)) {
    delete entity.traits;
  }
  // A spawn into a holder with grips fills the first free one, the way location is filled from
  // the chain. A full holder, or a space part left unnamed, is left for validation to refuse.
  if (entity.contained_in !== null && overrides.in_part === undefined) {
    const holder = snapshot.entities[entity.contained_in];
    if (holder !== undefined && holderLayout(registry, holder.template).grips.length > 0) {
      const claimed = claimGrip(snapshot, registry, entity.contained_in, entity);
      if ("part" in claimed) {
        entity.in_part = claimed.part;
      }
    }
  }
  const entities = { ...snapshot.entities, [id]: entity };
  // A holder completes forward containment: whoever named it before it existed takes the first
  // free grip now, in entry order. Validation still catches a part written where no part fits.
  if (holderLayout(registry, templateId).grips.length > 0) {
    for (const otherId of Object.keys(entities).sort()) {
      const other = entities[otherId];
      if (other === undefined || other.contained_in !== id || other.in_part !== null) {
        continue;
      }
      const claimed = claimGrip({ ...snapshot, entities }, registry, id, other);
      if ("part" in claimed) {
        entities[otherId] = { ...other, in_part: claimed.part };
      }
    }
  }
  const hasCoverage =
    snapshot.coverage.relations.length > 0 ||
    snapshot.coverage.senses.length > 0 ||
    snapshot.coverage.properties.length > 0;

  return {
    snapshot: {
      ...snapshot,
      ...(Object.keys(snapshot.entities).length === 0 && !hasCoverage && {
        coverage: defaultCoverage(),
      }),
      next_seq: snapshot.next_seq + 1,
      entities,
    },
    id,
  };
}
