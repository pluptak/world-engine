import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  ENGINE_CAPABILITIES,
  createWorld,
  openWorld,
  verbs,
  verifyWorld,
  WorldError,
  type Coverage,
  type Delta,
  type Result,
  type WorldEdit,
} from "../api.js";
import { actorWorld } from "../actor-world.js";
import {
  CoverageSchema,
  RequestSchema,
  ResponseSchema,
  ScenarioSchema,
  SeededScenarioSchema,
  ValidationFailureSchema,
  describeContract,
  type Request,
} from "../contract.js";

function issue(code: string, message = code) {
  return { code, path: [], message };
}

function errorCode(error: unknown): string {
  return error instanceof WorldError ? error.code : "internal_error";
}

// The world's own failure code first, then the rules it broke: a caller sees which invariant failed.
function errorIssues(error: unknown): unknown[] {
  const rules = error instanceof WorldError ? [...error.issues] : [];
  return [issue(errorCode(error)), ...rules];
}

// What one run of the CLI answers: the text it writes to stdout and its exit code.
export interface CliOutput {
  stdout: string;
  status: number;
}

function writeResponse(out: CliOutput, response: unknown): void {
  const parsed = ResponseSchema.safeParse(response);
  if (!parsed.success) {
    const failure = {
      status: "invalid",
      issues: [issue("invalid_response")],
    };
    out.stdout += `${canonicalJson(ValidationFailureSchema.parse(failure))}\n`;
    out.status = 2;
    return;
  }
  out.stdout += `${canonicalJson(parsed.data)}\n`;
  if ("status" in parsed.data && parsed.data.status === "invalid") {
    out.status = 2;
  }
}

function parseJson(text: string): { success: true; value: unknown } | { success: false } {
  try {
    return { success: true, value: JSON.parse(text) as unknown };
  } catch {
    return { success: false };
  }
}

function initializeWorld(out: CliOutput, dir: string, scenarioPath: string, coveragePath?: string): void {
  let scenarioText: string;
  try {
    scenarioText = readFileSync(scenarioPath, "utf8");
  } catch {
    writeResponse(out, { status: "invalid", issues: [issue("no_such_scenario")] });
    return;
  }

  const parsedJson = parseJson(scenarioText);
  if (!parsedJson.success) {
    writeResponse(out, { status: "invalid", issues: [issue("invalid_scenario_json")] });
    return;
  }
  const parsedScenario = Array.isArray(parsedJson.value)
    ? ScenarioSchema.safeParse(parsedJson.value)
    : SeededScenarioSchema.safeParse(parsedJson.value);
  if (!parsedScenario.success) {
    writeResponse(out, { status: "invalid", issues: parsedScenario.error.issues });
    return;
  }
  const entities = Array.isArray(parsedScenario.data) ? parsedScenario.data : parsedScenario.data.entities;
  const seed = Array.isArray(parsedScenario.data) ? undefined : parsedScenario.data.seed;

  // Coverage is optional, and a world that declares none keeps the defaults. Each way the file can
  // be wrong gets its own code, so a caller knows whether to fix the path, the JSON or the shape.
  let coverage: Coverage | undefined;
  if (coveragePath !== undefined) {
    let coverageText: string;
    try {
      coverageText = readFileSync(coveragePath, "utf8");
    } catch {
      writeResponse(out, { status: "invalid", issues: [issue("no_such_coverage")] });
      return;
    }
    const parsedCoverageJson = parseJson(coverageText);
    if (!parsedCoverageJson.success) {
      writeResponse(out, { status: "invalid", issues: [issue("invalid_coverage_json")] });
      return;
    }
    const parsedCoverage = CoverageSchema.safeParse(parsedCoverageJson.value);
    if (!parsedCoverage.success) {
      writeResponse(out, {
        status: "invalid",
        issues: [issue("invalid_coverage"), ...parsedCoverage.error.issues],
      });
      return;
    }
    coverage = parsedCoverage.data;
  }

  const world = createWorld(dir, entities, undefined, {
    ...(coverage === undefined ? {} : { coverage }),
    ...(seed === undefined ? {} : { seed }),
  });
  out.stdout += `${canonicalJson({ status: "ok", world: dir, snapshot_version: world.snapshot().version })}\n`;
}

// A spawned entity arrives as one delta on the field "entity"; the contract also reports the relation
// fields it came with, so a caller can follow support and containment without reading the snapshot.
function commandResponse(result: Result, includeSnapshot: boolean) {
  const responseDeltas: Delta[] = [];
  for (const delta of result.deltas) {
    responseDeltas.push(delta);
    if (delta.field === "entity" && delta.to !== null && typeof delta.to === "object") {
      const entity = delta.to as Record<string, unknown>;
      for (const field of ["support", "contained_in", "location", "detached_from", "pos"]) {
        if (Object.hasOwn(entity, field)) {
          responseDeltas.push({
            event_id: delta.event_id,
            entity: delta.entity,
            field,
            from: null,
            to: entity[field],
          });
        }
      }
    }
  }

  return {
    status: result.status,
    command_id: result.command_id,
    resolved_target: result.resolved_target,
    ...(result.candidates !== undefined && { candidates: result.candidates }),
    ...(result.reason_code !== undefined && { reason_code: result.reason_code }),
    ...(result.reason_data !== undefined && { reason_data: result.reason_data }),
    snapshot_version: result.snapshot.version,
    deltas: responseDeltas,
    events: result.events,
    ...(includeSnapshot && { snapshot: result.snapshot }),
    ...(result.observation !== undefined && { observation: result.observation }),
  };
}

