import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson } from "../src/engine/canonical.js";
import { elevation, effectivePos } from "../src/engine/geometry.js";
import { spawn } from "../src/engine/spawn.js";
import type { Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash } from "../src/templates.js";
import { deepFreeze } from "./harness.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function initialSnapshot(): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
}

function writeTemplate(dir: string, template: unknown): void {
  writeFileSync(join(dir, "template.json"), JSON.stringify(template));
}

const templateFixture = (parts: unknown[]) => ({
  id: "fixture",
  size_cm: { w: 1, d: 1, h: 1 },
  mass_g: 1,
  parts,
  props: {},
  break_products: [],
  break_residue: {},
});

test("loadTemplates rejects a part cycle and a missing parent", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-templates-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeTemplate(dir, templateFixture([
    { name: "a", parent: "b", contributes: {}, detachable: false, max_integrity: 100 },
    { name: "b", parent: "a", contributes: {}, detachable: false, max_integrity: 100 },
  ]));
  throws(() => loadTemplates(dir), /cycle/);

  writeTemplate(dir, templateFixture([
    { name: "a", parent: "missing", contributes: {}, detachable: false, max_integrity: 100 },
  ]));
  throws(() => loadTemplates(dir), /missing parent/);
});

test("spawn allocates sequential ids without mutating its input", () => {
  const original = deepFreeze(initialSnapshot());
  const first = spawn(original, registry, "room", { name: "hall" });
  const firstSnapshot = deepFreeze(first.snapshot);
  const second = spawn(firstSnapshot, registry, "human");

  strictEqual(first.id, "e1");
  strictEqual(second.id, "e2");
  strictEqual(second.snapshot.next_seq, 3);
  // Every part starts at its template default, which is not stored.
  deepStrictEqual(second.snapshot.entities.e2?.parts, {});
  strictEqual(second.snapshot.entities.e1?.name, "hall");
  deepStrictEqual(original.entities, {});
  strictEqual(original.next_seq, 1);
  strictEqual(firstSnapshot.next_seq, 2);
});

test("canonicalJson is independent of object key order at every depth", () => {
  strictEqual(
    canonicalJson({ z: 1, nested: { b: 2, a: 3 } }),
    canonicalJson({ nested: { a: 3, b: 2 }, z: 1 }),
  );
  strictEqual(canonicalJson({ "2": "b", "10": "a" }), '{"10":"a","2":"b"}');
});

test("elevation and effectivePos follow support chains", () => {
  const room = spawn(initialSnapshot(), registry, "room", {
    pos: { x: 0, y: 0 },
  });
  const table = spawn(room.snapshot, registry, "table", {
    support: room.id,
    location: room.id,
    pos: { x: 10, y: 20 },
  });
  const bottle = spawn(table.snapshot, registry, "bottle", {
    support: table.id,
    location: room.id,
  });

  strictEqual(elevation(bottle.snapshot, registry, bottle.id), registry.table?.size_cm.h);
  deepStrictEqual(effectivePos(bottle.snapshot, bottle.id), { x: 10, y: 20 });
});

test("elevation throws on a support cycle", () => {
  const first = spawn(initialSnapshot(), registry, "table");
  const second = spawn(first.snapshot, registry, "table", { support: first.id });
  const cyclic: Snapshot = {
    ...second.snapshot,
    entities: {
      ...second.snapshot.entities,
      [first.id]: { ...second.snapshot.entities[first.id]!, support: second.id },
    },
  };

  ok(cyclic.entities[first.id]);
  throws(() => elevation(cyclic, registry, first.id), /cycle/);
});
