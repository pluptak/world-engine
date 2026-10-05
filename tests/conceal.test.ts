import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalJson,
  createWorld,
  memoryWorld,
  type Scenario,
  type World,
} from "../src/index.js";

function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-conceal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A book on the floor, a note under it, two people in the room with the book, a dog, and someone in a
// room with no door to it. The templates only supply shapes: concealment is a relation, not a kind of
// thing, and it is declared, so `concealed_by` is written as the id the scenario allocates.
const hidden: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  { id: "cell", template: "room", overrides: { name: "cell" } },
  {
    id: "table",
    template: "table",
    overrides: { name: "table", location: "hall", support: "hall", pos: { x: 140, y: 0 } },
  },
  { id: "book", template: "stone", overrides: { name: "book", location: "hall", support: "hall", pos: { x: 30, y: 0 } } },
  {
    id: "note",
    template: "stone",
    overrides: {
      name: "note",
      location: "hall",
      support: "hall",
      pos: { x: 30, y: 0 },
      // e4 is the book, named by the id the scenario allocates: names resolve only for a holder.
      concealed_by: "e4",
    },
  },
  { id: "ann", template: "human", overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "hall", support: "hall", pos: { x: -20, y: 0 } } },
  { id: "rex", template: "dog", overrides: { name: "rex", location: "hall", support: "hall", pos: { x: 80, y: 0 } } },
  { id: "cal", template: "human", overrides: { name: "cal", location: "cell", support: "cell", pos: { x: 0, y: 0 } } },
];

const BOOK = "e4";
const NOTE = "e5";

// A store world and a memory world over the same snapshot: every feature answers in both.
function hiddenWorlds(t: { after(callback: () => void): void }): [World, World] {
  const store = createWorld(join(tempDir(t), "hidden"), hidden);
  const names = {
    hall: "e1",
    table: "e3",
    book: BOOK,
    note: NOTE,
    ann: "e6",
    bob: "e7",
    rex: "e8",
    cal: "e9",
  };
  return [store, memoryWorld(store.snapshot(), undefined, names)];
}

function sight(world: World, observer: string, entity: string) {
  return world.query({ kind: "perceive", observer, entity, sense: "sight" });
}

