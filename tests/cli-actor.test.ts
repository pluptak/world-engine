import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cli } from "./cli-run.js";
import { actorWorld, aliasOf, canonicalJson, createWorld, openWorld, type Scenario } from "../src/index.js";
import { ActorCommandResponseSchema, ResponseSchema } from "../src/contract.js";
import { tempDir } from "./harness.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

function runCli(request: unknown) {
  return cli(JSON.stringify(request));
}

function respond(request: unknown): unknown {
  const run = runCli(request);
  strictEqual(run.status, 0, run.stdout + run.stderr);
  return JSON.parse(run.stdout) as unknown;
}

function issueCodes(request: unknown): string[] {
  const run = runCli(request);
  strictEqual(run.status, 2, run.stdout);
  const response = ResponseSchema.parse(JSON.parse(run.stdout));
  ok("issues" in response, "expected an invalid response");
  return response.issues.map((entry) => entry.code);
}

// Ann with a stone at her feet and a chest 300 cm off, in a hall lit or not.
function hall(t: { after(callback: () => void): void }, lit: boolean): string {
  const dir = tempDir(t);
  const at = (x: number) => ({ location: "hall", support: "hall", pos: { x, y: 0 } });
  const scenario: Scenario = [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit } } },
    { id: "ann", template: "human", overrides: { name: "ann", ...at(0) } },
    { id: "stone", template: "stone", overrides: { name: "stone", ...at(20) } },
    { id: "chest", template: "chest", overrides: { name: "chest", ...at(300) } },
  ];
  const world = join(dir, "hall");
  createWorld(world, scenario);
  return world;
}

const ANN = "e2";
const STONE = "e3";
const CHEST = "e4";
const walk = { command_id: "walk", verb: "move", args: { to: { x: 300, y: 0 } } };

test("actor_command answers the verdict and the actor's view, never the world's record", (t) => {
  const world = hall(t, true);
  const response = respond({
    op: "actor_command",
    world,
    actor: ANN,
    command: { command_id: "take-stone", verb: "take", target: "stone" },
  });
  const parsed = ActorCommandResponseSchema.parse(response);
  strictEqual(parsed.status, "ok");
  strictEqual(parsed.resolved_target, aliasOf(ANN, STONE));
  deepStrictEqual(Object.keys(response as object).sort(), ["command_id", "observation", "resolved_target", "status"]);
  deepStrictEqual(parsed.observation.events.map((event) => event.type), ["take", "moved"]);
  // It was written like any command, by ann, and the world moved one version.
  strictEqual(openWorld(world).entity(STONE)?.contained_in, ANN);
  strictEqual(parsed.observation.tick, 1);
});

test("actor_check and actor_command name nothing the actor cannot sense", (t) => {
  const dark = hall(t, false);
  deepStrictEqual(
    (respond({ op: "check", world: dark, command: { ...walk, actor: ANN } }) as { reason_data?: unknown }).reason_data,
    { with: CHEST },
  );
  for (const op of ["actor_check", "actor_command"]) {
    const response = respond({ op, world: dark, actor: ANN, command: walk }) as Record<string, unknown>;
    deepStrictEqual([response.status, response.reason_code, response.reason_data], ["refused", "blocked", undefined], op);
  }
  // Seen across a lit hall, the chest is named.
  const lit = hall(t, true);
  deepStrictEqual((respond({ op: "actor_check", world: lit, actor: ANN, command: walk }) as { reason_data?: unknown }).reason_data, {
    with: aliasOf(ANN, CHEST),
  });
});

test("actor_observe, actor_inspect and actor_options answer as the library's actor view does", (t) => {
  const world = hall(t, false);
  const view = actorWorld(openWorld(world), ANN);
  for (const refused of [undefined, true]) {
    const request = { op: "actor_options", world, actor: ANN, ...(refused === undefined ? {} : { refused }) };
    strictEqual(canonicalJson(respond(request)), canonicalJson(view.options(refused === undefined ? {} : { refused })));
  }
  strictEqual(
    canonicalJson(respond({ op: "actor_observe", world, actor: ANN, since_tick: 0 })),
    canonicalJson(view.observe({ since_tick: 0 })),
  );
  strictEqual(canonicalJson(respond({ op: "actor_observe", world, actor: ANN })), canonicalJson(view.observe()));
  // In the dark ann neither sees nor feels the stone: there is nothing of it to inspect.
  deepStrictEqual(respond({ op: "actor_inspect", world, actor: ANN, entity: STONE }), { inspection: null });
  strictEqual(
    canonicalJson(respond({ op: "actor_inspect", world, actor: ANN, entity: ANN })),
    canonicalJson({ inspection: view.inspect(ANN) }),
  );
});

test("an actor op takes no actor or perceivers inside its command, and no unknown actor", (t) => {
  const world = hall(t, true);
  const take = { command_id: "take-stone", verb: "take", target: "stone" };
  for (const smuggled of [{ ...take, actor: "e9" }, { ...take, perceivers: true }]) {
    for (const op of ["actor_check", "actor_command"]) {
      ok(issueCodes({ op, world, actor: ANN, command: smuggled }).includes("unrecognized_keys"), op);
    }
  }
  // An actor has no version to send: a command based on one, or a look since one, is not an actor's.
  ok(issueCodes({ op: "actor_command", world, actor: ANN, based_on_version: 0, command: take }).includes("unrecognized_keys"));
  ok(issueCodes({ op: "actor_observe", world, actor: ANN, since: 0 }).includes("unrecognized_keys"));
  strictEqual(openWorld(world).snapshot().version, 0);
  deepStrictEqual(issueCodes({ op: "actor_observe", world, actor: "e99" }), ["no_such_entity"]);
});
