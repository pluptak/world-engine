import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { aliasOf, canonicalJson, createWorld, memoryWorld, WorldError, type Entity, type Id, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { cli } from "./cli-run.js";
import { tempDir } from "./harness.js";

// Traits describe a thing and nothing reads them: a map of at most 16 keys to opaque tokens, written
// by a scenario or an `edit spawn`, shown by `inspect` to an observer who sees the thing, never by
// `observe`, and absent when empty.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

const floor = (x: number) => ({ location: "hall", support: "hall", pos: { x, y: 0 } });

function scenario(traits: Record<string, string> | undefined, lit = true): Scenario {
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit } } },
    { id: "ann", template: "human", overrides: { name: "ann", ...floor(0) } },
    { id: "vase", template: "cup", overrides: { name: "vase", ...floor(40), ...(traits !== undefined && { traits }) } },
  ];
}

// An edit names ids, not scenario names: the hall is the first entity.
const inRoom = (x: number) => ({ location: "e1", support: "e1", pos: { x, y: 0 } });

const world = (t: { after(callback: () => void): void }, traits: Record<string, string> | undefined, lit = true): World =>
  createWorld(join(tempDir(t), "w"), scenario(traits, lit), registry);

test("a scenario writes traits, copied, and an empty map writes none", (t) => {
  const given = { colour: "brown", worn: "yes", constructor: "ok" };
  const w = world(t, given);
  deepStrictEqual(w.entity(w.id("vase")!)?.traits, given);
  given.colour = "changed";
  strictEqual(w.entity(w.id("vase")!)?.traits?.colour, "brown");
  const none = world(t, {});
  strictEqual("traits" in none.entity(none.id("vase")!)!, false);
  strictEqual("traits" in world(t, undefined).entity("e3")!, false);
  deepStrictEqual(validateSnapshot(w.snapshot(), registry), []);
});

test("a bad key, token, count or shape is invalid_trait, in a snapshot, a scenario and an edit", (t) => {
  const w = world(t, { colour: "brown" });
  const snapshot = w.snapshot();
  const vase = w.id("vase")!;
  const codes = (traits: unknown) =>
    validateSnapshot(
      { ...snapshot, entities: { ...snapshot.entities, [vase]: { ...snapshot.entities[vase]!, traits } as unknown as Entity } },
      registry,
    ).map((issue) => issue.code);
  const many = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`k${index}`, "v"]));
  const sixteen = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`k${index}`, "v"]));
  deepStrictEqual(codes(sixteen), []);
  deepStrictEqual(codes({ a: "x".repeat(64), z9_: "A.b:c-d_e" }), []);
  for (const bad of [
    many,
    {},
    [],
    "brown",
    null,
    { Colour: "brown" },
    { "1st": "brown" },
    { _x: "brown" },
    { ["k".repeat(33)]: "brown" },
    { colour: "two words" },
    { colour: "" },
    { colour: "x".repeat(65) },
    { colour: 7 },
    { colour: null },
  ]) {
    ok(codes(bad).every((code) => code === "invalid_trait") && codes(bad).length > 0, JSON.stringify(bad));
  }
  // A scenario carrying one never becomes a world.
  let thrown: unknown;
  try {
    createWorld(join(tempDir(t), "bad"), scenario({ Colour: "brown" }), registry);
  } catch (error) {
    thrown = error;
  }
  ok(thrown instanceof WorldError && thrown.code === "invalid_snapshot");
  deepStrictEqual((thrown as WorldError).issues?.map((issue) => issue.code), ["invalid_trait"]);
  // An edit spawn is refused with the code; a value that is no token string is not even a spawn.
  const before = canonicalJson(w.snapshot());
  const spawn = (traits: unknown) =>
    w.edit({ kind: "spawn", template: "stone", overrides: { name: "pebble", ...inRoom(60), traits: traits as Record<string, string> } });
  const refused = spawn({ Colour: "brown" });
  deepStrictEqual([refused.status, refused.reason_code], ["refused", "invalid_trait"]);
  deepStrictEqual([spawn({ colour: 7 }).status, spawn({ colour: 7 }).reason_code], ["invalid", "invalid_args"]);
  deepStrictEqual([spawn([]).status, spawn("brown").status], ["invalid", "invalid"]);
  strictEqual(canonicalJson(w.snapshot()), before);
  const ok1 = spawn({ colour: "grey" });
  strictEqual(ok1.status, "ok");
  strictEqual(w.entity(ok1.events[1]!.entity)?.traits?.colour, "grey");
  strictEqual("traits" in w.entity(w.edit({ kind: "spawn", template: "stone", overrides: { traits: {}, ...inRoom(80) } }).events[1]!.entity)!, false);
});

