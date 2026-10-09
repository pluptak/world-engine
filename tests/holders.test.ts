import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, createWorld, memoryWorld, type Entity, type Id, type Scenario, type World } from "../src/index.js";
import { validateSnapshot } from "../src/engine/validate.js";
import { loadTemplates } from "../src/templates.js";
import { presetRegistry } from "./presets.js";
import { fileURLToPath } from "node:url";
import { tempDir } from "./harness.js";

const shipped = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
// The chest a test needs open: an openable chest is a preset of its own, not a chest made openable
// by an override, which is a definition and so the world author's to refuse.
const registry = presetRegistry(shipped);

const scenario: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: 60, y: 0 } } },
  { id: "rex", template: "dog", overrides: { name: "rex", location: "hall", support: "hall", pos: { x: -60, y: 0 } } },
  { id: "flask", template: "bottle", overrides: { name: "flask", location: "hall", support: "hall", pos: { x: 10, y: 0 } } },
  { id: "mug", template: "cup", overrides: { name: "mug", location: "hall", support: "hall", pos: { x: 20, y: 0 } } },
  { id: "rock", template: "stone", overrides: { name: "rock", location: "hall", support: "hall", pos: { x: 30, y: 0 } } },
  { id: "tome", template: "book", overrides: { name: "tome", location: "hall", support: "hall", pos: { x: 40, y: 0 } } },
  { id: "bone", template: "stone", overrides: { name: "bone", location: "hall", support: "hall", pos: { x: -50, y: 0 } } },
  { id: "pebble", template: "stone", overrides: { name: "pebble", location: "hall", support: "hall", pos: { x: -40, y: 0 } } },
  {
    id: "cask",
    template: "open_chest",
    overrides: {
      name: "cask",
      location: "hall",
      support: "hall",
      pos: { x: 70, y: 0 },
    },
  },
  { id: "sip", template: "cup", overrides: { name: "sip", location: "hall", contained_in: "cask" } },
  { id: "kept", template: "stone", overrides: { name: "kept", location: "hall", contained_in: "ann" } },
  { id: "slip", template: "note", overrides: { name: "slip", location: "hall", support: "hall", pos: { x: 50, y: 0 } } },
];

// A store world and a memory world over the same snapshot: every holder rule holds in both.
function holderWorlds(t: { after(callback: () => void): void }): [World, World] {
  const dir = tempDir(t);
  const store = createWorld(join(dir, "held"), scenario, registry);
  const names: Record<string, Id> = {};
  for (const name of NAMES) {
    const id = store.id(name);
    ok(typeof id === "string", `no id for ${name}`);
    names[name] = id;
  }
  return [store, memoryWorld(store.snapshot(), registry, names)];
}

const NAMES = ["hall", "ann", "bob", "rex", "flask", "mug", "rock", "tome", "bone", "pebble", "cask", "sip", "kept", "slip"] as const;

function namedIds(world: World) {
  const id = (name: string): string => {
    const found = world.id(name);
    ok(typeof found === "string", `no id for ${name}`);
    return found;
  };
  return {
    hall: id("hall"),
    ann: id("ann"),
    bob: id("bob"),
    rex: id("rex"),
    flask: id("flask"),
    mug: id("mug"),
    rock: id("rock"),
    tome: id("tome"),
    bone: id("bone"),
    pebble: id("pebble"),
    cask: id("cask"),
    sip: id("sip"),
    kept: id("kept"),
    slip: id("slip"),
  };
}

function take(world: World, actor: string, target: string, commandId: string, part?: string) {
  const actorId = world.id(actor);
  ok(actorId !== null, `no id for ${actor}`);
  return world.command({
    command_id: commandId,
    actor: actorId,
    verb: "take",
    target,
    ...(part === undefined ? {} : { args: { part } }),
  });
}

function held(world: World, name: string) {
  const id = world.id(name);
  ok(id !== null);
  return world.entity(id);
}

