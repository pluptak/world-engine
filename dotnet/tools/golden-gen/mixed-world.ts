// The mixed run of tests/verify.test.ts, shared by the goldens that damage or change a stored world: the scene, the registry (the shipped
// templates with a `hush` prop declared on the room), the steps, and what is observed of a world's files.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, openWorld, verifyWorld, type World } from "../../../src/index.js";
import { loadTemplates, parseRegistry } from "../../../src/templates.js";

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const fixtures = join(root, "dotnet/tests/WorldEngine.Tests/Fixtures");
export const shipped = loadTemplates(join(root, "templates"));
export const registry = parseRegistry({ ...shipped, room: { ...shipped.room!, fields: { hush: { tier: "state", type: "boolean" } } } });

export const scene = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "table", template: "table", overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } } },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "table" } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: -50, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "room", support: "room", pos: { x: 400, y: 0 } } },
];

export type Step = { command: Record<string, unknown>; basedOn?: number } | { edit: Record<string, unknown> };

// Every kind of submission and an edit, then `waits` accepted waits and one more refusal.
export function steps(world: World, waits = 260): Step[] {
  const ann = world.id("ann")!;
  const bob = world.id("bob")!;
  const room = world.id("room")!;
  const list: Step[] = [
    { command: { command_id: "push", actor: ann, verb: "push", target: "table" } },
    { command: { command_id: "late-take", actor: ann, verb: "take", target: "bottle" }, basedOn: 0 },
    { command: { command_id: "far-take", actor: bob, verb: "take", target: "bottle" } },
    { command: { command_id: "fly", actor: ann, verb: "fly" } },
    { command: { command_id: "ghost", actor: ann, verb: "take", target: "ghost" } },
    { edit: { kind: "set_props", target: room, props: { ...world.entity(room)!.props, hush: true } } },
  ];
  for (let index = 0; index < waits; index += 1) {
    list.push({ command: { command_id: `rest-${index}`, actor: ann, verb: "wait", args: { ticks: 1 } } });
  }
  list.push({ command: { command_id: "late-far", actor: bob, verb: "take", target: "bottle" } });
  return list;
}

// Builds the run in `dir` and returns the steps it took.
export function build(dir: string, waits = 260): Step[] {
  const world = createWorld(dir, scene as never, registry);
  const list = steps(world, waits);
  for (const step of list) {
    if ("edit" in step) {
      world.edit(step.edit as never);
    } else {
      world.command(step.command as never, step.basedOn === undefined ? undefined : { basedOn: step.basedOn });
    }
  }
  return list;
}

export const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export function files(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      Object.assign(out, files(path, `${prefix}${name}/`));
    } else {
      out[`${prefix}${name}`] = hash(readFileSync(path));
    }
  }
  return out;
}

const codeOf = (error: unknown) => (error as { code?: string }).code ?? "error";

// What `verify`, opening and `verify` again say about a world's files, and the hash of each file after.
export function observe(dir: string) {
  const verifyOf = () => {
    try {
      return verifyWorld(dir);
    } catch (error) {
      return { error: codeOf(error) };
    }
  };
  const first = verifyOf();
  let opened: unknown;
  try {
    opened = { snapshot: hash(canonicalJson(openWorld(dir).snapshot())) };
  } catch (error) {
    opened = { error: codeOf(error) };
  }
  return { verify: first, open: opened, verify_after: verifyOf(), files: files(dir) };
}
