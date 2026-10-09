# Candidates

Known gaps with no plan yet. **Not work for a coding agent:** nothing here is ready, and each entry
ends in open questions that are the maintainer's to settle. A candidate is promoted by writing it
up as an item in `backlog.md` (its files, types, tests and done-condition) and adding it to the
Priorities there, then deleting it here in the same commit.

- **Actors learn that unseen others acted.** `observation.version` and a `preempted` status reveal
  commands the actor could not perceive, through `actorWorld` and the `actor_*` ops; the open decision
  is whether an actor view should hide them.
- **Long-lived processes keep every file they read.** The parsed lines of `events.jsonl` and `deltas.jsonl`
  (`lineCaches`) and the head of `initial.json` (`initialMeta`) are module-level maps keyed by path with no eviction,
  so a process that opens many worlds, as a middleware in-process would, holds all their events until it ends. The
  CLI, one process per request, never does. Open: a bound by files or by records, and whether any caller has this
  shape yet.
- **An observer reads an amount exactly.** `inspect` returns `liquid_amount` (and `fuel`) as stored
  whenever coverage names it, but a human cannot tell 288 cm³ from 270 at a glance; a vessel with a
  gauge marked on its side lets it tell more, still not exactly. The engine owns the exact amount
  and `pour` needs it; what an observer gets is a reading. Open: the reading's form (a percentage
  band of capacity, or named levels), how fine sight alone is, a gauge as a template prop that
  narrows it, the same for `fuel`, and whether the author's `inspect` stays exact. A reading must be
  a fixed band, never noise, so it replays (AGENTS.md).
- **Scenery: templates nothing can act on.** A scene needs things that are there to be perceived
  and change nothing: a flowery meadow, a painted stain, the sky or a ceiling that bounds it. The
  nearest today is `abstract` (`docs/state.md`), which no agent can address and which is never
  perceived; scenery would be perceived but inert. Open: a template prop (`scenery: true`) or a
  separate catalogue group; which senses reach it (a meadow smelt, a sky seen in the dark?); every
  verb refused with one code, or scenery left out of what an agent can name, so `options` never
  lists it; whether it has a footprint (walked over like a meadow, or a bound like a wall, which
  `barrier` already gives); whether `edit` and processes may still change it; and whether a
  stain that is scenery should smell, since smell reads residue today (`docs/limits.md`).
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
