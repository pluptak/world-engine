import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, memoryWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { directorWorld } from "../src/director-world.js";
import { playerWorld } from "../src/player-world.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A body that is destroyed may leave a successor (`docs/templates.md`): one agent of the template it names,
// where the body lay, caused by the destruction. Ann is a frail human whose successor is a human; a player
// drives her, and then her successor. The bleed is what destroys her: bob severs her hand.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));

function registry(t: { after(callback: () => void): void }, extra: Record<string, unknown> = {}): TemplateRegistry {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  writeFileSync(join(dir, "brute.json"), JSON.stringify({ id: "brute", extends: "human", props: { attack_damage: 100 } }));
  writeFileSync(join(dir, "frail_human.json"), JSON.stringify({ id: "frail_human", extends: "human", props: { successor: "human" } }));
  writeFileSync(join(dir, "heir_human.json"), JSON.stringify({ id: "heir_human", extends: "human", props: { successor: "frail_human" } }));
  for (const [id, body] of Object.entries(extra)) {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(body));
  }
  return loadTemplates(dir);
}

const scenario = (annTemplate: string): Scenario => [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "ann", template: annTemplate, overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "bob", template: "brute", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 0, y: 50 } } },
];

// The body a frail ann is: her integrity set low on the snapshot, which a scenario may not write.
function frail(t: { after(callback: () => void): void }, annTemplate = "frail_human", extra: Record<string, unknown> = {}): { world: World; reg: TemplateRegistry; id: (name: string) => Id } {
  const reg = registry(t, extra);
  const made = createWorld(join(tempDir(t), "succ"), scenario(annTemplate), reg);
  const snapshot = structuredClone(made.snapshot());
  const names = { ann: made.id("ann")!, bob: made.id("bob")! };
  snapshot.entities[names.ann]!.integrity = 8;
  const world = memoryWorld(snapshot, reg, names);
  return { world, reg, id: (name: string) => world.id(name)! };
}

let seq = 0;
function act(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({ command_id: `s${seq}`, actor, verb, ...(target === undefined ? {} : { target }), ...(args === undefined ? {} : { args }) });
}

// A move of a round: a running run takes an agent's command only in one.
function roundAct(world: World, actor: Id, verb: string, target?: string): Result {
  seq += 1;
  return world.round([{ command_id: `r${seq}`, actor, verb, ...(target === undefined ? {} : { target }) }]).results[0]!;
}

// The successors of a body: the bodies whose `succeeds` names it.
const successorsOf = (world: World, body: Id): Id[] =>
  Object.values(world.snapshot().entities)
    .filter((entity) => entity.props.succeeds === body)
    .map((entity) => entity.id);

test("a template with a successor loads; one naming a non-agent or a missing template is refused, naming the template", (t) => {
  // The shipped set and the frail templates load as they are.
  registry(t);
  throws(() => registry(t, { bad_human: { id: "bad_human", extends: "human", props: { successor: "stone" } } }), /bad_human names successor stone/);
  throws(() => registry(t, { lost_human: { id: "lost_human", extends: "human", props: { successor: "nothing_here" } } }), /lost_human names successor nothing_here/);
});

test("a body destroyed by a bleed leaves one successor where it lay, caused by the destruction, and the body stays destroyed", (t) => {
  const { world, id } = frail(t);
  const [ann, bob] = [id("ann"), id("bob")];
  strictEqual(act(world, bob, "attack", `${ann}.hand_r`).status, "ok");
  const waited = act(world, bob, "wait", undefined, { ticks: 7 });
  const destroyed = waited.events.find((event) => event.type === "destroyed" && event.entity === ann);
  ok(destroyed !== undefined, "ann bleeds out");
  strictEqual(world.entity(ann)?.status, "destroyed");
  const [successor] = successorsOf(world, ann);
  ok(successor !== undefined, "one successor");
  deepStrictEqual(successorsOf(world, ann), [successor]);
  const body = world.entity(successor)!;
  deepStrictEqual([body.template, body.status, body.location, body.support, body.pos], ["human", "intact", world.entity(ann)?.location, world.entity(ann)?.support, world.entity(ann)?.pos]);
  // The spawn is caused by the destruction, and the record of it names the body it took over.
  const spawned = waited.events.find((event) => event.type === "spawned" && event.entity === successor);
  strictEqual(spawned?.cause_id, destroyed?.event_id);
});

