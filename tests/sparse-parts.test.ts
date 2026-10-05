import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, openWorld, type Result, type Scenario, type World } from "../src/index.js";
import { structuralCapacity } from "../src/engine/capacity.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

// A lit room: ann with a bottle and a key on the floor beside her, and bob within reach of her.
const scenario: Scenario = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: 0, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "room", support: "room", pos: { x: 50, y: 0 } } },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "room", pos: { x: 0, y: 40 } } },
  { id: "key", template: "key", overrides: { name: "key", location: "room", support: "room", pos: { x: 0, y: -40 } } },
];

function open(t: { after(callback: () => void): void }): { dir: string; world: World; ann: string; bob: string } {
  const root = mkdtempSync(join(tmpdir(), "world-engine-sparse-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "w");
  const world = createWorld(dir, scenario);
  const ann = world.id("ann");
  const bob = world.id("bob");
  ok(ann !== null && bob !== null);
  return { dir, world, ann, bob };
}

let seq = 0;
function run(world: World, actor: string, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({ command_id: `c${seq}`, actor, verb, ...(target !== undefined && { target }), ...(args !== undefined && { args }) });
}

test("an untouched body stores no parts, and carrying and pocketing store none either", (t) => {
  const { world, ann } = open(t);
  deepStrictEqual(world.entity(ann)?.parts, {});
  strictEqual(run(world, ann, "take", "bottle").status, "ok");
  strictEqual(run(world, ann, "take", "key").status, "ok");
  strictEqual(run(world, ann, "put", "key", { relation: "in", destination: `${ann}.pocket` }).status, "ok");
  strictEqual(world.entity(world.id("key")!)?.in_part, "pocket");
  deepStrictEqual(world.entity(ann)?.parts, {});
});

test("a struck hand stores only itself; struck again it updates; severed it stays as detached", (t) => {
  const { world, ann, bob } = open(t);
  strictEqual(run(world, bob, "attack", `${ann}.hand_r`).status, "ok");
  deepStrictEqual(world.entity(ann)?.parts, { hand_r: { integrity: 60, status: "damaged" } });
  strictEqual(run(world, bob, "attack", `${ann}.hand_r`).status, "ok");
  deepStrictEqual(world.entity(ann)?.parts, { hand_r: { integrity: 20, status: "damaged" } });
  const severed = run(world, bob, "attack", `${ann}.hand_r`);
  ok(severed.events.some((event) => event.type === "detached"));
  // The thumb goes with its hand: the whole subtree is recorded as detached.
  deepStrictEqual(world.entity(ann)?.parts, {
    hand_r: { integrity: 0, status: "detached" },
    thumb_r: { integrity: 50, status: "detached" },
  });
  const hand = Object.values(world.snapshot().entities).find((entity) => entity.detached_from?.entity === ann);
  strictEqual(hand?.template, "human.hand_r");
});

test("a thumb costs nothing until it is struck, and losing it costs a fifth of the grip", (t) => {
  const { world, ann, bob } = open(t);
  const thumb = { kind: "fact" as const, subject: `${ann}.thumb_r`, relation: "status" };
  strictEqual(world.query({ ...thumb, object: "intact" }).value, "true");
  deepStrictEqual(world.entity(ann)?.parts, {});
  strictEqual(structuralCapacity(world.snapshot(), registry, ann, "manipulation"), 100);

  strictEqual(run(world, bob, "attack", `${ann}.thumb_r`).status, "ok");
  strictEqual(run(world, bob, "attack", `${ann}.thumb_r`).status, "ok");
  deepStrictEqual(world.entity(ann)?.parts, { thumb_r: { integrity: 0, status: "destroyed" } });
  strictEqual(world.query({ ...thumb, object: "destroyed" }).value, "true");
  strictEqual(structuralCapacity(world.snapshot(), registry, ann, "manipulation"), 80);
});

test("reopening, and replaying the log, give the same sparse snapshot byte for byte", (t) => {
  const { dir, world, ann, bob } = open(t);
  strictEqual(run(world, bob, "attack", `${ann}.hand_r`).status, "ok");
  strictEqual(run(world, ann, "take", "bottle").status, "ok");
  const stored = canonicalJson(world.snapshot());
  strictEqual(canonicalJson(openWorld(dir).snapshot()), stored);
  rmSync(join(dir, "head.json"));
  strictEqual(canonicalJson(openWorld(dir).snapshot()), stored);
});

test("a part set back to its default leaves the record", (t) => {
  const { world, ann, bob } = open(t);
  strictEqual(run(world, bob, "attack", `${ann}.hand_r`).status, "ok");
  const healed = world.edit({ kind: "set_part", target: ann, part: "hand_r", state: { integrity: 100, status: "intact" } });
  strictEqual(healed.status, "ok");
  deepStrictEqual(world.entity(ann)?.parts, {});
});

test("a stored part at its default breaks the snapshot's one stored form", (t) => {
  const { world, ann } = open(t);
  const snapshot = world.snapshot();
  const human = snapshot.entities[ann]!;
  const stored = {
    ...snapshot,
    entities: { ...snapshot.entities, [ann]: { ...human, parts: { pocket: { integrity: 100, status: "intact" as const } } } },
  };
  deepStrictEqual(validateSnapshot(stored, registry).map((issue) => issue.code), ["part_at_default"]);
});