test("scenario names resolve concealed_by references", (t) => {
  const scenario: Scenario = [
    { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
    { id: "book", template: "stone", overrides: { name: "book", location: "room", support: "room", pos: { x: 0, y: 0 } } },
    { id: "note", template: "stone", overrides: { name: "note", location: "room", support: "room", pos: { x: 0, y: 0 }, concealed_by: "book" } },
  ];
  const store = createWorld(join(tempDir(t), "named-concealed"), scenario);
  const bookId = store.id("book");
  const noteId = store.id("note");
  ok(typeof bookId === "string");
  ok(typeof noteId === "string");
  strictEqual(store.entity(noteId)?.concealed_by, bookId);
  const mem = memoryWorld(store.snapshot(), undefined, { book: bookId, note: noteId });
  strictEqual(mem.entity(noteId)?.concealed_by, bookId);
});

test("a note under a book is not seen by anybody, and hearing does not care", (t) => {
  for (const world of hiddenWorlds(t)) {
    strictEqual(world.entity(NOTE)?.concealed_by, BOOK);
    for (const observer of ["e6", "e7", "e8"]) {
      deepStrictEqual(sight(world, observer, NOTE), { value: "false", basis_code: "concealed" });
      deepStrictEqual(
        world.query({ kind: "perceive", observer, entity: BOOK, sense: "sight" }),
        { value: "true", basis_code: "same_location_lit" },
      );
      deepStrictEqual(
        world.query({ kind: "perceive", observer, entity: NOTE, sense: "hearing" }),
        { value: "true", basis_code: "same_location" },
      );
    }
    // The relation hides the note from everybody, including someone in a room with no door to it:
    // the basis is the relation, not the distance.
    deepStrictEqual(sight(world, "e9", NOTE), { value: "false", basis_code: "concealed" });
  }
});

test("searching the book finds the note, and everyone in the room sees it found", (t) => {
  for (const world of hiddenWorlds(t)) {
    // A search writes nothing: no deltas, and the entities are byte-identical afterwards. The
    // snapshot still moves — an ok command bumps its version and its events take ids.
    const entities = canonicalJson(world.snapshot().entities);
    const found = world.command({
      command_id: "search-book",
      actor: "e6",
      verb: "search",
      target: "book",
      perceivers: true,
    });
    strictEqual(found.status, "ok");
    // A search changes nothing: the world keeps no record of who looked.
    deepStrictEqual(found.deltas, []);
    strictEqual(canonicalJson(world.snapshot().entities), entities);
    strictEqual(world.entity(NOTE)?.concealed_by, BOOK);

    const root = found.events[0];
    ok(root);
    const event = found.events[1];
    ok(event);
    strictEqual(event.type, "found");
    strictEqual(event.entity, NOTE);
    strictEqual(event.cause_id, root.event_id);
    strictEqual(canonicalJson(event.data), canonicalJson({ concealer: BOOK }));
    strictEqual(found.events.length, 2);

    // The found event is read where the search happened, so the searcher and the other reader in
    // the room both see it, and the one in the room with no door does not.
    for (const observer of ["e6", "e7"]) {
      deepStrictEqual(
        world.query({ kind: "perceive", observer, event_id: event.event_id, sense: "sight" }),
        { value: "true", basis_code: "same_location_lit" },
      );
    }
    deepStrictEqual(
      world.query({ kind: "perceive", observer: "e9", event_id: event.event_id, sense: "sight" }),
      { value: "false", basis_code: "not_perceptible" },
    );
    deepStrictEqual(event.perceivers?.sight, ["e6", "e7", "e8"]);
  }
});

test("lifting the book uncovers the note for everyone in the room", (t) => {
  for (const world of hiddenWorlds(t)) {
    const lifted = world.command({ command_id: "take-book", actor: "e6", verb: "take", target: "book" });
    strictEqual(lifted.status, "ok");
    strictEqual(world.entity(NOTE)?.concealed_by, null);
    strictEqual(world.entity(BOOK)?.concealed_by, null);

    const moved = lifted.events.find((event) => event.type === "moved");
    ok(moved);
    const revealed = lifted.events.find((event) => event.type === "revealed");
    ok(revealed);
    strictEqual(revealed.entity, NOTE);
    strictEqual(revealed.cause_id, moved.event_id);
    strictEqual(canonicalJson(revealed.data), canonicalJson({ concealer: BOOK }));
    deepStrictEqual(lifted.events.filter((event) => event.type === "found"), []);

    for (const observer of ["e6", "e7"]) {
      deepStrictEqual(sight(world, observer, NOTE), { value: "true", basis_code: "same_location_lit" });
    }
    // The uncovering is itself perceivable, for the same reason the note now is.
    deepStrictEqual(
      world.query({ kind: "perceive", observer: "e7", event_id: revealed.event_id, sense: "sight" }),
      { value: "true", basis_code: "same_location_lit" },
    );
  }
});

test("taking the hidden thing takes it out of hiding", (t) => {
  for (const world of hiddenWorlds(t)) {
    const taken = world.command({ command_id: "take-note", actor: "e6", verb: "take", target: "note" });
    strictEqual(taken.status, "ok");
    strictEqual(world.entity(NOTE)?.concealed_by, null);
    const revealed = taken.events.find((event) => event.type === "revealed");
    ok(revealed);
    strictEqual(revealed.entity, NOTE);
  }
});

test("a concealer that is pushed, or removed, uncovers what it hid", (t) => {
  for (const world of hiddenWorlds(t)) {
    const pushed = world.command({
      command_id: "push-book",
      actor: "e6",
      verb: "push",
      target: "book",
      args: { distance_cm: 10, dir: "-x" },
    });
    strictEqual(pushed.status, "ok");
    strictEqual(world.entity(NOTE)?.concealed_by, null);
    strictEqual(
      pushed.events.filter((event) => event.type === "revealed").length,
      1,
    );
  }
  for (const world of hiddenWorlds(t)) {
    const before = canonicalJson(world.snapshot());
    const removed = world.edit({ kind: "remove", target: BOOK }, { command_id: "remove-book" });
    strictEqual(removed.status, "ok");
    strictEqual(world.entity(BOOK), null);
    // The note stays in the world, where it was, and is no longer hidden.
    strictEqual(world.entity(NOTE)?.concealed_by, null);
    strictEqual(world.entity(NOTE)?.support, "e1");
    const revealed = removed.events.find((event) => event.type === "revealed");
    ok(revealed);
    strictEqual(revealed.entity, NOTE);
    ok(canonicalJson(world.snapshot()) !== before);
    deepStrictEqual(sight(world, "e7", NOTE), { value: "true", basis_code: "same_location_lit" });
  }
});

// A chest on a table, a note under the chest: removing the table topples the chest, and a fall is a
// move like any other.
const toppling: Scenario = [
  { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
  {
    id: "table",
    template: "table",
    overrides: { name: "table", location: "hall", support: "hall", pos: { x: 30, y: 0 } },
  },
  {
    id: "chest",
    template: "chest",
    overrides: {
      name: "chest",
      location: "hall",
      support: "table",
      props: {
        container: true,
        topples: true,
        inner_w_cm: 55,
        inner_d_cm: 35,
        inner_h_cm: 35,
        openable: true,
        open: true,
      },
    },
  },
  {
    id: "note",
    template: "stone",
    overrides: { name: "note", location: "hall", support: "table", concealed_by: "e3" },
  },
  {
    id: "ann",
    template: "human",
    overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
  },
];

test("a concealer that topples off its support uncovers what it hid", (t) => {
  const store = createWorld(join(tempDir(t), "toppling"), toppling);
  for (const world of [store, memoryWorld(store.snapshot(), undefined, { chest: "e3" })]) {
    strictEqual(world.entity("e4")?.concealed_by, "e3");
    const removed = world.edit({ kind: "remove", target: "e2" }, { command_id: "remove-table" });
    strictEqual(removed.status, "ok");
    strictEqual(world.entity("e4")?.concealed_by, null);
    const dropped = removed.events.find((event) => event.type === "dropped");
    ok(dropped);
    const revealed = removed.events.find((event) => event.type === "revealed");
    ok(revealed);
    // The fall uncovered it, so the uncovering is caused by the fall and not by the removal.
    strictEqual(revealed.cause_id, dropped.event_id);
  }
});

test("search refuses a part, a mark, what it cannot reach", (t) => {
  for (const world of hiddenWorlds(t)) {
    // A mark is abstract, so no verb of an agent can address it at all.
    strictEqual(
      world.edit(
        {
          kind: "spawn",
          template: "anchor",
          overrides: { name: "mark", location: "e1", support: "e1", pos: { x: 90, y: 0 } },
        },
        { command_id: "spawn-mark" },
      ).status,
      "ok",
    );
    const entities = canonicalJson(world.snapshot().entities);
    const part = world.command({
      command_id: "search-arm",
      actor: "e6",
      verb: "search",
      target: "e6.arm_r",
    });
    strictEqual(part.status, "refused");
    strictEqual(part.reason_code, "target_attached");

    const mark = world.command({ command_id: "search-mark", actor: "e6", verb: "search", target: "mark" });
    strictEqual(mark.status, "unresolved");

    // The table is too far for ann, and out of her view is not the same as out of reach: rex shares
    // the room with it and is close enough.
    const far = world.command({ command_id: "search-far", actor: "e6", verb: "search", target: "table" });
    strictEqual(far.status, "refused");
    strictEqual(far.reason_code, "out_of_reach");
    deepStrictEqual(far.reason_data, { distance_cm: 140, reach_cm: 100 });

    // What someone in another room cannot even name is unresolved, not refused.
    const elsewhere = world.command({
      command_id: "search-elsewhere",
      actor: "e9",
      verb: "search",
      target: "book",
    });
    strictEqual(elsewhere.status, "unresolved");

    // A dog has no hands, so it cannot look under anything even when it can reach it.
    const paw = world.command({ command_id: "search-paw", actor: "e8", verb: "search", target: "book" });
    strictEqual(paw.status, "refused");
    strictEqual(paw.reason_code, "insufficient_manipulation");
    deepStrictEqual(paw.reason_data, { capacity: "manipulation", have: 0, need: 50 });

    deepStrictEqual(canonicalJson(world.snapshot().entities), entities);
  }
});

test("a search of something with nothing hidden succeeds", (t) => {
  const store = createWorld(join(tempDir(t), "search-empty"), [
    { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
    { id: "box", template: "stone", overrides: { name: "box", location: "room", support: "room", pos: { x: 0, y: 0 } } },
    { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: 0, y: 0 } } },
  ]);
  for (const world of [store, memoryWorld(store.snapshot(), undefined, { box: "e2" })]) {
    // Ann searches the box, which hides nothing.
    const found = world.command({
      command_id: "search-empty-box",
      actor: "e3",
      verb: "search",
      target: "box",
    });
    strictEqual(found.status, "ok");
    const root = found.events[0];
    ok(root);
    strictEqual(root.type, "search");
    strictEqual(found.events.length, 1);
  }
});

test("a concealer that loses a part goes on hiding what it hides", (t) => {
  const store = createWorld(join(tempDir(t), "arm"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    {
      id: "ann",
      template: "human",
      overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
    },
    {
      id: "note",
      template: "stone",
      overrides: { name: "note", location: "hall", support: "hall", pos: { x: 0, y: 0 }, concealed_by: "e2" },
    },
  ]);
  for (const world of [store, memoryWorld(store.snapshot(), undefined, { ann: "e2" })]) {
    for (let index = 0; index < 3; index += 1) {
      const hit = world.command({
        command_id: `cut-arm-${index}`,
        actor: "e2",
        verb: "attack",
        target: "e2.arm_r",
      });
      strictEqual(hit.status, "ok");
    }
    // The arm is gone and became an entity of its own, and the note is still under the whole that
    // was hiding it: a severed part does not uncover anything.
    strictEqual(world.entity("e2")?.parts.arm_r?.status, "detached");
    strictEqual(world.entity("e3")?.concealed_by, "e2");
    deepStrictEqual(sight(world, "e2", "e3"), { value: "false", basis_code: "concealed" });
  }
});

test("a thing in a shut container cannot be searched", (t) => {
  const store = createWorld(join(tempDir(t), "shut"), [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    {
      id: "chest",
      template: "chest",
      overrides: {
        name: "chest",
        location: "hall",
        support: "hall",
        pos: { x: 30, y: 0 },
        props: {
          container: true,
          inner_w_cm: 55,
          inner_d_cm: 35,
          inner_h_cm: 35,
          openable: true,
          open: false,
        },
      },
    },
    {
      id: "book",
      template: "stone",
      overrides: { name: "book", location: "hall", contained_in: "chest" },
    },
    {
      id: "ann",
      template: "human",
      overrides: { name: "ann", location: "hall", support: "hall", pos: { x: 0, y: 0 } },
    },
  ]);
  for (const world of [store, memoryWorld(store.snapshot(), undefined, { chest: "e3" })]) {
    const searched = world.command({ command_id: "search-in-chest", actor: "e4", verb: "search", target: "book" });
    strictEqual(searched.status, "refused");
    strictEqual(searched.reason_code, "container_closed");
    strictEqual(canonicalJson(searched.reason_data), canonicalJson({ enclosure: "e2" }));
  }
});

test("an abstract entity can neither conceal nor be concealed", (t) => {
  for (const world of hiddenWorlds(t)) {
    const mark = world.edit(
      {
        kind: "spawn",
        template: "anchor",
        overrides: { name: "mark", location: "e1", support: "e1", pos: { x: 90, y: 0 } },
      },
      { command_id: "spawn-mark" },
    );
    strictEqual(mark.status, "ok");
    const markId = mark.events[1]?.entity;
    ok(typeof markId === "string");

    // Nothing hides under a mark.
    const underMark = world.edit(
      { kind: "place", target: NOTE, concealed_by: markId },
      { command_id: "hide-under-mark" },
    );
    strictEqual(underMark.status, "refused");
    strictEqual(underMark.reason_code, "concealed_by_abstract");

    // And a mark hides nothing.
    const markHidden = world.edit(
      { kind: "place", target: markId, concealed_by: BOOK },
      { command_id: "hide-mark" },
    );
    strictEqual(markHidden.status, "refused");
    strictEqual(markHidden.reason_code, "concealed_by_abstract");

    strictEqual(world.entity(NOTE)?.concealed_by, BOOK);
    strictEqual(world.entity(markId)?.concealed_by, null);
    // The refusals left the note hidden exactly as it was.
    deepStrictEqual(sight(world, "e6", NOTE), { value: "false", basis_code: "concealed" });
  }
});

test("a concealer in another room hides nothing, and the world author may still hide a thing", (t) => {
  for (const world of hiddenWorlds(t)) {
    const across = world.edit(
      { kind: "place", target: NOTE, concealed_by: "e9" },
      { command_id: "hide-across" },
    );
    strictEqual(across.status, "refused");
    strictEqual(across.reason_code, "concealed_by_not_same_room");

    const under = world.edit(
      { kind: "place", target: NOTE, concealed_by: BOOK },
      { command_id: "hide-under" },
    );
    strictEqual(under.status, "ok");
    strictEqual(world.entity(NOTE)?.concealed_by, BOOK);

    const cleared = world.edit(
      { kind: "place", target: NOTE, concealed_by: null },
      { command_id: "unhide" },
    );
    strictEqual(cleared.status, "ok");
    strictEqual(world.entity(NOTE)?.concealed_by, null);
  }
});

test("an edit may hide a thing where it puts it", (t) => {
  for (const world of hiddenWorlds(t)) {
    const spawned = world.edit(
      {
        kind: "spawn",
        template: "stone",
        overrides: { name: "letter", location: "e1", support: "e3", concealed_by: BOOK },
      },
      { command_id: "spawn-letter" },
    );
    strictEqual(spawned.status, "ok");
    const letter = spawned.events[1]?.entity;
    ok(typeof letter === "string");
    strictEqual(world.entity(letter)?.concealed_by, BOOK);
    deepStrictEqual(sight(world, "e6", letter), { value: "false", basis_code: "concealed" });

    // Putting the book somewhere else uncovers the letter, and the note stays where it was.
    const moved = world.edit(
      { kind: "place", target: BOOK, support: "e1", pos: { x: -60, y: 0 } },
      { command_id: "move-book" },
    );
    strictEqual(moved.status, "ok");
    strictEqual(world.entity(letter)?.concealed_by, null);
    deepStrictEqual(sight(world, "e6", letter), { value: "true", basis_code: "same_location_lit" });
  }
});