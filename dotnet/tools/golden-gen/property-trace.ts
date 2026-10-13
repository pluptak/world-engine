// Records the TypeScript property sequences (tests/property-gen.ts, the seeds of tests/property-seeds-*.test.ts) as a corpus the .NET
// suite replays: for each seed, the generated steps in order, with a hash of what each step answered and of the snapshot it left.
// The generator reads the TypeScript snapshot to choose each step, so the steps are recorded, not regenerated, on the .NET side.
//
//   node --import tsx dotnet/tools/golden-gen/property-trace.ts [seeds] [steps]
//
// Writes dotnet/tests/WorldEngine.Tests/Fixtures/property/: initial.snapshot.json, templates/ (the fixture templates the property
// registry adds to templates/), and trace.jsonl.gz (one line per seed). Last generated from TypeScript at the commit that added it.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { canonicalJson, memoryWorld } from "../../../src/index.js";
import { loadTemplates } from "../../../src/templates.js";
import { buildInitial, genStep, mulberry32 } from "../../../tests/property-gen.js";
import { asEditCommand, registry } from "../../../tests/property-run.js";

const seeds = Number(process.argv[2] ?? 500);
const steps = Number(process.argv[3] ?? 30);
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, "dotnet/tests/WorldEngine.Tests/Fixtures/property");
mkdirSync(join(out, "templates"), { recursive: true });

const hash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

const shipped = loadTemplates(join(root, "templates"));
for (const [id, template] of Object.entries(registry)) {
  if (shipped[id] === undefined || canonicalJson(shipped[id]) !== canonicalJson(template)) {
    // The resolved template, with its nearest ancestor named again: `refine` reads the lineage a resolved set keeps.
    const { lineage, extends: _extends, ...declared } = template as Record<string, unknown>;
    const parent = id.includes(".") ? undefined : (lineage as string[] | undefined)?.[0];
    const written = parent === undefined ? declared : { id: declared.id, extends: parent, ...declared };
    writeFileSync(join(out, "templates", `${id}.json`), JSON.stringify(written, null, 2) + "\n");
  }
}
writeFileSync(join(out, "initial.snapshot.json"), canonicalJson(buildInitial(registry)) + "\n");

const lines: string[] = [];
for (let seed = 0; seed < seeds; seed += 1) {
  const world = memoryWorld(buildInitial(registry), registry);
  const rand = mulberry32(seed);
  const recorded: unknown[] = [];
  for (let i = 0; i < steps; i += 1) {
    const step = genStep(rand, world.snapshot(), `s${seed}-${i}`);
    const isCommand = "verb" in step;
    const result = isCommand ? world.command(step) : world.edit(step);
    recorded.push({ step: isCommand ? step : { edit: step }, result: hash(result), snapshot: hash(world.snapshot()) });
  }
  lines.push(JSON.stringify({ seed, steps: recorded }));
}
writeFileSync(join(out, "trace.jsonl.gz"), gzipSync(lines.join("\n") + "\n"));
console.log(`wrote ${seeds} seeds of ${steps} steps`);
void asEditCommand;
