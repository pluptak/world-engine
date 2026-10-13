// The shape rules for a scheduled beat as a scripted golden: a table of well-formed and malformed `schedule_beat` edits (conditions of
// every form, repeats, followers to the depth limit, each action kind and its extra or missing keys), each answered by TypeScript, then
// a few beats left to run through an advance. Writes Fixtures/beat-shapes-golden.expected.json.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTemplates } from "../../../src/templates.js";
import { Script } from "./scripted.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const registry = loadTemplates(join(root, "templates"));
const at = (x: number) => ({ location: "hall", support: "hall", pos: { x, y: 0 } });
const script = new Script(
  [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "rock", template: "stone", overrides: { name: "rock", ...at(0) } },
    { id: "ann", template: "human", overrides: { name: "ann", ...at(100) } },
    { id: "lamp", template: "lantern", overrides: { name: "lamp", ...at(-100), props: { burning: false } } },
  ],
  registry,
  ["hall", "yard", "rock", "ann", "lamp"],
);
const { hall, yard, rock, ann, lamp } = script.ids as Record<string, string>;
const sound = { kind: "sound", entity: rock };
const base = { kind: "schedule_beat", id: "b", at_tick: 5, action: sound };
let count = 0;
function shape(name: string, extra: Record<string, unknown>): void {
  count += 1;
  const result = script.edit(name, { ...base, id: `b${count}`, ...extra });
  if (result.status === "ok") {
    script.edit(`${name} (cancel)`, { kind: "cancel_beat", id: `b${count}` });
  }
}

// Conditions: each single form, each malformed one.
const conditions: [string, unknown][] = [
  ["in", { entity: ann, in: hall }],
  ["in by name", { entity: "ann", in: "hall" }],
  ["in with a prop key", { entity: ann, in: hall, prop: "x" }],
  ["in with empty entity", { entity: "", in: hall }],
  ["in with number", { entity: 3, in: hall }],
  ["room occupied", { room: hall, occupied: true }],
  ["room unoccupied", { room: yard, occupied: false }],
  ["room with non-bool", { room: hall, occupied: "yes" }],
  ["room without occupied", { room: hall }],
  ["occupied without room", { occupied: true }],
  ["room extra key", { room: hall, occupied: true, entity: ann }],
  ["prop eq bool", { entity: lamp, prop: "burning", op: "eq", value: true }],
  ["prop ne string", { entity: lamp, prop: "name", op: "ne", value: "x" }],
  ["prop gt number", { entity: lamp, prop: "fuel", op: "gt", value: 3 }],
  ["prop ge", { entity: lamp, prop: "fuel", op: "ge", value: 3 }],
  ["prop lt", { entity: lamp, prop: "fuel", op: "lt", value: 3 }],
  ["prop le", { entity: lamp, prop: "fuel", op: "le", value: 3 }],
  ["prop gt string", { entity: lamp, prop: "fuel", op: "gt", value: "3" }],
  ["prop gt bool", { entity: lamp, prop: "fuel", op: "gt", value: true }],
  ["prop bad op", { entity: lamp, prop: "fuel", op: "like", value: 3 }],
  ["prop missing op", { entity: lamp, prop: "fuel", value: 3 }],
  ["prop missing value", { entity: lamp, prop: "fuel", op: "eq" }],
  ["prop null value", { entity: lamp, prop: "fuel", op: "eq", value: null }],
  // Not recorded: a fractional value, which TypeScript stores in the snapshot and .NET refuses (BeatShapesGoldenTests).
  ["prop object value", { entity: lamp, prop: "fuel", op: "eq", value: {} }],
  ["prop extra key", { entity: lamp, prop: "fuel", op: "eq", value: 1, more: 1 }],
  ["prop empty prop", { entity: lamp, prop: "", op: "eq", value: 1 }],
  ["prop no entity", { prop: "fuel", op: "eq", value: 1 }],
  ["empty object", {}],
  ["array", []],
  ["string", "yes"],
  ["null", null],
  ["all one", { all: [{ room: hall, occupied: true }] }],
  ["all two", { all: [{ room: hall, occupied: true }, { entity: ann, in: hall }] }],
  ["all empty", { all: [] }],
  ["all not array", { all: { room: hall, occupied: true } }],
  ["all extra key", { all: [{ room: hall, occupied: true }], other: 1 }],
  ["all nested", { all: [{ all: [{ room: hall, occupied: true }] }] }],
  ["all with bad single", { all: [{ room: hall, occupied: true }, { room: hall }] }],
  ["all sixteen", { all: Array.from({ length: 16 }, () => ({ room: hall, occupied: true })) }],
  ["all seventeen", { all: Array.from({ length: 17 }, () => ({ room: hall, occupied: true })) }],
];
for (const [name, only_if] of conditions) {
  shape(`condition: ${name}`, { only_if });
}

