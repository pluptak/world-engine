import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { VerbRegistry } from "../src/engine/command.js";
import { verbCatalog, verbRegistry } from "../src/engine/verbs/index.js";
import { VerbsResponseSchema } from "../src/contract.js";
import { createWorld, type Scenario } from "../src/index.js";
import { VERB_TABLE } from "./property-gen.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

test("every verb describes itself and the catalog is sorted", () => {
  const catalog = verbCatalog();
  ok(catalog.length > 0, "the catalog lists no verb");
  const names = catalog.map((entry) => entry.verb);
  deepStrictEqual(names, [...verbRegistry.keys()].sort());
  for (const entry of catalog) {
    ok(entry.args !== undefined, `${entry.verb} has no args shape`);
    ok(entry.refuses !== undefined, `${entry.verb} has no refusal codes`);
  }
});

test("every registered verb has a generator entry, and no entry is dead", () => {
  const registered = verbCatalog().map((entry) => entry.verb);
  const missing = registered.filter((verb) => VERB_TABLE[verb] === undefined);
  deepStrictEqual(missing, [], `no property generator entry for: ${missing.join(", ")}`);
  const dead = Object.keys(VERB_TABLE).filter((verb) => !registered.includes(verb));
  deepStrictEqual(dead, [], `property generator entries for unregistered verbs: ${dead.join(", ")}`);
});

test("the catalog reads the live declarations", () => {
  const catalog = verbCatalog();
  const take = catalog.find((entry) => entry.verb === "take");
  ok(take);
  deepStrictEqual(take.args, { part: { kind: "address" } });
  strictEqual(take.carry_alternatives.length, 2);
  ok(take.carry_alternatives.some((alternative) => alternative.capacity === "mouth_carry" && alternative.holds === 1));
  ok(take.refuses.includes("mouth_full"));
  ok(take.refuses.includes("hands_full"));

  const put = catalog.find((entry) => entry.verb === "put");
  ok(put);
  deepStrictEqual(put.args.relation, { kind: "enum", values: ["on", "in"] });
  deepStrictEqual(put.requires, [{ capacity: "manipulation", at_least: 50 }]);

  const attack = catalog.find((entry) => entry.verb === "attack");
  ok(attack);
  deepStrictEqual(attack.attack_modes[1], {
    capacity: "mouth_carry",
    at_least: 1,
    damage_prop: "bite_damage",
    crosses_gap: "body",
  });

  const move = catalog.find((entry) => entry.verb === "move");
  ok(move);
  deepStrictEqual(move.args.to, { kind: "pos" });
  deepStrictEqual(move.requires, []);
});

test("a verb without a description cannot be cataloged", () => {
  const undescribed = new Map([
    [
      "fly",
      {
        requires_target: false,
        preconditions: () => ({ status: "ok" }),
        transition: () => undefined,
      },
    ],
  ]);
  throws(
    () => verbCatalog(undescribed as unknown as VerbRegistry),
    /does not describe itself/,
  );
});

test("the CLI answers the verb catalog", () => {
  const cli = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ op: "verbs" }),
  });
  strictEqual(cli.status, 0, cli.stderr);
  const parsed = VerbsResponseSchema.parse(JSON.parse(cli.stdout));
  // The CLI reads the same registry through a Zod boundary, so its answer must be the catalog.
  const catalog = verbCatalog();
  strictEqual(parsed.verbs.length, catalog.length);
  deepStrictEqual(
    parsed.verbs.map((entry) => entry.verb),
    catalog.map((entry) => entry.verb),
  );
  ok(parsed.verbs.find((entry) => entry.verb === "give")?.refuses.includes("not_an_actor"));
});

test("mutating the catalog cannot change what a carrier can hold", (t) => {
  const mouth = verbCatalog()
    .find((entry) => entry.verb === "take")
    ?.carry_alternatives.find((alternative) => alternative.capacity === "mouth_carry");
  ok(mouth);
  mouth.holds = 99;

  const dir = mkdtempSync(join(tmpdir(), "world-engine-catalog-copy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scenario: Scenario = [
    { template: "room", overrides: { name: "room" } },
    { template: "dog", overrides: { name: "dog", location: "e1", support: "e1", pos: { x: 0, y: 0 } } },
    { template: "glass_shard", overrides: { name: "shard", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
    { template: "cup", overrides: { name: "cup", location: "e1", support: "e1", pos: { x: 40, y: 0 } } },
  ];
  const world = createWorld(dir, scenario);
  strictEqual(world.command({ command_id: "c1", actor: "e2", verb: "take", target: "shard" }).status, "ok");
  const second = world.command({ command_id: "c2", actor: "e2", verb: "take", target: "cup" });
  strictEqual(second.status, "refused");
  strictEqual(second.reason_code, "mouth_full");
});

test("a verb that cannot be judged without args says how options offer it, and one that can does not say so", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-engine-catalog-args-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const world = createWorld(dir, [
    { template: "room", overrides: { name: "room", props: { lit: true } } },
    { template: "human", overrides: { name: "ann", location: "e1", support: "e1", pos: { x: 0, y: 0 } } },
    { template: "stone", overrides: { name: "stone", location: "e1", support: "e1", pos: { x: 30, y: 0 } } },
  ]);
  for (const [name, verb] of verbRegistry) {
    if (verb.author_only === true) {
      continue;
    }
    const bare = world.check({ command_id: "bare", actor: "e2", verb: name, ...(verb.requires_target ? { target: "e3" } : {}) });
    const needsArgs = bare.reason_code === "invalid_args";
    strictEqual(verb.suggest !== undefined || verb.free_args === true, needsArgs, `${name} answers ${bare.reason_code ?? bare.status}`);
  }
});

test("docs/verbs.md has one bullet per registered verb and none for a missing one", () => {
  const text = readFileSync(join(root, "docs", "verbs.md"), "utf8");
  const documented = [...text.matchAll(/^- `([a-z_]+)`:/gm)].map((match) => match[1]);
  deepStrictEqual([...documented].sort(), verbCatalog().map((entry) => entry.verb));
});

test("each verb's index line links to the one family file that holds its rules", () => {
  const docs = join(root, "docs");
  const index = readFileSync(join(docs, "verbs.md"), "utf8");
  const linked = new Map(
    [...index.matchAll(/^- `([a-z_]+)`:.*\]\((verbs-[a-z]+\.md)\)\)\.$/gm)].map((match) => [match[1]!, match[2]!]),
  );
  const families = [...new Set(linked.values())].sort();
  const describedIn = new Map<string, string[]>();
  for (const family of families) {
    const text = readFileSync(join(docs, family), "utf8");
    for (const match of text.matchAll(/^- `([a-z_]+)`:/gm)) {
      describedIn.set(match[1]!, [...(describedIn.get(match[1]!) ?? []), family]);
    }
  }
  for (const { verb } of verbCatalog()) {
    deepStrictEqual(describedIn.get(verb), [linked.get(verb)], verb);
  }
  deepStrictEqual([...describedIn.keys()].sort(), verbCatalog().map((entry) => entry.verb));
});
