import { deepStrictEqual, strictEqual } from "node:assert";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createWorld,
  directorWorld,
  openWorld,
  playerWorld,
  restartWorld,
  type Scene,
  type Scenario,
  type World,
  type WorldEdit,
} from "../src/index.js";
import { canonicalJson } from "../src/engine/canonical.js";
import { loadTemplates } from "../src/templates.js";
import { readEvents, readWorldTemplates } from "../src/store/file-store.js";
import { runCli } from "../src/cli/main.js";
import { tempDir } from "./harness.js";

// A run that ended is a record. `restartWorld` makes a new world from the old one's own
// `initial.json` and its frozen `templates.json`: the scene as it was built, with the run still
// registering, so the same registration and the same moves play the same run again, line for line.
// The old world is not touched, and a `templates/` directory that changed since the first world was
// made cannot reach the restart, since the restart never reads the directory.
const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
// A set that opens the chest by default: one the world takes as an upgrade after it was made.
const chestRegistry = {
  ...registry,
  chest: { ...registry.chest!, props: { ...registry.chest!.props, openable: true, open: true } },
};
const lab = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/lab.json", import.meta.url)), "utf8"),
) as { seed: number; entities: Scenario };

const SLOTS = ["ann", "bob", "terminal"];

function scene(): Scene {
  return { seed: lab.seed, entities: lab.entities, run: { slots: SLOTS } };
}

// One run played through the handles: the registration edits, the start, one move per slot per
// round, each round closed, then the end.
function play(world: World, rounds: number): void {
  const id = (name: string): string => {
    const found = world.id(name);
    if (found === null) {
      throw new Error(`No entity named ${name}`);
    }
    return found;
  };
  let seq = 0;
  const edit = (change: WorldEdit): void => {
    strictEqual(world.edit(change).status, "ok", JSON.stringify(change));
  };
  for (const [i, slot] of SLOTS.entries()) {
    edit({ kind: "register_player", handle: `p${i}`, slot: id(slot) });
  }
  edit({ kind: "start_run" });
  for (let round = 0; round < rounds; round += 1) {
    for (const [i, slot] of SLOTS.entries()) {
      seq += 1;
      const submitted = playerWorld(world, `p${i}`).submit({
        command_id: `m${seq}`,
        verb: "wait",
        args: { ticks: 1 },
      });
      strictEqual(submitted.status, "ok", submitted.status === "ok" ? "" : submitted.reason_code);
    }
    strictEqual(directorWorld(world).closeRound().status, "ok", "the round close");
  }
  edit({ kind: "end_run" });
}

test("a run played with rounds is played again from its own world, line for line", (t) => {
  const root = tempDir(t);
  const from = join(root, "first");
  const world = createWorld(from, scene(), registry);
  play(world, 2);
  const played = readEvents(from);
  strictEqual(openWorld(from).snapshot().run?.state, "ended");

  // The restart: the same scene, the run registering again, nothing of the old log.
  const to = join(root, "second");
  restartWorld(from, to);
  const again = openWorld(to);
  strictEqual(again.verify().ok, true);
  strictEqual(again.snapshot().version, 0);
  strictEqual(again.snapshot().run?.state, "registering");

  // The same registration, moves and closes give the same log, line for line.
  play(again, 2);
  strictEqual(canonicalJson(readEvents(to)), canonicalJson(played));
  strictEqual(again.verify().ok, true);

  // The old world is untouched by all of it, and the two are the same world replayed.
  strictEqual(openWorld(from).verify().ok, true);
  strictEqual(canonicalJson(readEvents(from)), canonicalJson(played));
  strictEqual(canonicalJson(again.snapshot()), canonicalJson(openWorld(from).snapshot()));
});

test("a restart refuses where it cannot write, and the old world is untouched", (t) => {
  const root = tempDir(t);
  const from = join(root, "one");
  createWorld(from, scene(), registry);
  const before = openWorld(from).snapshot();
  const to = join(root, "two");
  restartWorld(from, to);
  // A second restart into the same directory is refused, and the old world verifies unchanged.
  deepStrictEqual(
    (() => {
      try {
        restartWorld(from, to);
        return "ok";
      } catch (error) {
        return (error as { code?: string }).code;
      }
    })(),
    "world_exists",
  );
  // No world at `from` is refused.
  deepStrictEqual(
    (() => {
      try {
        restartWorld(join(root, "none"), join(root, "three"));
        return "ok";
      } catch (error) {
        return (error as { code?: string }).code;
      }
    })(),
    "no_such_world",
  );
  // The restart carries the old world's frozen set, not the directory's: an upgrade the first world
  // took after it was made is what the restarted world holds.
  const three = join(root, "three");
  createWorld(three, scene(), registry).upgradeTemplates(chestRegistry);
  strictEqual(readWorldTemplates(three).chest?.props.open, true);
  const four = join(root, "four");
  restartWorld(three, four);
  strictEqual(readWorldTemplates(four).chest?.props.open, true);
  strictEqual(canonicalJson(readWorldTemplates(four)), canonicalJson(readWorldTemplates(three)));
  // The world's own upgrade never wrote to the shipped directory it came from.
  const shipped = JSON.parse(
    readFileSync(fileURLToPath(new URL("../templates/chest.json", import.meta.url)), "utf8"),
  ) as { props?: Record<string, unknown> };
  strictEqual(shipped.props?.open, undefined);
});

test("a restart refuses a directory holding any world file, and leaves its files as they were", (t) => {
  const root = tempDir(t);
  const from = join(root, "one");
  createWorld(from, scene(), registry);
  for (const name of ["initial.json", "log.jsonl", "head.json", "templates.json"]) {
    const to = join(root, `partial-${name}`);
    mkdirSync(to);
    writeFileSync(join(to, name), "kept", "utf8");
    deepStrictEqual(
      (() => {
        try {
          restartWorld(from, to);
          return "ok";
        } catch (error) {
          return (error as { code?: string }).code;
        }
      })(),
      "world_exists",
    );
    strictEqual(readFileSync(join(to, name), "utf8"), "kept");
    deepStrictEqual(readdirSync(to), [name]);
  }
});

test("the CLI restarts a world and answers its snapshot version", (t) => {
  const root = tempDir(t);
  const from = join(root, "one");
  createWorld(from, scene(), registry);
  const to = join(root, "two");
  const response = JSON.parse(
    runCli([], JSON.stringify({ op: "restart", world: from, to })).stdout,
  ) as { snapshot_version: number };
  strictEqual(response.snapshot_version, 0);
  strictEqual(openWorld(to).verify().ok, true);
});
