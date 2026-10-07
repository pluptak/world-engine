import { closeSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { canonicalJson } from "../engine/canonical.js";
import { WorldError } from "../errors.js";

// Writers take turns. A world directory has no server, and the CLI is one process per request, so two
// callers at once are two writers on the same files. The turn is a file named `lock`, made with the
// exclusive flag (atomic across processes) and holding who made it and when. That clock is the one
// wall-clock reading in the store and it only judges a lock's age, never reaches the world.
//
// Whoever finds the file waits and tries again, up to a timeout, then fails `store_busy`. A lock whose
// process is gone, or that is older than a minute, was left by a crash and is taken over: the log is
// the truth, and what a crashed submit left half done is settled by the repair `load` already has.
export const LOCK_FILE = "lock";
const DEFAULT_TIMEOUT_MS = 5_000;
const STALE_AFTER_MS = 60_000;
const LONGEST_PAUSE_MS = 20;

interface Owner {
  pid: number;
  since_ms: number;
}

// The worlds this process holds. Everything is synchronous, so nothing else in the process can run
// between taking a turn and giving it back, and a call made while holding one (submit calls load)
// is already inside.
const held = new Set<string>();
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function timeoutMs(): number {
  const asked = Number(process.env.WORLD_LOCK_TIMEOUT_MS);
  return Number.isFinite(asked) && asked > 0 ? asked : DEFAULT_TIMEOUT_MS;
}

export function pause(ms: number): void {
  Atomics.wait(sleeper, 0, 0, ms);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // No permission to signal it still means it exists.
    return codeOf(error) === "EPERM";
  }
}

function readOwner(path: string): Owner | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Owner> | null;
    return typeof value?.pid === "number" && typeof value.since_ms === "number"
      ? { pid: value.pid, since_ms: value.since_ms }
      : null;
  } catch (error) {
    if (codeOf(error) === "ENOENT") {
      throw error;
    }
    // Empty or cut short: its maker is between creating it and writing it, or died there.
    return null;
  }
}

// A lock that cannot be read now belongs to somebody: only a lock that is gone, or provably
// left behind, is not.
function judge(path: string): "gone" | "stale" | "live" {
  try {
    const owner = readOwner(path);
    const since = owner === null ? statSync(path).mtimeMs : owner.since_ms;
    return (owner !== null && !alive(owner.pid)) || Date.now() - since > STALE_AFTER_MS ? "stale" : "live";
  } catch (error) {
    return codeOf(error) === "ENOENT" ? "gone" : "live";
  }
}

// What a crashed writer leaves besides the lock: temporaries named for its pid. Nobody else is
// writing, having just taken the turn.
function sweepTemporaries(dir: string): void {
  for (const folder of [dir, join(dir, "checkpoints")]) {
    let names: string[] = [];
    try {
      names = readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names.filter((entry) => entry.endsWith(".tmp"))) {
      try {
        unlinkSync(join(folder, name));
      } catch {
        // Someone else's sweep got there first.
      }
    }
  }
}

// True when the lock is gone and the turn can be tried for again. The file is renamed away, not
// deleted: of two waiters that judge the same lock stale only one rename finds it. A rename that
// caught a lock another waiter made in between is put back.
function takeOver(path: string): boolean {
  const verdict = judge(path);
  if (verdict !== "stale") {
    return verdict === "gone";
  }
  const grave = `${path}.stale-${process.pid}`;
  try {
    renameSync(path, grave);
  } catch (error) {
    return codeOf(error) === "ENOENT";
  }
  if (judge(grave) === "live") {
    try {
      renameSync(grave, path);
    } catch {
      // Taken again already; that holder's turn is the one at risk, and the repair on load covers it.
    }
    return false;
  }
  try {
    unlinkSync(grave);
  } catch {
    // Gone is gone.
  }
  sweepTemporaries(dirname(path));
  return true;
}

function create(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (error) {
    // A lock just given back can still be open in a waiter's hand, which Windows reports as EPERM.
    if (codeOf(error) === "EEXIST" || codeOf(error) === "EPERM" || codeOf(error) === "EACCES") {
      return false;
    }
    throw error;
  }
  try {
    writeSync(fd, canonicalJson({ pid: process.pid, since_ms: Date.now() } satisfies Owner));
  } catch (error) {
    closeSync(fd);
    unlinkSync(path);
    throw error;
  }
  closeSync(fd);
  return true;
}

function release(path: string): void {
  // Windows holds a file a reader has open until it lets go; a lock that cannot be removed stays
  // until its age says it was left behind, so ask a few times first.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      unlinkSync(path);
      return;
    } catch (error) {
      if (codeOf(error) === "ENOENT") {
        return;
      }
      pause(attempt + 1);
    }
  }
}

function acquire(path: string, dir: string): void {
  const deadline = Date.now() + timeoutMs();
  for (let wait = 1; ; wait = Math.min(wait * 2, LONGEST_PAUSE_MS)) {
    if (create(path) || (takeOver(path) && create(path))) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new WorldError("store_busy", `World at ${dir} is being written by another process`);
    }
    pause(wait);
  }
}

// Run `body` with this process's turn on the world at `dir`, which must exist. Re-entrant.
export function withLock<T>(dir: string, body: () => T): T {
  const key = resolve(dir);
  if (held.has(key)) {
    return body();
  }
  const path = join(dir, LOCK_FILE);
  acquire(path, dir);
  held.add(key);
  try {
    return body();
  } finally {
    held.delete(key);
    release(path);
  }
}