test("a scenario fills the first free grip, and takes fill lowest-first", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    strictEqual(held(world, "kept")?.in_part, "hand_l");
    strictEqual(take(world, "ann", "flask", "take-flask").status, "ok");
    // hand_l is taken by the scenario's stone, so the bottle lands in the other hand.
    strictEqual(held(world, "flask")?.in_part, "hand_r");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("hands_full on a third item", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "flask", "take-flask").status, "ok");
    strictEqual(take(world, "ann", "mug", "take-mug").status, "ok");
    const third = take(world, "ann", "rock", "take-rock");
    strictEqual(third.status, "refused");
    strictEqual(third.reason_code, "hands_full");
    deepStrictEqual(third.reason_data, { free: 0, need: 1 });
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("take and give name a grip through args.part", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "flask", "take-flask", "hand_r").status, "ok");
    strictEqual(held(world, "flask")?.in_part, "hand_r");
    const full = take(world, "ann", "mug", "take-mug", "hand_r");
    strictEqual(full.status, "refused");
    strictEqual(full.reason_code, "hands_full");
    const strange = take(world, "ann", "mug", "take-strange", "head");
    strictEqual(strange.status, "refused");
    strictEqual(strange.reason_code, "unknown_part");
    strictEqual(take(world, "ann", "mug", "take-mug").status, "ok");
    const given = world.command({
      command_id: "give-mug",
      actor: ids.ann,
      verb: "give",
      target: "mug",
      args: { destination: "bob", part: "hand_l" },
    });
    strictEqual(given.status, "ok");
    strictEqual(held(world, "mug")?.in_part, "hand_l");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a two-handed item takes both hands, and half a pair refuses it", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "tome", "take-tome").status, "ok");
    strictEqual(held(world, "tome")?.in_part, "hand_l");
    const second = take(world, "ann", "flask", "take-flask");
    strictEqual(second.status, "refused");
    strictEqual(second.reason_code, "hands_full");
    deepStrictEqual(second.reason_data, { free: 0, need: 1 });
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a two-handed item fits an empty pair but not a half-full one", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "flask", "take-flask").status, "ok");
    const tome = take(world, "ann", "tome", "take-tome");
    strictEqual(tome.status, "refused");
    strictEqual(tome.reason_code, "hands_full");
    deepStrictEqual(tome.reason_data, { free: 1, need: 2 });
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a pocket stows a held item and frees its grip", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "slip", "take-slip").status, "ok");
    const stowed = world.command({
      command_id: "stow-slip",
      actor: ids.ann,
      verb: "put",
      target: "slip",
      args: { relation: "in", destination: `${ids.ann}.pocket` },
    });
    strictEqual(stowed.status, "ok");
    strictEqual(held(world, "slip")?.in_part, "pocket");
    // The freed grip takes a third item the full hands refused before.
    strictEqual(take(world, "ann", "flask", "take-flask").status, "ok");
    strictEqual(take(world, "ann", "rock", "take-rock").status, "ok");
    strictEqual(held(world, "flask")?.in_part, "hand_l");
    strictEqual(held(world, "rock")?.in_part, "hand_r");
    // Out of the pocket back into a grip: drop the rock first to free one.
    world.command({ command_id: "drop-rock", actor: ids.ann, verb: "drop", target: "rock" });
    strictEqual(take(world, "ann", "slip", "take-slip-back").status, "ok");
    strictEqual(held(world, "slip")?.in_part, "hand_r");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a pocket too small refuses what does not fit", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "flask", "take-flask").status, "ok");
    const stowed = world.command({
      command_id: "stow-flask",
      actor: ids.ann,
      verb: "put",
      target: "flask",
      args: { relation: "in", destination: `${ids.ann}.pocket` },
    });
    strictEqual(stowed.status, "refused");
    strictEqual(stowed.reason_code, "too_large");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a drop from a pocket is refused until the item is taken out", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    strictEqual(take(world, "ann", "slip", "take-slip").status, "ok");
    strictEqual(
      world.command({
        command_id: "stow-slip",
        actor: ids.ann,
        verb: "put",
        target: "slip",
        args: { relation: "in", destination: `${ids.ann}.pocket` },
      }).status,
      "ok",
    );
    const dropped = world.command({ command_id: "drop-slip", actor: ids.ann, verb: "drop", target: "slip" });
    strictEqual(dropped.status, "refused");
    strictEqual(dropped.reason_code, "not_in_hand");
    // A drop from a grip lands the item with no part to be in.
    strictEqual(take(world, "ann", "flask", "take-flask").status, "ok");
    strictEqual(
      world.command({ command_id: "drop-flask", actor: ids.ann, verb: "drop", target: "flask" }).status,
      "ok",
    );
    strictEqual(held(world, "flask")?.contained_in, null);
    strictEqual(held(world, "flask")?.in_part, null);
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a dog's jaw still holds one item within its limit", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    strictEqual(take(world, "rex", "bone", "take-bone").status, "ok");
    strictEqual(held(world, "bone")?.in_part, "jaw");
    const second = take(world, "rex", "pebble", "take-pebble");
    strictEqual(second.status, "refused");
    strictEqual(second.reason_code, "mouth_full");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("taking from a container lands in a free grip", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    strictEqual(take(world, "ann", "sip", "take-sip").status, "ok");
    strictEqual(held(world, "sip")?.contained_in, world.id("ann"));
    strictEqual(held(world, "sip")?.in_part, "hand_r");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("hand loss drops its grip only", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "flask", "take-flask", "hand_r").status, "ok");
    strictEqual(take(world, "ann", "slip", "take-slip").status, "ok");
    strictEqual(
      world.command({
        command_id: "stow-slip",
        actor: ids.ann,
        verb: "put",
        target: "slip",
        args: { relation: "in", destination: `${ids.ann}.pocket` },
      }).status,
      "ok",
    );
    strictEqual(take(world, "ann", "mug", "take-mug").status, "ok");
    // flask sits in hand_r, mug in hand_l, slip in the pocket: losing hand_r drops only the flask.
    for (let index = 0; index < 2; index += 1) {
      strictEqual(
        world.command({ command_id: `hit-${index}`, actor: ids.bob, verb: "attack", target: `${ids.ann}.hand_r` }).status,
        "ok",
      );
      strictEqual(
        world.command({ command_id: `rest-${index}`, actor: ids.bob, verb: "wait", args: { ticks: 3 } }).status,
        "ok",
      );
    }
    strictEqual(
      world.command({ command_id: "hit-2", actor: ids.bob, verb: "attack", target: `${ids.ann}.hand_r` }).status,
      "ok",
    );
    strictEqual(held(world, "flask")?.contained_in, null);
    strictEqual(held(world, "flask")?.in_part, null);
    strictEqual(held(world, "mug")?.in_part, "hand_l");
    strictEqual(held(world, "slip")?.in_part, "pocket");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("a two-handed item drops with either hand that held it", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "tome", "take-tome").status, "ok");
    for (let index = 0; index < 2; index += 1) {
      strictEqual(
        world.command({ command_id: `hit-${index}`, actor: ids.bob, verb: "attack", target: `${ids.ann}.hand_r` }).status,
        "ok",
      );
      strictEqual(
        world.command({ command_id: `rest-${index}`, actor: ids.bob, verb: "wait", args: { ticks: 3 } }).status,
        "ok",
      );
    }
    strictEqual(
      world.command({ command_id: "hit-2", actor: ids.bob, verb: "attack", target: `${ids.ann}.hand_r` }).status,
      "ok",
    );
    strictEqual(held(world, "tome")?.contained_in, null);
    strictEqual(held(world, "tome")?.in_part, null);
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("destroying a pocket drops what it kept", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    strictEqual(take(world, "ann", "slip", "take-slip").status, "ok");
    strictEqual(
      world.command({
        command_id: "stow-slip",
        actor: ids.ann,
        verb: "put",
        target: "slip",
        args: { relation: "in", destination: `${ids.ann}.pocket` },
      }).status,
      "ok",
    );
    const annId = world.id("ann");
    ok(annId !== null);
    strictEqual(
      world.edit({ kind: "set_part", target: annId, part: "pocket", state: { integrity: 0, status: "destroyed" } }).status,
      "ok",
    );
    strictEqual(held(world, "slip")?.contained_in, null);
    strictEqual(held(world, "slip")?.in_part, null);
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("give from a pocket is refused not_in_hand", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    strictEqual(take(world, "ann", "slip", "take-slip").status, "ok");
    strictEqual(
      world.command({
        command_id: "stow-slip",
        actor: ids.ann,
        verb: "put",
        target: "slip",
        args: { relation: "in", destination: `${ids.ann}.pocket` },
      }).status,
      "ok",
    );
    const given = world.command({
      command_id: "give-slip",
      actor: ids.ann,
      verb: "give",
      target: "slip",
      args: { destination: "bob" },
    });
    strictEqual(given.status, "refused");
    strictEqual(given.reason_code, "not_in_hand");
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("taking from one's own pocket then giving succeeds", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    world.command({ command_id: "drop-kept", actor: ids.ann, verb: "drop", target: "kept" });
    strictEqual(take(world, "ann", "slip", "take-slip").status, "ok");
    strictEqual(
      world.command({
        command_id: "stow-slip",
        actor: ids.ann,
        verb: "put",
        target: "slip",
        args: { relation: "in", destination: `${ids.ann}.pocket` },
      }).status,
      "ok",
    );
    strictEqual(take(world, "ann", "slip", "take-slip-out").status, "ok");
    strictEqual(held(world, "slip")?.in_part, "hand_l");
    const given = world.command({
      command_id: "give-slip",
      actor: ids.ann,
      verb: "give",
      target: "slip",
      args: { destination: "bob" },
    });
    strictEqual(given.status, "ok");
    strictEqual(held(world, "slip")?.contained_in, ids.bob);
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);
  }
});

