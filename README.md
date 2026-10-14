# world-engine

A deterministic world model for narrative and agent grounding. Commands go in; statuses, deltas
and events come out, never prose.

A story, game or LLM agent needs a scene whose facts do not drift: where the bottle is, what broke,
who could have seen it. The engine keeps that state and answers with codes. The caller owns
knowledge, language and the seed of any chance.

## Example

`scenarios/bottle.json` sets a wine bottle on a table, with a stone on the floor beside it.
`e2` is the table, `e3` the bottle, `e4` the pusher and `e5` the stone.

```bash
dotnet build WorldEngine.slnx
dotnet run --no-build --project src/WorldEngine.Cli -- init data/w1 scenarios/bottle.json
echo '{"op":"command","world":"data/w1","command":{"command_id":"c1","actor":"e4",
  "verb":"push","target":"e2","args":{"dir":"+x","distance_cm":200}}}' \
  | dotnet run --no-build --project src/WorldEngine.Cli
```

The table slides 29 cm and stops at the stone. The response chains the consequences by `cause_id`:

```
push → moved → collided → displaced → dropped (the bottle falls 75 cm) → broken → spawned ×3 (shards)
```

Each changed field also gets a delta, and the wine ends up as residue on the room. Nothing says
"the bottle shatters"; a caller reads the codes, and `trace` walks the chain back.

## What it models

- **Verbs:** move, take, drop, put, give, pour, consume, push, pull, attack, open, close, lock,
  unlock, switch_on, switch_off, search, light, douse, say, wait, and the author's `edit` and
  `advance`. Every refusal is a declared code with numbers, not text.
- **Bodies and physics:** parts, capacities and severable limbs. Support and containment chains,
  falls, breaks and spills, each recorded as a cause chain. Verbs check capacities such as
  `manipulation`, never parts, so a severed hand changes what an agent can do with no special case.
- **Perception:** four senses from one sense table, with concealment, `search` and speech.
  `perceivers` names who sensed each event. `fact` and `perceive` answer `"true"`, `"false"` or
  `"unknown"`, where unknown means the world does not model that category.
- **Time:** one integer `tick`. Beats, template processes and scheduled causes run on it, and
  seeded dice replay exactly.
- **Controllers:** `options` lists what an actor can try. `ActorWorld` is one actor's sealed view
  of a world; runs pair players (`PlayerWorld`) with a director (`DirectorWorld`) in rounds.
- **History:** a validated, append-only store. `verify` replays it, and `since`, `trace` and
  `beat` read and batch it. Stale commands are preempted.
- **Authoring:** templates are data (`templates/*.json`), with `extends` and a catalogue.
  Scenarios have names, anchors, traits and percentage forms, and `refine`.

It is built for room-sized scenes: tens of entities, a few milliseconds per command.

## Using it

- **JSON CLI** (`src/WorldEngine.Cli`): `init <dir> <scenario.json>` creates a world; after that,
  each call reads one JSON request on stdin (`command`, `edit`, `beat`, `check`, `options`,
  `observe`, `inspect`, `query`, `trace`, `since`, `verify`, `verbs`, …). A malformed request is
  answered `{"status":"invalid","issues":[…]}` with exit code 2. See [docs/api.md](docs/api.md).
- **.NET library:** `StoreWorld.Open(dir)` opens a stored world and `MemoryWorld` holds one in
  memory; both implement `IWorld`.
- **Reference host** (`tools/WorldEngine.Host`): plays a run through the JSON ops, as a real host
  would. See [docs/host.md](docs/host.md).

## Layout

```
src/WorldEngine.Core       pure engine: model, canonical JSON, templates, pipeline, verbs, physics, perception
src/WorldEngine.Store      a world as a directory: log, events, deltas, snapshots, checkpoints, lock
src/WorldEngine.Contract   the shape of each JSON request
src/WorldEngine.Cli        the command-line entry point
templates/  scenarios/     shipped templates and example scenes
tests/  tools/             xUnit suite and goldens; benchmark, reference host
docs/                      the specification, one concept per file
```

## Development

Requires the .NET 10 SDK.

```bash
dotnet test WorldEngine.slnx                                 # the whole suite, the usual gate
dotnet run -c Release --project tools/WorldEngine.Bench      # store throughput
```

The engine was ported from TypeScript, which lives at the git tag `ts-final`.

## Documentation

Start with [docs/overview.md](docs/overview.md) and [docs/thesis.md](docs/thesis.md).
[docs/DESIGN.md](docs/DESIGN.md) indexes every concept, and [docs/limits.md](docs/limits.md) says
what the engine does not do. Contributors read [AGENTS.md](AGENTS.md) first.

## License

MIT, see [LICENSE](LICENSE).
