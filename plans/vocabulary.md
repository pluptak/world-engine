# Typed vocabulary in place of scattered strings

Date: 2026-10-14. The port kept TypeScript's stringly shape: about 3,600 snake_case literals in `src/` (675 distinct).
Nothing outside this repo uses the engine yet, so the wire format, the snapshot JSON and the template conventions may change
where that buys simpler code. A change that alters output regenerates its goldens from .NET in the same commit
(`WORLD_ENGINE_UPDATE_GOLDENS=1`), and the fixture diff is read like code. `tools/golden-gen/README.md` notes which goldens
are no longer TypeScript's.

## What stays a string

Declarations, where the string *is* the definition: JSON field names in `Checks.cs`, `TemplateShape.cs` and `EditParser.cs`;
template ids, entity names and other author data. Replacing those with constants only adds indirection.

## Blocks

All done. Left open, unplanned: a beat's condition, followers and repeat are still the JSON the author wrote, held to `Beats`'
shape rules where a beat is made or read. Typing them needs a converter for the condition's key-told forms and moves the
shape rules from the JSON onto the records; its action stays JSON, as it is an author's edit.

## Conventions (in place)

- A closed vocabulary is an enum, written in snake_case by `WorldJson`'s converter; `WorldJson.Name` gives the same name
  outside a record. `Truth` (an answer's value) and `HoldKind` are the first.
- A prop the engine reads is a `Prop<T>` descriptor in `Prop` (`Prop.cs`), which also builds the prop table. Reads are
  `props.Is(Prop.Open)` and `props.Get(Prop.LiquidAmount)` (`long?`); writes are `props.With(...)` and `Without(...)`, a copy
  for `Working.SetProps`. A props bag indexed by a literal key fails `PropTests`. A word that is also a reason code, an event
  type or a reason-data key (`"locked"`, `"lit"`, `"to"`) is that vocabulary's, not the prop's.
- Every machine code is a member of `Code` (`Model/Code.cs`): reason, basis, invariant and refused-input codes are one
  vocabulary, since an edit refuses with the invariant it would break. A new code is one member there. Where a status
  stands in for a missing code (`ambiguous`), `Pipeline.ReasonName` gives the string.
- A vocabulary a caller may extend stays a string with named constants: `Sense` (a request may name a sense the engine has
  no rule for, which answers `engine_incapable`), `Capacity` (a template's parts may contribute any) and `EventType` (a root
  event is named for its verb, and verbs are a registry). A verb's required capacity maps to its `insufficient_*` code in
  `Pipeline.Insufficient`, which `CatalogGoldenTests` holds to every verb's `refuses`.
- A scheduled cause is one record per kind (`CloseCause`, `BleedCause`, `ProcessCause`, `BeatCause`), told apart in JSON by
  `kind` (`CauseKind`); a stored cause of another kind does not read.
- A verb's declarations are typed. `VerbSpec` holds its `ArgSpec`s and `refuses`, and names the lists the engine itself
  uses for carrying and striking (`Carry.Alternatives`, `AttackVerb.Modes`) rather than a copy; its duration is a
  `VerbDuration` on the verb (one tick when absent), which the pipeline times commands by and the catalog writes.

## Out of this plan

Typing the whole `Entity.Props` bag as a record: templates declare props the engine never reads (`fields`), so the bag stays.
