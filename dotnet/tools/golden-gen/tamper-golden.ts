// A stored world tampered with, byte by byte, as a golden: the mixed run of tests/verify.test.ts is built (every kind of submission, an
// edit, 260 waits past the checkpoint at 256), then each case damages one file in one way (a line dropped, doubled or swapped, the file
// cut or emptied or gone, a byte flipped, text appended) and records what TypeScript says: `verify`, what opening the world does (the
// snapshot it settles to, or the error), `verify` again, and the hash of every file afterwards. Writes
// Fixtures/tamper-golden.expected.json, whose cases the .NET suite applies to its own copy of the same world.
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, createWorld, openWorld, verifyWorld, type World } from "../../../src/index.js";
import { loadTemplates, parseRegistry } from "../../../src/templates.js";
import { exportExtras } from "./scripted.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtures = join(root, "dotnet/tests/WorldEngine.Tests/Fixtures");
const shipped = loadTemplates(join(root, "templates"));
const registry = parseRegistry({ ...shipped, room: { ...shipped.room!, fields: { hush: { tier: "state", type: "boolean" } } } });
exportExtras(registry, shipped, join(fixtures, "tamper-templates"));

const scene = [
  { id: "room", template: "room", overrides: { name: "room", props: { lit: true } } },
  { id: "table", template: "table", overrides: { name: "table", location: "room", support: "room", pos: { x: 30, y: 0 } } },
  { id: "bottle", template: "bottle", overrides: { name: "bottle", location: "room", support: "table" } },
  { id: "ann", template: "human", overrides: { name: "ann", location: "room", support: "room", pos: { x: -50, y: 0 } } },
  { id: "bob", template: "human", overrides: { name: "bob", location: "room", support: "room", pos: { x: 400, y: 0 } } },
];

type Step = { command: Record<string, unknown>; basedOn?: number } | { edit: Record<string, unknown> };
function steps(world: World): Step[] {
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
  for (let index = 0; index < 260; index += 1) {
    list.push({ command: { command_id: `rest-${index}`, actor: ann, verb: "wait", args: { ticks: 1 } } });
  }
  list.push({ command: { command_id: "late-far", actor: bob, verb: "take", target: "bottle" } });
  return list;
}

const base = mkdtempSync(join(tmpdir(), "tamper-"));
const world = createWorld(join(base, "w"), scene as never, registry);
const list = steps(world);
for (const step of list) {
  if ("edit" in step) {
    world.edit(step.edit as never);
  } else {
    world.command(step.command as never, step.basedOn === undefined ? undefined : { basedOn: step.basedOn });
  }
}
const pristine = join(base, "w");

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function files(dir: string, prefix = ""): Record<string, string> {
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

type Op = { op: string; n?: number; text?: string };
function tamper(dir: string, file: string, op: Op): void {
  const path = join(dir, file);
  if (op.op === "delete_file") {
    rmSync(path);
    return;
  }
  let bytes = readFileSync(path);
  const lines = (): Buffer[] => {
    const out: Buffer[] = [];
    let from = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] === 10) {
        out.push(bytes.subarray(from, i + 1));
        from = i + 1;
      }
    }
    if (from < bytes.length) {
      out.push(bytes.subarray(from));
    }
    return out;
  };
  switch (op.op) {
    case "empty":
      bytes = Buffer.alloc(0);
      break;
    case "delete_line": {
      const all = lines();
      all.splice(op.n!, 1);
      bytes = Buffer.concat(all);
      break;
    }
    case "dup_line": {
      const all = lines();
      all.splice(op.n!, 0, all[op.n!]!);
      bytes = Buffer.concat(all);
      break;
    }
    case "swap_lines": {
      const all = lines();
      [all[op.n!], all[op.n! + 1]] = [all[op.n! + 1]!, all[op.n!]!];
      bytes = Buffer.concat(all);
      break;
    }
    case "truncate": {
      bytes = bytes.subarray(0, op.n! < 0 ? bytes.length + op.n! : op.n!);
      break;
    }
    case "flip_byte": {
      const at = op.n! < 0 ? bytes.length + op.n! : op.n!;
      bytes = Buffer.from(bytes);
      bytes[at] = bytes[at]! ^ 1;
      break;
    }
    case "append":
      bytes = Buffer.concat([bytes, Buffer.from(op.text!)]);
      break;
    default:
      throw new Error(op.op);
  }
  writeFileSync(path, bytes);
}

const observe = (dir: string) => {
  const verifyOf = () => {
    try {
      return verifyWorld(dir);
    } catch (error) {
      return { error: (error as { code?: string }).code ?? "error" };
    }
  };
  const first = verifyOf();
  let opened: unknown;
  try {
    opened = { snapshot: hash(canonicalJson(openWorld(dir).snapshot())) };
  } catch (error) {
    opened = { error: (error as { code?: string }).code ?? "error" };
  }
  return { verify: first, open: opened, verify_after: verifyOf(), files: files(dir) };
};

const targets = ["log.jsonl", "events.jsonl", "deltas.jsonl", "snapshot.json", "head.json", "initial.json", "templates.json"];
for (const name of readdirSync(join(pristine, "checkpoints"))) {
  targets.push(`checkpoints/${name}`);
}
const cases: { name: string; file: string; op: Op; observed: unknown }[] = [];
let count = 0;
for (const file of targets) {
  const bytes = readFileSync(join(pristine, file));
  const lineCount = bytes.toString("utf8").split("\n").length - 1;
  const ops: Op[] = [{ op: "empty" }, { op: "delete_file" }, { op: "append", text: '{"x":1}\n' }, { op: "append", text: "garbage" }];
  for (const n of [-1, -20, Math.floor(bytes.length / 2)]) {
    ops.push({ op: "truncate", n });
  }
  for (const n of [0, 10, Math.floor(bytes.length / 2), -2]) {
    // Not recorded for initial.json at its middle: the flip renames a key ("residue" to "reridue"), which TypeScript's reader ignores
    // and .NET's refuses as an unknown field (see plans/ts-sunset.md, deliberate deviations).
    if (file === "initial.json" && n === Math.floor(bytes.length / 2)) {
      continue;
    }
    ops.push({ op: "flip_byte", n });
  }
  for (const n of [0, 1, 4, 5, Math.floor(lineCount / 2), lineCount - 1]) {
    if (n >= 0 && n < lineCount) {
      ops.push({ op: "delete_line", n }, { op: "dup_line", n });
      if (n + 1 < lineCount) {
        ops.push({ op: "swap_lines", n });
      }
    }
  }
  for (const op of ops) {
    count += 1;
    const dir = join(base, `c${count}`);
    cpSync(pristine, dir, { recursive: true });
    tamper(dir, file, op);
    cases.push({ name: `${file} ${op.op} ${op.n ?? ""}${op.text === undefined ? "" : JSON.stringify(op.text)}`.trim(), file, op, observed: observe(dir) });
    rmSync(dir, { recursive: true, force: true });
  }
}
// The pristine world as well: verify, and the files as built.
const golden = { scene, steps: list, pristine: observe(pristine), cases };
writeFileSync(join(fixtures, "tamper-golden.expected.json"), canonicalJson(golden) + "\n");
rmSync(base, { recursive: true, force: true });
console.log(`wrote ${cases.length} cases`);
void existsSync;
