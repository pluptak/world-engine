import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createWorld, type Id, type Result, type Scenario, type World } from "../src/index.js";
import { loadTemplates, type TemplateRegistry } from "../src/templates.js";
import { tempDir } from "./harness.js";

// A camera's cone (`docs/camera.md`): the hall's camera looks along its facing and sees within half its
// cone either side. The terminal in the yard is fed by it; it sees the hall only through the camera. The
// narrow camera (60 degrees) is the repo's template; a 90-degree and a whole-room camera are written
// beside it, since a cone is a template's definition and no scenario writes one.
const templates = fileURLToPath(new URL("../templates/", import.meta.url));

function registry(t: { after(callback: () => void): void }): TemplateRegistry {
  const dir = join(tempDir(t), "templates");
  cpSync(templates, dir, { recursive: true });
  writeFileSync(join(dir, "wide_camera.json"), JSON.stringify({ id: "wide_camera", extends: "camera", props: { cone_deg: 90 } }));
  writeFileSync(join(dir, "whole_camera.json"), JSON.stringify({ id: "whole_camera", extends: "camera", props: { cone_deg: 360 } }));
  writeFileSync(join(dir, "faceless_camera.json"), JSON.stringify({ id: "faceless_camera", extends: "camera", props: { cone_deg: 60 } }));
  return loadTemplates(dir);
}

// The camera's own entry, then the subjects the test places in the hall.
function scenario(template: string, facing: number | null, subjects: Scenario): Scenario {
  return [
    { id: "hall", template: "room", overrides: { name: "hall", props: { lit: true } } },
    { id: "yard", template: "room", overrides: { name: "yard", props: { lit: true } } },
    { id: "generator", template: "generator", overrides: { name: "generator", location: "yard", support: "yard", pos: { x: -500, y: -500 } } },
    { id: "ai", template: "terminal", overrides: { name: "ai", location: "yard", support: "yard", pos: { x: 0, y: 0 } } },
    {
      id: "camera",
      template,
      overrides: {
        name: "camera",
        location: "hall",
        support: "hall",
        pos: { x: 0, y: 0 },
        props: { powered_by: "generator", controlled_by: "ai", ...(facing !== null && { facing_deg: facing }) },
      },
    },
    ...subjects,
  ];
}

function human(id: string, x: number, y: number): Scenario[number] {
  return { id, template: "human", overrides: { name: id, location: "hall", support: "hall", pos: { x, y } } };
}

function open(
  t: { after(callback: () => void): void },
  template: string,
  facing: number | null,
  subjects: Scenario,
): { world: World; id: (name: string) => Id; sight: (entity: Id) => { value: string; basis_code: string } } {
  const world: World = createWorld(join(tempDir(t), "cone"), scenario(template, facing, subjects), registry(t));
  const id = (name: string): Id => {
    const found = world.id(name);
    ok(found !== null, name);
    return found;
  };
  const ai = id("ai");
  const sight = (entity: Id) => world.query({ kind: "perceive", observer: ai, sense: "sight", entity });
  return { world, id, sight };
}

test("a subject inside the narrow cone is seen by the camera, and one outside it is not", (t) => {
  // Facing 0, a 60-degree cone: the edge is 30 degrees. Inside sits about 18 degrees off; outside about 72.
  const { id, sight } = open(t, "narrow_camera", 0, [human("inside", 300, 100), human("outside", 100, 300)]);
  deepStrictEqual(sight(id("inside")), { value: "true", basis_code: "camera" });
  strictEqual(sight(id("outside")).value, "false");
});

test("a subject exactly on the edge of the cone is seen, and one a centimetre past it is not", (t) => {
  // Facing 0, a 90-degree cone: the edge is 45 degrees, which (100, 100) sits on exactly.
  const { id, sight } = open(t, "wide_camera", 0, [human("edge", 100, 100), human("past", 100, 101)]);
  deepStrictEqual(sight(id("edge")), { value: "true", basis_code: "camera" });
  strictEqual(sight(id("past")).value, "false");
});

