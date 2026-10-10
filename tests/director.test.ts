import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, openWorld, type Id, type Result, type Scene, type World, type WorldEdit } from "../src/index.js";
import { directorWorld } from "../src/director-world.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// The director's handle and the roles it carries (`docs/roles.md`): a director registers players to slots,
// and runs its levers, and nothing else. Every log line names the role it was sent under; the bare World is
// the author, which may send anything.
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function scene(): Scene {
  return {
    entities: [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
      { id: "door", template: "door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
      { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
      { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
      { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 0, y: 50 } } },
    ],
    run: { tick_limit: 20, slots: ["ann", "bob"] },
  };
}

function open(t: { after(callback: () => void): void }): { dir: string; world: World; id: (name: string) => Id } {
  const dir = join(tempDir(t), "director");
  const world = createWorld(dir, scene(), registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, id };
}

let seq = 0;
const reason = (result: Result): [string, string | undefined] => [result.status, result.reason_code];
const nextId = (): string => `d${(seq += 1)}`;

test("registering binds a handle to a slot, in the order players registered, and each refusal is named once", (t) => {
  const { world, id } = open(t);
  const director = directorWorld(world);
  const [ann, bob, stone] = [id("ann"), id("bob"), id("stone")];
  const bind = (handle: string, slot: Id, options = {}): Result =>
    director.edit({ kind: "register_player", handle, slot }, { command_id: nextId(), ...options });
  strictEqual(bind("dana", ann).status, "ok");
  deepStrictEqual(world.snapshot().run?.players, [{ handle: "dana", slot: ann }]);
  deepStrictEqual(reason(bind("eve", ann)), ["refused", "slot_taken"]);
  deepStrictEqual(reason(bind("dana", bob)), ["refused", "handle_taken"]);
  deepStrictEqual(reason(bind("fay", stone)), ["refused", "no_such_slot"]);
  strictEqual(bind("gil", bob).status, "ok");
  deepStrictEqual(world.snapshot().run?.players?.map((player) => player.handle), ["dana", "gil"]);
  strictEqual(director.edit({ kind: "start_run" }, { command_id: nextId() }).status, "ok");
  deepStrictEqual(reason(bind("hal", bob)), ["refused", "run_not_registering"]);
});

test("a director's spawn and set_props are role_forbidden; its five kinds go through", (t) => {
  const { world, id } = open(t);
  const director = directorWorld(world);
  deepStrictEqual(
    reason(director.edit({ kind: "set_props", target: id("stone"), props: { lit: false } } as WorldEdit, { command_id: nextId() })),
    ["refused", "role_forbidden"],
  );
  deepStrictEqual(
    reason(director.edit({ kind: "spawn", template: "stone" }, { command_id: nextId() })),
    ["refused", "role_forbidden"],
  );
  // The author queues two beats; the director brings one forward and cancels the other.
  strictEqual(world.edit({ kind: "schedule_beat", id: "knock", at_tick: 9, action: { kind: "sound", entity: id("door") } }).status, "ok");
  strictEqual(world.edit({ kind: "schedule_beat", id: "late", at_tick: 12, action: { kind: "sound", entity: id("door") } }).status, "ok");
  strictEqual(director.edit({ kind: "register_player", handle: "dana", slot: id("ann") }, { command_id: nextId() }).status, "ok");
  strictEqual(director.edit({ kind: "start_run" }, { command_id: nextId() }).status, "ok");
  strictEqual(director.edit({ kind: "retime_beat", id: "knock", at_tick: 5 }, { command_id: nextId() }).status, "ok");
  strictEqual(director.edit({ kind: "cancel_beat", id: "late" }, { command_id: nextId() }).status, "ok");
  strictEqual(director.edit({ kind: "end_run" }, { command_id: nextId() }).status, "ok");
  strictEqual(world.snapshot().run?.state, "ended");
});

test("the director's handle has no command, and reads what the world reads", (t) => {
  const { world } = open(t);
  const director = directorWorld(world);
  strictEqual("command" in director, false);
  deepStrictEqual(director.snapshot(), world.snapshot());
  deepStrictEqual(director.schedule(), world.schedule());
});

test("every log line names its role: the director's edits name it, the author's name none", (t) => {
  const { dir, world, id } = open(t);
  const director = directorWorld(world);
  strictEqual(world.edit({ kind: "schedule_beat", id: "knock", at_tick: 9, action: { kind: "sound", entity: id("door") } }, { command_id: "author-beat" }).status, "ok");
  strictEqual(director.edit({ kind: "register_player", handle: "dana", slot: id("ann") }, { command_id: "director-register" }).status, "ok");
  const logged = world.attempts(0);
  const byId = (command: string) => logged.find((attempt) => attempt.command.command_id === command)?.by;
  deepStrictEqual(byId("author-beat"), undefined);
  deepStrictEqual(byId("director-register"), { role: "director" });
  // Replay keeps the roles: a store world reopened and verified names the same.
  strictEqual(world.verify().ok, true);
  deepStrictEqual(openWorld(dir).attempts(0).find((attempt) => attempt.command.command_id === "director-register")?.by, { role: "director" });
});

test("a command or round sent with a role is refused, so no caller can claim the director's by hand", (t) => {
  const { world, id } = open(t);
  const claimed = world.command({ command_id: "claim", actor: id("ann"), verb: "take", target: "stone", by: { role: "director" } } as never);
  deepStrictEqual(reason(claimed), ["invalid", "invalid_args"]);
  strictEqual(world.edit({ kind: "set_seed", seed: 3 }, { command_id: "seed", by: { role: "director" } }).status, "refused");
});

test("a slot whose body is removed ends the run once no slot is alive, as before", (t) => {
  const { world, id } = open(t);
  const director = directorWorld(world);
  strictEqual(director.edit({ kind: "register_player", handle: "dana", slot: id("ann") }, { command_id: nextId() }).status, "ok");
  strictEqual(director.edit({ kind: "start_run" }, { command_id: nextId() }).status, "ok");
  // Ann's body is removed: bob's slot is alive, so the run goes on.
  strictEqual(world.edit({ kind: "remove", target: id("ann") }, { command_id: "remove-ann" }).status, "ok");
  strictEqual(world.snapshot().run?.state, "running");
  strictEqual(world.edit({ kind: "remove", target: id("bob") }, { command_id: "remove-bob" }).status, "ok");
  strictEqual(world.snapshot().run?.state, "ended");
  strictEqual(world.snapshot().run?.ended?.reason, "no_live_players");
});
