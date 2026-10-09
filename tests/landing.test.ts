import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createWorld, type Scenario, type World } from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

const shipped = loadTemplates(fileURLToPath(new URL("../templates/", import.meta.url)));
const table = shipped.table;
ok(table !== undefined);
// A lower surface than the table, so a fall from the table has somewhere to stop on the way down.
const registry: TemplateRegistry = {
  ...shipped,
  stool: { ...table, id: "stool", size_cm: { w: 40, d: 40, h: 40 }, mass_g: 3000 },
};

function world(t: { after(callback: () => void): void }, scenario: Scenario): World {
  const dir = tempDir(t);
  return createWorld(join(dir, "w"), scenario, registry);
}

const floor = (name: string, template: string, x: number, y: number) => ({
  id: name,
  template,
  overrides: { name, location: "room", support: "room", pos: { x, y } },
});

function idOf(w: World, name: string): string {
  const id = w.id(name);
  ok(id !== null, name);
  return id;
}

test("a cup left without its table comes to rest on the stool beneath, falling 35 cm", (t) => {
  const w = world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("table", "table", 0, 0),
    floor("stool", "stool", 10, 0),
    { id: "cup", template: "cup", overrides: { name: "cup", location: "room", support: "table" } },
  ]);
  const result = w.edit({ kind: "remove", target: idOf(w, "table") }, { command_id: "remove-table" });
  strictEqual(result.status, "ok");
  deepStrictEqual(result.events.find((event) => event.type === "dropped")?.data, { fall_cm: 35 });
  strictEqual(w.entity(idOf(w, "cup"))?.support, idOf(w, "stool"));
  strictEqual(w.entity(idOf(w, "cup"))?.pos, null);
});

test("a surface narrower than what falls does not catch it", (t) => {
  const w = world(t, [
    { id: "room", template: "room", overrides: { name: "room" } },
    floor("stool", "stool", 0, 0),
    floor("ann", "human", 0, 0),
    { id: "chair", template: "chair", overrides: { name: "chair", location: "room", contained_in: "ann" } },
  ]);
  const result = w.command({ command_id: "drop-chair", actor: idOf(w, "ann"), verb: "drop", target: "chair" });
  strictEqual(result.status, "ok");
  strictEqual(w.entity(idOf(w, "chair"))?.support, idOf(w, "room"));
});
