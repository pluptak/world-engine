import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, createWorld, openWorld, verifyWorld, WorldError, type World } from "../src/index.js";

function worldWithChest(): { dir: string; world: World; chest: string } {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-entity-props-"));
  const world = createWorld(join(dir, "w"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    {
      id: "chest",
      template: "chest",
      overrides: { name: "chest", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
    },
  ]);
  return { dir, world, chest: world.id("chest")! };
}

function after(t: { after(callback: () => void): void }, dir: string): void {
  t.after(() => rmSync(dir, { recursive: true, force: true }));
}

function issuePath(code: string): (issues: readonly { code: string }[]) => boolean {
  return (issues) => issues.some((i) => i.code === code);
}

test("an edit update_props refuses a prop no template declares", (t) => {
  const { dir, world } = worldWithChest();
  after(t, dir);
  const refusal = world.edit({ kind: "update_props", target: world.id("chest")!, props: { foo: "bar" } });
  deepStrictEqual([refusal.status, refusal.reason_code], ["refused", "undeclared_prop"]);
  strictEqual(canonicalJson(world.snapshot()) === canonicalJson(world.snapshot()), true);
});

test("an edit set_props refuses an undeclared prop when replacing", (t) => {
  const { dir, world, chest } = worldWithChest();
  after(t, dir);
  const subject = world.entity(chest)!;
  const refusal = world.edit({
    kind: "set_props",
    target: chest,
    props: { ...subject.props, custom: 1 },
  });
  deepStrictEqual([refusal.status, refusal.reason_code], ["refused", "undeclared_prop"]);
});

test("an edit spawn refuses a prop no template declares in overrides", (t) => {
  const { dir, world } = worldWithChest();
  after(t, dir);
  const refusal = world.edit({
    kind: "spawn",
    template: "stone",
    overrides: { name: "weird", location: "e1", support: "e1", pos: { x: 10, y: 0 }, props: { glow: 5 } },
  });
  deepStrictEqual([refusal.status, refusal.reason_code], ["refused", "undeclared_prop"]);
});

test("an edit refuses a declared prop with the wrong type", (t) => {
  const { dir, world } = worldWithChest();
  after(t, dir);
  const hall = world.id("hall")!;
  const refusal = world.edit({ kind: "update_props", target: hall, props: { lit: "yes" } });
  deepStrictEqual([refusal.status, refusal.reason_code], ["refused", "wrong_prop_type"]);
});

test("an edit refuses a prop whose requires the template does not grant", (t) => {
  const { dir, world, chest } = worldWithChest();
  after(t, dir);
  // a chest template declares no `openable`, so setting `open` on it fails the
  // requirement check against the template's declared props, not its own
  const refusal = world.edit({ kind: "update_props", target: chest, props: { open: true } });
  deepStrictEqual([refusal.status, refusal.reason_code], ["refused", "unmet_requires"]);
});

test("a door side needs openable: a stone given from/to is unmet_requires, a door keeps them", (t) => {
  const { dir, world, chest } = worldWithChest();
  after(t, dir);
  const hall = world.id("hall")!;
  // A stone is a door by shape `isDoor` once it has from and to, but its preset grants no
  // `openable`, so the state write is refused before it can join two rooms.
  const asDoor = world.edit({ kind: "update_props", target: chest, props: { from: hall, to: hall } });
  deepStrictEqual([asDoor.status, asDoor.reason_code], ["refused", "unmet_requires"]);
  // A door template declares openable, so the same state is its own.
  const spawned = world.edit({
    kind: "spawn",
    template: "door",
    overrides: { name: "cellar door", location: hall, support: hall, pos: { x: 10, y: 0 }, props: { from: hall, to: hall } },
  });
  strictEqual(spawned.status, "ok");
});

test("a scenario refuses a wrong-typed or unsatisfied state prop before anything is written", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-entity-props-scenario-"));
  after(t, dir);
  const entry = (props: Record<string, number | string | boolean>) => [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    {
      id: "chest",
      template: "chest",
      overrides: { name: "chest", location: "hall", support: "hall", pos: { x: 0, y: 0 }, props },
    },
  ];
  const cases: Array<[string, Record<string, number | string | boolean>]> = [
    ["wrong_prop_type", { lit: "yes" }],
    ["unmet_requires", { open: true }],
  ];
  cases.forEach(([code, props], index) => {
    throws(
      () => createWorld(join(dir, `w${index}`), entry(props)),
      (error: unknown) =>
        error instanceof WorldError && error.code === "invalid_snapshot" && issuePath(code)(error.issues ?? []),
    );
  });
  // An undeclared prop is no state the architect may write: it is refused before the snapshot is judged.
  throws(
    () => createWorld(join(dir, "undeclared"), entry({ foo: "bar" })),
    (error: unknown) => error instanceof WorldError && error.code === "field_not_editable",
  );
  strictEqual(existsSync(join(dir, "undeclared")), false);
});

test("a hand-edited world meets each rule on open, and verify names the divergence", (t) => {
  const handDir = mkdtempSync(join(tmpdir(), "world-engine-entity-props-hand-"));
  after(t, handDir);
  type Mutate = (entities: Record<string, { props: Record<string, unknown> }>, room: string, chest: string) => void;
  const cases: Array<[string, Mutate]> = [
    ["undeclared_prop", (entities, _room, chest) => { entities[chest]!.props.extra = "nothing"; }],
    ["wrong_prop_type", (entities, room) => { entities[room]!.props.lit = "yes"; }],
    ["unmet_requires", (entities, _room, chest) => { entities[chest]!.props.open = true; }],
  ];
  cases.forEach(([code, mutate], index) => {
    const dir = join(handDir, `w${index}`);
    const world = createWorld(dir, [
      { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
      {
        id: "chest",
        template: "chest",
        overrides: { name: "chest", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
      },
    ]);
    const snapshotPath = join(dir, "snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    mutate(snapshot.entities, world.id("hall")!, world.id("chest")!);
    writeFileSync(snapshotPath, canonicalJson(snapshot));
    // Opening runs validateSnapshot; verify names the file the hand-edit changed.
    throws(
      () => openWorld(dir).snapshot(),
      (error: unknown) =>
        error instanceof WorldError && error.code === "invalid_snapshot" && issuePath(code)(error.issues ?? []),
    );
    const verify = verifyWorld(dir);
    strictEqual(verify.ok, false);
    strictEqual(verify.divergence.file, "snapshot.json");
  });
});

test("declared props remain writable after the rule", (t) => {
  const { dir, world, chest } = worldWithChest();
  after(t, dir);
  const lit = world.edit({ kind: "update_props", target: world.id("hall")!, props: { lit: true } });
  deepStrictEqual([lit.status, lit.reason_code], ["ok", undefined]);
  const open = world.edit({ kind: "update_props", target: chest, props: { open: true } });
  deepStrictEqual([open.status, open.reason_code], ["refused", "unmet_requires"]);
  const repeated = world.edit({ kind: "update_props", target: chest, props: { open: true } });
  deepStrictEqual([repeated.status, repeated.reason_code], ["refused", "unmet_requires"]);
});
