import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { loadTemplates } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A thing with no parts starts at its template's `max_integrity`, 100 when it declares none
// (`docs/integrity.md`). The cable's is 40, so one human blow of 40 destroys it.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));

// The repo's templates plus the test's own, written beside them, so a file can be read as the set's.
function registryWith(t: { after(callback: () => void): void }, files: Record<string, unknown>) {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(body));
  }
  return dir;
}

function scenario(cable: Record<string, unknown>): Scenario {
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "wire", template: "cable", overrides: { name: "wire", location: "hall", support: "hall", pos: { x: 0, y: 0 }, ...cable } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: -60 } } },
  ];
}

function open(t: { after(callback: () => void): void }, cable: Record<string, unknown> = {}): { world: World; id: (name: string) => Id; run: (actor: Id, verb: string, target?: string) => Result } {
  const world = createWorld(join(tempDir(t), "world"), scenario(cable));
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  let seq = 0;
  const run = (actor: Id, verb: string, target?: string): Result => {
    seq += 1;
    return world.command({ command_id: `i${seq}`, actor, verb, ...(target !== undefined && { target }) });
  };
  return { world, id, run };
}

test("a cable starts at 40 and one human blow destroys it", (t) => {
  const { world, id, run } = open(t);
  strictEqual(world.entity(id("wire"))?.integrity, 40);
  strictEqual(run(id("ann"), "attack", "wire").status, "ok");
  strictEqual(world.entity(id("wire"))?.status, "destroyed");
});

test("a template with no max_integrity starts at 100 and takes three blows", (t) => {
  const world = createWorld(join(tempDir(t), "stone"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "stone", template: "stone", overrides: { name: "stone", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: -60 } } },
  ]);
  const stone = world.id("stone")!;
  strictEqual(world.entity(stone)?.integrity, 100);
  const ann = world.id("ann")!;
  for (let blow = 0; blow < 2; blow += 1) {
    strictEqual(world.command({ command_id: `s${blow}`, actor: ann, verb: "attack", target: "stone" }).status, "ok");
  }
  strictEqual(world.entity(stone)?.status, "intact");
  strictEqual(world.command({ command_id: "s2", actor: ann, verb: "attack", target: "stone" }).status, "ok");
  strictEqual(world.entity(stone)?.status, "destroyed");
});

test("a child that extends cable inherits 40, and one that declares its own max keeps it", (t) => {
  const dir = registryWith(t, {
    "child_cable.json": { id: "child_cable", extends: "cable" },
    "thick_cable.json": { id: "thick_cable", extends: "cable", max_integrity: 60 },
  });
  const registry = loadTemplates(dir);
  strictEqual(registry.child_cable?.max_integrity, 40);
  strictEqual(registry.thick_cable?.max_integrity, 60);
  strictEqual(registry.cable?.max_integrity, 40);
  strictEqual(registry.chair?.max_integrity, undefined);
});

test("a template with parts and a max_integrity is refused when the set is loaded", (t) => {
  const dir = registryWith(t, {
    "parted.json": {
      id: "parted",
      size_cm: { w: 10, d: 10, h: 10 },
      mass_g: 10,
      parts: [{ name: "body", parent: null, contributes: {}, detachable: false, max_integrity: 100 }],
      props: {},
      break_products: [],
      break_residue: {},
      max_integrity: 40,
    },
  });
  throws(() => loadTemplates(dir), /max_integrity and parts/);
});

for (const value of [0, 101, 2.5]) {
  test(`a max_integrity of ${value} is refused when the set is loaded`, (t) => {
    const dir = registryWith(t, { "bad.json": { id: "bad", extends: "cable", max_integrity: value } });
    throws(() => loadTemplates(dir), /max_integrity must be an integer from 1 to 100/);
  });
}

test("a scenario entry cannot write a cable's integrity, so the architect has no override above its max", (t) => {
  throws(() => open(t, { integrity: 50 }), /writes integrity/);
});

test("an edit that spawns a cable above its max is refused, and one at its max is ok", (t) => {
  const { world } = open(t);
  const over = world.edit({ kind: "spawn", template: "cable", overrides: { integrity: 50 } });
  strictEqual(over.reason_code, "integrity_out_of_range");
  strictEqual(over.status, "refused");
  strictEqual(world.edit({ kind: "spawn", template: "cable", overrides: { integrity: 40 } }).status, "ok");
});
