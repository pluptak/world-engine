import { strictEqual } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, createWorld, type Scenario } from "../src/index.js";
import { cachedWorldCounts, load, readDeltas, readEvents } from "../src/store/file-store.js";
import { tempDir } from "./harness.js";

// A long-lived process bounds what it keeps of each world: the parsed lines of `events.jsonl`
// and `deltas.jsonl` and the head of `initial.json` keep the 8 most recently used worlds, by
// directory. A dropped world reads again from its files on its next use, answering as before.
const scenario: Scenario = [
  { template: "room", overrides: { name: "room", props: { lit: true } } },
  {
    template: "human",
    overrides: { name: "actor", location: "e1", support: "e1", pos: { x: 0, y: 0 } },
  },
];

test("the caches keep 8 worlds, and a dropped world reads the same answers again", (t) => {
  const root = tempDir(t);
  const dirs = Array.from({ length: 10 }, (_, i) => join(root, `w${i}`));
  for (const [i, dir] of dirs.entries()) {
    createWorld(dir, { seed: i + 1, entities: scenario });
  }
  const read = (dir: string): string =>
    canonicalJson({ snapshot: load(dir), events: readEvents(dir), deltas: readDeltas(dir) });
  const first = dirs.map(read);
  const counts = cachedWorldCounts();
  strictEqual(counts.lineCaches <= 8, true, `line caches hold ${counts.lineCaches} worlds`);
  strictEqual(counts.initialMeta <= 8, true, `initial meta holds ${counts.initialMeta} worlds`);
  // The first worlds read are not among the 8 kept, so this re-reads them from their files.
  for (const [i, dir] of dirs.entries()) {
    strictEqual(read(dir), first[i]);
  }
  const after = cachedWorldCounts();
  strictEqual(after.lineCaches <= 8, true, `line caches hold ${after.lineCaches} worlds`);
  strictEqual(after.initialMeta <= 8, true, `initial meta holds ${after.initialMeta} worlds`);
});
