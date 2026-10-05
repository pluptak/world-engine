import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  createWorld,
  openWorld,
  verbs,
  WorldError,
  type Coverage,
  type Delta,
  type Result,
} from "../api.js";
import {
  CoverageSchema,
  RequestSchema,
  ResponseSchema,
  ScenarioSchema,
  ValidationFailureSchema,
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

function writeResponse(response: unknown): void {
  const parsed = ResponseSchema.safeParse(response);
  if (!parsed.success) {
    const failure = {
      status: "invalid",
      issues: [issue("invalid_response")],
    };
    process.stdout.write(`${canonicalJson(ValidationFailureSchema.parse(failure))}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${canonicalJson(parsed.data)}\n`);
  if ("status" in parsed.data && parsed.data.status === "invalid") {
    process.exitCode = 2;
  }
}

function parseJson(text: string): { success: true; value: unknown } | { success: false } {
  try {
    return { success: true, value: JSON.parse(text) as unknown };
  } catch {
    return { success: false };
  }
}

function initializeWorld(dir: string, scenarioPath: string, coveragePath?: string): void {
  let scenarioText: string;
  try {
    scenarioText = readFileSync(scenarioPath, "utf8");
  } catch {
    writeResponse({ status: "invalid", issues: [issue("no_such_scenario")] });
    return;
  }

  const parsedJson = parseJson(scenarioText);
  if (!parsedJson.success) {
    writeResponse({ status: "invalid", issues: [issue("invalid_scenario_json")] });
    return;
  }
  const parsedScenario = ScenarioSchema.safeParse(parsedJson.value);
  if (!parsedScenario.success) {
    writeResponse({ status: "invalid", issues: parsedScenario.error.issues });
    return;
  }

  // Coverage is optional, and a world that declares none keeps the defaults. Each way the file can
  // be wrong gets its own code, so a caller knows whether to fix the path, the JSON or the shape.
  let coverage: Coverage | undefined;
  if (coveragePath !== undefined) {
    let coverageText: string;
    try {
      coverageText = readFileSync(coveragePath, "utf8");
    } catch {
      writeResponse({ status: "invalid", issues: [issue("no_such_coverage")] });
      return;
    }
    const parsedCoverageJson = parseJson(coverageText);
    if (!parsedCoverageJson.success) {
      writeResponse({ status: "invalid", issues: [issue("invalid_coverage_json")] });
      return;
    }
    const parsedCoverage = CoverageSchema.safeParse(parsedCoverageJson.value);
    if (!parsedCoverage.success) {
      writeResponse({
        status: "invalid",
        issues: [issue("invalid_coverage"), ...parsedCoverage.error.issues],
      });
      return;
    }
    coverage = parsedCoverage.data;
  }

  const world = createWorld(
    dir,
    parsedScenario.data,
    undefined,
    coverage === undefined ? undefined : { coverage },
  );
  process.stdout.write(`${canonicalJson({ status: "ok", world: dir, snapshot_version: world.snapshot().version })}\n`);
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
  };
}

function dispatch(request: Request): unknown {
  if (request.op === "verbs") {
    return { verbs: verbs() };
  }
  if (request.op === "command") {
    const world = openWorld(request.world);
    const result = world.command(request.command, { basedOn: request.based_on_version });
    return commandResponse(result, request.include_snapshot === true);
  }
  if (request.op === "edit") {
    const world = openWorld(request.world);
    const result = world.edit(
      request.edit,
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
  return world.snapshot();
}

async function stdinText(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk.toString();
  }
  return text;
}

function invalidFromIssues(issues: unknown): void {
  writeResponse({ status: "invalid", issues });
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === "init") {
    if (argv.length !== 3 && argv.length !== 4) {
      invalidFromIssues([issue("invalid_init_args")]);
      return;
    }
    initializeWorld(argv[1]!, argv[2]!, argv[3]);
    return;
  }

  const parsedJson = parseJson(await stdinText());
  if (!parsedJson.success) {
    invalidFromIssues([issue("invalid_json")]);
    return;
  }
  const parsedRequest = RequestSchema.safeParse(parsedJson.value);
  if (!parsedRequest.success) {
    invalidFromIssues(parsedRequest.error.issues);
    return;
  }

  try {
    const response = dispatch(parsedRequest.data);
    writeResponse(response);
  } catch (error) {
    invalidFromIssues(errorIssues(error));
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    invalidFromIssues(errorIssues(error));
  });
}
