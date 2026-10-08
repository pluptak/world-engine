import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, memoryWorld, type Command, type WorldEdit } from "../src/index.js";
import { defaultCoverage } from "../src/model.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { buildInitial, genStep, mulberry32, withProcessFixtures } from "./property-gen.js";

const registry: TemplateRegistry = withProcessFixtures(
  loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))),
);

// What `options` lists as ready is what the pipeline accepts: a random agent is asked each step, one
// of its ready options is issued for real, and it is ok. Every second world is seen through the
// default coverage, so what an actor can name is sometimes what it sees and sometimes only what it
// can reach.
test("property: a ready option, issued for real, is accepted; a read changes nothing", () => {
  const verbs = new Map<string, number>();
  let issued = 0;
  let withArgs = 0;
  let atParts = 0;
  let refusals = 0;
  for (let seed = 0; seed < 30; seed += 1) {
    const rand = mulberry32(seed + 9900);
    const initial = buildInitial(registry);
    const world = memoryWorld(seed % 2 === 0 ? { ...initial, coverage: defaultCoverage() } : initial, registry);
    for (let i = 0; i < 40; i += 1) {
      const snapshot = world.snapshot();
      // The generator moves the world on, with its refused and invalid steps among the rest.
      const step: Command | WorldEdit = genStep(rand, snapshot, `options-${seed}-${i}`);
      if ("verb" in step) {
        world.command(step);
      } else {
        world.edit(step);
      }
      const agents = Object.values(world.snapshot().entities)
        .filter((entity) => entity.props.agent === true && entity.detached_from === null)
        .map((entity) => entity.id)
        .sort();
      if (agents.length === 0) {
        continue;
      }
      const actor = agents[Math.floor(rand() * agents.length)]!;
      const before = canonicalJson(world.snapshot());
      const options = world.options(actor, { refused: true });
      strictEqual(canonicalJson(world.snapshot()), before, "a read changes nothing");
      deepStrictEqual(world.options(actor, { refused: true }), options, "and answers the same twice");
      const key = (entry: { verb: string; target?: string; args?: object }) =>
        `${entry.verb} ${entry.target ?? ""} ${canonicalJson(entry.args ?? null)}`;
      const ready = new Set(options.ready.map(key));
      strictEqual(options.blocked!.some((entry) => ready.has(key(entry))), false, "ready and blocked are apart");
      refusals += options.blocked!.length;
      if (options.ready.length === 0) {
        continue;
      }
      const chosen = options.ready[Math.floor(rand() * options.ready.length)]!;
      const result = world.command({
        command_id: `options-do-${seed}-${i}`,
        actor,
        verb: chosen.verb,
        ...(chosen.target === undefined ? {} : { target: chosen.target }),
        ...(chosen.args === undefined ? {} : { args: chosen.args }),
      });
      strictEqual(result.status, "ok", `seed ${seed} step ${i}: ${actor} ${key(chosen)} was ${result.status} ${result.reason_code}`);
      issued += 1;
      withArgs += chosen.args === undefined ? 0 : 1;
      atParts += chosen.target?.includes(".") === true ? 1 : 0;
      verbs.set(chosen.verb, (verbs.get(chosen.verb) ?? 0) + 1);
    }
  }
  // The runs reach many kinds of option, and refusals alongside them.
  ok(issued >= 600, `issued ${issued}`);
  ok(verbs.size >= 6, `verbs ${[...verbs.keys()].join(",")}`);
  ok(withArgs >= 15, `issued with args ${withArgs}`);
  ok(atParts >= 5, `issued at parts ${atParts}`);
  ok(refusals >= 20000, `refusals ${refusals}`);
});
