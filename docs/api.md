# The library API

A world is an `IWorld` (`Core/Engine/Worlds/IWorld.cs`): `StoreWorld.Open(dir)` opens a stored one
([persistence.md](persistence.md)), which `WorldBuilder.Snapshot(scenario, registry, coverage?)` and
`WorldBuilder.Create(dir, …)` make from a scenario ([scenario.md](scenario.md)); `new
MemoryWorld(snapshot, registry, templatesHash, names?)` holds one in memory ([fork.md](fork.md)).

Both answer `Apply` (a command), `Edit`, `Check`, `OptionsFor`, `Since`, `Attempts`, `TraceOf`,
`Scheduled` ([schedule-api.md](schedule-api.md)), `Beat`, `TakeRound` ([rounds.md](rounds.md)),
`QueryFact`, `QueryPerceive`, `Observe` and `Inspect` ([projection.md](projection.md)),
`CurrentSnapshot`, `EntityOf`, `CatalogEntries` ([catalog.md](catalog.md)), `Id` and `Verify`.
`WorldUpgrade.UpgradeTemplates` moves a stored world to a new set. `VerbRegistry.Catalog()` is the
verb catalog and `Capabilities` what the engine computes; the CLI answers both (`op` `verbs`,
`capabilities`), and each other op is one of the calls above (`CliRunner`).

**The CLI checks a request before it runs it.** Each op has a shape (`Checks` in
`WorldEngine.Contract`): its members, their types, no member beyond them. A request that does not
fit is answered `{ status: "invalid", issues }` with `invalid_request` and exit code 2, and nothing
is run for it. A request, a scenario file and a coverage file are read as values first: every
number is whole, a null member is the same as an absent one, and a null in a list or a fraction
anywhere (an edit or a scenario's `fuel_pct` included) does not fit. Otherwise the inside of an
edit, `args` or a prop is read by the engine, which refuses with its own codes. Store worlds share
a directory, so handles see each other; memory worlds hold their own. A missing directory, a
changed hash, or a bad version is a `WorldError` with a code.

- `Beat` runs commands in array order against one shared base, one log line each, each with its
  status, so a command an earlier one made fail is `preempted`.
- `TraceOf` follows `cause_id` root-first from an event, or from the last delta of an entity field,
  else its spawn; an initial entity's field has an empty chain, and a memory world answers
  `history_unavailable` for what predates it.
- `perceivers: true` on a command or edit names who sensed each of its events.
- `WorldBuilder.Snapshot` and `init` take an optional coverage, which the world's initial snapshot
  declares in place of `WorldBuilder.DefaultCoverage`; a category it leaves out answers `unknown`.
  A scene's `seed` seeds the world's dice; without one anything that rolls is refused `no_seed`
  ([rng.md](rng.md)).
- `StoreWorld.Open`'s `snapshotEvery` and `checkpointEvery` set how often this handle writes
  `snapshot.json` (default 32) and a checkpoint (default 256). Nothing stores them.
- `WorldBuilder.Restart(from, to)` makes a world at `to` from `from`'s `initial.json` and
  `templates.json` ([restart.md](restart.md)).
