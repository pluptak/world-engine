import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, memoryWorld, type Scenario, type World } from "../src/index.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// Scenery is perceived and named like anything, and acted on by nothing an agent does.

const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
// A meadow knee high, taller than a step, so only being scenery lets a walk cross it; it blooms by
// itself, so a process still changes it.
const meadow = {
  id: "meadow",
  size_cm: { w: 400, d: 400, h: 30 },
  mass_g: 1000,
  parts: [],
  props: { scenery: true, bloom: 0 },
  fields: { bloom: { tier: "state", type: "integer" } },
  break_products: [],
  break_residue: {},
  processes: [{ id: "bloom", every_ticks: 1, effect: { adjust_prop: { prop: "bloom", by: 1, max: 100 } } }],
};
const registry = parseRegistry({ ...base, meadow, open_gate: { id: "open_gate", extends: "gate", props: { open: true } } });

// Ann on a meadow in a yard, lit or not, an open gate across the meadow beside her and a stone.
function yard(lit: boolean): Scenario {
  const at = (x: number, y: number) => ({ location: "yard", support: "yard", pos: { x, y } });
  return [
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit } } },
    { id: "meadow", template: "meadow", overrides: { name: "meadow", ...at(0, 0) } },
    { id: "gate", template: "open_gate", overrides: { name: "gate", ...at(50, 0) } },
    { id: "ann", template: "human", overrides: { name: "ann", ...at(50, 30) } },
    { id: "stone", template: "stone", overrides: { name: "stone", ...at(20, 60) } },
  ];
}

function worlds(t: { after(callback: () => void): void }, lit = true): World[] {
  const store = createWorld(join(tempDir(t), "yard"), yard(lit), registry);
  const names = Object.fromEntries(yard(lit).map((entry) => [entry.id!, store.id(entry.id!)!]));
  return [store, memoryWorld(store.snapshot(), registry, names)];
}

test("a meadow is seen in the light and listed and inspected, and unseen in the dark", (t) => {
  for (const world of worlds(t)) {
    const [ann, field] = [world.id("ann")!, world.id("meadow")!];
    ok(world.observe(ann).entities.some((entity) => entity.id === field));
    deepStrictEqual(world.inspect(ann, field)?.senses, ["sight"]);
  }
  for (const world of worlds(t, false)) {
    const [ann, field] = [world.id("ann")!, world.id("meadow")!];
    strictEqual(world.observe(ann).entities.some((entity) => entity.id === field), false);
  }
});

test("whatever an agent aims at it is refused scenery and changes nothing", (t) => {
  for (const world of worlds(t)) {
    const ann = world.id("ann")!;
    const before = canonicalJson(world.snapshot());
    for (const [verb, args] of [["take", undefined], ["push", { direction: "+x", distance: 10 }], ["attack", undefined]] as const) {
      const result = world.command({ command_id: `${verb}-meadow`, actor: ann, verb, target: "meadow", ...(args && { args }) });
      deepStrictEqual([verb, result.status, result.reason_code, result.resolved_target], [verb, "refused", "scenery", world.id("meadow")]);
    }
    strictEqual(canonicalJson(world.snapshot()), before);
  }
});

test("options never offer it, as a target or an argument", (t) => {
  for (const world of worlds(t)) {
    const asked = world.options(world.id("ann")!, { refused: true });
    const named = canonicalJson([...asked.ready, ...(asked.blocked ?? [])]);
    strictEqual(named.includes(`"${world.id("meadow")!}"`), false);
    ok(asked.ready.some((entry) => entry.verb === "take" && entry.target === world.id("stone")));
  }
});

test("an agent walks across it and a shutting gate moves none of it", (t) => {
  for (const world of worlds(t)) {
    const [ann, field] = [world.id("ann")!, world.id("meadow")!];
    // From off the meadow onto it: what a walker already stands in never stops it, so start outside.
    strictEqual(world.edit({ kind: "place", target: ann, pos: { x: 260, y: 100 } }).status, "ok");
    const walk = world.command({ command_id: "walk", actor: ann, verb: "move", args: { to: { x: -100, y: 100 } } });
    strictEqual(walk.status, "ok");
    deepStrictEqual(world.entity(ann)?.pos, { x: -100, y: 100 });
    strictEqual(world.command({ command_id: "back", actor: ann, verb: "move", args: { to: { x: 50, y: 30 } } }).status, "ok");
    strictEqual(world.command({ command_id: "shut", actor: ann, verb: "close", target: "gate" }).status, "ok");
    deepStrictEqual(world.entity(field)?.pos, { x: 0, y: 0 });
  }
});

test("the world's edits move it and its process changes it", (t) => {
  for (const world of worlds(t)) {
    const field = world.id("meadow")!;
    strictEqual(world.edit({ kind: "place", target: field, pos: { x: -40, y: 0 } }).status, "ok");
    deepStrictEqual(world.entity(field)?.pos, { x: -40, y: 0 });
    strictEqual(world.command({ command_id: "wait", actor: world.id("ann")!, verb: "wait", args: { ticks: 3 } }).status, "ok");
    ok(Number(world.entity(field)?.props.bloom) >= 3);
  }
});

test("scenery cannot also be what an agent would use", () => {
  for (const use of ["agent", "surface", "container", "openable", "light_source", "barrier"]) {
    const props: Record<string, unknown> = { scenery: true, [use]: true };
    throws(
      () => parseRegistry({ ...base, odd: { ...meadow, id: "odd", props, processes: [], fields: {} } }),
      (error: unknown) => error instanceof TypeError && error.message.includes("scenery"),
      use,
    );
  }
});
