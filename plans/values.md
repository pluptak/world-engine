# The engine's own value type in place of JSON nodes

Date: 2026-10-14. JSON is the engine's value type, not only its file format: `System.Text.Json` is imported by 78 of the 107
files in `WorldEngine.Core` (about 600 uses of `JsonNode`, `JsonObject`, `JsonArray`, `JsonValue`), and the world facade
answers in `JsonObject`. `JsonNode` is mutable and belongs to one parent (50 `DeepClone` calls), has no structural equality
(`DeepEquals`, or comparing serialized text), and takes any number until `CanonicalJson` refuses it on the way out.

The goal: `System.Text.Json` only in `Core/Json` (the codec), the store and the CLI. The engine reads and writes its own
`Value`; JSON is one encoding of it. Another format is then one class (text to `Value` and back), and nothing past it
changes.

Nothing outside this repo uses the engine, so output may change wherever that makes the code simpler. A block that changes
output regenerates its goldens from .NET (`WORLD_ENGINE_UPDATE_GOLDENS=1`) in the same commit, the fixture diff is read
like code, and `tools/golden-gen/README.md` notes which goldens are no longer TypeScript's.

## What stays

- Stored files stay canonical JSON, for the engine's own sake rather than for old worlds: `head.json` holds byte sizes,
  repair works by byte offset, `verify` names the first differing byte, and `templates_hash` is SHA-256 of the canonical
  bytes of the resolved set. Canonical JSON becomes the definition of a `Value`'s bytes, not a property of the model.
- Determinism: the same snapshot and command still give the same bytes.

## `Value`

A closed, immutable set of records (`Model/Value.cs`): `Bool`, `Int` (`long`), `Text`, `List`, `Map`. A map's keys are kept
in ordinal order and lists and maps compare by content, so equality is structural.

- **No null.** An absent field and a null one are the same: maps hold no null entries, and the writer leaves null fields out
  everywhere, so the 14 `JsonIgnoreCondition.Never` fields go (an entity with no `contained_in` simply has none; block 3). A delta
  that clears a field has no `to`; one that sets it has no `from`.
- **No fractions.** A number that is not a whole `long` is refused where text is read, as an invalid request, rather than
  carried to the verb to be refused `invalid_args`. `Integers`' range checks move to the reader.

## Blocks

1. **`Value` and its codec.** Done: `Model/Value.cs`, `Json/ValueJson.cs` (registered in `WorldJson.Options`, reading a
   null member as absent and refusing a fraction or a null in a list), `CanonicalJson.Serialize(Value)`. No output moved.
2. **Every golden regenerates from .NET.** Only 8 golden tests take `WORLD_ENGINE_UPDATE_GOLDENS`; about 20 others
   (the CLI rows, init and restart, the store's files and `head.json`, stale, upgrade, trace, read-only rows, scenes, the
   `acceptance` replay) compare against TypeScript's recording with no way to rewrite it, and the stored fixture worlds
   carry a `templates_hash`. Each takes the switch through `GoldenUpdate`, so a block that moves output rewrites its
   goldens in one run. Found by trying the null rule in block 1: it moved 59 tests, 25 of which nothing could regenerate.
3. **No null on the way out.** `CanonicalJson` writes through `Value`, so null members are left out everywhere and the
   `JsonIgnoreCondition.Never` fields go; readers that demanded a key be present (a resolved part's `parent`, an event
   line's `cause_id`) stop doing so. The template hash moves with the templates' bytes.
4. **The model holds `Value`.** `Entity.Props` and a template's `Props`, `WorldEvent.Data`, `Command.Args`, `ReasonData`,
   `Delta.From`/`To`, `Run.Slots`. `Prop<T>`, `Pipeline.Reason` and `Working` change under the verbs; `Working` detects a
   no-op by `Value` equality, and the codec turns a field's record into a `Value` for its delta. Verb code that reads args
   or data directly reads `Value` patterns (`args["amount"] is Value.Int(var n)`). Fractions are refused at the reader.
5. **Reads answer in records.** `Projection`, `WorldReads`, `ActorWorld`, `PlayerWorld`, `DirectorWorld`, `Options` and
   `Trace` build typed records, as `Catalog` does, and `IWorld`/`IWorldReads` carry no `JsonObject`. A response whose
   shape only mirrored TypeScript's construction may take the record's plainer shape.
6. **Requests and edits are typed.** `Contract/Shape.cs` checks a `Value`; `EditParser` turns it into the `WorldEdit`
   records it already builds, and `IWorld.Edit` takes those. A beat's action is stored as its `WorldEdit` (or a sound), not
   as the edit's JSON, so `BeatShape` stops re-checking stored actions. An edit that clears a field (`Given<T>` with no
   value) needs its own form, since a null is no longer one.
7. **Templates and scenes are read from `Value`.** `TemplateShape`, `TemplateResolver`, `SceneBuilder`,
   `ScenarioResolver`, `Forms`, `Refine`, `Upgrade`.
8. **The store and the CLI encode only through the codec.** Log, head, checkpoint and pending lines become records; the
   CLI parses its request once and writes its answer once. A test fails on `System.Text.Json` anywhere in Core outside
   `Json/`, or in Contract; AGENTS.md gains the invariant.

Each block leaves the suite green and may keep a bridge at its border for the blocks still to come; block 8 removes the
last one. Blocks 4 and 5 are the large ones (about 300 references each).

## Out of this plan

A second encoding (YAML, MessagePack): once block 8 is in, it is one class and needs no plan of its own. Typing the props bag
as a record stays out, for the reason in `plans/vocabulary.md`.
