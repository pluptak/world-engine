import { ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ProjectionSchema } from "../src/contract.js";
import { memoryWorld, type Command, type WorldEdit } from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { buildInitial, genStep, mulberry32, withProcessFixtures } from "./property-gen.js";

const registry: TemplateRegistry = withProcessFixtures(
  loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))),
);

// A projection says who did a thing only to an observer who could tell: one who saw, smelt or felt it.
// One who only heard it is told where the sound came from and nothing of its source, however the
// generator moves speakers, walkers, doors and lights about.
test("property: a view event names its entity exactly when something other than hearing sensed it", () => {
  const volumes = ["whisper", "normal", "shout"] as const;
  const seen = { named: 0, here: 0, nextDoor: 0, views: 0 };
  for (let seed = 0; seed < 60; seed += 1) {
    const rand = mulberry32(seed + 9100);
    const world = memoryWorld(buildInitial(registry), registry);
    for (let i = 0; i < 40; i += 1) {
      const snapshot = world.snapshot();
      const agents = Object.keys(snapshot.entities)
        .sort()
        .filter((id) => snapshot.entities[id]?.props.agent === true && snapshot.entities[id]?.detached_from === null);
      // A fifth of the steps are speech, which is heard in the dark and across doors; the rest are the
      // generator's own, whose steps and knocks are heard too.
      const speaks = agents.length > 0 && rand() < 0.2;
      const step: Command | WorldEdit = speaks
        ? {
            command_id: `names-${seed}-${i}`,
            actor: agents[Math.floor(rand() * agents.length)]!,
            verb: "say",
            args: { utterance: `w${seed}x${i}`, volume: volumes[Math.floor(rand() * volumes.length)]! },
          }
        : genStep(rand, snapshot, `names-${seed}-${i}`);
      const before = snapshot.version;
      const result = "verb" in step ? world.command(step, { observe: true }) : world.edit(step);
      if (result.status !== "ok") {
        continue;
      }
      const omniscient = new Map(world.since(before).events.map((event) => [event.event_id, event]));
      const observers = Object.keys(world.snapshot().entities)
        .sort()
        .filter((id) => world.snapshot().entities[id]?.props.agent === true);
      const views = observers.map((observer) => [observer, world.observe(observer, { since: before })] as const);
      if ("observation" in result && result.observation !== undefined) {
        views.push([(step as Command).actor, result.observation]);
      }
      for (const [observer, view] of views) {
        ProjectionSchema.parse(view);
        seen.views += 1;
        for (const event of view.events) {
          const hearingOnly = event.senses.length === 1 && event.senses[0] === "hearing";
          const where = `${observer} ${event.event_id} at seed ${seed} step ${i}`;
          if (hearingOnly) {
            strictEqual("entity" in event, false, where);
            const basis = world.query({ kind: "perceive", observer, event_id: event.event_id, sense: "hearing" }).basis_code;
            strictEqual(event.from, basis === "same_location" ? "here" : "next_door", where);
            ok(basis === "same_location" || basis === "adjacent_loud_event", `${where}: ${basis}`);
            seen[event.from === "here" ? "here" : "nextDoor"] += 1;
          } else {
            strictEqual(event.entity, omniscient.get(event.event_id)?.entity, where);
            strictEqual("from" in event, false, where);
            seen.named += 1;
          }
        }
      }
    }
  }
  // The runs reach all three kinds of view event, not one of them many times over.
  ok(seen.named >= 200, `named ${seen.named}`);
  ok(seen.here >= 20, `heard here ${seen.here}`);
  ok(seen.nextDoor >= 15, `heard next door ${seen.nextDoor}`);
});
