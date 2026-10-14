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
2. **Goldens compare meaning, not bytes.** They were built to prove the port reproduced TypeScript byte for byte; that
   job is done, and now they pin the encoding (null against absent, key presence, file sizes in `head.json`, hashes of
   canonical bytes), so a harmless rule moved 59 tests. One shared comparison reads both sides as values (key order and a
   null member against an absent one do not count) and names the path of the first difference. The store's files compare
   line by line as values, and `head.json` is checked against the files on disk rather than recorded sizes. The hashed
   goldens (verb matrix, property trace) hash the normalized form, regenerated once. Bytes are checked only where they are
   the contract, against the engine itself: the same commands written twice are the same files, `verify` reproduces them,
   and the canonical writer's own tests. `GoldenUpdate` stays for a change that moves meaning. Done: `Meaning` (tests) holds the
   comparison, the store harnesses use `Meaning.SameTree`, and the acceptance replay and the hashed goldens regenerate.
3. **No null.** Done. `CanonicalJson` writes through `Value`, so a null member is never written and the
   `JsonIgnoreCondition.Never` fields are gone; `Pipeline.Apply` drops null members from a command's args, so a live world
   and its replay read the same request. What null used to say has its own form: an edit empties a field by naming it in
   `clear` (`place`, a `spawn`'s overrides), and an observed entity lists the relations it may not show in `hidden`, so
   "not shown" is never read as "none". A spawned entity no longer records a delta for a field it leaves empty, a null
   arg reads as absent (`consume` with `amount: null` eats it all), and the fixture worlds were rewritten without nulls.
4. **The model holds `Value`.** Done. Entity and resolved template props, event data, `reason_data`, a command's args, a
   delta's `from`/`to`, a process's `while` and `set_prop` values, a beat condition's value and a run's slots are `Value`
   (`Value.Map` reads as a dictionary); `Prop<T>`, `Pipeline.Reason` and `Working` changed under the verbs, and a delta's
   field is read through `ValueJson.Of`. A fraction in args is refused by the contract (`Shape.Args`) and never reaches a
   verb; the six golden rows that had a verb refuse one moved to `ChecksTests` and `EditTests`. Props are walked in key
   order, so a template with several bad props names the first by key (three template-fuzz cases). The edit parser still
   reads `args.edit` as JSON through a bridge until block 6. 39 Core files no longer import `System.Text.Json`.
5. **Reads answer in records.** Done. An observation, an observed entity and its facts, a sensed event, an inspection, a
   body's parts and a level are records of `Projection`; the actor view answers `ActorObservation`, `ActorVerdict` and
   `ActorOptions`, a player handle `PlayerWorld.Answer` and `Move`, `close_rounds` `DirectorWorld.QuietRounds`, and the
   verb catalog `VerbRegistry.CatalogEntry`. Options and a verb's suggestions hold args as `Value.Map`, and a query's
   property match reads a `Value`. The CLI and the tests encode a record once (`WorldJson.Node`); no golden moved.
   `IWorld.Edit` still takes the edit's JSON until block 6. 27 Core files still import `System.Text.Json`.
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
