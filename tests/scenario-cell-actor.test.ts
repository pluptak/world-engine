import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { actorWorld, aliasOf, canonicalJson, createWorld, type Id, type Scenario, type World } from "../src/index.js";
import {
  assertNoUnknownIds,
  byTemplate,
  character,
  playRounds,
  ready,
  wait,
  type Character,
  type Policy,
  type Sent,
  type Turn,
} from "./actor-harness.js";
import { tempDir } from "./harness.js";

// The cell played from inside (`scenarios/cell.json`, whose rules `tests/scenario-cell.test.ts` holds
// from outside): ann behind the bars, bob outside holding the key to the gate. Each holds only an
// `actorWorld` and chooses from its own view, options, inspections and last verdict; the test holds the
// `World` to judge the run afterwards, never to steer anyone, and schedules no beats. Steps are
// lettered; `docs/limits-actor.md` says what a controller could not decide from inside.

const cell = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/cell.json", import.meta.url)), "utf8"),
) as Scenario;

type Spot = { x: number; y: number };

// Where to stand against the gate on one's own side: its centre, then half the two depths (hers or
// his, and the gate's, which an inspection gives) away, rounded up, so the footprints touch and do not
// overlap. `far` is the same spot on the other side of it, `by` cm out.
function gateSpots(turn: Omit<Turn<unknown>, "memory">): { gate: Id; here: Spot; across: (by: number) => Spot } | undefined {
  const { view, inspect } = turn;
  const gate = byTemplate(view, "gate");
  const me = view.entities.find((entity) => entity.id === view.observer);
  const at = gate?.facts?.pos;
  const from = me?.facts?.pos;
  const gateSize = gate === undefined ? undefined : inspect(gate.id)?.size_cm;
  const selfSize = inspect(view.observer)?.size_cm;
  if (gate === undefined || at == null || from == null || gateSize === undefined || selfSize === undefined) {
    return undefined;
  }
  const side = from.y < at.y ? -1 : 1;
  return {
    gate: gate.id,
    here: { x: at.x, y: at.y + side * Math.ceil((gateSize.d + selfSize.d) / 2) },
    across: (by) => ({ x: at.x, y: at.y - side * by }),
  };
}

// The prisoner: she goes to the gate and, once there, tries the way out at once; shut, it is refused
// `blocked`. Then she does what the options let her: unlock the gate, else open it, and waits for what they do not yet
// offer. Open, the gate is a way out, and she takes it. Whether she is at the gate she reads
// from her inspection of it (`reachable`).
interface Prisoner {
  tried: boolean;
  leaving: boolean;
  out: boolean;
}
const prisoner: Policy<Prisoner> = (turn) => {
  const { options, inspect, last, memory } = turn;
  const out = memory.out || (memory.leaving && last?.result.status === "ok");
  const next = { ...memory, leaving: false, out };
  const spots = gateSpots(turn);
  if (out || spots === undefined) {
    return { command: wait, memory: next };
  }
  // The one thing in her options that can be shut is a gate that stands open.
  if (ready(options, "close", spots.gate)) {
    return { command: { verb: "move", args: { to: spots.across(100) } }, memory: { ...next, leaving: true } };
  }
  for (const verb of ["unlock", "open"]) {
    if (ready(options, verb, spots.gate)) {
      return { command: { verb, target: spots.gate }, memory: next };
    }
  }
  if (inspect(spots.gate)?.reachable !== true) {
    return { command: { verb: "move", args: { to: spots.here } }, memory: next };
  }
  if (!memory.tried) {
    return { command: { verb: "move", args: { to: spots.across(100) } }, memory: { ...next, tried: true } };
  }
  return { command: wait, memory: next };
};

// The visitor: he brings the key to the gate, where the prisoner will be, and gives it to her the
// moment his options offer it. What he holds he reads from his own inspection.
const visitor: Policy<null> = (turn) => {
  const { options, inspect, view } = turn;
  const holds = inspect(view.observer)?.holds ?? [];
  const gift = options.ready.find((option) => option.verb === "give" && option.target !== undefined && holds.includes(option.target));
  if (gift !== undefined) {
    return { command: { verb: "give", target: gift.target!, args: gift.args! }, memory: null };
  }
  const spots = gateSpots(turn);
  if (spots !== undefined && inspect(spots.gate)?.reachable !== true) {
    return { command: { verb: "move", args: { to: spots.here } }, memory: null };
  }
  return { command: wait, memory: null };
};

interface Cell {
  world: World;
  ids: Record<string, Id>;
  sent: Record<Id, Sent[]>;
}

function play(t: { after(callback: () => void): void }, rounds: number): Cell {
  const root = tempDir(t);
  const world = createWorld(join(root, "cell"), cell);
  const ids: Record<string, Id> = {};
  for (const name of ["ann", "bob", "key", "gate", "block"]) {
    const id = world.id(name);
    ok(id !== null, name);
    ids[name] = id;
  }
  const cast: Character[] = [
    character(actorWorld(world, ids.ann!), prisoner, { tried: false, leaving: false, out: false }),
    character(actorWorld(world, ids.bob!), visitor, null),
  ];
  return { world, ids, sent: playRounds(world, cast, rounds, "cell") };
}

const names = (sent: Sent[]) => sent.map((turn) => turn.command.verb);
// The judge names things by world id; each turn was sent its actor's aliases of them.
const blockedFor = (turn: Sent, verb: string, target: Id) =>
  turn.options.blocked
    ?.filter((entry) => entry.verb === verb && entry.target === aliasOf(turn.actor, target))
    .map((entry) => entry.reason_code);

