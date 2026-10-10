import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { actorWorld, aliasOf, createWorld, WORLD_AUTHOR, type Command, type WorldEdit, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// The underground lab written with today's mechanics: eight subjects in a dormitory, a corridor to
// the lab and to the server room, and an exit door, shut and locked, whose key lies in the lab. The
// AI's body is the terminal in the server room, which controls the exit door and the arm and watches
// the corridor's and the lab's cameras over a cable from the generator; the experiment's stage is a
// prop nothing reads.
// Steps are lettered; `docs/limits-lab.md` says what the lab wanted that they show it cannot say.

const verdict = (result: Result) => [result.status, result.reason_code, result.reason_data];

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const lab = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/lab.json", import.meta.url)), "utf8"),
) as { seed: number; entities: Scenario };

test("the lab: the arm takes the key before ann arrives, and a cut cable leaves it holding until ann's blow frees it", (t) => {
  const root = tempDir(t);
  const dir = join(root, "arm");
  const { world, id, run } = open(dir);
  const [arm, ann, bob, key, cable, terminal] = [id("arm"), id("ann"), id("bob"), id("key"), id("cable"), id("terminal")];
    const sees = (entity: Id) => world.query({ kind: "perceive", observer: terminal, sense: "sight", entity });

  // The lab camera, on the cable, shows the terminal the key on the lab floor before the arm takes it.
  deepStrictEqual(sees(key), { value: "true", basis_code: "camera" });
  // The arm takes the key from the lab floor, within its reach, before ann comes in.
  deepStrictEqual(verdict(run(arm, "take", "key")), ["ok", undefined, undefined]);
  strictEqual(world.entity(key)?.contained_in, arm);
  // The key in the arm's grip is still in the camera's sight; the terminal's view names it by its own alias,
  // which is not the arm's, so the test drives the arm by name, as a caller holding both views must.
  deepStrictEqual(sees(key), { value: "true", basis_code: "camera" });
  ok(aliasOf(terminal, key) !== aliasOf(arm, key));
  ok(actorWorld(world, terminal).observe().entities.some((entity) => entity.id === aliasOf(terminal, key)));

  // Ann comes in and stands by the key, and her take from the arm's grip is refused: a grip is not a pocket.
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "lab door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "move", undefined, { to: { x: -200, y: 60 } })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "take", "key")), ["refused", "held_by_another", undefined]);

  // Bob cuts the cable in the corridor, as in step E: the arm's power walk now ends in a destroyed link.
  deepStrictEqual(verdict(run(bob, "move", undefined, { through: "dormitory door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(bob, "move", undefined, { to: { x: 200, y: 360 } })), ["ok", undefined, undefined]);
  strictEqual(run(bob, "attack", "cable").status, "ok");
  strictEqual(world.entity(cable)?.status, "destroyed");
  // The cut blinds the camera too: the terminal no longer sees the key in the arm's grip.
  strictEqual(sees(key).value, "false");

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

test("the lab's exit door in its window: bob walks out before it shuts, ann's open stops a shut, and the lock waits for the shut", (t) => {
  const root = tempDir(t);
  const { world, id, run } = open(join(root, "window"));
  const [ann, bob, terminal, door] = [id("ann"), id("bob"), id("terminal"), id("exit_door")];
  const status = (result: Result) => [result.status, result.reason_code];
  const shuts = (result: Result) => result.events.filter((event) => event.type === "closed").map((event) => event.entity);

  // The terminal unlocks and opens the exit door; bob, in the dormitory, walks into the corridor by it.
  deepStrictEqual(status(run(terminal, "unlock", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(terminal, "open", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(bob, "move", undefined, { through: "dormitory door" })), ["ok", undefined]);
  deepStrictEqual(status(run(bob, "move", undefined, { to: { x: 0, y: 420 } })), ["ok", undefined]);

  // The terminal shuts it: the door is closing, still open, and the lock is refused until it shuts.
  const closing = run(terminal, "close", "exit door");
  deepStrictEqual(closing.events.map((event) => [event.type, event.entity]), [
    ["close", door],
    ["closing", door],
  ]);
  deepStrictEqual([world.entity(door)?.props.open, world.entity(door)?.props.closing], [true, true]);
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["refused", "closing"]);
  // Bob walks out through it in the window. The walk is one tick, and the shut falls due on the tick
  // the walk ends on: bob has passed while it was still open, and the door shuts with nobody in it.
  deepStrictEqual(status(run(bob, "move", undefined, { through: "exit door" })), ["ok", undefined]);
  strictEqual(world.entity(bob)?.location, id("outside"));
  deepStrictEqual(world.entity(door)?.props.open, false);
  deepStrictEqual(world.entity(door)?.props.closing, undefined);
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["ok", undefined]);

  // The terminal opens it again and shuts it; ann, coming up the corridor, opens it in the window: the
  // shut stops, the door stays open, and nothing shuts on the clock.
  deepStrictEqual(status(run(terminal, "unlock", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(terminal, "open", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(terminal, "close", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { to: { x: 0, y: 420 } })), ["ok", undefined]);
  const opened = run(ann, "open", "exit door");
  deepStrictEqual(opened.events.map((event) => event.type), ["open", "opened"]);
  deepStrictEqual([world.entity(door)?.props.open, world.entity(door)?.props.closing], [true, undefined]);
  deepStrictEqual(shuts(run(WORLD_AUTHOR, "advance", undefined, { ticks: 3 })), []);
  strictEqual(world.entity(door)?.props.open, true);

  // Shut again by the terminal, and the lock waits until the shut has come.
  deepStrictEqual(status(run(terminal, "close", "exit door")), ["ok", undefined]);
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["refused", "closing"]);
  deepStrictEqual(shuts(run(WORLD_AUTHOR, "advance", undefined, { ticks: 2 })), [door]);
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["ok", undefined]);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

// M. the corridor's camera is a narrow camera: a 60-degree cone turned toward the exit door. A subject in the
// corridor outside the cone is unseen by the terminal; the author turns the camera, and the terminal sees her.
test("the lab's corridor camera looks at 65 degrees: a subject outside its cone is unseen, until the author turns it to 7", (t) => {
  const { world, id, run, edit } = open(join(tempDir(t), "cone"));
  const [ann, terminal, camera] = [id("ann"), id("terminal"), id("camera")];
  const sees = () => world.query({ kind: "perceive", observer: terminal, sense: "sight", entity: ann });
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "move", undefined, { to: { x: 400, y: -300 } })), ["ok", undefined, undefined]);
  // From the camera at (-400, -400) she is 7 degrees off the exit door's 65-degree facing by 58: out of the cone.
  strictEqual(sees().value, "false");
  strictEqual(edit({ kind: "update_props", target: camera, props: { facing_deg: 7 } }).status, "ok");
  deepStrictEqual(sees(), { value: "true", basis_code: "camera" });
});

// L. the server panel is the local control of the exit door (`docs/panel.md`): ann works the door through it
// with no key, the terminal works it through the same panel, and once ann has blown the panel up her own key
// works the door by hand.
test("the lab's server panel: ann works the exit door through it with no key, and her key works it by hand once the panel is gone", (t) => {
  const { world, id, run } = open(join(tempDir(t), "panel"));
  const [ann, terminal, door, panel] = [id("ann"), id("terminal"), id("exit_door"), id("server_panel")];

  // Ann takes the key in the lab, comes out, and opens the server door from the corridor and walks through.
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "dormitory door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "lab door" })), ["ok", undefined, undefined]);
  strictEqual(run(ann, "take", "key").status, "ok");
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "lab door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "open", "server door")), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "server door" })), ["ok", undefined, undefined]);
  // By the panel she puts the key down, so she has no key when she works the door.
  deepStrictEqual(verdict(run(ann, "move", undefined, { to: { x: -300, y: 60 } })), ["ok", undefined, undefined]);
  strictEqual(run(ann, "drop", "key").status, "ok");

  // The exit door is in the corridor, out of her hands' reach: she unlocks and opens it through the panel.
  deepStrictEqual(verdict(run(ann, "unlock", "exit door")), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "open", "exit door")), ["ok", undefined, undefined]);
  strictEqual(world.entity(door)?.props.open, true);

  // The terminal, through the same panel, shuts the door; after the shut it locks it again.
  deepStrictEqual(run(terminal, "close", "exit door").events.map((event) => event.type), ["close", "closing"]);
  deepStrictEqual(run(WORLD_AUTHOR, "advance", undefined, { ticks: 2 }).events.filter((event) => event.type === "closed").map((event) => event.entity), [door]);
  deepStrictEqual(verdict(run(terminal, "lock", "exit door")), ["ok", undefined, undefined]);
  strictEqual(world.entity(door)?.props.locked, true);

  // Ann blows the panel to pieces. The terminal's unlock is refused where its walk ends at the panel.
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(ann, "attack", "server panel").status, "ok");
  }
  strictEqual(world.entity(panel)?.status, "destroyed");
  deepStrictEqual(verdict(run(terminal, "unlock", "exit door")), ["refused", "disconnected", { at: panel }]);

  // Ann takes the key from where she dropped it, goes out through the server door, and unlocks the exit door by hand.
  strictEqual(run(ann, "take", "key").status, "ok");
  deepStrictEqual(verdict(run(ann, "move", undefined, { through: "server door" })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "move", undefined, { to: { x: 0, y: 420 } })), ["ok", undefined, undefined]);
  deepStrictEqual(verdict(run(ann, "unlock", "exit door")), ["ok", undefined, undefined]);
  strictEqual(world.entity(door)?.props.locked, false);
});

