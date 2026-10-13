// A scripted golden: a world driven through a sequence of calls on TypeScript's memory world, each call and its answer recorded as a row
// the .NET MemoryGoldenTests replay understands (`op`, `args`, `result`; the first row, `base`, carries the starting snapshot). The
// recorded answer is TypeScript's own result object, so the .NET side compares the whole of it, snapshot included.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, createWorld, memoryWorld, type World } from "../../../src/index.js";
import type { TemplateRegistry } from "../../../src/templates.js";

export interface Row {
  name: string;
  op: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export class Script {
  readonly rows: Row[] = [];
  readonly world: World;
  readonly ids: Record<string, string> = {};
  private edits = 0;

  // `scene` is a scenario's entity list, built once through createWorld so its ids and templates hash are the real ones.
  constructor(scene: unknown, registry: TemplateRegistry, names: string[]) {
    const built = createWorld(join(mkdtempSync(join(tmpdir(), "script-")), "w"), scene as never, registry);
    for (const name of names) {
      this.ids[name] = built.id(name)!;
    }
    const snapshot = built.snapshot();
    this.rows.push({ name: "base", op: "base", args: { snapshot } });
    this.world = memoryWorld(snapshot, registry);
  }

  edit(name: string, edit: Record<string, unknown>, commandId?: string): any {
    const id = commandId ?? `script-${(this.edits += 1)}`;
    const result = this.world.edit(edit as never, { command_id: id });
    this.rows.push({ name, op: "edit", args: { edit, command_id: id }, result });
    return result;
  }

  command(name: string, command: Record<string, unknown>): any {
    const result = this.world.command(command as never);
    this.rows.push({ name, op: "command", args: { command }, result });
    return result;
  }

  snapshot(name: string): void {
    this.rows.push({ name, op: "snapshot", args: {}, result: this.world.snapshot() });
  }

  save(file: string): void {
    writeFileSync(file, canonicalJson(this.rows) + "\n");
  }
}

// Writes the templates a script's registry adds to (or changes in) the shipped set as files, each with its nearest ancestor named, so
// a .NET registry resolved from the shipped files plus these has the same lineage.
export function exportExtras(registry: TemplateRegistry, shipped: TemplateRegistry, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const [id, template] of Object.entries(registry)) {
    if (shipped[id] !== undefined && canonicalJson(shipped[id]) === canonicalJson(template)) {
      continue;
    }
    const { lineage, extends: _extends, ...declared } = template as Record<string, unknown>;
    const parent = id.includes(".") ? undefined : (lineage as string[] | undefined)?.[0];
    const written = parent === undefined ? declared : { id: declared.id, extends: parent, ...declared };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(written, null, 2) + "\n");
  }
}
