import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  actorWorld,
  canonicalJson,
  createWorld,
  memoryWorld,
  type Coverage,
  type Scenario,
  type World,
} from "../src/index.js";
import { InspectResponseSchema } from "../src/contract.js";
import { defaultCoverage } from "../src/model.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// An observer reads an amount as a level, never the figure: quarters by sight, finer with a gauge.

const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const registry = parseRegistry({
  ...base,
  gauged_bottle: { id: "gauged_bottle", extends: "bottle", props: { gauge_pct: 10 } },
});

const READ: Coverage = { ...defaultCoverage(), properties: [...defaultCoverage().properties, "liquid_amount", "fuel"] };

// Ann in a lit cellar with two plain bottles, a gauged one and a lantern at her feet.
const cellar: Scenario = [
  { id: "cellar", template: "room", overrides: { name: "cellar", props: { lit: true } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "cellar", support: "cellar", pos: { x: 0, y: 0 } } },
  ...["red", "white", "gauged"].map((name, n) => ({
    id: name,
    template: name === "gauged" ? "gauged_bottle" : "bottle",
    overrides: { name, location: "cellar", support: "cellar", pos: { x: 20 + 20 * n, y: 0 } },
  })),
  { id: "lantern", template: "lantern", overrides: { name: "lantern", location: "cellar", support: "cellar", pos: { x: -20, y: 0 } } },
];

// A store world and a memory world over it, each with these amounts set by the author.
function worlds(t: { after(callback: () => void): void }, amounts: Record<string, Record<string, number>>, coverage = READ): World[] {
  const store = createWorld(join(tempDir(t), "cellar"), cellar, registry, { coverage });
  for (const [name, props] of Object.entries(amounts)) {
    strictEqual(store.edit({ kind: "update_props", target: store.id(name)!, props }).status, "ok");
  }
  const names = Object.fromEntries(cellar.map((entry) => [entry.id!, store.id(entry.id!)!]));
  return [store, memoryWorld(store.snapshot(), registry, names)];
}

function looked(world: World, name: string) {
  const inspection = world.inspect(world.id("ann")!, world.id(name)!);
  InspectResponseSchema.parse({ inspection });
  return inspection;
}

test("two bottles a little apart read the same quarter, and the figure is in no prop", (t) => {
  for (const world of worlds(t, { red: { liquid_amount: 288 }, white: { liquid_amount: 270 } })) {
    for (const name of ["red", "white"]) {
      const inspection = looked(world, name);
      deepStrictEqual(inspection?.levels, { liquid_amount: { min_pct: 25, max_pct: 50 } });
      strictEqual(inspection?.props !== undefined && "liquid_amount" in inspection.props, false);
    }
  }
});

test("empty and full read exactly, and anything between never does", (t) => {
  for (const world of worlds(t, { red: { liquid_amount: 0 }, white: { liquid_amount: 749 } })) {
    deepStrictEqual(looked(world, "red")?.levels, { liquid_amount: { min_pct: 0, max_pct: 0 } });
    deepStrictEqual(looked(world, "white")?.levels, { liquid_amount: { min_pct: 75, max_pct: 100 } });
    deepStrictEqual(looked(world, "gauged")?.levels, { liquid_amount: { min_pct: 100, max_pct: 100 } });
  }
});

test("a gauge tells apart what sight alone does not", (t) => {
  for (const world of worlds(t, { gauged: { liquid_amount: 288 } })) {
    deepStrictEqual(looked(world, "gauged")?.levels, { liquid_amount: { min_pct: 30, max_pct: 40 } });
  }
  for (const world of worlds(t, { gauged: { liquid_amount: 200 } })) {
    deepStrictEqual(looked(world, "gauged")?.levels, { liquid_amount: { min_pct: 20, max_pct: 30 } });
  }
});

test("a lantern's fuel reads against what its template holds", (t) => {
  for (const world of worlds(t, { lantern: { fuel: 7 } })) {
    deepStrictEqual(looked(world, "lantern")?.levels, { fuel: { min_pct: 25, max_pct: 50 } });
  }
});

test("a world that does not cover an amount shows no level of it", (t) => {
  for (const world of worlds(t, { red: { liquid_amount: 288 } }, defaultCoverage())) {
    strictEqual(looked(world, "red")?.levels, undefined);
    strictEqual(looked(world, "lantern")?.levels, undefined);
  }
});

test("a store and a memory world read alike", (t) => {
  const [store, memory] = worlds(t, { red: { liquid_amount: 288 }, lantern: { fuel: 7 } });
  for (const name of ["red", "white", "gauged", "lantern"]) {
    strictEqual(canonicalJson(looked(store!, name)), canonicalJson(looked(memory!, name)));
  }
});

test("the offer to pour names no amount, and an actor's refusal does not give the figure", (t) => {
  for (const world of worlds(t, { red: { liquid_amount: 288 } })) {
    const ann = world.id("ann")!;
    strictEqual(world.command({ command_id: "take-red", actor: ann, verb: "take", target: "red" }).status, "ok");
    const offered = world.options(ann).ready.filter((entry) => entry.verb === "pour");
    deepStrictEqual(offered.map((entry) => entry.args), [{ destination: world.id("cellar") }]);
    const pour = { command_id: "pour-much", verb: "pour", target: "red", args: { destination: "cellar", amount: 500 } };
    deepStrictEqual(world.check({ ...pour, actor: ann }).reason_data, { requested: 500, available: 288 });
    const verdict = actorWorld(world, ann).check(pour);
    deepStrictEqual([verdict.reason_code, verdict.reason_data], ["insufficient_liquid", { requested: 500 }]);
  }
});

test("a gauge marks whole steps of at most a quarter that divide a hundred", () => {
  for (const gauge_pct of [0, 30, 7]) {
    throws(() => parseRegistry({ ...base, odd: { id: "odd", extends: "bottle", props: { gauge_pct } } }), TypeError);
  }
});
