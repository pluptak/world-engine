import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, WORLD_AUTHOR, type Command, type WorldEdit, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// The underground lab written with today's mechanics: eight subjects in a dormitory, a corridor to
// the lab and to the server room, and an exit door, shut and locked, whose key lies in the lab. The
// AI's body is the terminal in the server room, which controls the exit door and watches the
// corridor's camera over a cable from the generator; the experiment's stage is a prop nothing reads.
// Steps are lettered; `docs/limits-lab.md` says what the lab wanted that they show it cannot say.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const lab = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/lab.json", import.meta.url)), "utf8"),
) as Scenario;

test("the lab: the arm takes the key before ann arrives, and a cut cable leaves it holding until ann's blow frees it", (t) => {
  const root = tempDir(t);
  const dir = join(root, "arm");
  const { world, id, run } = open(dir);
  const [arm, ann, bob, key, cable] = [id("arm"), id("ann"), id("bob"), id("key"), id("cable")];
  const verdict = (result: Result) => [result.status, result.reason_code, result.reason_data];

  // The arm takes the key from the lab floor, within its reach, before ann comes in.
  deepStrictEqual(verdict(run(arm, "take", "key")), ["ok", undefined, undefined]);
  strictEqual(world.entity(key)?.contained_in, arm);

  // Ann comes in and stands by the key, and her take from the arm's grip is refused: a grip is not a pocket.
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "lab door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "move", undefined, { to: { x: -200, y: 60 } })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "take", "key")), ["refused", "held_by_another", undefined]);

  // Bob cuts the cable in the corridor, as in step E: the arm's power walk now ends in a destroyed link.
  deepStrictEqual(verdict(run(bob, "move", undefined, { through: "dormitory door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(bob, "move", undefined, { to: { x: 200, y: 360 } })), ["ok", undefined, undefined]);
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(bob, "attack", "cable").status, "ok");
  }
  strictEqual(world.entity(cable)?.status, "destroyed");

  // The arm cannot let go: its drop is refused at the arm, with the cable as the cut.
  deepStrictEqual(verdict(run(arm, "drop", "key")), ["refused", "unpowered", { at: arm, cut: cable }]);
  strictEqual(world.entity(key)?.contained_in, arm);

  // Ann, still beside the arm, blows its gripper, which has 40 integrity: the gripper is destroyed, and the
  // arm drops the key as a body that loses its hands does. Ann takes it from the floor.
  deepStrictEqual(verdict(run(ann, "attack", `${arm}.gripper`)), ["ok", undefined, undefined]);
  strictEqual(world.entity(key)?.contained_in, null);
  deepStrictEqual(verdict(run(ann, "take", "key")), ["ok", undefined, undefined]);
  strictEqual(world.entity(key)?.contained_in, ann);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

// Everything sent to the world, in order, so a second world can be sent the same.
type Sent = { command: Command } | { edit: WorldEdit };

function open(dir: string): { world: World; id: (name: string) => Id; sent: Sent[]; run: Run; edit: (edit: WorldEdit) => Result } {
  const world = createWorld(dir, lab);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  const sent: Sent[] = [];
  let seq = 0;
  const run: Run = (actor, verb, target, args, perceivers) => {
    seq += 1;
    const command: Command = {
      command_id: `lab${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
      ...(perceivers === true && { perceivers }),
    };
    sent.push({ command });
    return world.command(command);
  };
  const edit = (change: WorldEdit): Result => {
    sent.push({ edit: change });
    return world.edit(change);
  };
  return { world, id, sent, run, edit };
}

type Run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>, perceivers?: boolean) => Result;

const STORED = ["log.jsonl", "events.jsonl", "deltas.jsonl", "snapshot.json"];

test("the lab: an escape by key, an AI that locks a door it cannot see, a cut cable, a stage a watch moves", (t) => {
  const root = tempDir(t);
  const dir = join(root, "lab");
  const { world, id, sent, run, edit } = open(dir);
  const [ann, bob, terminal, experiment] = [id("ann"), id("bob"), id("terminal"), id("experiment")];
  const status = (result: Result) => [result.status, result.reason_code];

  // A. the world builds and holds its invariants: eight subjects, the terminal and the arm are its agents.
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  const agents = Object.values(world.snapshot().entities).filter((entity) => entity.props.agent === true);
  deepStrictEqual(agents.map((entity) => entity.template).sort(), ["arm", ...Array<string>(8).fill("human"), "terminal"]);

  // B. ann walks to the lab, takes the key, comes back, unlocks and opens the exit door and leaves:
  // escaped is no event, only where she is.
  deepStrictEqual(status(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { through: "lab door" })), ["ok", undefined]);
  const took = run(ann, "take", "key", undefined, true);
  strictEqual(took.status, "ok");
  deepStrictEqual(status(run(ann, "move", undefined, { through: "lab door" })), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { to: { x: 0, y: 420 } })), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "unlock", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "open", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { through: "exit door" })), ["ok", undefined]);
  deepStrictEqual(world.query({ kind: "fact", subject: ann, relation: "location", object: id("outside") }), {
    value: "true",
    basis_code: "relation_state",
  });

  // C. the terminal senses the server room and, by camera, the corridor: ann's take in the lab
  // reached ann alone, and the key there is not seen from it.
  for (const event of took.events) {
    deepStrictEqual([event.perceivers?.sight, event.perceivers?.hearing], [[ann], []]);
  }
  deepStrictEqual(world.query({ kind: "perceive", observer: terminal, sense: "sight", entity: id("key") }).value, "false");

  // D. the terminal locks the exit door it controls from the server room: no key, no hands, no reach,
  // and it sees the door it locks through the corridor's camera.
  const sees = (entity: Id) => world.query({ kind: "perceive", observer: terminal, sense: "sight", entity });
  deepStrictEqual(sees(id("exit_door")), { value: "true", basis_code: "camera" });
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["ok", undefined]);
  strictEqual(world.entity(id("exit_door"))?.props.locked, true);

  // E. bob cuts the cable in the corridor: the terminal's unlock is refused where power stops, and
  // ann's key still turns the lock by hand from outside.
  const cable = id("cable");
  deepStrictEqual(status(run(bob, "move", undefined, { through: "dormitory door" })), ["ok", undefined]);
  deepStrictEqual(status(run(bob, "move", undefined, { to: { x: 200, y: 360 } })), ["ok", undefined]);
  deepStrictEqual(sees(bob), { value: "true", basis_code: "camera" });
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(bob, "attack", "cable").status, "ok");
  }
  strictEqual(world.entity(cable)?.status, "destroyed");
  // The cut blinds the camera too: the terminal sees neither bob nor the door.
  strictEqual(sees(bob).value, "false");
  strictEqual(sees(id("exit_door")).value, "false");
  const cut = run(terminal, "unlock", "exit door");
  deepStrictEqual([cut.status, cut.reason_code, cut.reason_data], ["refused", "unpowered", { at: id("exit_door"), cut: cable }]);
  deepStrictEqual(status(run(ann, "unlock", "exit door")), ["ok", undefined]);

  // F. the escape advanced nothing: the stage is 0 and stays so until a watch the author set moves it
  // (I), a subject's edit is not the author's, and an abstract experiment is perceived by nobody, the terminal included.
  strictEqual(world.entity(experiment)?.props.stage, 0);
  const asked = { kind: "update_props", target: experiment, props: { stage: 1 } } as const;
  deepStrictEqual(status(run(bob, "edit", undefined, { edit: asked })), ["invalid", "invalid_author"]);
  strictEqual(world.entity(experiment)?.props.stage, 0);
  deepStrictEqual(world.query({ kind: "perceive", observer: ann, sense: "sight", entity: experiment }), {
    value: "false",
    basis_code: "abstract",
  });
  // G. bob cannot walk into the open doorway, since a door blocks its footprint open or shut; the
  // author puts him there, and ann shutting the door from outside moves him aside first.
  const walked = run(bob, "move", undefined, { to: { x: 0, y: 450 } });
  deepStrictEqual([walked.status, walked.reason_code, walked.reason_data], ["refused", "blocked", { with: id("exit_door") }]);
  strictEqual(edit({ kind: "place", target: bob, support: id("corridor"), pos: { x: 0, y: 450 } }).status, "ok");
  const closed = run(ann, "close", "exit door");
  deepStrictEqual(closed.events.map((event) => [event.type, event.entity]), [
    ["close", id("exit_door")],
    ["closed", id("exit_door")],
    ["moved", bob],
  ]);
  ok(world.entity(bob)?.pos?.y !== 450);

  // I. the stage advances on its own: a watch the author set moves it once the exit door is locked and
  // nobody is outside, and a deadline the author set for later finds it advanced, so it is skipped.
  const tick = (): number => world.snapshot().tick;
  const clock = (ticks: number): Result => run(WORLD_AUTHOR, "advance", undefined, { ticks });
  const stageOne = { kind: "set_props", target: experiment, props: { abstract: true, stage: 1 } } as const;
  const lock = {
    all: [
      { entity: id("exit_door"), prop: "locked", op: "eq", value: true },
      { room: id("outside"), occupied: false },
    ],
  };
  strictEqual(
    edit({ kind: "schedule_beat", id: "watch", at_tick: tick() + 1, action: stageOne, only_if: lock, repeat: { every_ticks: 1, times: 1000, until_ran: true } } as WorldEdit).status,
    "ok",
  );
  // Ann is outside and the door is shut but unlocked: the watch is silent.
  strictEqual(clock(2).status, "ok");
  strictEqual(world.entity(experiment)?.props.stage, 0);
  // Ann locks the door from outside with her key: it is locked, but she is still outside.
  strictEqual(run(ann, "lock", "exit door").status, "ok");
  strictEqual(clock(1).status, "ok");
  strictEqual(world.entity(experiment)?.props.stage, 0);
  // The author puts ann back in the corridor: nobody is outside, the door is locked, the watch fires.
  strictEqual(edit({ kind: "place", target: ann, support: id("corridor"), pos: { x: -200, y: 0 } }).status, "ok");
  strictEqual(clock(1).status, "ok");
  strictEqual(world.entity(experiment)?.props.stage, 1);
  // The deadline finds the stage advanced, so its condition is false and it is skipped.
  const deadline = { kind: "set_props", target: experiment, props: { abstract: true, stage: -1 } } as const;
  strictEqual(
    edit({ kind: "schedule_beat", id: "deadline", at_tick: tick() + 3, action: deadline, only_if: { entity: experiment, prop: "stage", op: "eq", value: 0 } } as WorldEdit).status,
    "ok",
  );
  const late = clock(4);
  deepStrictEqual(
    late.events.filter((event) => event.type === "beat_skipped").map((event) => [event.data.id, event.data.reason]),
    [["deadline", "condition"]],
  );
  strictEqual(world.entity(experiment)?.props.stage, 1);
  deepStrictEqual((world.snapshot().schedule ?? []).filter((cause) => cause.kind === "beat"), []);

  // H. the stored world replays, and the same scenario sent the same gives the same files, byte for byte.
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  strictEqual(world.verify().ok, true);
  const again = open(join(root, "again"));
  for (const entry of sent) {
    if ("command" in entry) {
      again.world.command(entry.command);
    } else {
      again.world.edit(entry.edit);
    }
  }
  for (const file of STORED) {
    strictEqual(readFileSync(join(root, "again", file), "utf8"), readFileSync(join(dir, file), "utf8"), file);
  }
});
