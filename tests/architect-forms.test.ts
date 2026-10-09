import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, memoryWorld, WorldError, type Id, type Scenario, type ScenarioEntry, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { cli } from "./cli-run.js";
import { tempDir } from "./harness.js";

// The architect says "a tenth of the fuel" or "half full" in a scenario, and the engine stores the one
// exact value: fuel, liquid_amount and liquid_material, integrity, hunger or portions.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const at = (x: number) => ({ location: "hall", support: "hall", pos: { x, y: 0 } });

function built(t: { after(callback: () => void): void }, entry: ScenarioEntry): World {
  const scenario: Scenario = [{ id: "hall", template: "room", overrides: { name: "hall" } }, entry];
  return createWorld(join(tempDir(t), "w"), scenario, registry);
}

function stored(t: { after(callback: () => void): void }, template: string, forms: Record<string, unknown>) {
  const world = built(t, { id: "thing", template, overrides: { name: "thing", ...at(0), ...forms } as ScenarioEntry["overrides"] });
  return world.entity(world.id("thing")!)!;
}

function refusal(t: { after(callback: () => void): void }, template: string, forms: Record<string, unknown>): string {
  const dir = join(tempDir(t), "w");
  try {
    createWorld(dir, [{ id: "hall", template: "room", overrides: { name: "hall" } }, { id: "thing", template, overrides: { name: "thing", ...at(0), ...forms } as ScenarioEntry["overrides"] }], registry);
  } catch (error) {
    return error instanceof WorldError ? error.code : `not a WorldError: ${String(error)}`;
  }
  return "built";
}

test("each form stores the one exact value", (t) => {
  // A bottle starts full; a form says otherwise.
  strictEqual(stored(t, "bottle", {}).props.liquid_amount, 750);
  deepStrictEqual(stored(t, "bottle", { liquid: { pct: 100 } }).props.liquid_amount, 750);
  const half = stored(t, "wine_bottle", { liquid: { pct: 50 } });
  deepStrictEqual([half.props.liquid_amount, half.props.liquid_material], [375, "grape_wine"]);
  // pct 0 stores an amount of 0 and no material at all, as an emptied vessel has.
  const emptied = stored(t, "bottle", { liquid: { pct: 0 } });
  deepStrictEqual([emptied.props.liquid_amount, emptied.props.liquid_material], [0, ""]);
  // A cup holds nothing until told what, and then 250 is full.
  deepStrictEqual(stored(t, "cup", {}).props.liquid_amount, undefined);
  const water = stored(t, "cup", { liquid: { material: "water", pct: 100 } });
  deepStrictEqual([water.props.liquid_amount, water.props.liquid_material], [250, "water"]);
  const beer = stored(t, "bottle", { liquid: { material: "beer", pct: 10 } });
  deepStrictEqual([beer.props.liquid_amount, beer.props.liquid_material], [75, "beer"]);

  // A candle's 8 fuel: 10% is 1, not 0, so it still lights; 0% is 0; a lantern's 20 at 50% is 10.
  deepStrictEqual([10, 0, 100, 12].map((pct) => stored(t, "candle", { fuel_pct: pct }).props.fuel), [1, 0, 8, 0 + 1]);
  strictEqual(stored(t, "lantern", { fuel_pct: 50 }).props.fuel, 10);
  strictEqual(stored(t, "candle", {}).props.fuel, 8);

  deepStrictEqual([stored(t, "stone", { condition: "damaged" }).integrity, stored(t, "stone", { condition: "intact" }).integrity], [50, 100]);
  deepStrictEqual([50, 25, 100, 1].map((pct) => stored(t, "bread", { portions_pct: pct }).props.portions), [2, 1, 4, 1]);
  deepStrictEqual([100, 0, 40].map((pct) => stored(t, "human_hungry", { hunger_pct: pct }).props.hunger), [100, 0, 40]);

  // The form is gone from the entity: nothing but the stored value is left.
  const entity = stored(t, "candle", { fuel_pct: 50, condition: "damaged" });
  ok(!("fuel_pct" in entity) && !("condition" in entity));
  deepStrictEqual([entity.props.fuel, entity.integrity], [4, 50]);
  // Forms mix with the plain state a scenario writes.
  deepStrictEqual(stored(t, "candle", { fuel_pct: 50, props: { burning: true } }).props, { light_source: true, burning: true, fuel: 4 });
});

