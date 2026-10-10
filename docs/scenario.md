# Scenes

A scenario file is a list of entries, or a scene: `{ seed?, entities, beats?, run? }`. `init` and
`createWorld` read the same form, parsed by `SeededScenarioSchema` in `src/contract.ts` and built by
`sceneSnapshot` in `src/engine/scene.ts`. A bare list is a scene with no seed, beats or run.

- `entities`: the entries, as they were: an id, a template and overrides ([space.md](space.md)).
- `seed`: the dice's starting state, a whole number from 0 to 2^32 - 1 ([rng.md](rng.md)).
- `beats`: each a `schedule_beat` body (`id`, `at_tick`, `action`, `only_if?`, `then?`, `repeat?`,
  as in [beats.md](beats.md)). `at_tick` is from 1, and an entity in an action, a condition or a
  follower is named by its scenario id. They are queued at creation with a `cause_id` of null, since
  no event set them going, as for a process the initial state started.
- `run`: `{ tick_limit?, slots?, pool?, odds? }`. `pool`: beat bodies with no `at_tick`, each with
  an `id` unique among the beats and the pool, which the director plays (`play_beat`,
  [roles.md](roles.md)). `odds`: `{ entity, prop: "jam_pct", min, max }` for a door, a whole range
  from 0 to 100 the director may steer it within. A run needs one of the four keys. The rest of the
  run: `tick_limit` a positive int; `slots` the scenario ids of agents, each named once. Either key
  or both; neither is `empty_run`. It is stored as the snapshot's `run`, registering until the
  author starts it ([run.md](run.md)); absent when the scene has none, and `snapshot()` reads it
  back.

**Checks.** Every check runs before anything is written, and a refusal is `invalid_scenario` with
the path and the rule, such as `beats[2].action.entity: no_such_entity`. The rules are
`invalid_beat` (the shape a `schedule_beat` takes), `beat_in_past` (`at_tick` below 1),
`duplicate_beat`, `too_many_beats` (past 256), `no_such_entity` (a name no entry declares),
`not_an_agent`, `duplicate_slot`, `empty_run` and `invalid_run`. A stored `run` is checked the same
way by `validateSnapshot`.

**Versions.** A world without a scene stores nothing new: `run` is absent, and a beat with a null
`cause_id` is only ever written by a scene. So `schema_version` stays 5.

**Not in it.** The pool of beats and the odds a director steers (`plans/roles.md`), the run's
states, and a list of scenes. Tests: `tests/scene.test.ts`.
