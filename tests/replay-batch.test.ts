import { strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, type Scenario } from "../src/index.js";
import { replayUntilEvent, replayUntilEvents } from "../src/store/file-store.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// One replay for a whole observation's events answers like one replay per event: the batch holds,
// for every event the log produced, the same before and after snapshots and the same events the
// single replay returns, and nothing for an id the log never produced.
const scenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "chest",
    overrides: { name: "chest", location: "e1", support: "e1", pos: { x: 20, y: 0 } },
  },
  {
    template: "human",
    overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
  },
  {
    template: "stone",
    overrides: { name: "stone", location: "e1", support: "e1", pos: { x: 40, y: 0 } },
  },
];

test("a batch replay answers every event as its own replay would", (t) => {
  const dir = join(tempDir(t), "w");
  const base = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
  const registry: TemplateRegistry = {
    ...base,
    chest: { ...base.chest!, props: { ...base.chest!.props, openable: true } },
  };
  const world = createWorld(dir, { seed: 7, entities: scenario }, registry);
  const snapshot = world.snapshot();
  const id = (name: string): string => {
    for (const [eid, entity] of Object.entries(snapshot.entities)) {
      if (entity.name === name) {
        return eid;
      }
    }
    throw new Error(`No such name ${name}`);
  };
  const run = (commandId: string, verb: string, target?: string, args?: Record<string, unknown>) => {
    const result = world.command({
      command_id: commandId,
      actor: id("actor"),
      verb,
      ...(target !== undefined && { target: id(target) }),
      ...(args !== undefined && { args }),
    });
    strictEqual(result.status, "ok", `${commandId} was ${result.status}: ${result.reason_code ?? ""}`);
  };
  run("c1", "open", "chest");
  run("c2", "take", "stone");
  run("c3", "say", undefined, { utterance: "u1", volume: "normal" });
  run("c4", "drop", "stone");
  // Past a checkpoint (every 256 commands), so the batch starting there answers from the events
  // file, as a single replay past a checkpoint does.
  for (let i = 0; i < 260; i += 1) {
    run(`w${i}`, "wait", undefined, { ticks: 1 });
  }
  run("c5", "take", "stone");
  const ids = world.since(0).events.map((event) => event.event_id);
  strictEqual(ids.length > 2, true, `expected several events, saw ${ids.length}`);
  const batched = replayUntilEvents(dir, ids);
  strictEqual(batched.size, ids.length);
  for (const eventId of ids) {
    strictEqual(canonicalJson(batched.get(eventId)), canonicalJson(replayUntilEvent(dir, eventId)));
  }
  // Only events past the checkpoint: the batch starts from it, like their single replays.
  const late = world.since(world.snapshot().version - 1).events.map((event) => event.event_id);
  strictEqual(late.length > 0, true, "expected events from the last command");
  const lateBatched = replayUntilEvents(dir, late);
  strictEqual(lateBatched.size, late.length);
  for (const eventId of late) {
    strictEqual(canonicalJson(lateBatched.get(eventId)), canonicalJson(replayUntilEvent(dir, eventId)));
  }
  strictEqual(batched.get("ev99999"), undefined);
  strictEqual(batched.get("no-such-event"), undefined);
});
