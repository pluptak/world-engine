// The cases of tests/refine.test.ts as a scripted golden: every refusal `refine` has, the refinements that are allowed, and the
// authors and shapes that are not. Writes Fixtures/refine-golden.expected.json and Fixtures/refine-templates/.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../../src/index.js";
import { loadTemplates, parseRegistry } from "../../../src/templates.js";
import { exportExtras, Script } from "./scripted.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtures = join(root, "dotnet/tests/WorldEngine.Tests/Fixtures");
const shipped = loadTemplates(join(root, "templates"));
const registry = parseRegistry({
  ...(JSON.parse(canonicalJson(shipped)) as Record<string, unknown>),
  small_table: { id: "small_table", extends: "table", size_cm: { w: 20, d: 15, h: 75 } },
  flat_table: { id: "flat_table", extends: "table", props: { surface: false } },
  big_chest: { id: "big_chest", extends: "chest", size_cm: { w: 130, d: 70, h: 40 } },
  tiny_chest: { id: "tiny_chest", extends: "chest", props: { inner_w_cm: 10, inner_d_cm: 10, inner_h_cm: 10 } },
  half_bottle: { id: "half_bottle", extends: "bottle", props: { capacity_cm3: 500 } },
  sturdy_bottle: { id: "sturdy_bottle", extends: "bottle", mass_g: 900, props: { break_fall_cm: 400 } },
  frail: { id: "frail", extends: "human", part_overrides: { arm_l: { max_integrity: 50 } } },
  torso_only: {
    id: "torso_only",
    extends: "human",
    parts: [
      { name: "head", parent: null, contributes: { sight: 100, hearing: 100, speech: 100 }, detachable: false, max_integrity: 100 },
      { name: "torso", parent: null, contributes: { moving: 100, touch: 100 }, detachable: false, max_integrity: 100 },
    ],
  },
});
exportExtras(registry, shipped, join(fixtures, "refine-templates"));

const floor = (x: number, y = 0) => ({ location: "hall", support: "hall", pos: { x, y } });
const names = ["hall", "table", "book", "box", "chest", "stone", "bottle", "lamp", "ann", "flask"];
const script = new Script(
  [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "table", template: "table", overrides: { name: "table", ...floor(0) } },
    { id: "book", template: "book", overrides: { name: "book", location: "hall", support: "table" } },
    { id: "box", template: "chest", overrides: { name: "box", location: "hall", support: "table" } },
    { id: "chest", template: "chest", overrides: { name: "chest", ...floor(300) } },
    { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", contained_in: "chest" } },
    { id: "bottle", template: "bottle", overrides: { name: "bottle", ...floor(-300) } },
    { id: "lamp", template: "lantern", overrides: { name: "lamp", ...floor(-200), fuel_pct: 25, props: { burning: true } } },
    { id: "ann", template: "human", overrides: { name: "ann", ...floor(200) } },
    { id: "flask", template: "bottle", overrides: { name: "flask", ...floor(-400) } },
  ],
  registry,
  names,
);
const id = script.ids as Record<string, string>;
const refine = (name: string, target: string, template: string) => script.edit(name, { kind: "refine", target, template });

// Not refinements: a stranger, the same preset; then a lantern becomes a candle, and cannot go back; a wine bottle through two steps.
refine("stranger", id.book, "chest");
refine("same preset", id.lamp, "lantern");
refine("lantern to candle", id.lamp, "candle");
refine("candle back to lantern", id.lamp, "lantern");
refine("bottle to wine bottle", id.bottle, "wine_bottle");
refine("table to small table (book in the way)", id.table, "small_table");
refine("unknown preset", id.bottle, "no_such_preset");
// Fit refusals, then the same refinements once what was in the way is removed.
refine("flat table under a book", id.table, "flat_table");
refine("box outgrows the table", id.box, "big_chest");
script.edit("remove the book", { kind: "remove", target: id.book });
script.edit("remove the box", { kind: "remove", target: id.box });
refine("table to small table", id.table, "small_table");
// Contents and liquid.
refine("chest too small for the stone", id.chest, "tiny_chest");
refine("more liquid than the vessel holds", id.flask, "half_bottle");
script.edit("pour down to what fits", { kind: "update_props", target: id.flask, props: { liquid_amount: 500 } });
refine("flask to half bottle", id.flask, "half_bottle");
refine("flask to sturdy bottle", id.flask, "sturdy_bottle");
// Parts.
script.edit("arm at 80", { kind: "set_part", target: id.ann, part: "arm_l", state: { integrity: 80, status: "intact" } });
script.edit("torso at 30", { kind: "set_part", target: id.ann, part: "torso", state: { integrity: 30, status: "damaged" } });
refine("arm stronger than frail allows", id.ann, "frail");
script.edit("arm at 50", { kind: "set_part", target: id.ann, part: "arm_l", state: { integrity: 50, status: "intact" } });
refine("ann to frail", id.ann, "frail");
const bob = script.edit("spawn bob", { kind: "spawn", template: "human", overrides: { name: "bob", location: id.hall, support: id.hall, pos: { x: 100, y: 0 } } });
const bobId = bob.events.find((event: any) => event.type === "spawned").entity;
script.edit("bob loses a hand", { kind: "set_part", target: bobId, part: "hand_l", state: { integrity: 0, status: "destroyed" } });
refine("bob to torso only", bobId, "torso_only");
const cy = script.edit("spawn cy", { kind: "spawn", template: "human", overrides: { name: "cy", location: id.hall, support: id.hall, pos: { x: 120, y: 0 } } });
refine("cy to torso only", cy.events.find((event: any) => event.type === "spawned").entity, "torso_only");
// Who may refine, and in what shape.
script.command("an actor refines", { command_id: "c1", actor: id.ann, verb: "edit", target: id.lamp, args: { edit: { kind: "refine", target: id.lamp, template: "candle" } } });
refine("empty template", id.lamp, "");
script.edit("refine is no beat action", { kind: "schedule_beat", id: "b1", at_tick: 5, action: { kind: "refine", target: id.lamp, template: "candle" } });
script.snapshot("end");
script.save(join(fixtures, "refine-golden.expected.json"));
console.log(`wrote ${script.rows.length} rows`);