test("a subject at the camera's own spot is seen, and so is a door with no position", (t) => {
  const { world, id, sight } = open(t, "narrow_camera", 0, [human("atcamera", 0, 0), { id: "door", template: "door", overrides: { name: "door", props: { open: false, from: "hall", to: "yard" } } }]);
  deepStrictEqual(sight(id("atcamera")), { value: "true", basis_code: "camera" });
  strictEqual(world.entity(id("door"))?.pos, null);
  // A door with no position stands in both rooms it joins: the yard sees it there as now, and the cone is not asked.
  deepStrictEqual(sight(id("door")), { value: "true", basis_code: "same_location_lit" });
});

test("a carried thing is read at its holder: the one a subject in the cone holds is seen, the one held outside is not", (t) => {
  const { world, id, sight, } = open(t, "narrow_camera", 0, [
    human("inside", 300, 100),
    human("outside", 100, 300),
    { id: "coin_in", template: "stone", overrides: { name: "coin in", location: "hall", support: "hall", pos: { x: 310, y: 100 } } },
    { id: "coin_out", template: "stone", overrides: { name: "coin out", location: "hall", support: "hall", pos: { x: 110, y: 300 } } },
  ]);
  strictEqual(world.command({ command_id: "take-in", actor: id("inside"), verb: "take", target: "coin in" }).status, "ok");
  strictEqual(world.command({ command_id: "take-out", actor: id("outside"), verb: "take", target: "coin out" }).status, "ok");
  deepStrictEqual(sight(id("coin_in")), { value: "true", basis_code: "camera" });
  strictEqual(sight(id("coin_out")).value, "false");
});

test("a cone of 360 and a camera with no cone both see the whole room", (t) => {
  for (const template of ["whole_camera", "camera"]) {
    const { id, sight } = open(t, template, null, [human("far", 100, 300)]);
    deepStrictEqual(sight(id("far")), { value: "true", basis_code: "camera" }, template);
  }
});

test("an event is seen if the subject stood in the cone before or after it: a walk in from outside is seen", (t) => {
  const { world, id } = open(t, "narrow_camera", 0, [human("walker", 100, 300)]);
  const terminal = id("ai");
  const walk: Result = world.command({ command_id: "walk-in", actor: id("walker"), verb: "move", args: { to: { x: 300, y: 100 } } }, { observe: false });
  strictEqual(walk.status, "ok");
  const moved = walk.events.find((event) => event.type === "moved");
  ok(moved !== undefined);
  deepStrictEqual(
    world.query({ kind: "perceive", observer: terminal, sense: "sight", event_id: moved.event_id }),
    { value: "true", basis_code: "camera" },
  );
});

test("a cone with no facing is a broken snapshot, refused when the world is made", (t) => {
  // The validation gate refuses it at creation, so no world holds a cone it cannot read.
  throws(() => open(t, "faceless_camera", null, [human("inside", 300, 100)]), /camera_without_facing/);
});

test("the author turns a camera, and a subject it did not see is seen", (t) => {
  const { world, id, sight } = open(t, "narrow_camera", 0, [human("late", 100, 300)]);
  strictEqual(sight(id("late")).value, "false");
  strictEqual(world.edit({ kind: "update_props", target: id("camera"), props: { facing_deg: 90 } }).status, "ok");
  deepStrictEqual(sight(id("late")), { value: "true", basis_code: "camera" });
});

test("an author's edit that leaves a narrow camera with no facing is refused camera_without_facing", (t) => {
  const { world, id } = open(t, "narrow_camera", 0, []);
  const camera = id("camera");
  const { facing_deg: _facing, ...props } = world.entity(camera)!.props;
  const result = world.edit({ kind: "set_props", target: camera, props });
  deepStrictEqual([result.status, result.reason_code], ["refused", "camera_without_facing"]);
  strictEqual(world.entity(camera)?.props.facing_deg, 0);
});
