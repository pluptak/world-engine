import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, type Id, type Scenario, type World } from "../src/index.js";
import { tempDir } from "./harness.js";

// A wait with `until: "sensed"` ends at the first tick its own actor could sense something, the rule
// the author's `advance` applies to the agents it names: the count is only an upper bound, and the
// wait event says how long it ran.

const watch = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/watch.json", import.meta.url)), "utf8"),
) as Scenario;

interface Night {
  world: World;
  id: (name: string) => Id;
}

// The watch with a knock on its door at tick 5, loud or not.
function night(t: { after(callback: () => void): void }, loud: boolean): Night {
  const root = tempDir(t);
  const world = createWorld(join(root, "night"), watch, undefined, { seed: 7 });
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  const scheduled = world.edit({
    kind: "schedule_beat",
    id: "knock",
    at_tick: 5,
    action: { kind: "sound", entity: id("door"), loud },
  });
  strictEqual(scheduled.status, "ok");
  return { world, id };
}

function wait(world: World, actor: Id, args: Record<string, unknown>, commandId = "w") {
  return world.command({ command_id: commandId, actor, verb: "wait", args }, { observe: true });
}

test("a wait of 20 until sensed ends at the knock at tick 5 and says so; without it, it runs to 20", (t) => {
  const { world, id } = night(t, true);
  const ann = id("ann");
  const woken = wait(world, ann, { ticks: 20, until: "sensed" });
  strictEqual(woken.status, "ok");
  strictEqual(woken.snapshot.tick, 5);
  deepStrictEqual(woken.events[0]?.data, { advanced: 5 });
  // The knock is in her view, heard from her own room and naming nothing.
  deepStrictEqual(
    woken.observation?.events.filter((event) => event.type === "sounded").map((event) => [event.from, event.senses]),
    [["here", ["hearing"]]],
  );

  const other = night(t, true);
  const plain = wait(other.world, other.id("ann"), { ticks: 20 });
  strictEqual(plain.status, "ok");
  strictEqual(plain.snapshot.tick, 20);
  strictEqual("advanced" in (plain.events[0]?.data ?? {}), false);
});

test("a wait that woke early leaves the world a wait of that many ticks would have", (t) => {
  const early = night(t, true);
  strictEqual(wait(early.world, early.id("ann"), { ticks: 20, until: "sensed" }).status, "ok");
  const exact = night(t, true);
  strictEqual(wait(exact.world, exact.id("ann"), { ticks: 5 }).status, "ok");
  strictEqual(canonicalJson(early.world.snapshot()), canonicalJson(exact.world.snapshot()));
});

test("a wait that senses nothing runs to its bound and still says how long it ran", (t) => {
  const { world, id } = night(t, true);
  const result = wait(world, id("ann"), { ticks: 3, until: "sensed" });
  strictEqual(result.status, "ok");
  strictEqual(result.snapshot.tick, 3);
  deepStrictEqual(result.events[0]?.data, { advanced: 3 });
});

test("only what the waiter itself could sense wakes it: a quiet knock does not reach the yard", (t) => {
  const { world, id } = night(t, false);
  const bob = wait(world, id("bob"), { ticks: 8, until: "sensed" });
  strictEqual(bob.status, "ok");
  deepStrictEqual(bob.events[0]?.data, { advanced: 8 });
  strictEqual(bob.snapshot.tick, 8);

  const quiet = night(t, false);
  const ann = wait(quiet.world, quiet.id("ann"), { ticks: 8, until: "sensed" });
  deepStrictEqual(ann.events[0]?.data, { advanced: 5 });
  strictEqual(ann.snapshot.tick, 5);
});

test("an unknown `until` is invalid_args and takes no time", (t) => {
  const { world, id } = night(t, true);
  const before = world.snapshot();
  for (const until of ["never", "", 1, null, ["sensed"]]) {
    const result = wait(world, id("ann"), { ticks: 5, until });
    strictEqual(result.status, "invalid", String(until));
    strictEqual(result.reason_code, "invalid_args", String(until));
  }
  strictEqual(world.snapshot().tick, before.tick);
});