// K. the exit door jams: the terminal works it, unlocking and locking it in turn, and each command that
// does not jam moves it on. The seed's first jam is the ninth roll; the camera shows it, and the door is as it was.
test("the lab's exit door jams under the terminal: the first jam the seed gives is seen by the camera, and the door stays as it was", (t) => {
  const { world, id, run } = open(join(tempDir(t), "jam"));
  const [terminal, door] = [id("terminal"), id("exit_door")];
  const sees = (entity: Id) => world.query({ kind: "perceive", observer: terminal, sense: "sight", entity });
  let worked = 0;
  let jam: Result | undefined;
  let jammedVerb = "";
  while (jam === undefined) {
    ok(worked < 20, "the seed jams within twenty rolls");
    const verb = world.entity(door)?.props.locked === true ? "unlock" : "lock";
    const before = world.entity(door)?.props.locked;
    const result = run(terminal, verb, "exit door", undefined, true);
    strictEqual(result.status, "ok");
    if (result.events.some((event) => event.type === "jammed")) {
      jam = result;
      jammedVerb = verb;
      strictEqual(world.entity(door)?.props.locked, before);
    } else {
      worked += 1;
      ok(world.entity(door)?.props.locked !== before);
    }
  }
  // The seed's first jam is the ninth roll; the eight before it moved the door.
  strictEqual(worked, 8);
  deepStrictEqual(jam.events.map((event) => [event.type, event.entity]), [
    [jammedVerb, door],
    ["jammed", door],
  ]);
  deepStrictEqual(jam.events[1]?.data, { verb: jammedVerb });
  ok(jam.events[1]?.perceivers?.sight.includes(terminal));
  deepStrictEqual(sees(door), { value: "true", basis_code: "camera" });
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});

