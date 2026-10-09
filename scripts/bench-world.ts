import { fileURLToPath } from "node:url";
import type { Command, Scenario, World } from "../src/index.js";
import { loadTemplates, parseRegistry, type TemplateRegistry } from "../src/templates.js";

// The scale benchmark's world, shared with the test that builds it: 20 rooms and 500 entities, per
// room an agent, a table, an openable chest, and 21 stones (one of them a sprout, which grows by
// itself for the whole run, so processes are in the measure). The cycle each agent plays returns the
// room to where it began, so the workload can run as long as it likes: open the chest, take a stone,
// put it in, take it out, drop it, close the chest, step aside, wait.
export const ROOMS = 20;
export const CYCLE = 8;

export function scaleRegistry(): TemplateRegistry {
  return parseRegistry({
    ...loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url))),
    sprout: {
      id: "sprout",
      extends: "stone",
      props: { size: 0 },
      fields: { size: { tier: "state", type: "integer" } },
      processes: [{ id: "grow", every_ticks: 3, effect: { adjust_prop: { prop: "size", by: 1, max: 1000000 } } }],
    },
    // A scenario entry may not make a chest openable: that is a definition, so it is a preset.
    shut_chest: { id: "shut_chest", extends: "chest", props: { openable: true, open: false } },
  });
}

export function scaleScenario(): Scenario {
  const entries: Scenario[number][] = [];
  for (let r = 0; r < ROOMS; r += 1) {
    entries.push({ id: `room${r}`, template: "room", overrides: { name: `room${r}`, props: { lit: true } } });
    entries.push({
      id: `table${r}`,
      template: "table",
      overrides: { name: `table${r}`, location: `room${r}`, support: `room${r}`, pos: { x: 0, y: 200 } },
    });
    entries.push({
      id: `chest${r}`,
      template: "shut_chest",
      overrides: { name: `chest${r}`, location: `room${r}`, support: `room${r}`, pos: { x: 40, y: 0 } },
    });
    entries.push({
      id: `agent${r}`,
      template: "human",
      overrides: { name: `agent${r}`, location: `room${r}`, support: `room${r}`, pos: { x: 0, y: 0 } },
    });
    for (let k = 0; k < 21; k += 1) {
      entries.push({
        id: `stone${r}_${k}`,
        template: k === 20 ? "sprout" : "stone",
        overrides: {
          name: `stone${r}_${k}`,
          location: `room${r}`,
          support: `room${r}`,
          pos: k === 0 ? { x: -30, y: 0 } : { x: -400 + 40 * (k % 10), y: 100 + 40 * Math.floor(k / 10) },
        },
      });
    }
  }
  return entries;
}

export function scaleCommand(i: number, world: World): Command {
  const r = i % ROOMS;
  const step = Math.floor(i / ROOMS) % CYCLE;
  const lap = Math.floor(i / (ROOMS * CYCLE));
  const actor = world.id(`agent${r}`)!;
  const base = { command_id: `scale-${i}`, actor };
  const stone = `stone${r}_0`;
  switch (step) {
    case 0:
      return { ...base, verb: "open", target: `chest${r}` };
    case 1:
      return { ...base, verb: "take", target: stone };
    case 2:
      return { ...base, verb: "put", target: stone, args: { relation: "in", destination: `chest${r}` } };
    case 3:
      return { ...base, verb: "take", target: stone };
    case 4:
      return { ...base, verb: "drop", target: stone };
    case 5:
      return { ...base, verb: "close", target: `chest${r}` };
    case 6:
      return { ...base, verb: "move", args: { to: { x: 0, y: lap % 2 === 0 ? -60 : -40 } } };
    default:
      return { ...base, verb: "wait", args: { ticks: 1 } };
  }
}
