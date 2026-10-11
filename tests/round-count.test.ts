import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, createWorld, memoryWorld, openWorld, type Scene, type World } from "../src/index.js";
import { directorWorld } from "../src/director-world.js";
import { playerWorld } from "../src/player-world.js";
import { loadTemplates, parseRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// The closed rounds are numbered from a count the store keeps in head.json, and a memory world keeps its own
// (`docs/persistence.md`). A head from before the count is settled, not trusted, and numbers its next round right.
const shipped = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const registry = parseRegistry({ ...shipped, slow_door: { id: "slow_door", extends: "door", props: { closes_after: 2 } } });

const scene: Scene = {
  entities: [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "door", template: "slow_door", overrides: { name: "door", location: "hall", support: "hall", pos: { x: 0, y: 120 }, props: { open: false, from: "hall", to: "yard" } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 100 } } },
    { id: "bob", template: "human", overrides: { name: "bob", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
  ],
  run: { tick_limit: 40, slots: ["ann", "bob"] },
};

function closedNumbers(world: World): number[] {
  return world.attempts(0).flatMap((attempt) => (attempt.round?.close === true ? [attempt.round.number] : []));
}

function head(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "head.json"), "utf8")) as Record<string, unknown>;
}

test("a store world numbers its closed rounds from the count in its head, and a head without it is settled to one", (t) => {
  const dir = join(tempDir(t), "counted");
  const world = createWorld(dir, scene, registry);
  world.round([]);
  world.round([]);
  deepStrictEqual(closedNumbers(world), [1, 2]);
  strictEqual(head(dir).rounds_closed, 2);

  // A head from before the count: the next open settles it, and the next round carries on from the log's count.
  const older = { ...head(dir) };
  delete older.rounds_closed;
  writeFileSync(join(dir, "head.json"), canonicalJson(older));
  const reopened = openWorld(dir);
  strictEqual(reopened.round([]).round, 3);
  strictEqual(head(dir).rounds_closed, 3);
  deepStrictEqual(closedNumbers(reopened), [1, 2, 3]);
  strictEqual(reopened.verify().ok, true);
});

test("a memory world numbers its closed rounds from its own count", () => {
  const world = memoryWorld(createWorld(join(tempDir({ after() {} }), "seed"), scene, registry).snapshot(), registry);
  strictEqual(world.round([]).round, 1);
  strictEqual(world.round([]).round, 2);
  deepStrictEqual(closedNumbers(world), [1, 2]);
});

test("a body that sees a door shut in a quiet round stops the quiet at that round, though the door is shut by then", (t) => {
  const world = createWorld(join(tempDir(t), "shut"), scene, registry);
  const director = directorWorld(world);
  const id = (name: string): string => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  director.edit({ kind: "register_player", handle: "dana", slot: id("ann") }, { command_id: "reg-dana" });
  director.edit({ kind: "register_player", handle: "eve", slot: id("bob") }, { command_id: "reg-eve" });
  director.edit({ kind: "start_run" }, { command_id: "start" });
  // Ann opens the door, which swings shut two ticks on: bob, on the far side, sees it go.
  world.round([{ command_id: "open", actor: id("ann"), verb: "open", target: "door" }]);
  strictEqual(world.schedule({ kind: "close" }).length, 1);
  playerWorld(world, "dana").idle();
  playerWorld(world, "eve").idle();
  deepStrictEqual(director.closeRounds({ max: 5 }), { status: "ok", rounds: 1, stopped: "heard" });
});
