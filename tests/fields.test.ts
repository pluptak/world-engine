// test-select: reads src/**/*.ts
import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ENTITY_FIELDS, PROP_FIELDS } from "../src/engine/fields.js";
import { loadTemplates, parseRegistry, templatesHash, type TemplateRegistry } from "../src/templates.js";

// One table says which props the engine reads, of what type, who may write them and what each needs
// beside it; a template that sets a prop outside it, or the wrong kind of value, is refused by name.

const root = fileURLToPath(new URL("../", import.meta.url));
const base: TemplateRegistry = loadTemplates(join(root, "templates"));

function withTemplate(template: Record<string, unknown>): () => TemplateRegistry {
  return () => parseRegistry({ ...base, odd: { id: "odd", extends: "stone", ...template } });
}

test("a template is refused for a prop no table declares, naming the template and the prop", () => {
  throws(withTemplate({ props: { openabel: true } }), /templates\.json#odd props\.openabel is not a declared prop/);
});

test("a template is refused for a value of the wrong type", () => {
  throws(withTemplate({ props: { barrier: true, gap_cm: "12" } }), /#odd props\.gap_cm must be an integer/);
  throws(withTemplate({ props: { reach_cm: 1.5 } }), /#odd props\.reach_cm must be an integer/);
  throws(withTemplate({ props: { surface: "yes" } }), /#odd props\.surface must be a boolean/);
  throws(withTemplate({ props: { liquid_material: 3 } }), /#odd props\.liquid_material must be a string/);
});

test("a template is refused for a prop without the props it requires", () => {
  throws(withTemplate({ props: { gap_cm: 12 } }), /#odd props\.gap_cm requires barrier/);
  throws(withTemplate({ props: { locked: true } }), /#odd props\.locked requires openable/);
  throws(withTemplate({ props: { container: true, inner_w_cm: 5 } }), /#odd props\.container requires inner_d_cm/);
  throws(withTemplate({ props: { fuel: 3 } }), /#odd props\.fuel requires light_source/);
});

test("a requirement may be met by a parent", () => {
  const resolved = parseRegistry({ ...base, cage: { id: "cage", extends: "bars", props: { gap_cm: 4 } } });
  strictEqual(resolved.cage?.props.gap_cm, 4);
});

test("a process may name only declared props, adjust only integers and set a value of the prop's type", () => {
  const grow = (prop: string) => [{ id: "grow", every_ticks: 1, effect: { adjust_prop: { prop, by: 1 } } }];
  throws(withTemplate({ processes: grow("size") }), /#odd processes\.grow names size, which is not a declared prop/);
  throws(
    withTemplate({ props: { light_source: true }, processes: grow("burning") }),
    /#odd processes\.grow adjusts burning, which is not an integer prop/,
  );
  throws(
    withTemplate({
      props: { light_source: true, fuel: 2 },
      processes: [
        {
          id: "burn",
          every_ticks: 1,
          effect: { adjust_prop: { prop: "fuel", by: -1, min: 0 } },
          then: { set_prop: { prop: "burning", value: "off" } },
        },
      ],
    }),
    /#odd processes\.burn sets burning to a value that is not boolean/,
  );
  throws(
    withTemplate({ fields: { size: { tier: "state", type: "integer" } }, processes: [{ ...grow("size")[0], every_ticks_prop: "pace" }] }),
    /names pace/,
  );
});

test("fields declare a template's own props, and are refused when malformed or the engine's", () => {
  const resolved = withTemplate({ props: { size: 1 }, fields: { size: { tier: "state", type: "integer" } } })();
  deepStrictEqual(resolved.odd?.fields, { size: { tier: "state", type: "integer" } });
  throws(withTemplate({ fields: { reach_cm: { tier: "definition", type: "integer" } } }), /#odd\.fields\.reach_cm is a prop the engine declares/);
  throws(withTemplate({ fields: { size: { tier: "derived", type: "integer" } } }), /#odd\.fields\.size\.tier must be definition or state/);
  throws(withTemplate({ fields: { size: { tier: "state", type: "id" } } }), /#odd\.fields\.size\.type must be boolean, integer or string/);
  throws(withTemplate({ fields: { size: { tier: "state", type: "integer", min: 0 } } }), /#odd\.fields\.size has unknown field min/);
  throws(
    withTemplate({ props: { size: "big" }, fields: { size: { tier: "state", type: "integer" } } }),
    /#odd props\.size must be an integer/,
  );
});

test("fields merge by name through extends, the child's own winning", () => {
  const resolved = parseRegistry({
    ...base,
    plant: { id: "plant", extends: "stone", props: { size: 1 }, fields: { size: { tier: "state", type: "integer" } } },
    vine: {
      id: "vine",
      extends: "plant",
      props: { reach: 2 },
      fields: { size: { tier: "definition", type: "integer" }, reach: { tier: "state", type: "integer" } },
    },
  });
  deepStrictEqual(resolved.vine?.fields, {
    size: { tier: "definition", type: "integer" },
    reach: { tier: "state", type: "integer" },
  });
  deepStrictEqual(resolved.plant?.fields, { size: { tier: "state", type: "integer" } });
});

test("every shipped template passes, and only human_hungry and experiment declare fields", () => {
  const declaring = Object.values(base).filter((template) => template.fields !== undefined).map((template) => template.id);
  deepStrictEqual(declaring.sort(), ["experiment", "human_hungry"]);
  deepStrictEqual(base.experiment?.fields, { stage: { tier: "state", type: "integer" } });
  deepStrictEqual(base.human_hungry?.fields, {
    hunger_every: { tier: "definition", type: "integer" },
    starvation: { tier: "state", type: "integer" },
  });
  strictEqual(Object.hasOwn(base.stone!, "fields"), false);
  strictEqual(templatesHash(parseRegistry(JSON.parse(JSON.stringify(base)))), templatesHash(base));
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

// Every way the source names a prop: `props.x`, `props["x"]`, a declaration's `prop: "x"` or
// `<kind>_prop: "x"`, and the bleed's `read("x")`.
const PROP_READS = [/props\??\.([a-z0-9_]+)/g, /props\["([a-z0-9_]+)"\]/g, /\b(?:[a-z_]+_)?prop: "([a-z0-9_]+)"/g, /\bread\("([a-z0-9_]+)"\)/g];

test("the table covers every prop the source reads, and lists none it does not", () => {
  const read = new Set<string>();
  let text = "";
  for (const path of sourceFiles(join(root, "src"))) {
    if (path.endsWith("fields.ts")) {
      continue;
    }
    const source = readFileSync(path, "utf8");
    text += source;
    for (const pattern of PROP_READS) {
      for (const match of source.matchAll(pattern)) {
        read.add(match[1]!);
      }
    }
  }
  const undeclared = [...read].filter((name) => !Object.hasOwn(PROP_FIELDS, name)).sort();
  deepStrictEqual(undeclared, [], `props read but not in PROP_FIELDS: ${undeclared.join(", ")}`);
  const dead = Object.keys(PROP_FIELDS).filter((name) => !read.has(name)).sort();
  deepStrictEqual(dead, [], `PROP_FIELDS entries no source reads: ${dead.join(", ")}`);
  ok(text.length > 0);
});

test("every entity field has a tier, and the tiers are the plan's", () => {
  deepStrictEqual(
    Object.entries(ENTITY_FIELDS).filter(([, tier]) => tier === "derived").map(([name]) => name).sort(),
    ["id", "location", "modifiers"],
  );
  strictEqual(ENTITY_FIELDS.template, "definition");
  for (const [name, field] of Object.entries(PROP_FIELDS)) {
    for (const required of field.requires ?? []) {
      ok(Object.hasOwn(PROP_FIELDS, required), `${name} requires ${required}, which the table does not declare`);
    }
  }
});
