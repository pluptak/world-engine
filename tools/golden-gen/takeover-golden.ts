// A world whose templates.json names another set than its head (a crash between the stamps of an upgrade), opened by TypeScript: it is
// taken over when the log replays under the new set to the stored files, else refused with the lost field or `templates_changed`.
// The mixed run (40 waits, so the snapshot lags the log) is built, one stored part state is added by an edit, then each case patches
// the resolved set in templates.json, optionally damages a file, and records what opening does (the snapshot, or the error code), what
// `verify` says, and every file's hash after. Writes Fixtures/takeover-golden.expected.json.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, openWorld } from "../../../src/index.js";
import { build, fixtures, observe, scene, registry, shipped } from "./mixed-world.js";
import { exportExtras } from "./scripted.js";

exportExtras(registry, shipped, join(fixtures, "tamper-templates"));
const base = mkdtempSync(join(tmpdir(), "takeover-"));
const pristine = join(base, "w");
const list = build(pristine, 40);
const world = openWorld(pristine);
const extra = { edit: { kind: "set_part", target: world.id("ann")!, part: "arm_l", state: { integrity: 70, status: "damaged" } } };
world.edit(extra.edit as never);

type Patch = { path: string[]; set?: unknown; delete?: boolean };
const cases: { name: string; patches: Patch[]; damage?: { file: string; op: string }; observed?: unknown }[] = [
  { name: "no change in the set", patches: [] },
  { name: "a template added", patches: [{ path: ["extra_stone"], set: JSON.parse(JSON.stringify(JSON.parse(readFileSync(join(pristine, "templates.json"), "utf8")).stone)) }] },
  { name: "a value the history never touches", patches: [{ path: ["human", "mass_g"], set: 71000 }] },
  { name: "a value the history reads: the table is narrower", patches: [{ path: ["table", "size_cm", "w"], set: 25 }] },
  { name: "the bottle is heavier", patches: [{ path: ["bottle", "mass_g"], set: 4000 }] },
  { name: "the bottle template is gone", patches: [{ path: ["bottle"], delete: true }] },
  { name: "the table template is gone", patches: [{ path: ["table"], delete: true }] },
  { name: "the room no longer declares hush", patches: [{ path: ["room", "fields"], delete: true }] },
  { name: "the hush field changes type", patches: [{ path: ["room", "fields", "hush", "type"], set: "integer" }] },
  { name: "a human without its left arm part", patches: [{ path: ["human", "parts"], set: JSON.parse(readFileSync(join(pristine, "templates.json"), "utf8")).human.parts.filter((part: { name: string }) => part.name !== "arm_l") }] },
  { name: "a human who cannot move", patches: [{ path: ["human", "parts"], set: JSON.parse(readFileSync(join(pristine, "templates.json"), "utf8")).human.parts.map((part: { name: string; contributes: Record<string, number> }) => ({ ...part, contributes: Object.fromEntries(Object.entries(part.contributes).filter(([key]) => key !== "moving")) })) }] },
  { name: "the stone is lighter", patches: [{ path: ["stone", "mass_g"], set: 1 }] },
  { name: "a template removed that no entity has", patches: [{ path: ["candle"], delete: true }] },
  { name: "a new set with a changed value, and the deltas file gone", patches: [{ path: ["human", "mass_g"], set: 71000 }], damage: { file: "deltas.jsonl", op: "delete_file" } },
  { name: "a new set, and the events file cut", patches: [{ path: ["human", "mass_g"], set: 71000 }], damage: { file: "events.jsonl", op: "truncate" } },
  { name: "a new set, and the snapshot gone", patches: [{ path: ["human", "mass_g"], set: 71000 }], damage: { file: "snapshot.json", op: "delete_file" } },
  { name: "a new set, and the head gone", patches: [{ path: ["human", "mass_g"], set: 71000 }], damage: { file: "head.json", op: "delete_file" } },
];

function patched(text: string, patches: Patch[]): string {
  const value = JSON.parse(text) as Record<string, unknown>;
  for (const patch of patches) {
    let at: any = value;
    for (const key of patch.path.slice(0, -1)) {
      at = at[key];
    }
    const last = patch.path[patch.path.length - 1]!;
    if (patch.delete) {
      delete at[last];
    } else {
      at[last] = patch.set;
    }
  }
  return canonicalJson(value);
}

let count = 0;
for (const entry of cases) {
  count += 1;
  const dir = join(base, `c${count}`);
  cpSync(pristine, dir, { recursive: true });
  writeFileSync(join(dir, "templates.json"), patched(readFileSync(join(pristine, "templates.json"), "utf8"), entry.patches));
  if (entry.damage?.op === "delete_file") {
    rmSync(join(dir, entry.damage.file));
  } else if (entry.damage?.op === "truncate") {
    const path = join(dir, entry.damage.file);
    const bytes = readFileSync(path);
    writeFileSync(path, bytes.subarray(0, bytes.length - 7));
  }
  entry.observed = observe(dir);
  rmSync(dir, { recursive: true, force: true });
}
writeFileSync(
  join(fixtures, "takeover-golden.expected.json"),
  canonicalJson({ scene, steps: list, extra: extra, waits: 40, pristine: observe(pristine), cases }) + "\n",
);
rmSync(base, { recursive: true, force: true });
console.log(`wrote ${cases.length} cases`);
