import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, type Command, type WorldEdit, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// The underground lab written with today's mechanics: eight subjects in a dormitory, a corridor to
// the lab and to the server room, and an exit door, shut and locked, whose key lies in the lab. The
// AI's body is the terminal in the server room; the experiment's stage is a prop nothing reads.
// Steps are lettered; `docs/limits-lab.md` says what the lab wanted that they show it cannot say.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const lab = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/lab.json", import.meta.url)), "utf8"),
) as Scenario;

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

test("the lab with today's mechanics: an escape by key, an AI that only sees its room, a stage only the author moves", (t) => {
  const root = tempDir(t);
  const dir = join(root, "lab");
  const { world, id, sent, run, edit } = open(dir);
  const [ann, bob, terminal, experiment] = [id("ann"), id("bob"), id("terminal"), id("experiment")];
  const status = (result: Result) => [result.status, result.reason_code];

  // A. the world builds and holds its invariants: eight subjects and the terminal are its agents.
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  const agents = Object.values(world.snapshot().entities).filter((entity) => entity.props.agent === true);
  deepStrictEqual(agents.map((entity) => entity.template).sort(), [...Array<string>(8).fill("human"), "terminal"]);

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

  // C. the terminal senses only the server room: ann's take in the lab reached ann alone, and the
  // key there is not seen from it. No camera carries the lab to it.
  for (const event of took.events) {
    deepStrictEqual([event.perceivers?.sight, event.perceivers?.hearing], [[ann], []]);
  }
  deepStrictEqual(world.query({ kind: "perceive", observer: terminal, sense: "sight", entity: id("key") }).value, "false");

  // D. the terminal cannot lock the exit door: it cannot even name it from the server room, and
  // nothing connects it to the door.
  deepStrictEqual(status(run(terminal, "lock", "exit door")), ["unresolved", undefined]);

  // E. the escape advanced nothing: the stage changes by the author's edit alone, a subject's edit is
  // not the author's, and an abstract experiment is perceived by nobody, the terminal included.
  strictEqual(world.entity(experiment)?.props.stage, 0);
  const asked = { kind: "update_props", target: experiment, props: { stage: 1 } } as const;
  deepStrictEqual(status(run(bob, "edit", undefined, { edit: asked })), ["invalid", "invalid_author"]);
  strictEqual(edit(asked).status, "ok");
  strictEqual(world.entity(experiment)?.props.stage, 1);
  deepStrictEqual(world.query({ kind: "perceive", observer: ann, sense: "sight", entity: experiment }), {
    value: "false",
    basis_code: "abstract",
  });
  // Nor is there power to give the terminal: a prop no template declares is refused.
  strictEqual(edit({ kind: "update_props", target: terminal, props: { powered: true } }).reason_code, "undeclared_prop");

  // F. bob cannot walk into the open doorway, since a door blocks its footprint open or shut; the
  // author puts him there, and ann shutting the door from outside moves him aside first.
  deepStrictEqual(status(run(bob, "move", undefined, { through: "dormitory door" })), ["ok", undefined]);
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

  // G. the stored world replays, and the same scenario sent the same gives the same files, byte for byte.
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