// Repeats.
const repeats: [string, unknown][] = [
  ["repeat ok", { every_ticks: 2, times: 3 }],
  ["repeat until_ran", { every_ticks: 2, times: 3, until_ran: true }],
  ["repeat until_ran false", { every_ticks: 2, times: 3, until_ran: false }],
  ["repeat until_ran string", { every_ticks: 2, times: 3, until_ran: "yes" }],
  ["repeat zero spacing", { every_ticks: 0, times: 3 }],
  ["repeat zero times", { every_ticks: 2, times: 0 }],
  ["repeat too many", { every_ticks: 2, times: 1000 }],
  ["repeat float", { every_ticks: 1.5, times: 3 }],
  ["repeat missing times", { every_ticks: 2 }],
  ["repeat missing spacing", { times: 2 }],
  ["repeat extra key", { every_ticks: 2, times: 2, other: 1 }],
  ["repeat not object", 3],
  ["repeat huge", { every_ticks: 9007199254740992, times: 2 }],
];
for (const [name, repeat] of repeats) {
  shape(name, { repeat });
}
shape("repeat with followers", { repeat: { every_ticks: 2, times: 2 }, then: [{ id: "f", delay_ticks: 1, action: sound }] });

// Followers.
const followers: [string, unknown][] = [
  ["follower ok", [{ id: "f1", delay_ticks: 1, action: sound }]],
  ["follower with condition", [{ id: "f1", delay_ticks: 1, action: sound, only_if: { room: hall, occupied: true } }]],
  ["follower bad condition", [{ id: "f1", delay_ticks: 1, action: sound, only_if: { room: hall } }]],
  ["follower zero delay", [{ id: "f1", delay_ticks: 0, action: sound }]],
  ["follower negative delay", [{ id: "f1", delay_ticks: -1, action: sound }]],
  ["follower float delay", [{ id: "f1", delay_ticks: 1.5, action: sound }]],
  ["follower missing delay", [{ id: "f1", action: sound }]],
  ["follower bad id", [{ id: "bad id", delay_ticks: 1, action: sound }]],
  ["follower missing id", [{ delay_ticks: 1, action: sound }]],
  ["follower extra key", [{ id: "f1", delay_ticks: 1, action: sound, more: 1 }]],
  ["follower bad action", [{ id: "f1", delay_ticks: 1, action: { kind: "nope" } }]],
  ["follower not object", ["f1"]],
  ["followers empty", []],
  ["followers not array", { id: "f1" }],
  ["followers nested", [{ id: "f1", delay_ticks: 1, action: sound, then: [{ id: "f2", delay_ticks: 1, action: sound }] }]],
  ["followers nested empty", [{ id: "f1", delay_ticks: 1, action: sound, then: [] }]],
  ["followers duplicate", [{ id: "f1", delay_ticks: 1, action: sound }, { id: "f1", delay_ticks: 2, action: sound }]],
];
for (const [name, then] of followers) {
  shape(name, { then });
}

