import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, openWorld, type Id, type Scene, type World } from "../src/index.js";
import { directorWorld } from "../src/director-world.js";
import { playerWorld } from "../src/player-world.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// Blind submission (`docs/rounds.md`, `docs/roles.md`): a player's handle holds its one move for the next
// round; the director learns only which handles have submitted, and closes the round with the moves. Ann and
// bob are the slots; both want the one stone in the hall.
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function scene(): Scene {
  return {
    entities: [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
      { id: "door", template: "door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
      { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
      { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
      { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 0, y: 80 } } },
    ],
    run: { tick_limit: 20, slots: ["ann", "bob"] },
  };
}

// A world with two players registered and the run started, the stone for the taking.
function started(t: { after(callback: () => void): void }, dir = join(tempDir(t), "players")): { dir: string; world: World; id: (name: string) => Id } {
  const world = createWorld(dir, { seed: 11, entities: scene().entities, run: scene().run }, registry);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  const director = directorWorld(world);
  strictEqual(director.edit({ kind: "register_player", handle: "dana", slot: id("ann") }, { command_id: "reg-dana" }).status, "ok");
  strictEqual(director.edit({ kind: "register_player", handle: "eve", slot: id("bob") }, { command_id: "reg-eve" }).status, "ok");
  strictEqual(director.edit({ kind: "start_run" }, { command_id: "start" }).status, "ok");
  return { dir, world, id };
}

test("two players submit blind: neither's reads or pending move shows the other's, and the director sees only the handles", (t) => {
  const { world } = started(t);
  const dana = playerWorld(world, "dana");
  const eve = playerWorld(world, "eve");
  deepStrictEqual(dana.submit({ command_id: "dana-take", verb: "take", target: "stone" }), { status: "ok" });
  deepStrictEqual(eve.submit({ command_id: "eve-take", verb: "take", target: "stone" }), { status: "ok" });
  deepStrictEqual(dana.pending()?.command_id, "dana-take");
  deepStrictEqual(eve.pending()?.command_id, "eve-take");
  // Nothing dana reads names eve's move, and the other way round.
  ok(!JSON.stringify(dana.observe()).includes("eve-take"));
  ok(!JSON.stringify(eve.observe()).includes("dana-take"));
  ok(!JSON.stringify(dana.options()).includes("eve-take"));
  const seen = JSON.stringify(directorWorld(world).submitted());
  deepStrictEqual(directorWorld(world).submitted(), ["dana", "eve"]);
  ok(!seen.includes("take"), "the director learns no move");
  // Pending moves are not world state: no version and no log line for them.
  deepStrictEqual(world.attempts(0).some((attempt) => attempt.command.command_id === "dana-take"), false);
});

test("closing the round takes both moves in the order the round gives, each under its player's role, and the close under the director's", (t) => {
  const { world } = started(t);
  playerWorld(world, "dana").submit({ command_id: "dana-take", verb: "take", target: "stone" });
  playerWorld(world, "eve").submit({ command_id: "eve-take", verb: "take", target: "stone" });
  const closed = directorWorld(world).closeRound();
  strictEqual(closed.status, "ok");
  deepStrictEqual(closed.results.map((result) => result.status).sort(), ["ok", "preempted"]);
  const logged = world.attempts(0);
  const by = (command: string) => logged.find((attempt) => attempt.command.command_id === command)?.by;
  deepStrictEqual(by("dana-take"), { role: "player", handle: "dana" });
  deepStrictEqual(by("eve-take"), { role: "player", handle: "eve" });
  deepStrictEqual(logged.find((attempt) => attempt.round?.close === true)?.by, { role: "director" });
  // The round took the moves: nothing is pending, and the clock moved once.
  deepStrictEqual(directorWorld(world).submitted(), []);
  strictEqual(world.snapshot().tick, 1);
});

test("a resubmit replaces the move, a withdraw leaves none, and a round with no move is a quiet tick", (t) => {
  const { world } = started(t);
  const dana = playerWorld(world, "dana");
  dana.submit({ command_id: "first", verb: "wait", args: { ticks: 1 } });
  dana.submit({ command_id: "second", verb: "take", target: "stone" });
  deepStrictEqual(dana.pending()?.command_id, "second");
  deepStrictEqual(dana.withdraw(), { status: "ok" });
  strictEqual(dana.pending(), null);
  const quiet = directorWorld(world).closeRound();
  deepStrictEqual([quiet.status, quiet.results.length], ["ok", 0]);
  strictEqual(world.snapshot().tick, 1);
});

test("an unregistered handle is refused not_registered, and a player before the start is refused run_not_running", (t) => {
  const { world } = started(t);
  deepStrictEqual(playerWorld(world, "fay").submit({ command_id: "f", verb: "take", target: "stone" }), { status: "refused", reason_code: "not_registered" });
  throws(() => playerWorld(world, "fay").observe(), (error: unknown) => (error as { code?: string }).code === "not_registered");
  // A run that has not started takes no move: a fresh world, players registered but the run still registering.
  const fresh = createWorld(join(tempDir(t), "fresh"), { seed: 11, entities: scene().entities, run: scene().run }, registry);
  directorWorld(fresh).edit({ kind: "register_player", handle: "dana", slot: fresh.id("ann")! }, { command_id: "r" });
  deepStrictEqual(playerWorld(fresh, "dana").submit({ command_id: "d", verb: "take", target: "stone" }), { status: "refused", reason_code: "run_not_running" });
});

test("a store world's pending moves survive a second process opening it, verify with them pending, and clear at the close", (t) => {
  const { dir, world } = started(t);
  playerWorld(world, "dana").submit({ command_id: "dana-take", verb: "take", target: "stone" });
  strictEqual(world.verify().ok, true);
  // A second handle on the same directory sees the move, and the director there closes the round with it.
  const again = openWorld(dir);
  deepStrictEqual(playerWorld(again, "dana").pending()?.command_id, "dana-take");
  deepStrictEqual(directorWorld(again).submitted(), ["dana"]);
  strictEqual(directorWorld(again).closeRound().status, "ok");
  deepStrictEqual(directorWorld(openWorld(dir)).submitted(), []);
  strictEqual(openWorld(dir).verify().ok, true);
});

test("a player's move is written as its view writes: an alias it was offered resolves, a world id names nothing", (t) => {
  const { world, id } = started(t);
  const dana = playerWorld(world, "dana");
  const take = dana.options().ready.find((option) => option.verb === "take");
  ok(take?.target !== undefined && take.target !== id("stone"));
  deepStrictEqual(dana.submit({ command_id: "by-alias", verb: "take", target: take.target }), { status: "ok" });
  // What the handle holds is said back in the view's own words: no world id, no actor.
  deepStrictEqual(dana.pending(), { command_id: "by-alias", verb: "take", target: take.target });
  const closed = directorWorld(world).closeRound();
  deepStrictEqual(closed.results.map((result) => result.status), ["ok"]);
  strictEqual(world.entity(id("stone"))?.contained_in, id("ann"));
  dana.submit({ command_id: "by-id", verb: "drop", target: id("stone") });
  deepStrictEqual(directorWorld(world).closeRound().results.map((result) => result.status), ["unresolved"]);
});
