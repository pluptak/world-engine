import { strictEqual } from "node:assert";
import { test } from "node:test";
import { canonicalJson, memoryWorld } from "../src/index.js";
import type { TemplateRegistry } from "../src/templates.js";
import { buildInitial } from "./property-gen.js";
import { registry, runSequence } from "./property-run.js";

// Structure no command reaches leaves no trace: the same sequences against a set whose bodies declare
// extra latent parts (contributing nothing, never a default hit part, so only a command naming one
// could reach it, and the generator names only the parts of the set on disk) give byte-identical
// snapshots and events, the template hash aside.
test("latent structure nothing touches changes nothing", () => {
  const latent = (template: string, parent: string, name: string) => {
    const base = registry[template]!;
    return {
      ...base,
      parts: [...base.parts, { name, parent, contributes: {}, detachable: false, max_integrity: 10 }],
    };
  };
  const enriched: TemplateRegistry = {
    ...registry,
    human: latent("human", "head", "hair"),
    dog: latent("dog", "head", "whiskers"),
    chair: latent("chair", "seat", "cushion"),
  };
  // The deeper set is the one the world answers from: the hair is there to ask about.
  const initial = buildInitial(enriched);
  const human = Object.values(initial.entities).find((entity) => entity.template === "human")!;
  const hair = { kind: "fact" as const, subject: `${human.id}.hair`, relation: "status" };
  strictEqual(memoryWorld(initial, enriched).query(hair).value, "true");
  strictEqual(memoryWorld(buildInitial(registry), registry).query(hair).basis_code, "no_such_part");
  const unhashed = (snapshot: string) => canonicalJson({ ...(JSON.parse(snapshot) as object), templates_hash: "" });
  for (let seed = 0; seed < 100; seed += 1) {
    const plain = runSequence(memoryWorld(buildInitial(registry), registry), seed, 30);
    const deeper = runSequence(memoryWorld(buildInitial(enriched), enriched), seed, 30);
    strictEqual(deeper.events, plain.events, `seed ${seed}`);
    strictEqual(unhashed(deeper.snapshot), unhashed(plain.snapshot), `seed ${seed}`);
  }
});
