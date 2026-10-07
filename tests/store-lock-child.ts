import { existsSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { openWorld } from "../src/index.js";
import { withWorldLock } from "../src/store/file-store.js";

// The other process in tests/store-lock.test.ts. It is not a test itself: the runner only globs
// *.test.ts.
//
//   commands <dir> <who> <n>   n alternating take and drop of the world's stone, as ann
//   edits <dir> <who> <n>      n author edits with default ids
//   reads <dir> <who> <n>      n fresh opens and snapshots, holding no turn
//   hold <dir> <ms> [repair]   take the turn, say so, keep it for ms, say whether the head was
//                              still missing; with repair, then open the world (which rebuilds
//                              the head, under the turn it already holds) and say the head's time

const [mode, dir, third, fourth] = process.argv.slice(2) as [string, string, string, string?];

function say(line: string): void {
  // Written straight to the descriptor: the parent waits for this line while this process sleeps.
  writeSync(1, `${line}\n`);
}

if (mode === "reads") {
  for (let i = 0; i < Number(fourth); i += 1) {
    openWorld(dir).snapshot();
  }
} else if (mode === "commands" || mode === "edits") {
  const world = openWorld(dir);
  const ann = world.id("ann")!;
  const stone = world.id("stone")!;
  for (let i = 0; i < Number(fourth); i += 1) {
    if (mode === "commands") {
      world.command({ command_id: `${third}-${i}`, actor: ann, verb: i % 2 === 0 ? "take" : "drop", target: "stone" });
    } else {
      world.edit({ kind: "set_props", target: stone, props: { ...world.entity(stone)!.props, mark: `${third}-${i}` } });
    }
  }
} else if (mode === "hold") {
  withWorldLock(dir, () => {
    say("locked");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(third));
    say(`head_missing=${!existsSync(join(dir, "head.json"))}`);
    if (fourth === "repair") {
      openWorld(dir);
      say(`head_mtime=${statSync(join(dir, "head.json")).mtimeMs}`);
    }
  });
} else {
  throw new Error(`unknown mode ${mode}`);
}