function dispatch(request: Request): unknown {
  if (request.op === "verbs") {
    return { verbs: verbs() };
  }
  if (request.op === "capabilities") {
    return structuredClone(ENGINE_CAPABILITIES);
  }
  if (request.op === "schema") {
    return describeContract();
  }
  if (request.op === "command") {
    const world = openWorld(request.world);
    const result = world.command(request.command, {
      basedOn: request.based_on_version,
      observe: request.observe,
    });
    return commandResponse(result, request.include_snapshot === true);
  }
  if (request.op === "edit") {
    const world = openWorld(request.world);
    // A beat's action is read by the engine, which refuses a malformed one `invalid_args`.
    const result = world.edit(
      request.edit as WorldEdit,
      { command_id: request.command_id, basedOn: request.based_on_version, perceivers: request.perceivers },
    );
    return commandResponse(result, request.include_snapshot === true);
  }
  if (request.op === "check") {
    const world = openWorld(request.world);
    return world.check(request.command);
  }
  if (request.op === "since") {
    const world = openWorld(request.world);
    return world.since(request.version);
  }
  if (request.op === "attempts") {
    return { attempts: openWorld(request.world).attempts(request.version) };
  }
  if (request.op === "verify") {
    // Not through openWorld, which would settle the files before they were compared.
    return verifyWorld(request.world);
  }
  if (request.op === "trace") {
    const world = openWorld(request.world);
    return world.trace(request.query);
  }
  if (request.op === "beat") {
    const world = openWorld(request.world);
    const includeSnapshot = request.include_snapshot === true;
    return {
      results: world
        .beat(request.commands, { basedOn: request.based_on_version })
        .map((result) => commandResponse(result, includeSnapshot)),
    };
  }
  const world = openWorld(request.world);
  if (request.op === "query") {
    return world.query(request.query);
  }
  if (request.op === "inspect") {
    return { inspection: openWorld(request.world).inspect(request.observer, request.entity) };
  }
  if (request.op === "options") {
    return world.options(request.actor, request.refused === undefined ? {} : { refused: request.refused });
  }
  if (request.op === "observe") {
    return world.observe(request.observer, request.since === undefined ? {} : { since: request.since });
  }
  if (request.op === "actor_observe") {
    return actorWorld(world, request.actor).observe(request.since === undefined ? {} : { since: request.since });
  }
  if (request.op === "actor_inspect") {
    return { inspection: actorWorld(world, request.actor).inspect(request.entity) };
  }
  if (request.op === "actor_options") {
    return actorWorld(world, request.actor).options(request.refused === undefined ? {} : { refused: request.refused });
  }
  if (request.op === "actor_check") {
    return actorWorld(world, request.actor).check(request.command);
  }
  if (request.op === "actor_command") {
    return actorWorld(world, request.actor).command(request.command, { basedOn: request.based_on_version });
  }
  return world.snapshot();
}

async function stdinText(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk.toString();
  }
  return text;
}

function invalidFromIssues(out: CliOutput, issues: unknown): void {
  writeResponse(out, { status: "invalid", issues });
}

// One run of the CLI in process: `init` from its arguments, any other request from `input`. The
// process entry below only feeds it stdin and writes out what it returns, so tests call it directly.
export function runCli(argv: readonly string[], input: string): CliOutput {
  const out: CliOutput = { stdout: "", status: 0 };
  try {
    if (argv[0] === "init") {
      if (argv.length !== 3 && argv.length !== 4) {
        invalidFromIssues(out, [issue("invalid_init_args")]);
        return out;
      }
      initializeWorld(out, argv[1]!, argv[2]!, argv[3]);
      return out;
    }

    const parsedJson = parseJson(input);
    if (!parsedJson.success) {
      invalidFromIssues(out, [issue("invalid_json")]);
      return out;
    }
    const parsedRequest = RequestSchema.safeParse(parsedJson.value);
    if (!parsedRequest.success) {
      invalidFromIssues(out, parsedRequest.error.issues);
      return out;
    }
    writeResponse(out, dispatch(parsedRequest.data));
  } catch (error) {
    invalidFromIssues(out, errorIssues(error));
  }
  return out;
}

async function main(argv: string[]): Promise<void> {
  const out = runCli(argv, argv[0] === "init" ? "" : await stdinText());
  process.stdout.write(out.stdout);
  process.exitCode = out.status;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  void main(process.argv.slice(2));
}
