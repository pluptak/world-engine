import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CapabilitiesResponseSchema } from "../src/contract.js";
import {
  createWorld,
  ENGINE_CAPABILITIES,
  memoryWorld,
  WorldError,
  type Coverage,
  type Scenario,
  type World,
} from "../src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

// A lit room with ann holding a warm cup: `temperature` is a prop the scenario gives it.
const scenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: 0, y: 0 } } },
  { id: "cup", template: "cup", overrides: { name: "cup", location: "room", contained_in: "ann", props: { temperature: 60 } } },
];

function world(t: { after(callback: () => void): void }, coverage?: Coverage): World {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-capabilities-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return createWorld(join(dir, "w"), scenario, undefined, coverage === undefined ? {} : { coverage });
}

const refusesCoverage = (code: string, path: string[]) => (error: unknown) =>
  error instanceof WorldError &&
  error.code === "invalid_snapshot" &&
  JSON.stringify(error.issues?.map((issue) => [issue.code, issue.path])) === JSON.stringify([[code, path]]);

test("a world may not cover a sense or a relation the engine has no rule for", (t) => {
  const base: Coverage = { relations: ["support"], senses: ["sight"], properties: [] };
  throws(
    () => world(t, { ...base, senses: ["sight", "taste"] }),
    refusesCoverage("coverage_not_computable", ["coverage", "senses", "taste"]),
  );
  throws(
    () => world(t, { ...base, relations: ["support", "owns"] }),
    refusesCoverage("coverage_not_computable", ["coverage", "relations", "owns"]),
  );
  // A memory world built from a snapshot that claims one is refused the same way.
  const snapshot = world(t).snapshot();
  throws(
    () => memoryWorld({ ...snapshot, coverage: { ...snapshot.coverage, senses: ["sight", "taste"] } }),
    refusesCoverage("coverage_not_computable", ["coverage", "senses", "taste"]),
  );
});

test("unknown says why: a sense the engine cannot compute, or one this world does not model", (t) => {
  const w = world(t);
  const ann = w.id("ann")!;
  const cup = w.id("cup")!;
  const perceive = (sense: string) => w.query({ kind: "perceive", observer: ann, entity: cup, sense });
  deepStrictEqual(perceive("taste"), { value: "unknown", basis_code: "engine_incapable" });
  deepStrictEqual(perceive("smell"), { value: "unknown", basis_code: "uncovered_sense" });
  strictEqual(perceive("sight").value, "true");
});

test("properties are open: a world covers any prop its entities carry", (t) => {
  const covered = world(t, {
    relations: ["support", "contained_in", "location"],
    senses: ["sight", "hearing"],
    properties: ["integrity", "temperature"],
  });
  const cup = covered.id("cup")!;
  deepStrictEqual(covered.query({ kind: "fact", subject: cup, relation: "temperature", object: "60" }), {
    value: "true",
    basis_code: "property_state",
  });
  const plain = world(t);
  deepStrictEqual(plain.query({ kind: "fact", subject: plain.id("cup")!, relation: "temperature" }), {
    value: "unknown",
    basis_code: "uncovered_category",
  });
});

test("the capability list is frozen, and the CLI answers it", () => {
  throws(() => {
    (ENGINE_CAPABILITIES.senses as unknown as string[]).push("taste");
  }, TypeError);
  const cli = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ op: "capabilities" }),
  });
  strictEqual(cli.status, 0, cli.stderr);
  deepStrictEqual(CapabilitiesResponseSchema.parse(JSON.parse(cli.stdout)), structuredClone(ENGINE_CAPABILITIES));
});
