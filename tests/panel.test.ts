import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A panel is the local control of a device (`docs/panel.md`). The hall door joins the hall and a vault,
// and is controlled by the hall's panel, which the yard's panel controls, which a relay (a stone) passes
// on to the AI's terminal. Ann stands by the yard panel and cannot reach the door by hand; bob stands by
// the door and the hall panel with a key; cid is out of the yard panel's reach and sees nothing of the hall.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));

function registry(t: { after(callback: () => void): void }): TemplateRegistry {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  writeFileSync(join(dir, "jam_all_door.json"), JSON.stringify({ id: "jam_all_door", extends: "door", props: { jam_pct: 100 } }));
  return loadTemplates(dir);
}

function scenario(doorTemplate: string): Scenario {
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "vault", template: "room", overrides: { name: "vault", props: { lit: true } } },
    { id: "generator", template: "generator", overrides: { name: "generator", location: "yard", support: "yard", pos: { x: -300, y: -300 } } },
    { id: "cable", template: "cable", overrides: { name: "cable", location: "yard", support: "yard", pos: { x: -100, y: 130 }, props: { powered_by: "generator" } } },
    {
      id: "yard_panel",
      template: "panel",
      overrides: { name: "yard panel", location: "yard", support: "yard", pos: { x: -100, y: 0 }, props: { powered_by: "cable", controlled_by: "relay" } },
    },
    {
      id: "relay",
      template: "stone",
      overrides: { name: "relay", location: "yard", support: "yard", pos: { x: 300, y: -150 }, props: { powered_by: "generator", controlled_by: "ai" } },
    },
    { id: "ai", template: "terminal", overrides: { name: "ai", location: "yard", support: "yard", pos: { x: 300, y: 0 }, props: { powered_by: "generator" } } },
    {
      id: "hall_panel",
      template: "panel",
      overrides: { name: "hall panel", location: "hall", support: "hall", pos: { x: -60, y: 0 }, props: { powered_by: "generator", controlled_by: "yard_panel" } },
    },
    {
      id: "hall_door",
      template: doorTemplate,
      overrides: {
        name: "hall door",
        location: "hall",
        support: "hall",
        pos: { x: 0, y: 100 },
        props: { open: false, locked: true, from: "hall", to: "vault", powered_by: "generator", controlled_by: "hall_panel" },
      },
    },
    { id: "key", template: "key", overrides: { name: "key", location: "hall", support: "hall", pos: { x: 30, y: 60 }, props: { opens: "hall_door" } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: -20, y: 60 } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "yard", support: "yard", pos: { x: -100, y: 60 } } },
    { id: "cid", template: "human", overrides: { name: "cid", location: "yard", support: "yard", pos: { x: 400, y: -300 } } },
  ];
}

function open(
  t: { after(callback: () => void): void },
  options: { doorTemplate?: string; seed?: number } = {},
): { world: World; id: (name: string) => Id; run: (actor: Id, verb: string, target?: string, args?: Record<string, unknown>) => Result } {
  const world: World = createWorld(
    join(tempDir(t), "world"),
    scenario(options.doorTemplate ?? "door"),
    options.doorTemplate === undefined ? undefined : registry(t),
    options.seed === undefined ? undefined : { seed: options.seed },
  );
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result => {
    seq += 1;
    return world.command({
      command_id: `p${seq}`,
      actor,
      verb,
      ...(target !== undefined && { target }),
      ...(args !== undefined && { args }),
    });
  };
  return { world, id, run };
}

test("a subject at a panel opens, closes, locks and unlocks a door in another room, with no key", (t) => {
  const { world, id, run } = open(t);
  const [ann, door] = [id("ann"), id("hall_door")];
  // The door starts locked; ann has no key, and the yard panel reaches the hall door through the hall's.
  const options = world.options(ann);
  ok(options.ready.some((option) => option.verb === "unlock" && option.target === door), "offered");
  deepStrictEqual([run(ann, "unlock", "hall door").status, run(ann, "open", "hall door").status], ["ok", "ok"]);
  strictEqual(world.entity(door)?.props.open, true);
  deepStrictEqual(run(ann, "close", "hall door").events.map((event) => event.type), ["close", "closed"]);
  strictEqual(run(ann, "lock", "hall door").status, "ok");
  strictEqual(world.entity(door)?.props.locked, true);
});

