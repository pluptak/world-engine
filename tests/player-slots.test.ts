import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, memoryWorld, type Id, type Scene, type World } from "../src/index.js";
import { aliasOf } from "../src/actor-world.js";
import { directorWorld } from "../src/director-world.js";
import { playerWorld } from "../src/player-world.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A slot of several bodies (`docs/roles.md`): dana drives ann and ann2, one handle and one slot named by ann, the
// first body. Eve drives bob, the other slot. The view names a thing alike from every body of the slot.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));

// The shipped set, with a brute who takes a hand in one blow and a frail human whose successor is a human.
function registry(t: { after(callback: () => void): void }): TemplateRegistry {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  writeFileSync(join(dir, "brute.json"), JSON.stringify({ id: "brute", extends: "human", props: { attack_damage: 100 } }));
  writeFileSync(join(dir, "frail_human.json"), JSON.stringify({ id: "frail_human", extends: "human", props: { successor: "human" } }));
  return loadTemplates(dir);
}

function scene(ann2Room: string, annTemplate = "human"): Scene {
  return {
    entities: [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
      { id: "door", template: "door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
      { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
      { id: "ann", template: annTemplate, overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
      { id: "ann2", template: "human", overrides: { name: "ann2", location: ann2Room, support: ann2Room, pos: { x: 0, y: 10 } } },
      { id: "bob", template: "brute", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 0, y: 50 } } },
    ],
    run: { tick_limit: 40, slots: [["ann", "ann2"], "bob"] },
  };
}

// A running run: dana on the two-body slot, eve on bob. Each body is named by its id here, a test's own bookkeeping.
function started(t: { after(callback: () => void): void }, ann2Room = "hall", reg = registry(t), annTemplate = "human") {
  const world = createWorld(join(tempDir(t), "slots"), { seed: 11, entities: scene(ann2Room, annTemplate).entities, run: scene(ann2Room, annTemplate).run }, reg);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  const director = directorWorld(world);
  strictEqual(director.edit({ kind: "register_player", handle: "dana", slot: id("ann") }, { command_id: "reg-dana" }).status, "ok");
  strictEqual(director.edit({ kind: "register_player", handle: "eve", slot: id("bob") }, { command_id: "reg-eve" }).status, "ok");
  strictEqual(director.edit({ kind: "start_run" }, { command_id: "start" }).status, "ok");
  // The view's name for each body of dana's slot, as the handle writes it.
  const alias = (name: string): string => aliasOf(id("ann"), id(name));
  return { world, id, alias, reg };
}

let seq = 0;
function roundAct(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>) {
  seq += 1;
  return world.round([{ command_id: `r${seq}`, actor, verb, ...(target === undefined ? {} : { target }), ...(args === undefined ? {} : { args }) }]).results[0]!;
}

test("a two-body slot registers under its first body, and a registration naming its second is refused no_such_slot", (t) => {
  const { world, id } = started(t);
  strictEqual(world.snapshot().run?.slots?.[0] !== undefined && Array.isArray(world.snapshot().run?.slots?.[0]), true);
  // A fresh run, so the second body is named with nothing registered yet.
  const fresh = createWorld(join(tempDir(t), "fresh-slots"), { seed: 11, entities: scene("hall").entities, run: scene("hall").run }, registry(t));
  const refused = directorWorld(fresh).edit({ kind: "register_player", handle: "dana", slot: fresh.id("ann2")! }, { command_id: "r" });
  deepStrictEqual([refused.status, refused.reason_code], ["refused", "no_such_slot"]);
  strictEqual(world.snapshot().run?.players?.find((player) => player.handle === "dana")?.slot, id("ann"));
});

test("the view names one stone alike from either body of the slot, and a take by either is the same thing", (t) => {
  const { world, alias, id } = started(t);
  const dana = playerWorld(world, "dana");
  const takeTarget = (body: string) => dana.options({ body }).ready.find((option) => option.verb === "take")?.target;
  const fromAnn = takeTarget(alias("ann"));
  const fromAnn2 = takeTarget(alias("ann2"));
  ok(fromAnn !== undefined, "ann can take the stone");
  strictEqual(fromAnn, fromAnn2);
  strictEqual(fromAnn, alias("stone"));
  // The raw world id names nothing in the view: it appears nowhere in what the handle reads, quoted as a value.
  ok(!JSON.stringify(dana.options({ body: alias("ann") })).includes(`"${id("stone")}"`));
});

test("observe lists what either body senses, each thing once", (t) => {
  // ann2 stands in the yard, behind the closed door: ann cannot see it, so it is listed only through ann2's own sight.
  const { world, alias, id } = started(t, "yard");
  const dana = playerWorld(world, "dana");
  const seen = dana.observe().entities.map((entity) => entity.id);
  strictEqual(new Set(seen).size, seen.length, "each entity once");
  ok(seen.includes(alias("stone")), "ann's stone is listed");
  ok(seen.includes(alias("ann2")), "ann2's own sight lists itself");
  strictEqual(seen.includes(alias("bob")), true, "a body of the other slot seen by ann is listed too");
  // Inspection reads through the slot the same way: what ann2 alone senses is inspected through ann2.
  deepStrictEqual(dana.inspect(alias("ann2"))?.id, alias("ann2"));
  strictEqual(dana.inspect(alias("stone"))?.id, alias("stone"));
  // Nothing of the world's ids in the view's entities.
  ok(!seen.includes(id("ann2")));
});

test("a handle moves each of its bodies in one round, each move logged under the handle", (t) => {
  const { world, alias } = started(t, "hall");
  const dana = playerWorld(world, "dana");
  deepStrictEqual(dana.submit({ command_id: "a-take", verb: "take", target: "stone", body: alias("ann") }), { status: "ok" });
  deepStrictEqual(dana.submit({ command_id: "a2-walk", verb: "move", args: { to: { x: 20, y: 10 } }, body: alias("ann2") }), { status: "ok" });
  deepStrictEqual(
    dana.pending().map((move) => [move.body, move.command_id]).sort(),
    [[alias("ann"), "a-take"], [alias("ann2"), "a2-walk"]].sort(),
  );
  const closed = directorWorld(world).closeRound();
  strictEqual(closed.status, "ok");
  deepStrictEqual(closed.results.map((result) => result.status).sort(), ["ok", "ok"]);
  const logged = world.attempts(0).filter((attempt) => attempt.by?.handle === "dana").map((attempt) => attempt.command.command_id).sort();
  deepStrictEqual(logged, ["a-take", "a2-walk"]);
  deepStrictEqual(directorWorld(world).submitted(), []);
});

test("a move naming a body the handle does not drive is refused, and a two-body handle must name its body", (t) => {
  const { world, alias, id } = started(t);
  const dana = playerWorld(world, "dana");
  deepStrictEqual(dana.submit({ command_id: "bob", verb: "wait", args: { ticks: 1 }, body: alias("bob") }), { status: "refused", reason_code: "not_a_body" });
  deepStrictEqual(dana.submit({ command_id: "raw", verb: "wait", args: { ticks: 1 }, body: id("bob") }), { status: "refused", reason_code: "not_a_body" });
  deepStrictEqual(dana.submit({ command_id: "unnamed", verb: "wait", args: { ticks: 1 } }), { status: "refused", reason_code: "body_required" });
  deepStrictEqual(dana.pending(), []);
  throws(() => dana.options(), (error: unknown) => (error as { code?: string }).code === "body_required");
  // Eve's one-body handle needs no name, and a body it names must be its own.
  deepStrictEqual(playerWorld(world, "eve").submit({ command_id: "eve-wait", verb: "wait", args: { ticks: 1 } }), { status: "ok" });
});

test("the slot lives while one of its bodies does, and ends the run when both are destroyed", (t) => {
  // Dana's slot is the run's only one, so the run ends for no live players only when both its bodies are gone.
  const dir = join(tempDir(t), "only-slot");
  const reg = registry(t);
  const scenic = scene("hall");
  const world = createWorld(dir, { seed: 11, entities: scenic.entities, run: { tick_limit: 40, slots: [["ann", "ann2"]] } }, reg);
  const id = (name: string): Id => world.id(name)!;
  directorWorld(world).edit({ kind: "register_player", handle: "dana", slot: id("ann") }, { command_id: "reg" });
  directorWorld(world).edit({ kind: "start_run" }, { command_id: "start" });
  // Ann and ann2 are weak enough to bleed out after a single blow from bob.
  const snapshot = structuredClone(world.snapshot());
  snapshot.entities[id("ann")]!.integrity = 8;
  snapshot.entities[id("ann2")]!.integrity = 8;
  const run = memoryWorld(snapshot, reg, { ann: id("ann"), ann2: id("ann2"), bob: id("bob") });
  const bleedOut = (body: Id): void => {
    roundAct(run, id("bob"), "attack", `${body}.hand_r`);
    for (let round = 0; round < 12 && run.entity(body)?.status !== "destroyed"; round += 1) {
      run.round([]);
    }
  };
  bleedOut(id("ann"));
  strictEqual(run.entity(id("ann"))?.status, "destroyed");
  strictEqual(run.snapshot().run?.state, "running", "ann2 still lives, so the slot does");
  bleedOut(id("ann2"));
  strictEqual(run.entity(id("ann2"))?.status, "destroyed");
  strictEqual(run.snapshot().run?.state, "ended");
  strictEqual(run.snapshot().run?.ended?.reason, "no_live_players");
});

test("a successor of one body is driven in its place, under the slot's name for it", (t) => {
  // ann is frail: her successor is a human where she lay, and dana drives it alongside ann2.
  const reg = registry(t);
  const { world, id } = started(t, "hall", reg, "frail_human");
  const snapshot = structuredClone(world.snapshot());
  snapshot.entities[id("ann")]!.integrity = 8;
  const run = memoryWorld(snapshot, reg, { ann: id("ann"), ann2: id("ann2"), bob: id("bob") });
  roundAct(run, id("bob"), "attack", `${id("ann")}.hand_r`);
  for (let round = 0; round < 12 && run.entity(id("ann"))?.status !== "destroyed"; round += 1) {
    run.round([]);
  }
  const heir = Object.values(run.snapshot().entities).find((entity) => entity.props.succeeds === id("ann"))?.id;
  ok(heir !== undefined, "ann has a successor");
  const dana = playerWorld(run, "dana");
  // The successor answers to the slot's name for it: the alias keyed by the slot's first body, as ann's was.
  deepStrictEqual(dana.submit({ command_id: "heir-walk", verb: "move", args: { to: { x: 20, y: 0 } }, body: aliasOf(id("ann"), heir!) }), { status: "ok" });
  deepStrictEqual(directorWorld(run).closeRound().results.map((result) => result.status), ["ok"]);
  deepStrictEqual(run.entity(heir!)?.pos, { x: 20, y: 0 });
});

test("a slot whose first body is removed reads through the rest: observe and inspect go on through the second body", (t) => {
  const { world, alias, id } = started(t);
  strictEqual(world.edit({ kind: "remove", target: id("ann") }).status, "ok");
  strictEqual(world.snapshot().run?.state, "running", "ann2 still lives, so the slot does");
  const dana = playerWorld(world, "dana");
  const seen = dana.observe().entities.map((entity) => entity.id);
  ok(seen.includes(alias("ann2")) && seen.includes(alias("stone")), "ann2's sight lists itself and the stone");
  strictEqual(dana.inspect(alias("stone"))?.id, alias("stone"));
  deepStrictEqual(dana.submit({ command_id: "a2-take", verb: "take", target: alias("stone"), body: alias("ann2") }), { status: "ok" });
  deepStrictEqual(directorWorld(world).closeRound().results.map((result) => result.status), ["ok"]);
});
