import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, WORLD_AUTHOR, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { replay } from "../src/store/file-store.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";

// Time-driven change end to end, as `inn` did for the verbs: a dark tent, a lantern that burns down,
// a note under a book, bread, and a hungry body that starves unless it eats. Steps are lettered.

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const camp = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scenarios/camp.json", import.meta.url)), "utf8"),
) as Scenario;

interface Camp {
  dir: string;
  world: World;
  gus: Id;
  ann: Id;
  lantern: Id;
  bread: Id;
  note: Id;
  book: Id;
}

function open(t: { after(callback: () => void): void }): Camp {
  const root = mkdtempSync(join(tmpdir(), "world-engine-camp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "camp");
  const world = createWorld(dir, camp);
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  return { dir, world, gus: id("gus"), ann: id("ann"), lantern: id("lantern"), bread: id("bread"), note: id("note"), book: id("book") };
}

let seq = 0;
function run(world: World, actor: Id, verb: string, target?: string, args?: Record<string, unknown>): Result {
  seq += 1;
  return world.command({
    command_id: `camp${seq}`,
    actor,
    verb,
    ...(target === undefined ? {} : { target }),
    ...(args === undefined ? {} : { args }),
  });
}

function advance(world: World, ticks: number): Result {
  seq += 1;
  return world.command({ command_id: `camp${seq}`, actor: WORLD_AUTHOR, verb: "advance", args: { ticks } });
}

const sees = (world: World, observer: Id, entity: Id) =>
  world.query({ kind: "perceive", observer, sense: "sight", entity });

test("a dark tent: light the lantern, search, let it burn out, and the body left at full hunger starves", (t) => {
  const { dir, world, gus, ann, lantern, bread, note, book } = open(t);

  // A. dark: nothing is seen.
  deepStrictEqual(sees(world, ann, bread), { value: "false", basis_code: "location_unlit" });

  // B. gus lights the lantern; ann sees the bread, and gus finds what the book hid.
  strictEqual(run(world, gus, "light", "lantern").status, "ok");
  deepStrictEqual(sees(world, ann, bread), { value: "true", basis_code: "same_location_lit" });
  const found = run(world, gus, "search", "book");
  strictEqual(found.status, "ok");
  // The tick the search takes also runs a starving: a `changed` rides after the search's own events.
  deepStrictEqual(found.events.map((event) => event.type).slice(0, 2), ["search", "found"]);
  strictEqual(found.events[1]?.entity, note);
  // Searching changes nothing: the note is still under the book, named as its concealer.
  strictEqual(world.entity(note)?.concealed_by, book);
  strictEqual(found.events[1]?.data.concealer, book);

  // C. ten ticks: fuel falls a point a tick, gus's hunger is already at its cap and he starves.
  const fuel = (): unknown => world.entity(lantern)?.props.fuel;
  const before = fuel() as number;
  advance(world, 10);
  strictEqual(fuel(), before - 10);
  strictEqual(world.entity(gus)?.props.starvation, 2);

  // D. past burn-out the lantern snuffs itself and the room goes dark: ann's sight flips.
  advance(world, 30);
  strictEqual(world.entity(lantern)?.props.burning, false);
  deepStrictEqual(sees(world, ann, bread), { value: "false", basis_code: "location_unlit" });
  strictEqual(run(world, gus, "light", "lantern").reason_code, "no_fuel");

  // E. left alone, gus starves to destruction.
  advance(world, 100);
  strictEqual(world.entity(gus)?.status, "destroyed");
  strictEqual(world.entity(gus)?.props.starvation, 20);
  deepStrictEqual(run(world, gus, "consume", "bread").reason_code, "not_an_agent");

  // F. one chain reads back from the destruction to the first starvation `changed`.
  const chain = world.trace({ entity: gus, field: "integrity" }).events;
  const types = chain.map((event) => event.type);
  strictEqual(types[0], "changed");
  strictEqual(types.at(-1), "destroyed");
  strictEqual(types.filter((type) => type === "changed").length, types.length - 1);
  strictEqual(chain[0]?.data.process, "starve");
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);

  // G. the log replayed from the initial snapshot is the stored snapshot.
  strictEqual(canonicalJson(replay(dir, registry)), canonicalJson(world.snapshot()));
});

test("a body that eats does not starve: bread lowers hunger and the starving is withdrawn", (t) => {
  const { world, gus, bread } = open(t);
  advance(world, 20);
  strictEqual(world.entity(gus)?.props.starvation, 4);
  strictEqual(run(world, gus, "consume", "bread").status, "ok");
  strictEqual(world.entity(bread), null);
  strictEqual(world.entity(gus)?.props.hunger, 60);
  advance(world, 150);
  strictEqual(world.entity(gus)?.status, "intact");
  // Hunger has risen again, one point per ten ticks, and never reached the cap.
  strictEqual(world.entity(gus)?.props.starvation, 4);
  strictEqual((world.entity(gus)?.props.hunger as number) < 100, true);
  deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
});
