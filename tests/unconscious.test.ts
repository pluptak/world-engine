import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, type Coverage, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { capacity, structuralCapacity } from "../src/engine/capacity.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// An unconscious body takes every sense and every capacity until an author's edit ends it. Its own
// commands are refused `unconscious`; what it holds stays held. Worlds are built inline, as in sleep.test.ts.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
// Smell is covered only where a world declares it (`tests/cli-coverage.test.ts`).
const smellCoverage: Coverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "smell", "touch"],
  properties: ["integrity", "residue", "pos"],
} as Coverage;

interface Hall {
  world: World;
  ann: Id;
  dee: Id;
  pebble: Id;
}

function hall(t: { after(callback: () => void): void }, dee: Record<string, string | number | boolean> = {}, coverage?: Coverage): Hall {
  const root = tempDir(t);
  const scenario: Scenario = [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "dee", template: "human", overrides: { name: "dee", location: "hall", support: "hall", pos: { x: 100, y: 0 }, props: dee } },
    { id: "pebble", template: "stone", overrides: { name: "pebble", location: "hall", support: "hall", pos: { x: 100, y: 60 } } },
  ];
  const world = createWorld(join(root, "w"), scenario, registry, coverage === undefined ? undefined : { coverage });
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { world, ann: id("ann"), dee: id("dee"), pebble: id("pebble") };
}

let seq = 0;
function run(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `u${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

test("a scenario may start a body unconscious, and its own commands are refused", (t) => {
  const h = hall(t, { unconscious: true });
  strictEqual(run(h.world, h.dee, "say", undefined, { utterance: "hello", volume: "normal" }).reason_code, "unconscious");
  strictEqual(run(h.world, h.dee, "wait").reason_code, "unconscious");
  strictEqual(run(h.world, h.dee, "take", "pebble").reason_code, "unconscious");
  strictEqual(run(h.world, h.ann, "say", undefined, { utterance: "hello", volume: "normal" }).status, "ok");
  deepStrictEqual(validateSnapshot(h.world.snapshot(), registry), []);
});

test("every sense answers false / unconscious", (t) => {
  const h = hall(t, { unconscious: true }, smellCoverage);
  const said = run(h.world, h.ann, "say", undefined, { utterance: "hello", volume: "normal" });
  const event = said.events.find((e) => e.type === "say");
  ok(event !== undefined);
  for (const sense of ["hearing", "smell"] as const) {
    deepStrictEqual(h.world.query({ kind: "perceive", observer: h.dee, event_id: event.event_id, sense }), { value: "false", basis_code: "unconscious" });
  }
  for (const sense of ["sight", "touch"] as const) {
    deepStrictEqual(h.world.query({ kind: "perceive", observer: h.dee, sense, entity: h.ann }), { value: "false", basis_code: "unconscious" });
  }
});

test("capacities read zero, structural sums do not, and what it holds stays held", (t) => {
  const h = hall(t);
  strictEqual(run(h.world, h.dee, "take", "pebble").status, "ok");
  // The pebble is in dee's grip: contained by dee, in one of its hand parts.
  const grip = h.world.snapshot().entities[h.pebble];
  strictEqual(grip?.contained_in, h.dee);
  ok(grip?.in_part !== null && grip?.in_part !== undefined);
  strictEqual(h.world.edit({ kind: "update_props", target: h.dee, props: { unconscious: true } }).status, "ok");
  const snapshot = h.world.snapshot();
  strictEqual(capacity(snapshot, registry, h.dee, "moving"), 0);
  ok((structuralCapacity(snapshot, registry, h.dee, "moving") ?? 0) > 0);
  deepStrictEqual(snapshot.entities[h.pebble], grip);
  strictEqual(run(h.world, h.dee, "wait").reason_code, "unconscious");
});

test("an author's edit ends it, and the body acts again", (t) => {
  const h = hall(t, { unconscious: true });
  strictEqual(h.world.edit({ kind: "update_props", target: h.dee, props: { unconscious: false } }).status, "ok");
  strictEqual(run(h.world, h.dee, "say", undefined, { utterance: "up", volume: "normal" }).status, "ok");
  strictEqual(capacity(h.world.snapshot(), registry, h.dee, "moving") !== 0, true);
});