test("each in_part rule fires on a snapshot wrong in exactly that way", (t) => {
  const [store] = holderWorlds(t);
  const base = store.snapshot();
  const ids = (name: string): string => {
    const id = store.id(name);
    ok(id !== null, `no id for ${name}`);
    return id;
  };
  const annId = ids("ann");
  const hallId = ids("hall");
  const caskId = ids("cask");
  const hold = (
    entities: Record<string, Entity>,
    name: string,
    holder: string | null,
    part: string | null,
  ): void => {
    const id = ids(name);
    const entity = entities[id];
    ok(entity !== undefined);
    entity.contained_in = holder;
    entity.support = holder === null ? hallId : null;
    entity.pos = holder === null ? { x: 0, y: 0 } : null;
    entity.location = hallId;
    entity.in_part = part;
  };
  const check = (mutate: (entities: Record<string, Entity>) => void, code: string): void => {
    const snapshot = { ...structuredClone(base), entities: structuredClone(base.entities) };
    mutate(snapshot.entities);
    deepStrictEqual(
      validateSnapshot(snapshot, registry).map((issue) => issue.code),
      code === "" ? [] : [code],
    );
  };

  check((entities) => hold(entities, "flask", null, "hand_l"), "in_part_holder_mismatch");
  check((entities) => hold(entities, "flask", hallId, "hand_l"), "in_part_holder_mismatch");
  check((entities) => hold(entities, "sip", caskId, "pocket"), "in_part_holder_mismatch");
  check((entities) => hold(entities, "rock", annId, null), "in_part_holder_mismatch");
  check((entities) => hold(entities, "rock", annId, "head"), "in_part_unknown_part");
  check((entities) => {
    hold(entities, "rock", annId, "hand_l");
    hold(entities, "kept", null, null);
    const ann = entities[annId];
    ok(ann !== undefined);
    ann.parts.hand_l = { integrity: 0, status: "destroyed" };
  }, "in_part_unavailable");
  check((entities) => {
    hold(entities, "rock", annId, "hand_l");
    hold(entities, "flask", annId, "hand_l");
    hold(entities, "kept", null, null);
  }, "grip_occupied");
  check((entities) => {
    hold(entities, "tome", annId, "hand_r");
    hold(entities, "rock", annId, "hand_l");
    hold(entities, "kept", null, null);
  }, "grip_occupied");
  check((entities) => {
    hold(entities, "flask", annId, "pocket");
    hold(entities, "kept", null, null);
  }, "part_contents_too_large");
  check((entities) => {
    hold(entities, "slip", annId, "pocket");
    hold(entities, "kept", null, null);
  }, "");
});

