import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { capacities, capacity } from "../src/engine/capacity.js";
import { apply } from "../src/engine/pipeline.js";
import { spawn } from "../src/engine/spawn.js";
import type { Snapshot } from "../src/model.js";
import { loadTemplates, templatesHash, type TemplateRegistry } from "../src/templates.js";

const registry = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));

function initialSnapshot(): Snapshot {
  return {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(registry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
}

function duel() {
  const room = spawn(initialSnapshot(), registry, "room", { name: "room" });
  const attacker = spawn(room.snapshot, registry, "human", {
    name: "attacker",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const guard = spawn(attacker.snapshot, registry, "human", {
    name: "guard",
    location: room.id,
    support: room.id,
    pos: { x: 50, y: 0 },
  });
  return { snapshot: guard.snapshot, roomId: room.id, attackerId: attacker.id, guardId: guard.id };
}

function attack(snapshot: Snapshot, actor: string, target: string, commandId: string) {
  return apply(snapshot, registry, {
    command_id: commandId,
    actor,
    verb: "attack",
    target,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

test("detaching guard.hand_r spawns a hand and reduces manipulation to 50", () => {
  const setup = duel();
  let snapshot = deepFreeze(setup.snapshot);
  let finalAttack = undefined as ReturnType<typeof attack> | undefined;

  for (let index = 0; index < 3; index += 1) {
    finalAttack = attack(snapshot, setup.attackerId, `${setup.guardId}.hand_r`, `hand-${index}`);
    strictEqual(finalAttack.status, "ok");
    snapshot = finalAttack.snapshot;
    if (index < 2) {
      const wait = apply(snapshot, registry, {
        command_id: `cooldown-${index}`,
        actor: setup.attackerId,
        verb: "wait",
        args: { ticks: 3 },
      });
      strictEqual(wait.status, "ok");
      snapshot = wait.snapshot;
    }
  }

  ok(finalAttack);
  const detached = finalAttack.events.find((event) => event.type === "detached");
  const capability = finalAttack.events.find(
    (event) => event.type === "capability_changed" && event.data.capacity === "manipulation",
  );
  ok(detached);
  ok(capability);
  strictEqual(capability.cause_id, detached.event_id);
  deepStrictEqual(
    { from: capability.data.from, to: capability.data.to },
    { from: 100, to: 50 },
  );

  const newHand = Object.values(finalAttack.snapshot.entities).find(
    (entity) => entity.detached_from?.entity === setup.guardId,
  );
  ok(newHand);
  strictEqual(newHand.template, "human.hand_r");
  deepStrictEqual(newHand.detached_from, { entity: setup.guardId, part: "hand_r" });
  strictEqual(newHand.support, setup.roomId);
  strictEqual(finalAttack.snapshot.entities[setup.guardId]?.parts.hand_r?.status, "detached");
  strictEqual(capacity(finalAttack.snapshot, registry, setup.guardId, "manipulation"), 50);

  const crate = spawn(finalAttack.snapshot, registry, "stone", {
    name: "crate",
    location: setup.roomId,
    support: setup.roomId,
    pos: { x: 50, y: 0 },
    props: { hands_required: 2 },
  });
  const take = apply(crate.snapshot, registry, {
    command_id: "two-handed-take",
    actor: setup.guardId,
    verb: "take",
    target: "crate",
  });
  strictEqual(take.status, "refused");
  strictEqual(take.reason_code, "insufficient_manipulation");
});

test("a sublethal part hit adds a temporary modifier that wait expires", () => {
  const setup = duel();
  const hit = attack(setup.snapshot, setup.attackerId, `${setup.guardId}.hand_r`, "sublethal");
  const damaged = hit.events.find((event) => event.type === "damaged");
  const guard = hit.snapshot.entities[setup.guardId]!;

  strictEqual(hit.status, "ok");
  ok(damaged);
  strictEqual(capacity(hit.snapshot, registry, setup.guardId, "manipulation"), 80);
  deepStrictEqual(guard.modifiers, [
    {
      capacity: "manipulation",
      delta: -20,
      expires_at_tick: 3,
      cause_id: damaged.event_id,
    },
  ]);

  const waited = apply(hit.snapshot, registry, {
    command_id: "wait-three",
    actor: setup.attackerId,
    verb: "wait",
    args: { ticks: 3 },
  });
  const recovery = waited.events.find(
    (event) => event.type === "capability_changed" && event.data.capacity === "manipulation",
  );
  ok(recovery);
  strictEqual(recovery.cause_id, damaged.event_id);
  deepStrictEqual({ from: recovery.data.from, to: recovery.data.to }, { from: 80, to: 100 });
  strictEqual(waited.snapshot.tick, 3);
  strictEqual(waited.snapshot.entities[setup.guardId]?.modifiers.length, 0);
  strictEqual(capacity(waited.snapshot, registry, setup.guardId, "manipulation"), 100);
});

test("an attack without a part targets the template default hit part", () => {
  const setup = duel();
  const hit = attack(setup.snapshot, setup.attackerId, setup.guardId, "default-hit");
  const damaged = hit.events.find((event) => event.type === "damaged");

  strictEqual(hit.status, "ok");
  ok(damaged);
  strictEqual(damaged.data.part, "torso");
  strictEqual(hit.snapshot.entities[setup.guardId]?.parts.torso?.integrity, 60);
  strictEqual(capacity(hit.snapshot, registry, setup.guardId, "moving"), 80);
});

test("detaching an arm carries its hand and its manipulation contribution", () => {
  const setup = duel();
  let snapshot = setup.snapshot;
  let finalAttack = undefined as ReturnType<typeof attack> | undefined;
  for (let index = 0; index < 3; index += 1) {
    finalAttack = attack(snapshot, setup.attackerId, `${setup.guardId}.arm_r`, `arm-${index}`);
    snapshot = finalAttack.snapshot;
  }

  ok(finalAttack);
  const detachedArm = Object.values(finalAttack.snapshot.entities).find(
    (entity) => entity.detached_from?.entity === setup.guardId,
  );
  ok(detachedArm);
  strictEqual(detachedArm.template, "human.arm_r");
  deepStrictEqual(detachedArm.parts.hand_r, { integrity: 100, status: "intact" });
  strictEqual(capacity(finalAttack.snapshot, registry, detachedArm.id, "manipulation"), 50);
  strictEqual(finalAttack.snapshot.entities[setup.guardId]?.parts.hand_r?.status, "detached");
});

test("a severed arm cannot act as the actor of a command", () => {
  const setup = duel();
  let snapshot = setup.snapshot;
  for (let index = 0; index < 3; index += 1) {
    const hit = attack(snapshot, setup.attackerId, `${setup.guardId}.arm_r`, `cut-arm-${index}`);
    strictEqual(hit.status, "ok");
    snapshot = hit.snapshot;
  }

  const arm = Object.values(snapshot.entities).find(
    (entity) => entity.detached_from?.entity === setup.guardId,
  );
  ok(arm);

  const asActor = apply(snapshot, registry, {
    command_id: "arm-waits",
    actor: arm.id,
    verb: "wait",
    args: { ticks: 1 },
  });

  strictEqual(asActor.status, "invalid");
  strictEqual(asActor.reason_code, "not_an_agent");
  strictEqual(asActor.deltas.length, 0);
  strictEqual(asActor.events.length, 0);
  strictEqual(asActor.snapshot.version, snapshot.version);
});

test("detaching a chair leg creates a supported part entity", () => {
  const room = spawn(initialSnapshot(), registry, "room", { name: "room" });
  const attacker = spawn(room.snapshot, registry, "human", {
    name: "attacker",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const chair = spawn(attacker.snapshot, registry, "chair", {
    name: "chair",
    location: room.id,
    support: room.id,
    pos: { x: 50, y: 0 },
  });
  let snapshot = chair.snapshot;
  let result: ReturnType<typeof attack> | undefined;
  for (let index = 0; index < 3; index += 1) {
    result = attack(snapshot, attacker.id, `${chair.id}.leg_fl`, `chair-leg-${index}`);
    snapshot = result.snapshot;
  }

  ok(result);
  const leg = Object.values(result.snapshot.entities).find(
    (entity) => entity.detached_from?.entity === chair.id,
  );
  ok(leg);
  strictEqual(leg.template, "chair.leg_fl");
  deepStrictEqual(leg.detached_from, { entity: chair.id, part: "leg_fl" });
  strictEqual(leg.support, room.id);
  deepStrictEqual(leg.pos, { x: 50, y: 0 });
  strictEqual(result.snapshot.entities[chair.id]?.parts.leg_fl?.status, "detached");
});

test("destroying a non-part entity applies its break residue", () => {
  const customRegistry: TemplateRegistry = {
    ...registry,
    stone: { ...registry.stone!, break_residue: { granite: 4 } },
  };
  const initial: Snapshot = {
    version: 0,
    tick: 0,
    next_seq: 1,
    templates_hash: templatesHash(customRegistry),
    coverage: { relations: [], senses: [], properties: [] },
    entities: {},
  };
  const room = spawn(initial, customRegistry, "room", { name: "room" });
  const attacker = spawn(room.snapshot, customRegistry, "human", {
    name: "attacker",
    location: room.id,
    support: room.id,
    pos: { x: 0, y: 0 },
  });
  const stone = spawn(attacker.snapshot, customRegistry, "stone", {
    name: "stone",
    location: room.id,
    support: room.id,
    pos: { x: 50, y: 0 },
  });
  let snapshot = stone.snapshot;
  let result = undefined as ReturnType<typeof apply> | undefined;
  for (let index = 0; index < 3; index += 1) {
    result = apply(snapshot, customRegistry, {
      command_id: `stone-hit-${index}`,
      actor: attacker.id,
      verb: "attack",
      target: stone.id,
    });
    snapshot = result.snapshot;
  }

  ok(result);
  strictEqual(result.snapshot.entities[stone.id]?.integrity, 0);
  strictEqual(result.snapshot.entities[stone.id]?.status, "destroyed");
  deepStrictEqual(result.snapshot.entities[room.id]?.residue, { granite: 4 });
});

test("a holder who loses all manipulation drops carried items", () => {
  const setup = duel();
  const bottle = spawn(setup.snapshot, registry, "bottle", {
    name: "bottle",
    location: setup.roomId,
    support: setup.roomId,
    pos: { x: 50, y: 0 },
  });
  const taken = apply(bottle.snapshot, registry, {
    command_id: "take-bottle",
    actor: setup.guardId,
    verb: "take",
    target: "bottle",
  });
  strictEqual(taken.snapshot.entities[bottle.id]?.in_part, "hand_l");
  let snapshot = taken.snapshot;
  let finalAttack: ReturnType<typeof attack> | undefined;
  let index = 0;
  let holdingDrop: ReturnType<typeof attack> | undefined;

  for (const part of ["hand_l", "hand_r"]) {
    for (let hit = 0; hit < 3; hit += 1) {
      finalAttack = attack(snapshot, setup.attackerId, `${setup.guardId}.${part}`, `carry-hit-${index++}`);
      snapshot = finalAttack.snapshot;
      if (hit < 2) {
        const waited = apply(snapshot, registry, {
          command_id: `carry-wait-${index}`,
          actor: setup.attackerId,
          verb: "wait",
          args: { ticks: 3 },
        });
        snapshot = waited.snapshot;
      }
    }
    // Losing the holding hand drops the bottle at once, caused by the detach rather than by the
    // capacity the carrier has left; the other hand's loss drops nothing more.
    if (part === "hand_l") {
      holdingDrop = finalAttack;
    }
  }

  ok(finalAttack);
  ok(holdingDrop);
  const detached = holdingDrop.events.find((event) => event.type === "detached");
  const dropped = holdingDrop.events.find(
    (event) => event.type === "dropped" && event.entity === bottle.id,
  );
  ok(detached);
  ok(dropped);
  strictEqual(dropped.cause_id, detached.event_id);
  strictEqual(holdingDrop.snapshot.entities[bottle.id]?.contained_in, null);
  strictEqual(holdingDrop.snapshot.entities[bottle.id]?.status, "broken");
  deepStrictEqual(holdingDrop.snapshot.entities[setup.roomId]?.residue, { glass: 5, wine: 75 });

  const capability = finalAttack.events.find(
    (event) => event.type === "capability_changed" && event.data.capacity === "manipulation",
  );
  ok(capability);
  strictEqual(capability.data.to, 0);
  strictEqual(
    finalAttack.events.some((event) => event.type === "dropped" && event.entity === bottle.id),
    false,
  );
  deepStrictEqual(capacities(finalAttack.snapshot, registry, setup.guardId), {
    hearing: 100,
    manipulation: 0,
    moving: 100,
    sight: 100,
    touch: 100,
  });
});
