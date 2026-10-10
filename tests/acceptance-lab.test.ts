import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { actorWorld, aliasOf, createWorld, WORLD_AUTHOR, type Id, type Result, type Scenario, type World, type WorldEdit } from "../src/index.js";
import { canonicalJson } from "../src/engine/canonical.js";
import { tempDir } from "./harness.js";

// The lab's acceptance table (`docs/limits-lab.md`): one test per row, each from a fresh world built from
// `scenarios/lab.json` with its seed. Where a row repeats a step of `tests/scenario-lab.test.ts`, it is
// repeated on purpose. No row changes the engine; the seed's first jam is the ninth roll (`tests/scenario-lab.test.ts`, K).
const lab = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/lab.json", import.meta.url)), "utf8"),
) as { seed: number; entities: Scenario };

const STORED = ["log.jsonl", "events.jsonl", "deltas.jsonl", "snapshot.json"];

function open(t: { after(callback: () => void): void }, dirName = "lab") {
  const dir = join(tempDir(t), dirName);
  const world: World = createWorld(dir, lab.entities, undefined, { seed: lab.seed });
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>, perceivers?: boolean): Result => {
    seq += 1;
    return world.command({
      command_id: `a${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
      ...(perceivers === true && { perceivers: true }),
    });
  };
  const edit = (change: WorldEdit): Result => world.edit(change);
  return { world, id, run, edit, dir };
}

const status = (result: Result) => [result.status, result.reason_code];
const verdict = (result: Result) => [result.status, result.reason_code, result.reason_data];

test("row 1: the AI remotely locks the exit door with no key, and sees it locked through the corridor's camera", (t) => {
  const { world, id, run } = open(t);
  const [terminal, door] = [id("terminal"), id("exit_door")];
  // The door starts locked, so the terminal unlocks it, then locks it with no key in anyone's hand.
  deepStrictEqual(status(run(terminal, "unlock", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["ok", undefined]);
  strictEqual(world.entity(door)?.props.locked, true);
  deepStrictEqual(world.query({ kind: "perceive", observer: terminal, sense: "sight", entity: door }), {
    value: "true",
    basis_code: "camera",
  });
});

test("row 2: with the generator destroyed the terminal's lock is unpowered, naming the generator, and the door is unchanged", (t) => {
  const { world, id, run, edit } = open(t);
  const [ann, terminal, door, generator] = [id("ann"), id("terminal"), id("exit_door"), id("generator")];
  // The author puts ann beside the generator, and she blows it to pieces: three blows at full integrity.
  strictEqual(edit({ kind: "place", target: ann, support: id("server_room"), pos: { x: 300, y: 220 } }).status, "ok");
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(ann, "attack", "generator").status, "ok");
  }
  strictEqual(world.entity(generator)?.status, "destroyed");
  const before = canonicalJson(world.entity(door));
  deepStrictEqual(verdict(run(terminal, "lock", "exit door")), ["refused", "unpowered", { at: terminal, cut: generator }]);
  strictEqual(canonicalJson(world.entity(door)), before);
});

test("row 3: a subject outside the camera's coverage is unseen by the terminal; one in the corridor is seen, and the actor view lists only the second", (t) => {
  const { world, id, edit } = open(t);
  const [terminal, ann, bob] = [id("terminal"), id("ann"), id("bob")];
  // Bob stays in the dormitory; the author puts ann in the corridor the camera watches.
  strictEqual(edit({ kind: "place", target: ann, support: id("corridor"), pos: { x: -200, y: 0 } }).status, "ok");
  strictEqual(world.query({ kind: "perceive", observer: terminal, sense: "sight", entity: bob }).value, "false");
  deepStrictEqual(world.query({ kind: "perceive", observer: terminal, sense: "sight", entity: ann }), {
    value: "true",
    basis_code: "camera",
  });
  const view = actorWorld(world, terminal).observe();
  ok(view.entities.some((entity) => entity.id === aliasOf(terminal, ann)));
  ok(view.entities.every((entity) => entity.id !== aliasOf(terminal, bob)));
});

test("row 4: the arm's take of a key beyond its reach is unresolved; with the key in ann's grip beside it, held_by_another; neither moves the key", (t) => {
  const { world, id, run, edit } = open(t);
  const [arm, ann, key] = [id("arm"), id("ann"), id("key")];
  // The author puts the key where the arm cannot reach it.
  strictEqual(edit({ kind: "place", target: key, support: id("lab"), pos: { x: -300, y: 400 } }).status, "ok");
  const far = canonicalJson(world.entity(key));
  deepStrictEqual(status(run(arm, "take", "key")), ["unresolved", undefined]);
  strictEqual(canonicalJson(world.entity(key)), far);

  // The author puts the key back in reach; ann walks to the lab, takes it, and stands beside the arm.
  strictEqual(edit({ kind: "place", target: key, support: id("lab"), pos: { x: -300, y: 0 } }).status, "ok");
  deepStrictEqual(status(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { through: "lab door" })), ["ok", undefined]);
  strictEqual(run(ann, "take", "key").status, "ok");
  deepStrictEqual(status(run(ann, "move", undefined, { to: { x: -200, y: 60 } })), ["ok", undefined]);
  const held = canonicalJson(world.entity(key));
  deepStrictEqual(verdict(run(arm, "take", "key")), ["refused", "held_by_another", undefined]);
  strictEqual(canonicalJson(world.entity(key)), held);
  strictEqual(world.entity(key)?.contained_in, ann);
});

test("row 5: the terminal closes the exit door, ann opens it in the window, and a second close runs out and the lock is ok", (t) => {
  const { world, id, run } = open(t);
  const [terminal, ann, door] = [id("terminal"), id("ann"), id("exit_door")];
  // The terminal unlocks and opens the door, and ann comes up the corridor to it.
  deepStrictEqual(status(run(terminal, "unlock", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(terminal, "open", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { to: { x: 0, y: 420 } })), ["ok", undefined]);
  // The terminal shuts it: closing, and its lock is refused until the shut has come.
  deepStrictEqual(run(terminal, "close", "exit door").events.map((event) => event.type), ["close", "closing"]);
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["refused", "closing"]);
  // Ann opens it in the window: the shut stops, and nothing shuts on the clock.
  deepStrictEqual(status(run(ann, "open", "exit door")), ["ok", undefined]);
  strictEqual(world.entity(door)?.props.closing, undefined);
  deepStrictEqual(run(WORLD_AUTHOR, "advance", undefined, { ticks: 3 }).events.filter((event) => event.type === "closed"), []);
  strictEqual(world.entity(door)?.props.open, true);
  // A second close, and this time the window runs out: the lock is refused until the shut, then ok.
  deepStrictEqual(run(terminal, "close", "exit door").events.map((event) => event.type), ["close", "closing"]);
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["refused", "closing"]);
  const shut = run(WORLD_AUTHOR, "advance", undefined, { ticks: 2 });
  deepStrictEqual(shut.events.filter((event) => event.type === "closed").map((event) => event.entity), [door]);
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["ok", undefined]);
});

test("row 6: a watch for stage 1 leaves the stage at 0 through many ticks while a subject is outside, and a deadline sets it to -1", (t) => {
  const { world, id, run, edit } = open(t);
  const [ann, door, experiment] = [id("ann"), id("exit_door"), id("experiment")];
  const tick = (): number => world.snapshot().tick;
  // Ann is outside: the watch's condition (the door locked and nobody outside) is false every tick.
  strictEqual(edit({ kind: "place", target: ann, support: id("outside"), pos: { x: 0, y: 0 } }).status, "ok");
  const lock = {
    all: [
      { entity: door, prop: "locked", op: "eq", value: true },
      { room: id("outside"), occupied: false },
    ],
  };
  strictEqual(
    edit({
      kind: "schedule_beat",
      id: "watch",
      at_tick: tick() + 1,
      action: { kind: "set_props", target: experiment, props: { abstract: true, stage: 1 } },
      only_if: lock,
      repeat: { every_ticks: 1, times: 1000, until_ran: true },
    } as WorldEdit).status,
    "ok",
  );
  strictEqual(run(WORLD_AUTHOR, "advance", undefined, { ticks: 30 }).status, "ok");
  strictEqual(world.entity(experiment)?.props.stage, 0);

  // The deadline comes only if the stage is still 0, and it is: the stage is set to -1.
  strictEqual(
    edit({
      kind: "schedule_beat",
      id: "deadline",
      at_tick: tick() + 1,
      action: { kind: "set_props", target: experiment, props: { abstract: true, stage: -1 } },
      only_if: { entity: experiment, prop: "stage", op: "eq", value: 0 },
    } as WorldEdit).status,
    "ok",
  );
  strictEqual(run(WORLD_AUTHOR, "advance", undefined, { ticks: 2 }).status, "ok");
  strictEqual(world.entity(experiment)?.props.stage, -1);
});

test("row 7: an agent's view inspects neither the key nor the experiment, and a command naming another actor's alias is unresolved", (t) => {
  const { world, id, run } = open(t);
  const [bob, ann, key, experiment] = [id("bob"), id("ann"), id("key"), id("experiment")];
  const view = actorWorld(world, bob);
  strictEqual(view.inspect(aliasOf(bob, key)), null);
  strictEqual(view.inspect(aliasOf(bob, experiment)), null);
  // Ann's alias for the key is no name in bob's view.
  const theirs = aliasOf(ann, key);
  const named = view.command({ command_id: "bob-takes", verb: "take", target: theirs });
  deepStrictEqual([named.status, named.reason_code], ["unresolved", undefined]);
  strictEqual(run(bob, "wait", undefined, { ticks: 1 }).status, "ok");
});

test("row 8: the same initial state and commands write the same files, byte for byte, and verify is ok", (t) => {
  const send = (dirName: string) => {
    const { world, id, run, edit, dir } = open(t, dirName);
    const [ann, bob, terminal] = [id("ann"), id("bob"), id("terminal")];
    deepStrictEqual(status(run(terminal, "unlock", "exit door")), ["ok", undefined]);
    strictEqual(edit({ kind: "place", target: bob, support: id("lab"), pos: { x: -250, y: 60 } }).status, "ok");
    deepStrictEqual(status(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined]);
    deepStrictEqual(status(run(ann, "move", undefined, { through: "lab door" })), ["ok", undefined]);
    strictEqual(run(ann, "take", "key").status, "ok");
    strictEqual(run(ann, "move", undefined, { to: { x: -200, y: 60 } }).status, "ok");
    strictEqual(run(ann, "give", "key", { destination: "bob" }).status, "ok");
    strictEqual(world.entity(id("key"))?.contained_in, bob);
    strictEqual(world.verify().ok, true);
    return dir;
  };
  const first = send("first");
  const second = send("second");
  for (const file of STORED) {
    strictEqual(readFileSync(join(second, file), "utf8"), readFileSync(join(first, file), "utf8"), file);
  }
});
