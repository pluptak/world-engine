import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, openWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { tempDir } from "./harness.js";

// Structural resolution end to end, on the workshop: two humans, a dog and a chair declare 31 parts
// between them, and a world stores state only for the ones something has changed. Harmless work
// stores nothing; harm stores exactly what it touched; the store keeps that form across a reopen and
// a replay of its log.

const workshop = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/workshop.json", import.meta.url)), "utf8"),
) as Scenario;

function open(t: { after(callback: () => void): void }): { dir: string; world: World; id: (name: string) => Id } {
  const root = tempDir(t);
  const dir = join(root, "workshop");
  const world = createWorld(dir, workshop);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, id };
}

let seq = 0;
function run(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  const result = world.command({
    command_id: `s${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
  strictEqual(result.status, "ok", `${verb} ${target ?? ""}: ${result.reason_code ?? ""}`);
  return result;
}

// Every stored part entry in the world, by entity name.
function stored(world: World): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const entity of Object.values(world.snapshot().entities)) {
    if (Object.keys(entity.parts).length > 0) {
      out[entity.name] = entity.parts;
    }
  }
  return out;
}

function fact(world: World, subject: string, relation: string, object?: string): string {
  return world.query({ kind: "fact", subject, relation, ...(object === undefined ? {} : { object }) }).value;
}

test("a busy, harmless workshop stores no part state at all", (t) => {
  const { world, id } = open(t);
  deepStrictEqual(stored(world), {});

  run(world, id("ann"), "move", undefined, { to: { x: 230, y: 50 } });
  run(world, id("ann"), "take", "cup");
  run(world, id("ann"), "put", "cup", { relation: "on", destination: "bench" });
  run(world, id("bob"), "push", "stone", { dir: "+x", distance_cm: 20 });
  run(world, id("rex"), "move", undefined, { to: { x: 100, y: -100 } });
  world.observe(id("ann"), { since: 0 });

  // Asking about parts at any depth reads the templates and writes nothing.
  strictEqual(fact(world, `${id("ann")}.thumb_r`, "status", "intact"), "true");
  strictEqual(fact(world, `${id("rex")}.jaw`, "attached_to"), "true");
  strictEqual(fact(world, `${id("chair")}.leg_fl`, "integrity", "100"), "true");
  deepStrictEqual(stored(world), {});
});

test("harm stores exactly the parts it touched, and a reopen and a replay keep that form", (t) => {
  const { dir, world, id } = open(t);
  const bob = id("bob");
  run(world, bob, "move", undefined, { to: { x: 100, y: 40 } });
  for (let blow = 0; blow < 3; blow += 1) {
    run(world, bob, "attack", `${id("chair")}.leg_fl`);
  }
  run(world, bob, "attack", `${id("ann")}.thumb_l`);

  deepStrictEqual(stored(world), {
    chair: { leg_fl: { integrity: 0, status: "detached" } },
    ann: { thumb_l: { integrity: 10, status: "damaged" } },
  });
  const leg = Object.values(world.snapshot().entities).find((entity) => entity.detached_from?.entity === id("chair"));
  strictEqual(leg?.template, "chair.leg_fl");
  strictEqual(fact(world, `${id("chair")}.leg_fl`, "attached_to"), "false");

  const snapshot = canonicalJson(world.snapshot());
  strictEqual(canonicalJson(openWorld(dir).snapshot()), snapshot);
  rmSync(join(dir, "head.json"));
  strictEqual(canonicalJson(openWorld(dir).snapshot()), snapshot);
});
