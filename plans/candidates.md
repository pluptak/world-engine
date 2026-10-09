# Candidates

Known gaps with no plan yet. **Not work for a coding agent:** nothing here is ready, and each entry
ends in open questions that are the maintainer's to settle. A candidate is promoted by writing it
up as an item in `backlog.md` (its files, types, tests and done-condition) and adding it to the
Priorities there, then deleting it here in the same commit.

- **An id gap shows something happened unseen.** Event and entity ids come from one `next_seq`, so an
  actor that sees `ev12` then `ev20` knows ids were allocated out of its sight, by a command or a
  process. Open: whether that is worth closing, and how (per-actor aliases, or a counter per room).
- **Long-lived processes keep every file they read.** The parsed lines of `events.jsonl` and `deltas.jsonl`
  (`lineCaches`) and the head of `initial.json` (`initialMeta`) are module-level maps keyed by path with no eviction,
  so a process that opens many worlds, as a middleware in-process would, holds all their events until it ends. The
  CLI, one process per request, never does. Open: a bound by files or by records, and whether any caller has this
  shape yet.
- **Every command writes the whole snapshot.** At 500 entities about 8 of the 10.6 ms per command is loading,
  serialising and writing the snapshot, against 1.2 ms in the pipeline, and "only a delta log would change" it
  (`docs/measurements.md`). `deltas.jsonl` already holds every accepted command's deltas. Open: write the snapshot
  every N commands and replay the deltas since on `load`, how that meets the head's fast path and `verify`, and
  whether any caller runs worlds this size yet.
- **Who authors templates.** The catalogue is `templates/`: an architect picks presets and never
  writes one, and a world author changes state, never a definition. Open: who adds a preset a scene
  needs, and whether that is ever done while a world runs or only between worlds (`upgradeTemplates`).
- **Facing and a sight cone.** In a lit room every act is seen (`docs/limits.md`); the costliest of
  the limits, revisit when a concrete world needs what darkness, concealment and staging cannot give.
