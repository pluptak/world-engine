import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, memoryWorld, openWorld, type Scenario } from "../src/api.js";
import { CoverageSchema, ResponseSchema } from "../src/contract.js";
import { loadTemplates } from "../src/templates.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const bottleScenario = fileURLToPath(new URL("../scenarios/bottle.json", import.meta.url));
const innScenario = fileURLToPath(new URL("../scenarios/inn.json", import.meta.url));
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function runCli(input?: string, args: string[] = []) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    ...(input !== undefined && { input }),
  });
}

function temporaryDirectory(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-cli-coverage-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The coverage a world needs before anything can smell: the default covers sight and hearing only.
const smellCoverage = {
  relations: ["support", "contained_in", "attached_to", "status", "location", "near"],
  senses: ["sight", "hearing", "smell"],
  properties: ["integrity", "residue", "pos"],
};

function coverageFile(t: { after(callback: () => void): void }, coverage: unknown): string {
  const path = join(temporaryDirectory(t), "coverage.json");
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
  const world = join(temporaryDirectory(t), "world");
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
  const worldNoSmell = join(temporaryDirectory(t), "world-no-smell");
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
  const dir = temporaryDirectory(t);
  deepStrictEqual(
    issueCodes(runCli(undefined, ["init", join(dir, "world"), bottleScenario, join(dir, "absent.json")])),
    ["no_such_coverage"],
  );
});

test("init refuses a coverage file that is not JSON, and says so", (t) => {
  deepStrictEqual(
    issueCodes(runCli(undefined, ["init", join(temporaryDirectory(t), "world"), bottleScenario, coverageFile(t, "{not json")])),
    ["invalid_coverage_json"],
  );
});

test("init refuses a coverage of the wrong shape, naming the field", (t) => {
  const codes = issueCodes(
    runCli(undefined, [
      "init",
      join(temporaryDirectory(t), "world"),
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
      join(temporaryDirectory(t), "world"),
      bottleScenario,
      coverageFile(t, smellCoverage),
      "extra.json",
    ])),
    ["invalid_init_args"],
  );
});

test("init without a coverage file still writes the default coverage", (t) => {
  const world = join(temporaryDirectory(t), "world");
  const inited = runCli(undefined, ["init", world, bottleScenario]);
  strictEqual(inited.status, 0, inited.stderr);
  deepStrictEqual(openWorld(world).snapshot().coverage.senses, ["sight", "hearing"]);
});

// A sense nobody declares capacity for. Coverage accepts any name, so the world may cover `taste`,
// but no template part contributes it: what the engine answers is the finding, whatever it is.
const uncapableSense = "taste";
const uncapableCoverage = { ...smellCoverage, senses: ["sight", "hearing", uncapableSense] };

test("a covered sense with no capacity answers no_sense_capacity, not unsupported_sense", (t) => {
  const scenario: Scenario = [
    { id: "room", template: "room", overrides: { name: "room" } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: 0, y: 0 } } },
    { id: "table", template: "table", overrides: { name: "table", location: "room", support: "room", pos: { x: 10, y: 0 } } },
  ];

  for (const kind of ["store", "memory"] as const) {
    const world = kind === "store"
      ? createWorld(join(temporaryDirectory(t), "store"), scenario, registry, { coverage: uncapableCoverage })
      : memoryWorld(
        createWorld(join(temporaryDirectory(t), "memory"), scenario, registry).snapshot(),
        registry,
        { room: "e1", ann: "e2", table: "e3" },
        { coverage: uncapableCoverage },
      );
    const ann = world.id("ann");
    const table = world.id("table");
    ok(ann !== null && table !== null);

    // The entity form, and the event form: the same question about a thing and about what happened.
    const entityAnswer = world.query({ kind: "perceive", observer: ann, entity: table, sense: uncapableSense });
    deepStrictEqual(entityAnswer, { value: "false", basis_code: "no_sense_capacity" }, `${kind} entity form`);

    const moved = world.command({ command_id: "t1", actor: ann, verb: "move", args: { to: { x: 5, y: 0 } } });
    strictEqual(moved.status, "ok");
    const eventId = moved.events[0]?.event_id;
    ok(eventId !== undefined);
    const eventAnswer = world.query({ kind: "perceive", observer: ann, event_id: eventId, sense: uncapableSense });
    deepStrictEqual(eventAnswer, { value: "false", basis_code: "no_sense_capacity" }, `${kind} event form`);
  }
});

test("the coverage schema accepts a sense name the engine has no rule for", () => {
  // The boundary takes any name; what the engine can answer for it is the engine's business.
  const parsed = CoverageSchema.safeParse(uncapableCoverage);
  ok(parsed.success, "coverage schema refused a plain sense name");
});

test("a covered sense that some observer has capacity for but the engine does not answers unsupported_sense", (t) => {
  // Create a custom registry by cloning the human template and modifying it to add taste capacity
  const customRegistry = { ...registry };
  const humanTemplate = registry.human;
  if (humanTemplate === undefined) {
    throw new Error("human template not found");
  }
  // Modify a structuredClone of human in place, keeping its id, to add taste capacity to head
  const modifiedHuman = structuredClone(humanTemplate);
  modifiedHuman.parts = modifiedHuman.parts.map((part) =>
    part.name === "head" ? { ...part, contributes: { ...part.contributes, taste: 100 } } : part
  );
  customRegistry.human = modifiedHuman;

  const tasteCoverage = { ...smellCoverage, senses: ["sight", "hearing", "taste"] };
  const scenario: Scenario = [
    { id: "room", template: "room", overrides: { name: "room" } },
    { id: "taster", template: "human", overrides: { name: "taster", location: "room", support: "room", pos: { x: 0, y: 0 } } },
    { id: "table", template: "table", overrides: { name: "table", location: "room", support: "room", pos: { x: 10, y: 0 } } },
  ];

  for (const kind of ["store", "memory"] as const) {
    const world = kind === "store"
      ? createWorld(join(temporaryDirectory(t), "store"), scenario, customRegistry, { coverage: tasteCoverage })
      : memoryWorld(
        createWorld(join(temporaryDirectory(t), "memory"), scenario, customRegistry).snapshot(),
        customRegistry,
        { room: "e1", taster: "e2", table: "e3" },
        { coverage: tasteCoverage },
      );
    const taster = world.id("taster");
    const table = world.id("table");
    ok(taster !== null && table !== null);

    // The entity form: taste is covered and observer has capacity, but engine has no rule for taste
    const entityAnswer = world.query({ kind: "perceive", observer: taster, entity: table, sense: "taste" });
    deepStrictEqual(entityAnswer, { value: "false", basis_code: "unsupported_sense" }, `${kind} entity form`);

    // The event form: move command in same room, then query what the taster perceived
    const moved = world.command({ command_id: "t1", actor: taster, verb: "move", args: { to: { x: 5, y: 0 } } });
    strictEqual(moved.status, "ok");
    const eventId = moved.events[0]?.event_id;
    ok(eventId !== undefined);
    const eventAnswer = world.query({ kind: "perceive", observer: taster, event_id: eventId, sense: "taste" });
    deepStrictEqual(eventAnswer, { value: "false", basis_code: "unsupported_sense" }, `${kind} event form`);
  }
});
