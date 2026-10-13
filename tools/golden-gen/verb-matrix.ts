// A matrix of commands over the fixture snapshots, answered by TypeScript's pipeline: for each of the 55 snapshots in Fixtures (the
// states the verb goldens start from), the commands the world itself offers (`options`, ready and refused), and a seeded random sample of
// every verb with every kind of actor, target and argument, well formed or not. Each answer is one line: status, reason code, resolved
// target and reason data, and for an ok result a hash of the snapshot, events and deltas it made. Writes
// Fixtures/verb-matrix.expected.json.gz, one entry per snapshot: [command, answer] rows.
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { apply } from "../../../src/engine/pipeline.js";
import { verbCatalog } from "../../../src/engine/verbs/index.js";
import { canonicalJson } from "../../../src/index.js";
import { listOptions } from "../../../src/options.js";
import { loadTemplates } from "../../../src/templates.js";
import { mulberry32 } from "../../../tests/property-gen.js";
import { fixtures, root } from "./mixed-world.js";

const dir = mkdtempSync(join(tmpdir(), "matrix-"));
cpSync(join(root, "templates"), join(dir, "templates"), { recursive: true });
cpSync(join(fixtures, "test-templates"), join(dir, "templates"), { recursive: true });
const registry = loadTemplates(join(dir, "templates"));
const verbs = verbCatalog().filter((verb) => verb.verb !== "edit" && verb.verb !== "advance");

const hash8 = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 12);
type Json = Record<string, unknown>;

function answer(snapshot: any, command: Json): string {
  let result: any;
  try {
    result = apply(snapshot, registry, command as never);
  } catch (error) {
    // A throw is an engine fault on a state the fixture should not have reached; it is recorded so .NET has to throw there as well.
    return `throw|${(error as Error).message.slice(0, 60)}`;
  }
  const base = [result.status, result.reason_code ?? "", result.resolved_target ?? "", canonicalJson(result.reason_data ?? null)].join("|");
  return result.status === "ok" ? `${base}|${hash8(result.snapshot)}|${hash8(result.events)}|${hash8(result.deltas)}` : base;
}

const out: Record<string, [Json, string][]> = {};
const skipped: string[] = [];
let n = 0;
for (const file of readdirSync(fixtures).filter((name) => name.endsWith(".snapshot.json")).sort()) {
  const snapshot = JSON.parse(readFileSync(join(fixtures, file), "utf8"));
  const entities = Object.values(snapshot.entities) as any[];
  if (entities.some((entity) => registry[entity.template] === undefined)) {
    skipped.push(file);
    continue;
  }
  const ids = entities.map((entity) => entity.id as string);
  const agents = entities.filter((entity) => registry[entity.template]!.agent === true || (registry[entity.template]!.parts ?? []).some((part: any) => part.contributes?.moving)).map((entity) => entity.id as string);
  const rooms = entities.filter((entity) => entity.template === "room").map((entity) => entity.id as string);
  const rand = mulberry32(1000 + out.length);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
  const partsOf = (id: string): string[] => ((registry[snapshot.entities[id].template]?.parts ?? []) as any[]).map((part) => `${id}.${part.name}`);
  const addresses = [...ids, ...entities.map((entity) => entity.name).filter(Boolean), "ghost", ...agents.slice(0, 2).flatMap(partsOf)];
  const candidates = (arg: any): unknown[] => {
    switch (arg.kind) {
      case "int":
        return [0, 1, 5, 100, 100000, -1];
      case "address":
        return [pick(addresses), pick(addresses), pick(ids), "ghost"];
      case "enum":
        return [...arg.values, "bad"];
      case "pos":
        return [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 5000, y: 0 }, { x: 3 }];
      case "room":
        return [...rooms, "nowhere"];
      case "token":
        return ["hi", "", "x y"];
      default:
        return [];
    }
  };
  const argsFor = (verb: any): Json | undefined => {
    const names = Object.keys(verb.args);
    if (names.length === 0) {
      return rand() < 0.1 ? { surprise: 1 } : undefined;
    }
    const args: Json = {};
    for (const name of names) {
      const spec = verb.args[name];
      const present = spec.optional === true ? rand() < 0.5 : rand() < 0.9;
      if (present) {
        const options = candidates(spec);
        if (options.length > 0) {
          args[name] = pick(options);
        }
      }
    }
    return args;
  };

  const rows: [Json, string][] = [];
  const add = (command: Json) => {
    n += 1;
    rows.push([command, answer(snapshot, command)]);
  };
  // What the world itself offers each agent.
  for (const actor of agents.slice(0, 6)) {
    let options: any;
    try {
      options = listOptions(snapshot, registry, actor, { refused: true } as never, (command) => apply(snapshot, registry, command));
    } catch {
      // A hand-built fixture whose ids run past next_seq makes some dry run throw; the sample below still reaches it.
      continue;
    }
    for (const list of [options.ready, options.blocked ?? []]) {
      for (const option of (list ?? []).slice(0, 60)) {
        if (option.verb === undefined) {
          continue;
        }
        add({ command_id: `m${n}`, actor, verb: option.verb, ...(option.target === undefined ? {} : { target: option.target }), ...(option.args === undefined ? {} : { args: option.args }) });
      }
    }
  }
  // A seeded sample of everything else.
  for (let i = 0; i < 450; i += 1) {
    const verb = pick(verbs);
    const actor = rand() < 0.85 && agents.length > 0 ? pick(agents) : pick([...ids, "ghost"]);
    const args = argsFor(verb);
    add({ command_id: `m${n}`, actor, verb: verb.verb, ...(verb.requires_target || rand() < 0.2 ? { target: pick(addresses) } : {}), ...(args === undefined ? {} : { args }) });
  }
  out[file] = rows;
}
writeFileSync(join(fixtures, "verb-matrix.expected.json.gz"), gzipSync(canonicalJson({ skipped, snapshots: out })));
console.log(`wrote ${n} answers over ${Object.keys(out).length} snapshots, skipped ${skipped.length}: ${skipped.join(" ")}`);
