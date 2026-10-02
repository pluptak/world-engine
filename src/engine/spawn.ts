import type { Entity, Id, Snapshot } from "../model.js";
import type { TemplateRegistry } from "../templates.js";

export type EntityOverrides = Partial<Omit<Entity, "id" | "template" | "parts">>;

const DEFAULT_COVERAGE = {
  relations: ["support", "contained_in", "attached_to", "status", "location"],
  senses: ["sight", "hearing"],
  properties: ["integrity", "residue", "pos"],
};

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
  };
}

export function spawn(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  templateId: string,
  overrides: EntityOverrides = {},
): { snapshot: Snapshot; id: Id } {
  const template = registry[templateId];
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
    pos: null,
    detached_from: null,
    integrity: 100,
    status: "intact",
    parts: Object.fromEntries(
      template.parts.map((part) => [
        part.name,
        { integrity: part.max_integrity, status: "intact" as const },
      ]),
    ),
    residue: {},
    modifiers: [],
    props: { ...template.props },
    ...copyOverrides(overrides),
  };
  const hasCoverage =
    snapshot.coverage.relations.length > 0 ||
    snapshot.coverage.senses.length > 0 ||
    snapshot.coverage.properties.length > 0;

  return {
    snapshot: {
      ...snapshot,
      ...(Object.keys(snapshot.entities).length === 0 && !hasCoverage && {
        coverage: {
          relations: [...DEFAULT_COVERAGE.relations],
          senses: [...DEFAULT_COVERAGE.senses],
          properties: [...DEFAULT_COVERAGE.properties],
        },
      }),
      next_seq: snapshot.next_seq + 1,
      entities: { ...snapshot.entities, [id]: entity },
    },
    id,
  };
}
