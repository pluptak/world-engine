// The helpers every test file shares: a world directory that cleans itself up, and the deep freeze
// engine tests put their input snapshots under, so a verb that mutates its input fails loudly.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDir(t: { after(callback: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
