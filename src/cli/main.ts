import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  canonicalJson,
  createWorld,
  openWorld,
  WorldError,
  type Delta,
  type Result,
} from "../api.js";
import {
  RequestSchema,
  ResponseSchema,
  ValidationFailureSchema,
  type Request,
} from "../contract.js";

const PrimitiveSchema = z.union([z.number(), z.string(), z.boolean()]);
const ModifierSchema = z.object({
  capacity: z.string(),
  delta: z.number().int(),
  expires_at_tick: z.number().int().nullable(),
  cause_id: z.string(),
}).strict();
const SpawnOverridesSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  location: z.string().nullable().optional(),
  support: z.string().nullable().optional(),
  contained_in: z.string().nullable().optional(),
  pos: z.object({ x: z.number().int(), y: z.number().int() }).strict().nullable().optional(),
  detached_from: z.object({ entity: z.string(), part: z.string() }).strict().nullable().optional(),
  integrity: z.number().int().min(0).max(100).optional(),
  status: z.enum(["intact", "broken", "destroyed"]).optional(),
  residue: z.record(z.string(), z.number().int()).optional(),
  modifiers: z.array(ModifierSchema).optional(),
  props: z.record(z.string(), PrimitiveSchema).optional(),
}).strict();
const ScenarioSchema = z.array(z.object({
  template: z.string().min(1),
  overrides: SpawnOverridesSchema.optional(),
}).strict());

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

function initializeWorld(dir: string, scenarioPath: string): void {
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

  const world = createWorld(dir, parsedScenario.data);
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
    snapshot_version: result.snapshot.version,
    deltas: responseDeltas,
    events: result.events,
    ...(includeSnapshot && { snapshot: result.snapshot }),
  };
}

function dispatch(request: Request): unknown {
  if (request.op === "command") {
    const world = openWorld(request.world);
    const result = world.command(request.command, { basedOn: request.based_on_version });
    return commandResponse(result, request.include_snapshot === true);
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
    if (argv.length !== 3) {
      invalidFromIssues([issue("invalid_init_args")]);
      return;
    }
    initializeWorld(argv[1]!, argv[2]!);
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