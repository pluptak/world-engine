import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CommandResponseSchema, InspectResponseSchema } from "../src/contract.js";
import { canonicalJson, createWorld, WorldError, type Coverage, type Id, type Scenario, type World } from "../src/index.js";
import { defaultCoverage } from "../src/model.js";

// What a controller asks between commands: can I reach it, what exactly is that, and what did my
// own command look like from where I stand. Every answer is a read; none of them writes.

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));
const scenario = (name: string): Scenario =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../scenarios/${name}.json`, import.meta.url)), "utf8")) as Scenario;

interface Opened {
  dir: string;
  world: World;
  id: (name: string) => Id;
}

function open(t: { after(callback: () => void): void }, name: string, coverage?: Coverage): Opened {
  const base = mkdtempSync(join(tmpdir(), "world-engine-controller-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, name);
  const world = createWorld(dir, scenario(name), undefined, coverage === undefined ? {} : { coverage });
  const id = (entity: string): Id => {
    const found = world.id(entity);
    ok(found !== null, entity);
    return found;
  };
  return { dir, world, id };
}

let seq = 0;
function walk(world: World, actor: Id, x: number, y: number) {
  seq += 1;
  return world.command({ command_id: `w${seq}`, actor, verb: "move", args: { to: { x, y } } });
}

test("reachable answers by the rule the verbs use, and says why it cannot", (t) => {
  const { world, id } = open(t, "workshop");
  const ann = id("ann");
  const cup = id("cup");
  const reachable = (object?: string) =>
    world.query({ kind: "fact", subject: ann, relation: "reachable", ...(object === undefined ? {} : { object }) });

  // Walking along the bench's front edge: the fact and `take`'s own verdict agree at every step,
  // and both answers occur.
  const seen = new Set<string>();
  for (const x of [150, 190, 200, 210, 250, 300, 400, 410]) {
    strictEqual(walk(world, ann, x, 45).status, "ok", `x ${x}`);
    const fact = reachable(cup).value;
    const take = world.check({ command_id: "probe", actor: ann, verb: "take", target: cup });
    strictEqual(fact === "true", take.reason_code !== "out_of_reach", `x ${x}`);
    seen.add(fact);
  }
  deepStrictEqual([...seen].sort(), ["false", "true"]);
  deepStrictEqual(reachable(), { value: "false", basis_code: "no_object" });
  deepStrictEqual(reachable("e999"), { value: "false", basis_code: "no_such_entity" });

  const narrow = open(t, "workshop", { ...defaultCoverage(), relations: ["support"] });
  deepStrictEqual(
    narrow.world.query({ kind: "fact", subject: narrow.id("ann"), relation: "reachable", object: narrow.id("cup") }),
    { value: "unknown", basis_code: "uncovered_category" },
  );
});

test("reach passes through bars: ann and bob 36 cm apart across them, then 120", (t) => {
  const { world, id } = open(t, "cell");
  strictEqual(walk(world, id("ann"), -150, -18).status, "ok");
  strictEqual(walk(world, id("bob"), -150, 18).status, "ok");
  const fact = () => world.query({ kind: "fact", subject: id("ann"), relation: "reachable", object: id("bob") }).value;
  strictEqual(fact(), "true");
  strictEqual(walk(world, id("bob"), -150, 102).status, "ok");
  strictEqual(fact(), "false");
});

test("inspect gives one thing in detail: covered props, reach, and what it visibly holds", (t) => {
  const coverage = { ...defaultCoverage(), properties: [...defaultCoverage().properties, "open", "locked"] };
  const cell = open(t, "cell", coverage);
  const gate = cell.world.inspect(cell.id("ann"), cell.id("gate"));
  ok(gate !== null);
  deepStrictEqual(gate.senses, ["sight"]);
  // `barrier` and `openable` are props too, but this world does not cover them.
  deepStrictEqual(gate.props, { locked: true, open: false });
  strictEqual(gate.reachable, false);
  deepStrictEqual(gate.facts?.pos, { x: 50, y: 0 });

  const shop = open(t, "workshop");
  const bench = shop.world.inspect(shop.id("ann"), shop.id("bench"));
  deepStrictEqual(bench?.holds, [shop.id("cup")]);
  deepStrictEqual(bench?.props, {});
  strictEqual(shop.world.inspect(shop.id("ann"), "e999"), null);
  throws(
    () => shop.world.inspect("e999", shop.id("bench")),
    (error: unknown) => error instanceof WorldError && error.code === "no_such_entity",
  );
});

test("inspect is null for what the observer cannot sense", (t) => {
  const { world, id } = open(t, "workshop", { ...defaultCoverage(), senses: ["sight", "hearing", "touch"] });
  strictEqual(world.edit({ kind: "set_props", target: id("shop"), props: { lit: false } }).status, "ok");
  strictEqual(world.inspect(id("ann"), id("bench")), null);
  // Her own body she still feels, where the world covers touch.
  deepStrictEqual(world.inspect(id("ann"), id("ann"))?.senses, ["touch"]);
});

test("a command can bring back what its actor sensed of it, refused or not", (t) => {
  const { world, id } = open(t, "workshop");
  const bob = id("bob");
  const pushed = world.command(
    { command_id: "push-stone", actor: bob, verb: "push", target: "stone", args: { dir: "+x", distance_cm: 20 } },
    { observe: true },
  );
  strictEqual(pushed.status, "ok");
  ok(pushed.observation !== undefined);
  strictEqual(pushed.observation.observer, bob);
  strictEqual(pushed.observation.version, pushed.snapshot.version);
  deepStrictEqual(
    pushed.observation.events.map((event) => [event.type, event.senses]),
    [
      ["push", ["sight", "hearing"]],
      ["moved", ["sight", "hearing"]],
    ],
  );
  ok(pushed.observation.entities.some((entity) => entity.id === id("stone")));

  const before = canonicalJson(world.snapshot());
  const refused = world.command(
    { command_id: "push-bench", actor: bob, verb: "push", target: "bench", args: { dir: "+x", distance_cm: 20 } },
    { observe: true },
  );
  strictEqual(refused.reason_code, "out_of_reach");
  deepStrictEqual(refused.observation?.events, []);
  strictEqual(canonicalJson(world.snapshot()), before);
  strictEqual(world.command({ command_id: "plain", actor: bob, verb: "wait", args: { ticks: 1 } }).observation, undefined);
});

test("the CLI carries the observation and answers inspect", (t) => {
  const { dir, id } = open(t, "workshop");
  const cli = (request: unknown): unknown => {
    const run = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(request),
    });
    strictEqual(run.status, 0, run.stderr);
    return JSON.parse(run.stdout) as unknown;
  };
  const command = CommandResponseSchema.parse(cli({
    op: "command",
    world: dir,
    observe: true,
    command: { command_id: "c1", actor: id("bob"), verb: "push", target: "stone", args: { dir: "+x", distance_cm: 20 } },
  }));
  strictEqual(command.observation?.observer, id("bob"));
  const inspected = InspectResponseSchema.parse(cli({ op: "inspect", world: dir, observer: id("ann"), entity: id("bench") }));
  deepStrictEqual(inspected.inspection?.holds, [id("cup")]);
});