test("a successor's own successor is the one a player drives, down the chain, and a body with none is its own", (t) => {
  // Heir names frail_human, which names human: killed twice over, the chain runs three bodies long.
  const { world, id, reg } = frail(t, "heir_human");
  const [ann, bob] = [id("ann"), id("bob")];
  strictEqual(act(world, bob, "attack", `${ann}.hand_r`).status, "ok");
  act(world, bob, "wait", undefined, { ticks: 7 });
  const [first] = successorsOf(world, ann);
  ok(first !== undefined);
  strictEqual(world.entity(first)?.template, "frail_human");
  // The first successor is frail too: its hand is taken, and it bleeds out in turn.
  const snapshot = structuredClone(world.snapshot());
  snapshot.entities[first!]!.integrity = 8;
  const next = memoryWorld(snapshot, reg, { ann, bob, first: first! });
  strictEqual(act(next, bob, "attack", `${first}.hand_r`).status, "ok");
  act(next, bob, "wait", undefined, { ticks: 7 });
  const [second] = successorsOf(next, first!);
  ok(second !== undefined, "the successor's successor");
  strictEqual(next.entity(second)?.template, "human");
  strictEqual(next.entity(second)?.props.succeeds, first);
});

test("a run whose only slot dies with a successor keeps running, and ends when the successor is destroyed", (t) => {
  const { world, id, reg } = frail(t);
  const [ann, bob] = [id("ann"), id("bob")];
  // Run the scene as a run with ann as its slot, started by the director.
  const snapshot = structuredClone(world.snapshot());
  snapshot.run = { tick_limit: 40, slots: [ann], state: "registering" };
  const run = memoryWorld(snapshot, reg, { ann, bob });
  strictEqual(directorWorld(run).edit({ kind: "start_run" }, { command_id: "go" }).status, "ok");
  strictEqual(roundAct(run, bob, "attack", `${ann}.hand_r`).status, "ok");
  for (let round = 0; round < 8 && run.entity(ann)?.status !== "destroyed"; round += 1) {
    run.round([]);
  }
  strictEqual(run.entity(ann)?.status, "destroyed");
  // Ann is gone, but her successor takes the slot over: the run goes on.
  strictEqual(run.snapshot().run?.state, "running");
  // Wound the successor as frail, and it bleeds out: now no live slot is left.
  const [heir] = successorsOf(run, ann);
  const tweaked = structuredClone(run.snapshot());
  tweaked.entities[heir!]!.integrity = 8;
  const again = memoryWorld(tweaked, reg, { ann, bob, heir: heir! });
  strictEqual(roundAct(again, bob, "attack", `${heir}.hand_r`).status, "ok");
  for (let round = 0; round < 8 && again.entity(heir!)?.status !== "destroyed"; round += 1) {
    again.round([]);
  }
  strictEqual(again.entity(heir!)?.status, "destroyed");
  strictEqual(again.snapshot().run?.state, "ended");
  strictEqual(again.snapshot().run?.ended?.reason, "no_live_players");
});

test("with the player item, a player drives the successor that took its body over, and its submitted move is the successor's", (t) => {
  const { world, id, reg } = frail(t);
  const [ann, bob] = [id("ann"), id("bob")];
  const snapshot = structuredClone(world.snapshot());
  snapshot.run = { tick_limit: 40, slots: [ann], state: "registering" };
  const run = memoryWorld(snapshot, reg, { ann, bob });
  const director = directorWorld(run);
  strictEqual(director.edit({ kind: "register_player", handle: "dana", slot: ann }, { command_id: "reg" }).status, "ok");
  strictEqual(director.edit({ kind: "start_run" }, { command_id: "go" }).status, "ok");
  strictEqual(roundAct(run, bob, "attack", `${ann}.hand_r`).status, "ok");
  for (let round = 0; round < 8 && run.entity(ann)?.status !== "destroyed"; round += 1) {
    run.round([]);
  }
  const [heir] = successorsOf(run, ann);
  ok(heir !== undefined);
  const dana = playerWorld(run, "dana");
  deepStrictEqual(dana.submit({ command_id: "dana-move", verb: "move", args: { to: { x: 20, y: 0 } } }), { status: "ok" });
  strictEqual(dana.pending()?.actor, heir);
  // The round takes the move as the successor's: the successor stands where dana sent it.
  const closed = directorWorld(run).closeRound();
  strictEqual(closed.status, "ok");
  deepStrictEqual(closed.results[0]?.status, "ok");
  deepStrictEqual(run.entity(heir!)?.pos, { x: 20, y: 0 });
});