test("out of the yard panel's reach the hall door is unresolved by name, since no one in the yard can see it", (t) => {
  const { id, run } = open(t);
  deepStrictEqual([run(id("cid"), "unlock", "hall door").status, run(id("cid"), "unlock", "hall door").reason_code], ["unresolved", undefined]);
});

test("a subject beside the door works it by hand, with its key, even when a panel is in reach", (t) => {
  const { world, id, run } = open(t);
  const [bob, door] = [id("bob"), id("hall_door")];
  // The hall panel is in bob's reach, but bob reaches the door itself: by hand, so without the key it is refused.
  deepStrictEqual([run(bob, "unlock", "hall door").status, run(bob, "unlock", "hall door").reason_code], ["refused", "no_key"]);
  strictEqual(run(bob, "take", "key").status, "ok");
  strictEqual(run(bob, "unlock", "hall door").status, "ok");
  strictEqual(world.entity(door)?.props.locked, false);
});

test("an unpowered panel refuses its subject unpowered, and a cut link between the door and the panel refuses it disconnected", (t) => {
  // The cable that powers the yard panel: ann cuts it with one blow, and her unlock is refused where power stops.
  const powerless = open(t);
  strictEqual(powerless.run(powerless.id("ann"), "attack", "cable").status, "ok");
  deepStrictEqual(
    [powerless.run(powerless.id("ann"), "unlock", "hall door").reason_code, powerless.run(powerless.id("ann"), "unlock", "hall door").reason_data],
    ["unpowered", { at: powerless.id("yard_panel"), cut: powerless.id("cable") }],
  );
  strictEqual(powerless.world.entity(powerless.id("hall_door"))?.props.locked, true);

  // The hall panel, between the door and the yard panel, blown to pieces by bob: the walk is cut at it.
  const cut = open(t);
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(cut.run(cut.id("bob"), "attack", "hall panel").status, "ok");
  }
  strictEqual(cut.world.entity(cut.id("hall_panel"))?.status, "destroyed");
  deepStrictEqual(
    [cut.run(cut.id("ann"), "unlock", "hall door").reason_code, cut.run(cut.id("ann"), "unlock", "hall door").reason_data],
    ["disconnected", { at: cut.id("hall_panel") }],
  );
});

test("a link beyond the panel does not refuse its subject, but refuses the controller that the link leads to", (t) => {
  const { world, id, run } = open(t);
  const [ann, ai, door] = [id("ann"), id("ai"), id("hall_door")];
  // Ann walks to the relay and blows it to pieces, then walks back to the yard panel.
  deepStrictEqual(run(ann, "move", undefined, { to: { x: 250, y: -150 } }).status, "ok");
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(ann, "attack", "relay").status, "ok");
  }
  strictEqual(world.entity(id("relay"))?.status, "destroyed");
  deepStrictEqual(run(ann, "move", undefined, { to: { x: -100, y: 60 } }).status, "ok");
  strictEqual(run(ann, "unlock", "hall door").status, "ok");
  deepStrictEqual(
    [run(ai, "lock", "hall door").reason_code, run(ai, "lock", "hall door").reason_data],
    ["disconnected", { at: id("relay") }],
  );
  strictEqual(world.entity(door)?.props.locked, false);
});

test("the controller works the door through the panel, and is refused at a destroyed one", (t) => {
  const { world, id, run } = open(t);
  const [ai, ann, door] = [id("ai"), id("ann"), id("hall_door")];
  strictEqual(run(ai, "unlock", "hall door").status, "ok");
  strictEqual(world.entity(door)?.props.locked, false);
  for (let blow = 0; blow < 3; blow += 1) {
    strictEqual(run(ann, "attack", "yard panel").status, "ok");
  }
  strictEqual(world.entity(id("yard_panel"))?.status, "destroyed");
  deepStrictEqual(
    [run(ai, "lock", "hall door").reason_code, run(ai, "lock", "hall door").reason_data],
    ["disconnected", { at: id("yard_panel") }],
  );
  // Ann, whose only panel is destroyed, reaches no door now.
  strictEqual(run(ann, "unlock", "hall door").status, "unresolved");
});

test("a jamming door jams a panel's command too: it is remote", (t) => {
  const { id, run } = open(t, { doorTemplate: "jam_all_door", seed: 5 });
  const result = run(id("ann"), "unlock", "hall door");
  deepStrictEqual([result.status, result.events.map((event) => event.type)], ["ok", ["unlock", "jammed"]]);
});
