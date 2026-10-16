// The behaviours the .NET port first refused as not ported, each answered by TypeScript: a chance process that rolls, a process that
// removes its entity, a destroyed body's successor, a beat edit with no cause, a spawn with an explicit null in_part, and a spawn with
// a trait that is not a string. Writes Fixtures/gap-golden.expected.json (run on the shipped templates plus Fixtures/test-templates).
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld } from "../../../src/index.js";
import { apply } from "../../../src/engine/pipeline.js";
import { loadTemplates } from "../../../src/templates.js";
import { canonicalJson } from "../../../src/engine/canonical.js";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = mkdtempSync(join(tmpdir(), "gap-"));
cpSync(`${root}/templates`, join(dir, "templates"), { recursive: true });
cpSync(`${root}/tests/WorldEngine.Tests/Fixtures/test-templates`, join(dir, "templates"), { recursive: true });
const registry = loadTemplates(join(dir, "templates"));

const hall = { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } };
const at = (x: number, y: number) => ({ location: "hall", support: "hall", pos: { x, y } });
const rows: unknown[] = [];
let n = 0;
function row(name: string, scene: any, command: any) {
  n += 1;
  const world = createWorld(join(dir, `w${n}`), scene, registry);
  const snapshot = world.snapshot();
  const result = apply(snapshot, registry, command);
  rows.push({ name, snapshot, command, result });
}
const advance = (ticks: number) => ({ command_id: "g1", actor: "world", verb: "advance", args: { ticks } });
const edit = (e: unknown) => ({ command_id: "g1", actor: "world", verb: "edit", args: { edit: e } });

row("chance process rolls", { seed: 7, entities: [hall, { id: "moss", template: "lichen", overrides: { name: "moss", ...at(0, 0) } }] }, advance(6));
row("process removes its entity", { entities: [hall, { id: "fly", template: "mayfly", overrides: { name: "fly", ...at(0, 0) } }] }, advance(3));
row("destroyed body leaves its successor", { entities: [hall, { id: "ann", template: "rotting_human", overrides: { name: "ann", ...at(0, 0) } }] }, advance(1));
row(
  "beat edit with no cause",
  {
    entities: [hall, { id: "rock", template: "stone", overrides: { name: "rock", ...at(0, 0) } }],
    beats: [{ id: "b1", at_tick: 1, action: { kind: "set_props", target: "hall", props: { lit: false } } }],
  },
  advance(1),
);
const people = [hall, { id: "ann", template: "human", overrides: { name: "ann", ...at(0, 0) } }];
row("spawn into a holder with in_part null", { entities: people }, edit({ kind: "spawn", template: "stone", overrides: { location: "e1", contained_in: "e2", in_part: null } }));
row("spawn into a holder with in_part omitted", { entities: people }, edit({ kind: "spawn", template: "stone", overrides: { location: "e1", contained_in: "e2" } }));
row("spawn with a trait that is not a string", { entities: people }, edit({ kind: "spawn", template: "stone", overrides: { location: "e1", support: "e1", pos: { x: 5, y: 5 }, traits: { mood: 3 } } }));

writeFileSync(`${root}/tests/WorldEngine.Tests/Fixtures/gap-golden.expected.json`, canonicalJson(JSON.parse(JSON.stringify(rows))));
console.log(rows.map((r: any) => `${r.name}: ${r.result.status} ${r.result.reason_code ?? ""} ev=${r.result.events.length}`).join("\n"));