test("the key crosses the bars, the gate opens, and she walks out: all chosen from inside", (t) => {
  const { ids, sent, world } = play(t, 7);
  const ann = sent[ids.ann!]!;
  const bob = sent[ids.bob!]!;
  const gate = ids.gate!;
  const key = ids.key!;
  const toAnn = (id: Id) => aliasOf(ids.ann!, id);
  const toBob = (id: Id) => aliasOf(ids.bob!, id);
  deepStrictEqual(names(ann), ["move", "move", "unlock", "open", "move", "wait", "wait"]);
  deepStrictEqual(names(bob), ["move", "give", "wait", "wait", "wait", "wait", "wait"]);

  // A. Neither is at the gate yet, so neither can try its lock: out of reach, whatever the key. Each
  // works out the spot against the gate on its own side from its inspections of the gate and itself (a
  // gate 5 deep, a human 30: 18 cm from its centre line, 36 cm apart), and walks there. Bob holds the
  // key, which his own inspection says, and cannot give it from where he starts.
  for (const turn of [ann[0]!, bob[0]!]) {
    deepStrictEqual(blockedFor(turn, "unlock", gate), ["out_of_reach"]);
    deepStrictEqual(blockedFor(turn, "open", gate), ["out_of_reach"]);
    deepStrictEqual(turn.inspected.find((found) => found?.id === aliasOf(turn.actor, gate))?.size_cm, { w: 100, d: 5, h: 250 });
  }
  deepStrictEqual(bob[0]?.inspected.find((found) => found?.id === toBob(ids.bob!))?.holds, [toBob(key)]);
  deepStrictEqual(blockedFor(bob[0]!, "give", key), ["out_of_reach"]);
  deepStrictEqual([ann[0]?.command.args, ann[0]?.result.status], [{ to: { x: 50, y: -18 } }, "ok"]);
  deepStrictEqual([bob[0]?.command.args, bob[0]?.result.status], [{ to: { x: 50, y: 18 } }, "ok"]);

  // B. Now at the gate, with no key: `unlock` is blocked `no_key` and `open` `locked`, neither ready.
  // Her try at the way out is refused `blocked`, it names the gate, which she can name too, and it takes no
  // time: bob's turn begins at the tick hers did.
  deepStrictEqual(blockedFor(ann[1]!, "unlock", gate), ["no_key"]);
  deepStrictEqual(blockedFor(ann[1]!, "open", gate), ["locked"]);
  strictEqual(ready(ann[1]!.options, "unlock", toAnn(gate)) || ready(ann[1]!.options, "open", toAnn(gate)), false);
  deepStrictEqual(
    [ann[1]?.result.status, ann[1]?.result.reason_code, ann[1]?.result.reason_data],
    ["refused", "blocked", { with: toAnn(gate) }],
  );
  strictEqual(bob[1]?.tick, ann[1]?.tick);

  // C. He gives her the key through the gate the turn his options offer it: it is 8 × 3 × 1 cm, its smallest
  // side under the gate's 12 cm gap, and the key is hers afterwards.
  deepStrictEqual(bob[1]?.options.ready.filter((option) => option.verb === "give"), [
    { verb: "give", target: toBob(key), args: { destination: toBob(ids.ann!) } },
  ]);
  deepStrictEqual(
    [bob[1]?.command.target, bob[1]?.command.args, bob[1]?.result.status],
    [toBob(key), { destination: toBob(ids.ann!) }, "ok"],
  );
  strictEqual(world.entity(gate)?.props.gap_cm, 12);
  const size = actorWorld(world, ids.bob!).inspect(toBob(key))?.size_cm;
  ok(size !== undefined && Math.min(size.w, size.d, size.h) <= 12, JSON.stringify(size));
  strictEqual(world.entity(key)?.contained_in, ids.ann);

  // D. With it, `unlock` is ready and `open` is still blocked `locked`; once unlocked, `open` is ready and
  // she opens the gate.
  ok(ready(ann[2]!.options, "unlock", toAnn(gate)));
  deepStrictEqual(blockedFor(ann[2]!, "open", gate), ["locked"]);
  deepStrictEqual([ann[2]?.command.verb, ann[2]?.result.status], ["unlock", "ok"]);
  ok(ready(ann[3]!.options, "open", toAnn(gate)));
  deepStrictEqual(blockedFor(ann[3]!, "open", gate), []);
  deepStrictEqual([ann[3]?.command.verb, ann[3]?.result.status], ["open", "ok"]);
  strictEqual(world.entity(gate)?.props.open, true);
  strictEqual(world.entity(gate)?.props.locked, false);

  // E. The gate stands open, and the one thing her options let her shut is that gate; the walk across,
  // refused `blocked` while it was shut, is now ok and she is out, on bob's side, he never having moved.
  ok(ready(ann[4]!.options, "close", toAnn(gate)));
  deepStrictEqual([ann[4]?.command.args, ann[4]?.result.status], [{ to: { x: 50, y: 100 } }, "ok"]);
  deepStrictEqual(world.entity(ids.ann!)?.pos, { x: 50, y: 100 });
  deepStrictEqual(world.entity(ids.bob!)?.pos, { x: 50, y: 18 });
});

test("no character is sent an id it was not given: the bars, the gate and the key included", (t) => {
  const { sent, world } = play(t, 7);
  const checked = assertNoUnknownIds(world, sent);
  ok(checked > 100, `checked ${checked}`);
});

test("the same run twice is the same record", (t) => {
  const first = play(t, 7);
  const second = play(t, 7);
  strictEqual(canonicalJson(first.sent), canonicalJson(second.sent));
  strictEqual(canonicalJson(first.world.attempts(0)), canonicalJson(second.world.attempts(0)));
  strictEqual(canonicalJson(first.world.snapshot()), canonicalJson(second.world.snapshot()));
});