test("a bad form is refused with its code and builds no world", (t) => {
  const codes = (template: string, forms: Record<string, unknown>) => refusal(t, template, forms);
  for (const bad of [101, -1, 1.5, "50", null, Number.NaN]) {
    strictEqual(codes("candle", { fuel_pct: bad }), "invalid_form", String(bad));
  }
  strictEqual(codes("bread", { portions_pct: 150 }), "invalid_form");
  strictEqual(codes("human_hungry", { hunger_pct: 1.2 }), "invalid_form");
  strictEqual(codes("stone", { condition: "ruined" }), "invalid_form");
  strictEqual(codes("bottle", { liquid: { pct: 101 } }), "invalid_form");
  strictEqual(codes("bottle", { liquid: { pct: 50, extra: 1 } }), "invalid_form");
  strictEqual(codes("bottle", { liquid: { pct: 50, material: "" } }), "invalid_form");
  strictEqual(codes("bottle", { liquid: "half" }), "invalid_form");
  // One fact is written one way: the raw value beside a form is not the architect's to write at all.
  strictEqual(codes("candle", { fuel_pct: 50, props: { fuel: 3 } }), "field_not_editable");
  strictEqual(codes("bottle", { liquid: { pct: 50 }, props: { liquid_amount: 3 } }), "field_not_editable");
  strictEqual(codes("stone", { condition: "damaged", integrity: 20 }), "field_not_editable");

  // A template that declares nothing to convert to.
  strictEqual(codes("stone", { fuel_pct: 50 }), "form_not_applicable");
  strictEqual(codes("stone", { liquid: { material: "water", pct: 50 } }), "form_not_applicable");
  strictEqual(codes("human", { hunger_pct: 50 }), "form_not_applicable");
  strictEqual(codes("stone", { portions_pct: 50 }), "form_not_applicable");
  // A cup holds no material of its own, so a share of it needs one named; none at 0% is fine.
  strictEqual(codes("cup", { liquid: { pct: 50 } }), "no_liquid_material");
  strictEqual(codes("cup", { liquid: { pct: 0 } }), "built");
  strictEqual(codes("bottle", { liquid: { pct: 50 } }), "built");

  // Nothing is written for a refused scenario.
  const dir = join(tempDir(t), "never");
  throws(() => createWorld(dir, [{ template: "stone", overrides: { fuel_pct: 50 } }], registry), WorldError);
  strictEqual(existsSync(dir), false);
});

test("a form is the architect's: an edit spawn refuses it", (t) => {
  const world = built(t, { id: "stone", template: "stone", overrides: { name: "stone", ...at(0) } });
  const spawn = world.edit({ kind: "spawn", template: "candle", overrides: { name: "c", fuel_pct: 50 } as never });
  deepStrictEqual([spawn.status, spawn.reason_code], ["invalid", "invalid_args"]);
});

test("the CLI inits a world from a scenario with forms, and refuses a bad one by its code", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "scenario.json");
  writeFileSync(
    file,
    JSON.stringify([
      { id: "hall", template: "room", overrides: { name: "hall" } },
      { id: "wick", template: "candle", overrides: { name: "wick", ...at(0), fuel_pct: 50 } },
    ]),
  );
  const inited = cli("", ["init", join(dir, "w"), file]);
  strictEqual(inited.status, 0, inited.stdout);
  const snapshot = JSON.parse(cli(JSON.stringify({ op: "snapshot", world: join(dir, "w") })).stdout) as { entities: Record<Id, { props: Record<string, number> }> };
  strictEqual(snapshot.entities.e2?.props.fuel, 4);

  writeFileSync(file, JSON.stringify([{ id: "wick", template: "candle", overrides: { name: "wick", fuel_pct: 500 } }]));
  const refused = cli("", ["init", join(dir, "bad"), file]);
  strictEqual(refused.status, 2);
  ok(refused.stdout.includes("invalid_form"), refused.stdout);
});

test("a vessel is bounded by its capacity_cm3: a cup by 250, a chest still by its inner volume", (t) => {
  const dir = join(tempDir(t), "w");
  const world = createWorld(
    dir,
    [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "ann", template: "human", overrides: { name: "ann", ...at(0) } },
      { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "hall", contained_in: "ann" } },
      { id: "cup", template: "cup", overrides: { name: "cup", ...at(40) } },
      { id: "chest", template: "chest", overrides: { name: "chest", ...at(-40) } },
    ],
    registry,
  );
  const ann = world.id("ann")!;
  let n = 0;
  const pour = (destination: string, amount?: number) =>
    world.command({ command_id: `pour-${(n += 1)}`, actor: ann, verb: "pour", target: "bottle", args: { destination, ...(amount !== undefined && { amount }) } });
  const tooMuch = pour("cup", 300);
  deepStrictEqual([tooMuch.status, tooMuch.reason_code, tooMuch.reason_data], ["refused", "container_full", { requested: 300, held: 0, capacity: 250 }]);
  strictEqual(pour("cup", 250).status, "ok");
  const more = pour("cup", 1);
  deepStrictEqual(more.reason_data, { requested: 1, held: 250, capacity: 250 });
  // A chest declares no capacity_cm3, so its inner volume (55 x 35 x 35) bounds it as it always did.
  const rest = world.entity(world.id("bottle")!)!.props.liquid_amount as number;
  strictEqual(rest, 500);
  strictEqual(pour("chest").status, "ok");
  strictEqual(world.entity(world.id("chest")!)?.props.liquid_amount, 500);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

test("capacity_cm3 is an integer of at least 1, in a template and in a stored entity", (t) => {
  const withCapacity = (value: unknown) => () => parseRegistry({ ...registry, jar: { id: "jar", extends: "cup", props: { capacity_cm3: value } } });
  ok(Object.keys(withCapacity(300)()).includes("jar"));
  throws(withCapacity(0), /props.capacity_cm3 must be at least 1/);
  throws(withCapacity(-5), /props.capacity_cm3 must be at least 1/);
  throws(withCapacity(2.5), /props.capacity_cm3 must be an integer/);
  // A snapshot written by hand with a capacity of 0 on an entity is refused by the same rule.
  const world = built(t, { id: "cup", template: "cup", overrides: { name: "cup", ...at(0) } });
  const snapshot = world.snapshot();
  const cup = snapshot.entities.e2!;
  const bad = { ...snapshot, entities: { ...snapshot.entities, e2: { ...cup, props: { ...cup.props, capacity_cm3: 0 } } } };
  ok(validateSnapshot(bad, registry).some((issue) => issue.code === "wrong_prop_type"));
});
