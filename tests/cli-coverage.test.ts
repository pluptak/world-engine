import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cli } from "./cli-run.js";
import { createWorld, memoryWorld, openWorld, WorldError, type Scenario } from "../src/api.js";
import { CoverageSchema, ResponseSchema } from "../src/contract.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const bottleScenario = fileURLToPath(new URL("../scenarios/bottle.json", import.meta.url));
const innScenario = fileURLToPath(new URL("../scenarios/inn.json", import.meta.url));
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function runCli(input?: string, args: string[] = []) {
  return cli(input, args);
}

// The coverage a world needs before anything can smell: the default covers sight and hearing only.
const smellCoverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "smell"],
  properties: ["integrity", "residue", "pos"],
};

function coverageFile(t: { after(callback: () => void): void }, coverage: unknown): string {
  const path = join(tempDir(t), "coverage.json");
  writeFileSync(path, typeof coverage === "string" ? coverage : JSON.stringify(coverage));
  return path;
}

function issueCodes(result: ReturnType<typeof runCli>): string[] {
  strictEqual(result.status, 2, result.stdout);
  const response = ResponseSchema.parse(JSON.parse(result.stdout));
  ok("issues" in response, "expected an invalid response");
  return response.issues.map((entry) => entry.code);
}

test("a world inited with a coverage file answers smell from the sense table", (t) => {
  const world = join(tempDir(t), "world");
  const inited = runCli(undefined, ["init", world, innScenario, coverageFile(t, smellCoverage)]);
  strictEqual(inited.status, 0, inited.stderr);
  strictEqual(JSON.parse(inited.stdout).status, "ok");

  // Dog (rex) smelling the wine bottle in the same room should answer true with same_location basis
  const queried = runCli(JSON.stringify({
    op: "query",
    world,
    query: { kind: "perceive", observer: openWorld(world).id("rex"), entity: openWorld(world).id("bottle"), sense: "smell" },
  }));
  strictEqual(queried.status, 0, queried.stderr);
  const answer = JSON.parse(queried.stdout) as { value: string; basis_code: string };
  deepStrictEqual(answer, { value: "true", basis_code: "same_location" }, "dog should smell bottle in same room");

  // Without coverage file, smell is uncovered
  const worldNoSmell = join(tempDir(t), "world-no-smell");
  const initedNoSmell = runCli(undefined, ["init", worldNoSmell, innScenario]);
  strictEqual(initedNoSmell.status, 0, initedNoSmell.stderr);

  const queriedNoSmell = runCli(JSON.stringify({
    op: "query",
    world: worldNoSmell,
    query: { kind: "perceive", observer: openWorld(worldNoSmell).id("rex"), entity: openWorld(worldNoSmell).id("bottle"), sense: "smell" },
  }));
  strictEqual(queriedNoSmell.status, 0, queriedNoSmell.stderr);
  const answerNoSmell = JSON.parse(queriedNoSmell.stdout) as { value: string; basis_code: string };
  deepStrictEqual(answerNoSmell, { value: "unknown", basis_code: "uncovered_sense" }, "smell should be uncovered without coverage file");
});

test("init refuses a coverage file it cannot read, and names the file", (t) => {
  const dir = tempDir(t);
  deepStrictEqual(
    issueCodes(runCli(undefined, ["init", join(dir, "world"), bottleScenario, join(dir, "absent.json")])),
    ["no_such_coverage"],
  );
});

test("init refuses a coverage file that is not JSON, and says so", (t) => {
  deepStrictEqual(
    issueCodes(runCli(undefined, ["init", join(tempDir(t), "world"), bottleScenario, coverageFile(t, "{not json")])),
    ["invalid_coverage_json"],
  );
});

test("init refuses a coverage of the wrong shape, naming the field", (t) => {
  const codes = issueCodes(
    runCli(undefined, [
      "init",
      join(tempDir(t), "world"),
      bottleScenario,
      coverageFile(t, { ...smellCoverage, senses: "smell" }),
    ]),
  );
  strictEqual(codes[0], "invalid_coverage");
  ok(codes.length > 1, "expected the schema's own issue after the code");
});

test("four arguments is still invalid_init_args", (t) => {
  deepStrictEqual(
    issueCodes(runCli(undefined, [
      "init",
      join(tempDir(t), "world"),
      bottleScenario,
      coverageFile(t, smellCoverage),
      "extra.json",
    ])),
    ["invalid_init_args"],
  );
});

test("init without a coverage file still writes the default coverage", (t) => {
  const world = join(tempDir(t), "world");
  const inited = runCli(undefined, ["init", world, bottleScenario]);
  strictEqual(inited.status, 0, inited.stderr);
  deepStrictEqual(openWorld(world).snapshot().coverage.senses, ["sight", "hearing"]);
});

// A sense the engine has no rule for. The coverage schema takes any name; validation refuses a world
// that covers one, so it never answers `false` where it meant "modelled".
const uncapableSense = "taste";
const uncapableCoverage = { ...smellCoverage, senses: ["sight", "hearing", uncapableSense] };

test("the coverage schema accepts a sense name the engine has no rule for", () => {
  const parsed = CoverageSchema.safeParse(uncapableCoverage);
  ok(parsed.success, "coverage schema refused a plain sense name");
});

test("a world covering a sense the engine has no rule for is refused, even with a template that contributes it", (t) => {
  // A human whose head contributes taste: the capacity is there, the rule is not.
  const customRegistry = { ...registry };
  const humanTemplate = registry.human;
  if (humanTemplate === undefined) {
    throw new Error("human template not found");
  }
  const modifiedHuman = structuredClone(humanTemplate);
  modifiedHuman.parts = modifiedHuman.parts.map((part) =>
    part.name === "head" ? { ...part, contributes: { ...part.contributes, taste: 100 } } : part
  );
  customRegistry.human = modifiedHuman;
  const scenario: Scenario = [
    { id: "room", template: "room", overrides: { name: "room" } },
    { id: "taster", template: "human", overrides: { name: "taster", location: "room", support: "room", pos: { x: 0, y: 0 } } },
  ];
  const refused = (error: unknown) =>
    error instanceof WorldError &&
    error.code === "invalid_snapshot" &&
    error.issues?.[0]?.code === "coverage_not_computable";

  throws(
    () => createWorld(join(tempDir(t), "store"), scenario, customRegistry, { coverage: uncapableCoverage }),
    refused,
  );
  const plain = createWorld(join(tempDir(t), "memory"), scenario, customRegistry).snapshot();
  throws(() => memoryWorld(plain, customRegistry, { room: "e1", taster: "e2" }, { coverage: uncapableCoverage }), refused);
  // Asked anyway, of a world that covers only what the engine computes, taste is unknown, not false.
  const world = memoryWorld(plain, customRegistry, { room: "e1", taster: "e2" });
  deepStrictEqual(world.query({ kind: "perceive", observer: "e2", entity: "e1", sense: uncapableSense }), {
    value: "unknown",
    basis_code: "engine_incapable",
  });
});
