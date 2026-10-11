import { deepStrictEqual, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, type Scenario, type World } from "../src/index.js";
import { scaleRegistry, scaleScenario } from "../scripts/bench-world.js";
import { tempDir } from "./harness.js";

// A cheaper observe must answer the same: every agent's projection of the scale world and of the
// lab, from a fixed list of commands, is byte-identical before and after, by canonicalJson. The
// fixture holds the before (`scripts/tmp-observe-fixture.ts` wrote it, then was deleted); a
// failure here is an answer the optimization changed, not a faster one.

const lab = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/lab.json", import.meta.url)), "utf8"),
) as { seed: number; entities: Scenario };

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/observe-projections.json", import.meta.url)), "utf8"),
) as { scale: Record<string, string>; lab: Record<string, string> };

function agentsOf(world: World): string[] {
  const snapshot = world.snapshot();
  return Object.keys(snapshot.entities)
    .sort()
    .filter((id) => snapshot.entities[id]?.props.agent === true);
}

function check(world: World, expected: Record<string, string>): void {
  const agents = agentsOf(world);
  deepStrictEqual(agents, Object.keys(expected).sort());
  for (const observer of agents) {
    strictEqual(canonicalJson(world.observe(observer, { since: 0 })), expected[observer]);
  }
}

test("every agent's projection of the scale world is what it was", (t) => {
  const world = createWorld(join(tempDir(t), "scale"), { seed: 7, entities: scaleScenario() }, scaleRegistry());
  const id = (name: string): string => {
    const found = world.id(name);
    if (found === null) {
      throw new Error(`No such name ${name}`);
    }
    return found;
  };
  const run = (commandId: string, actor: string, verb: string, target?: string, args?: Record<string, unknown>) => {
    const result = world.command({
      command_id: commandId,
      actor: id(actor),
      verb,
      ...(target !== undefined && { target: id(target) }),
      ...(args !== undefined && { args }),
    });
    strictEqual(result.status, "ok", `${commandId} was ${result.status}: ${result.reason_code ?? ""}`);
  };
  run("f1", "agent0", "open", "chest0");
  run("f2", "agent1", "take", "stone1_0");
  run("f3", "agent0", "say", undefined, { utterance: "u0", volume: "normal" });
  run("f4", "agent2", "move", undefined, { to: { x: 0, y: -60 } });
  check(world, fixture.scale);
});

test("every agent's projection of the lab is what it was", (t) => {
  const world = createWorld(join(tempDir(t), "lab"), lab);
  const agents = agentsOf(world);
  let i = 0;
  for (const actor of agents.slice(0, 4)) {
    i += 1;
    const result = world.command({ command_id: `g${i}`, actor, verb: "wait", args: { ticks: 1 } });
    strictEqual(result.status, "ok", `g${i} was ${result.status}: ${result.reason_code ?? ""}`);
  }
  const speaker = agents.find((id) => world.entity(id)?.template === "human");
  if (speaker === undefined) {
    throw new Error("No human to speak");
  }
  i += 1;
  const said = world.command({ command_id: `g${i}`, actor: speaker, verb: "say", args: { utterance: "u1", volume: "normal" } });
  strictEqual(said.status, "ok", `say was ${said.status}: ${said.reason_code ?? ""}`);
  check(world, fixture.lab);
});