test("taking what is already in the grip it would go to is refused and changes nothing; a pocket or another grip still moves it", (t) => {
  for (const world of holderWorlds(t)) {
    const ids = namedIds(world);
    const grip = held(world, "kept")?.in_part;
    ok(grip === "hand_l" || grip === "hand_r", String(grip));
    const before = canonicalJson(world.snapshot());
    for (const part of [undefined, grip]) {
      const again = take(world, "ann", "kept", `again-${part ?? "default"}`, part);
      deepStrictEqual([again.status, again.reason_code, again.events, again.deltas], ["refused", "already_held", [], []]);
    }
    strictEqual(canonicalJson(world.snapshot()), before);

    // Another named grip is a move.
    const other = grip === "hand_l" ? "hand_r" : "hand_l";
    strictEqual(take(world, "ann", "kept", "regrip", other).status, "ok");
    strictEqual(held(world, "kept")?.in_part, other);

    // From the pocket it goes to a hand (a stone is too big for the pocket, a slip of paper is not).
    strictEqual(take(world, "ann", "slip", "lift-slip").status, "ok");
    const pocketed = world.command({
      command_id: "pocket",
      actor: ids.ann,
      verb: "put",
      target: "slip",
      args: { relation: "in", destination: `${ids.ann}.pocket` },
    });
    strictEqual(pocketed.status, "ok", String(pocketed.reason_code));
    strictEqual(held(world, "slip")?.in_part, "pocket");
    strictEqual(take(world, "ann", "slip", "out-of-pocket").status, "ok");
    ok(held(world, "slip")?.in_part?.startsWith("hand_"));
    deepStrictEqual(validateSnapshot(world.snapshot(), registry), []);

    // A mouth holds as a hand does.
    strictEqual(take(world, "rex", "bone", "rex-takes").status, "ok");
    deepStrictEqual(
      [take(world, "rex", "bone", "rex-again").status, take(world, "rex", "bone", "rex-again-2").reason_code],
      ["refused", "already_held"],
    );
  }
});