// Actions.
const actions: [string, unknown][] = [
  ["sound loud", { kind: "sound", entity: rock, loud: true }],
  ["sound loud string", { kind: "sound", entity: rock, loud: "yes" }],
  ["sound extra key", { kind: "sound", entity: rock, volume: 3 }],
  ["sound no entity", { kind: "sound" }],
  ["sound unknown entity", { kind: "sound", entity: "e999" }],
  ["sound by name", { kind: "sound", entity: "rock" }],
  ["set_props", { kind: "set_props", target: lamp, props: { burning: true } }],
  ["set_props undeclared", { kind: "set_props", target: lamp, props: { zzz: 1 } }],
  ["set_props wrong type", { kind: "set_props", target: lamp, props: { burning: 3 } }],
  ["set_props definition", { kind: "set_props", target: lamp, props: { light_source: false } }],
  ["update_props", { kind: "update_props", target: lamp, props: { fuel: 2 } }],
  ["update_props empty", { kind: "update_props", target: lamp, props: {} }],
  ["remove", { kind: "remove", target: rock }],
  ["place", { kind: "place", target: rock, location: hall, support: hall, pos: { x: 10, y: 0 } }],
  ["place no target", { kind: "place", location: hall }],
  ["spawn at location", { kind: "spawn", template: "stone", overrides: { location: hall, support: hall, pos: { x: 20, y: 0 } } }],
  ["spawn no location", { kind: "spawn", template: "stone" }],
  ["spawn unknown template", { kind: "spawn", template: "nope", overrides: { location: hall } }],
  ["set_part", { kind: "set_part", target: ann, part: "arm_l", state: { integrity: 50, status: "damaged" } }],
  ["set_seed", { kind: "set_seed", seed: 5 }],
  ["schedule_beat inside a beat", { kind: "schedule_beat", id: "z", at_tick: 9, action: sound }],
  ["cancel_beat inside a beat", { kind: "cancel_beat", id: "z" }],
  ["refine inside a beat", { kind: "refine", target: lamp, template: "candle" }],
  ["kind missing", { entity: rock }],
  ["kind not text", { kind: 3 }],
  ["not object", "sound"],
  ["null action", null],
];
for (const [name, action] of actions) {
  shape(`action: ${name}`, { action });
}

// Ids, ticks and the keys of the edit itself.
for (const [name, extra] of [
  ["id empty", { id: "" }],
  ["id spaces", { id: "a b" }],
  ["id long", { id: "x".repeat(200) }],
  ["id number", { id: 3 }],
  ["tick zero", { at_tick: 0 }],
  ["tick negative", { at_tick: -3 }],
  ["tick float", { at_tick: 2.5 }],
  ["tick string", { at_tick: "3" }],
  ["tick huge", { at_tick: 9007199254740991 }],
  ["tick unsafe", { at_tick: 9007199254740992 }],
  ["extra key", { surprise: true }],
] as [string, Record<string, unknown>][]) {
  shape(`edit: ${name}`, extra);
}

// Beats left to run: conditions of every form, a repeat, a watch, a chain and a merge, through an advance.
const live: [string, Record<string, unknown>][] = [
  ["knock in the room", { id: "k1", at_tick: 2, action: sound, only_if: { room: hall, occupied: true } }],
  ["knock in an empty yard", { id: "k2", at_tick: 2, action: sound, only_if: { room: yard, occupied: true } }],
  ["knock when ann is in the yard", { id: "k3", at_tick: 2, action: { kind: "sound", entity: rock, loud: true }, only_if: { entity: ann, in: yard } }],
  ["light when ann is home", { id: "k4", at_tick: 3, action: { kind: "set_props", target: lamp, props: { burning: true } }, only_if: { all: [{ entity: ann, in: hall }, { entity: lamp, prop: "burning", op: "eq", value: false }] } }],
  ["fuel merge", { id: "k5", at_tick: 4, action: { kind: "update_props", target: lamp, props: { fuel: 7 } } }],
  ["repeating knock", { id: "k6", at_tick: 3, action: sound, repeat: { every_ticks: 2, times: 3 } }],
  ["watch", { id: "k7", at_tick: 2, action: { kind: "set_props", target: lamp, props: { burning: false } }, only_if: { entity: lamp, prop: "fuel", op: "le", value: 7 }, repeat: { every_ticks: 1, times: 6, until_ran: true } }],
  ["chain", { id: "k8", at_tick: 2, action: sound, then: [{ id: "k9", delay_ticks: 2, action: { kind: "sound", entity: rock, loud: true }, then: [{ id: "k10", delay_ticks: 1, action: { kind: "remove", target: rock } }] }] }],
  ["refused when it runs", { id: "k11", at_tick: 5, action: { kind: "place", target: ann, location: hall, support: hall, pos: { x: 99999, y: 0 } } }],
];
for (const [name, extra] of live) {
  script.edit(name, { ...base, ...extra });
}
script.snapshot("scheduled");
script.command("advance through the beats", { command_id: "adv-1", actor: "world", verb: "advance", args: { ticks: 14 } });
script.snapshot("after");
script.save(join(root, "tests/WorldEngine.Tests/Fixtures/beat-shapes-golden.expected.json"));
console.log(`wrote ${script.rows.length} rows`);
