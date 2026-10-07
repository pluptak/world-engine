import { deepStrictEqual, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { capacities, capacity } from "../src/engine/capacity.js";
import { spawn } from "../src/engine/spawn.js";
import type { Entity, Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash } from "../src/templates.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function humanSnapshot(tick = 0): { snapshot: Snapshot; id: string } {
  const initial: Snapshot = {
    version: 0,
    tick,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  return spawn(initial, registry, "human");
}

function updateEntity(snapshot: Snapshot, id: string, update: (entity: Entity) => Entity): Snapshot {
  const entity = snapshot.entities[id];
  if (entity === undefined) {
    throw new TypeError(`Unknown test entity ${id}`);
  }
  return { ...snapshot, entities: { ...snapshot.entities, [id]: update(entity) } };
}

test("an intact human has its declared capacities", () => {
  const { snapshot, id } = humanSnapshot();
  deepStrictEqual(capacities(snapshot, registry, id), {
    hearing: 100,
    manipulation: 100,
    moving: 100,
    sight: 100,
    speech: 100,
    touch: 100,
  });
  strictEqual(capacity(snapshot, registry, id, "manipulation"), 100);
});

test("a destroyed hand no longer contributes manipulation", () => {
  const { snapshot, id } = humanSnapshot();
  const damaged = updateEntity(snapshot, id, (entity) => ({
    ...entity,
    parts: {
      ...entity.parts,
      hand_r: { integrity: 0, status: "destroyed" },
    },
  }));

  strictEqual(capacity(damaged, registry, id, "manipulation"), 50);
});

test("detaching an arm also removes its hand's contribution", () => {
  const { snapshot, id } = humanSnapshot();
  const detached = updateEntity(snapshot, id, (entity) => ({
    ...entity,
    parts: {
      ...entity.parts,
      arm_r: { integrity: 0, status: "detached" },
    },
  }));

  strictEqual(capacity(detached, registry, id, "manipulation"), 50);
});

test("modifiers apply only before their expiration tick", () => {
  const { snapshot, id } = humanSnapshot(4);
  const modified = updateEntity(snapshot, id, (entity) => ({
    ...entity,
    modifiers: [
      { capacity: "manipulation", delta: -30, expires_at_tick: 5, cause_id: "ev1" },
    ],
  }));

  strictEqual(capacity(modified, registry, id, "manipulation"), 70);
  strictEqual(
    capacity({ ...modified, tick: 5 }, registry, id, "manipulation"),
    100,
  );
});

test("templates with no parts have no capacities", () => {
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const { snapshot, id } = spawn(initial, registry, "stone");

  strictEqual(capacity(snapshot, registry, id, "moving"), null);
  strictEqual(capacities(snapshot, registry, id), null);
});

test("capacity modifiers clamp at zero", () => {
  const { snapshot, id } = humanSnapshot();
  const modified = updateEntity(snapshot, id, (entity) => ({
    ...entity,
    modifiers: [
      { capacity: "moving", delta: -1000, expires_at_tick: null, cause_id: "ev1" },
    ],
  }));

  strictEqual(capacity(modified, registry, id, "moving"), 0);
});
