import { deepStrictEqual, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { createWorld } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { CYCLE, ROOMS, scaleCommand, scaleRegistry, scaleScenario } from "../scripts/bench-world.js";
import { tempDir } from "./harness.js";

// The scale benchmark's world builds and its workload runs: nothing times it here, so a change to the
// schema or a verb that breaks the benchmark fails a test instead of the next measurement.

test("the scale world builds and two laps of its cycle are all ok and valid", (t) => {
  const registry = scaleRegistry();
  const world = createWorld(join(tempDir(t), "w"), scaleScenario(), registry);
  strictEqual(Object.keys(world.snapshot().entities).length, 500);
  const notOk: string[] = [];
  for (let i = 0; i < CYCLE * ROOMS * 2; i += 1) {
    const command = scaleCommand(i, world);
    const result = world.command(command);
    if (result.status !== "ok") {
      notOk.push(`${i} ${command.verb}: ${result.status} ${result.reason_code ?? ""}`);
    }
  }
  deepStrictEqual(notOk, []);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});
