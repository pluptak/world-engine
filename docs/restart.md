# A run played again

A run that ended is a record; playing the scene again needs a new world. `init` builds one from the
scene file ([scenario.md](scenario.md)), but the file or `templates/` may have changed since, so the
new run would not be the same run ([api.md](api.md)).

`WorldBuilder.Restart(from, to)` makes a world at `to` from the world at `from`:

- its `initial.json`: the scene as it was built, the run registering, the beats queued, the seed;
- its frozen `templates.json`, so a `templates/` directory that changed since the first world was
  made cannot reach the restart. A linked run restarts with its manifest instead, inside its
  library's `runs/<world>/`; anywhere else is refused `outside_library`.

Nothing of the old world's log, pending moves or checkpoints is carried, and the old world is not
touched, so the same registration and the same moves give the same log, line for line. The new
world's snapshot starts at version 0.

```
first world                      restarted world
initial.json + templates.json -> initial.json + templates.json
log.jsonl -> events.jsonl                   (none: a fresh world)
snapshot.json (ended)          snapshot.json (registering, v0)
```

`world_exists` when `to` holds any world file, whole or not (`initial.json`, `log.jsonl`, ...), so
no file a world keeps is written over; `no_such_world` when `from` holds none.

**The CLI.** `restart` (`{ op, world, to }`) answers the new world's snapshot version.

**Not in it.** Copying the old world's log, its checkpoints or its pending moves; `init` reading a
scene file. Tests: the `restart` rows of `InitGoldenTests`.
