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

Each block is independently pausable and ends with `dotnet test WorldEngine.slnx` green.

1. **Codes.** `ReasonCode` and `BasisCode` enums (`WorldJson` names enum members in snake_case, so they need no
   attributes). `VerbSpec.Refuses` is a `ReasonCode` list, `Attempt.ReasonCode`, `WorldError.Code` and
   `Answer.BasisCode` are typed, and the runtime check that a refusal is declared by its verb stays. Schedule cause kinds, capacity names the engine reads, and event types the
   engine compares become enums or constants in the same pass.
2. **Typed verb specs.** `VerbSpec` holds records, not JSON text: `Args` as a map of `ArgSpec`, `Duration`,
   `CarryAlternative`, `AttackMode`. The catalog serializes them; its golden is regenerated.
3. **Scheduled causes as types.** `ScheduledCause` splits into `CloseCause`, `BleedCause`, `ProcessCause` and `BeatCause`
   (polymorphic on `kind`), with the beat's action, condition and followers as records instead of `JsonNode`. The
   kind-by-kind checks in `SnapshotValidation` and the `JsonNode` walking in `BeatConditions` go.

## Conventions (in place)

- A closed vocabulary is an enum, written in snake_case by `WorldJson`'s converter; `WorldJson.Name` gives the same name
  outside a record. `Truth` (an answer's value) and `HoldKind` are the first.
- A prop the engine reads is a `Prop<T>` descriptor in `Prop` (`Prop.cs`), which also builds the prop table. Reads are
  `props.Is(Prop.Open)` and `props.Get(Prop.LiquidAmount)` (`long?`); writes are `props.With(...)` and `Without(...)`, a copy
  for `Working.SetProps`. A props bag indexed by a literal key fails `PropTests`. A word that is also a reason code, an event
  type or a reason-data key (`"locked"`, `"lit"`, `"to"`) is that vocabulary's, not the prop's.
- A vocabulary a caller may extend stays a string with named constants and one list: `Sense` (a request may name a sense the
  engine has no rule for, which answers `engine_incapable`).

## Out of this plan

Typing the whole `Entity.Props` bag as a record: templates declare props the engine never reads (`fields`), so the bag stays.