test("inspect lists traits to an observer who sees or feels the thing, whatever the coverage; observe does not", (t) => {
  const lit = world(t, { colour: "brown" });
  const ann = lit.id("ann")!;
  const vase = lit.id("vase")!;
  deepStrictEqual(lit.inspect(ann, vase)?.traits, { colour: "brown" });
  // The default coverage names no prop of a cup, yet the traits are shown.
  deepStrictEqual(lit.inspect(ann, vase)?.props, {});
  ok(!("traits" in lit.inspect(ann, ann)!), "an entity with none lists none");
  for (const entity of lit.observe(ann).entities) {
    strictEqual("traits" in entity, false);
  }
  // In the dark nothing of it is seen, so nothing of its traits: an actor view shows what inspect does.
  const dark = world(t, { colour: "brown" }, false);
  strictEqual(dark.inspect(dark.id("ann")!, dark.id("vase")!), null);
});

test("the CLI answers a snapshot, an inspect and an actor inspect that carry traits", (t) => {
  const dir = join(tempDir(t), "cli");
  const w = createWorld(dir, scenario({ colour: "brown" }), registry);
  const ask = (request: unknown) => {
    const run = cli(JSON.stringify(request));
    strictEqual(run.status, 0, run.stdout);
    return JSON.parse(run.stdout) as Record<string, any>;
  };
  strictEqual(ask({ op: "snapshot", world: dir }).entities[w.id("vase")!].traits.colour, "brown");
  const ann = w.id("ann")!;
  const vase = w.id("vase")!;
  deepStrictEqual(ask({ op: "inspect", world: dir, observer: ann, entity: vase }).inspection.traits, { colour: "brown" });
  deepStrictEqual(ask({ op: "actor_inspect", world: dir, actor: ann, entity: aliasOf(ann, vase) }).inspection.traits, { colour: "brown" });
  // An edit with traits through the CLI.
  const edit = ask({ op: "edit", world: dir, edit: { kind: "spawn", template: "stone", overrides: { name: "pebble", traits: { shape: "round" }, ...inRoom(70) } } });
  strictEqual(edit.status, "ok");
  // trace knows the field.
  deepStrictEqual(ask({ op: "trace", world: dir, query: { entity: vase, field: "traits" } }).events ?? [], []);
});

test("no rule reads a trait: the inn answers every command the same with traits on every entity and without", (t) => {
  const inn = JSON.parse(readFileSync(fileURLToPath(new URL("../scenarios/inn.json", import.meta.url)), "utf8")) as Scenario;
  const described = inn.map((entry) => ({ ...entry, overrides: { ...entry.overrides, traits: { kind: "described", template: entry.template.replace(/[^a-z0-9_]/g, "_") } } }));
  const plain = createWorld(join(tempDir(t), "plain"), inn, registry);
  const marked = createWorld(join(tempDir(t), "marked"), described, registry);
  const agents = (w: World): Id[] =>
    Object.values(w.snapshot().entities).filter((entity) => entity.props.agent === true).map((entity) => entity.id).sort();
  deepStrictEqual(agents(marked), agents(plain));
  ok(Object.values(marked.snapshot().entities).every((entity) => entity.traits !== undefined));
  let ran = 0;
  for (let step = 0; step < 80; step += 1) {
    const actors = agents(plain);
    const actor = actors[step % actors.length]!;
    const options = plain.options(actor).ready;
    deepStrictEqual(marked.options(actor).ready, options);
    if (options.length === 0) {
      continue;
    }
    const picked = options[(step * 7) % options.length]!;
    const command = { command_id: `walk-${step}`, actor, verb: picked.verb, ...(picked.target !== undefined && { target: picked.target }), ...(picked.args !== undefined && { args: picked.args }) };
    const left = plain.command(command);
    const right = marked.command(command);
    deepStrictEqual(
      [right.status, right.reason_code, right.events, right.resolved_target],
      [left.status, left.reason_code, left.events, left.resolved_target],
      `${step} ${picked.verb}`,
    );
    ran += left.status === "ok" ? 1 : 0;
  }
  ok(ran > 10, `only ${ran} commands were accepted`);
  deepStrictEqual(validateSnapshot(marked.snapshot(), registry), []);
  strictEqual(memoryWorld(marked.snapshot(), registry).snapshot().version, marked.snapshot().version);
});
