// Template validation by mutation: for each of a dozen shipped templates, every key at depth up to three is set to each of fourteen
// wrong or odd values and, in turn, deleted. The set is written to a directory and loaded as `loadTemplates` loads it, and what comes back
// is one line: "ok <hash of the resolved set>" or the error message with the directory made `<dir>`. Writes
// Fixtures/template-fuzz.expected.json.gz as { cases: [[template, path, value-or-delete, answer]] }; the .NET suite writes the same
// directories and must give the same line for each.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { loadTemplates, templatesHash } from "../../../src/templates.js";
import { fixtures, root } from "./mixed-world.js";

const bases = ["stone", "human", "candle", "lantern", "wine_bottle", "human_hungry", "panel", "chest", "door", "bottle", "table", "human.hand_l"];
// No fraction: TypeScript accepts one wherever it asks for a finite number, .NET asks for a whole number (plans/ts-sunset.md).
const values: unknown[] = [null, "x", "", -1, 0, 1, 1000000, true, false, [], {}, [1], { a: 1 }];
const dir = mkdtempSync(join(tmpdir(), "fuzz-"));
cpSync(join(root, "templates"), dir, { recursive: true });

type Json = any;
function paths(value: Json, prefix: string[] = [], depth = 0): string[][] {
  const out: string[][] = [];
  if (depth >= 3 || value === null || typeof value !== "object") {
    return out;
  }
  const keys = Array.isArray(value) ? (value.length > 0 ? ["0"] : []) : Object.keys(value);
  for (const key of keys) {
    out.push([...prefix, key]);
    out.push(...paths(value[key], [...prefix, key], depth + 1));
  }
  return out;
}

function mutate(decl: Json, path: string[], value: unknown, remove: boolean): Json {
  const copy = JSON.parse(JSON.stringify(decl));
  let at = copy;
  for (const key of path.slice(0, -1)) {
    at = at[key];
  }
  const last = path[path.length - 1]!;
  if (remove) {
    if (Array.isArray(at)) {
      at.splice(Number(last), 1);
    } else {
      delete at[last];
    }
  } else {
    at[last] = value;
  }
  return copy;
}

const cases: unknown[][] = [];
for (const base of bases) {
  const file = join(dir, `${base}.json`);
  const original = readFileSync(file, "utf8");
  const decl = JSON.parse(original);
  for (const path of paths(decl)) {
    for (const variant of [...values.map((value) => ({ value, remove: false })), { value: undefined, remove: true }]) {
      writeFileSync(file, JSON.stringify(mutate(decl, path, variant.value, variant.remove)));
      let answer: string;
      try {
        answer = `ok ${templatesHash(loadTemplates(dir)).slice(0, 12)}`;
      } catch (error) {
        answer = (error as Error).message.split(dir).join("<dir>");
      }
      cases.push([base, path, variant.remove ? { delete: true } : { set: variant.value ?? null }, answer]);
    }
  }
  writeFileSync(file, original);
}
writeFileSync(join(fixtures, "template-fuzz.expected.json.gz"), gzipSync(JSON.stringify({ cases })));
rmSync(dir, { recursive: true, force: true });
const messages = new Set(cases.map((row) => String(row[3]).replace(/\d+/g, "N")));
console.log(`wrote ${cases.length} cases, ${cases.filter((row) => String(row[3]).startsWith("ok ")).length} ok, ${messages.size} distinct messages`);