// Everything sent to the world, in order, so a second world can be sent the same.
type Sent = { command: Command } | { edit: WorldEdit };

function open(dir: string): { world: World; id: (name: string) => Id; sent: Sent[]; run: Run; edit: (edit: WorldEdit) => Result } {
  const world = createWorld(dir, lab.entities, undefined, { seed: lab.seed });
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

test("the lab: an escape by key, an AI that locks a door it cannot see, a cut cable, a stage a watch moves, a terminal without power", (t) => {
  const root = tempDir(t);
  const dir = join(root, "lab");
  const { world, id, sent, run, edit } = open(dir);
  const [ann, bob, terminal, experiment] = [id("ann"), id("bob"), id("terminal"), id("experiment")];
  const status = (result: Result) => [result.status, result.reason_code];

  // A. the world builds and holds its invariants: eight subjects, the terminal and the arm are its agents.
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  const agents = Object.values(world.snapshot().entities).filter((entity) => entity.props.agent === true);
  deepStrictEqual(agents.map((entity) => entity.template).sort(), ["arm", ...Array<string>(8).fill("human"), "terminal"]);

  // A2. the terminal speaks through the dormitory intercom: every subject there hears it through the
  // intercom, and ann answers from there, which the terminal hears through it too.
  const heardBy = (observer: Id, event: string) => world.query({ kind: "perceive", observer, event_id: event, sense: "hearing" });
  const wake = run(terminal, "say", undefined, { utterance: "wake" });
  const subjects = agents.filter((entity) => entity.template === "human").map((entity) => entity.id);
  deepStrictEqual(
    subjects.map((subject) => heardBy(subject, wake.events[0]!.event_id)),
    subjects.map(() => ({ value: "true", basis_code: "intercom" })),
  );
  const who = run(ann, "say", undefined, { utterance: "who" });
  deepStrictEqual(heardBy(terminal, who.events[0]!.event_id), { value: "true", basis_code: "intercom" });

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

  // C. the terminal senses the server room and, by camera, the corridor and the lab: ann's take in the lab
  // reached ann and the terminal, which sees the key there through the lab camera, and no one else.
  for (const event of took.events) {
    deepStrictEqual([event.perceivers?.sight, event.perceivers?.hearing], [[terminal, ann].sort(), []]);
  }
  // The key is in ann's hand now, and ann is out of the lab: nothing the lab camera sees holds it.
  deepStrictEqual(world.query({ kind: "perceive", observer: terminal, sense: "sight", entity: id("key") }), {
    value: "false",
    basis_code: "not_perceptible",
  });
  // A move in the dormitory, where no camera looks, reaches the dormitory's subjects and not the terminal.
  const shuffle = run(bob, "move", undefined, { to: { x: -250, y: 60 } }, true);
  strictEqual(shuffle.status, "ok");
  const dormitory = subjects.filter((subject) => subject !== ann).sort();
  for (const event of shuffle.events) {
    deepStrictEqual(event.perceivers?.sight.slice().sort(), dormitory);
  }

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
  strictEqual(run(bob, "attack", "cable").status, "ok");
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
  // The exit door is a shut door: ann's close opens its window, and the shut comes two ticks on, moving
  // bob aside only then.
  const closing = run(ann, "close", "exit door");
  deepStrictEqual(closing.events.map((event) => [event.type, event.entity]), [
    ["close", id("exit_door")],
    ["closing", id("exit_door")],
  ]);
  strictEqual(world.entity(bob)?.pos?.y, 450);
  const shut = run(WORLD_AUTHOR, "advance", undefined, { ticks: 2 });
  deepStrictEqual(
    shut.events.filter((event) => event.type === "closed" || event.type === "moved").map((event) => [event.type, event.entity]),
    [
      ["closed", id("exit_door")],
      ["moved", bob],
    ],
  );
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
  // The deadline is queued three ticks on, then brought forward to the tick after next. It finds the stage
  // advanced, so its condition is false and it is skipped, at the tick it was brought to.
  const deadline = { kind: "set_props", target: experiment, props: { abstract: true, stage: -1 } } as const;
  const due = tick() + 2;
  strictEqual(
    edit({ kind: "schedule_beat", id: "deadline", at_tick: due + 3, action: deadline, only_if: { entity: experiment, prop: "stage", op: "eq", value: 0 } } as WorldEdit).status,
    "ok",
  );
  strictEqual(edit({ kind: "retime_beat", id: "deadline", at_tick: due } as WorldEdit).status, "ok");
  const late = clock(4);
  deepStrictEqual(
    late.events.filter((event) => event.type === "beat_skipped").map((event) => [event.data.id, event.data.reason, event.tick]),
    [["deadline", "condition", due]],
  );
  strictEqual(world.entity(experiment)?.props.stage, 1);
  deepStrictEqual(world.schedule({ kind: "beat" }), []);

  // J. the terminal runs on the generator itself, so the cut cable left it running; ann opens the server
  // room and destroys the generator, and the terminal can neither act nor sense, while the world's time
  // and the author's beats go on without it.
  const generator = id("generator");
  deepStrictEqual(status(run(ann, "open", "server door")), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { through: "server door" })), ["ok", undefined]);
  deepStrictEqual(status(run(ann, "move", undefined, { to: { x: 300, y: 220 } })), ["ok", undefined]);
  ok(run(ann, "say", undefined, { utterance: "here" }, true).events[0]?.perceivers?.hearing.includes(terminal));
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(ann, "attack", "generator").status, "ok");
  }
  strictEqual(world.entity(generator)?.status, "destroyed");
  const dark = run(terminal, "wait", undefined, { ticks: 1 });
  deepStrictEqual([dark.status, dark.reason_code, dark.reason_data], ["refused", "unpowered", { at: terminal, cut: generator }]);
  strictEqual(run(ann, "say", undefined, { utterance: "here" }, true).events[0]?.perceivers?.hearing.includes(terminal), false);
  // The intercom is silent too: the generator is gone, so the terminal cannot speak through it.
  const lost = run(terminal, "say", undefined, { utterance: "lost" });
  deepStrictEqual([lost.status, lost.reason_code], ["refused", "unpowered"]);
  deepStrictEqual(world.query({ kind: "perceive", observer: terminal, sense: "sight", entity: ann }), {
    value: "false",
    basis_code: "unpowered",
  });
  const stageTwo = { kind: "set_props", target: experiment, props: { abstract: true, stage: 2 } } as const;
  strictEqual(edit({ kind: "schedule_beat", id: "after", at_tick: tick() + 1, action: stageTwo } as WorldEdit).status, "ok");
  strictEqual(clock(1).status, "ok");
  strictEqual(world.entity(experiment)?.props.stage, 2);

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
