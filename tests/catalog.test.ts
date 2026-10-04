import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { VerbRegistry } from "../src/engine/command.js";
import { verbCatalog } from "../src/engine/verbs/index.js";
import { VerbsResponseSchema } from "../src/contract.js";
import { createWorld, type Scenario } from "../src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

test("every verb describes itself and the catalog is sorted", () => {
  const catalog = verbCatalog();
  strictEqual(catalog.length, 14);
  const names = catalog.map((entry) => entry.verb);
  deepStrictEqual(names, [...names].sort());
  for (const entry of catalog) {
    ok(entry.args !== undefined, `${entry.verb} has no args shape`);
    ok(entry.refuses !== undefined, `${entry.verb} has no refusal codes`);
  }
});

test("the catalog reads the live declarations", () => {
  const catalog = verbCatalog();
  const take = catalog.find((entry) => entry.verb === "take");
  ok(take);
  deepStrictEqual(take.args, {});
  strictEqual(take.carry_alternatives.length, 2);
  ok(take.carry_alternatives.some((alternative) => alternative.capacity === "mouth_carry" && alternative.holds === 1));
  ok(take.refuses.includes("mouth_full"));

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
  strictEqual(parsed.verbs.length, 14);
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
