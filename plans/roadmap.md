# Roadmap

What comes next. Each item says what is already decided and what is still open. `docs/` describes
only what is built; this file is the plan, tracked here in `plans/` (`docs/superpowers/` stays
ignored for tool scratch). As of `875a1df`, pushed.

## Done

The time/structure/capability specs and the controller review, taken on in this order:

- Sparse part state, materialization triggers, severed subtrees, structural-resolution tests.
- Thesis and structure docs; capability vs coverage.
- Walking and barriers (`fe38460`); controller queries: `reachable`, `inspect`, `observe` on a
  command (`7b1ad5b`).
- The clock: every ok command takes its verb's declared duration (`1528eeb`).
- Thesis line: commands are attempts, `edit` is the author's channel (`a452614`).
- Provenance docs, with an expiry's `modifiers` delta recorded under its own event (`92cbaa1`).
- A `tick` on every event (`9006326`).
- Scheduled causes around the self-closing door (`b5d6d15`).
- The bars gap rule: smallest dimension against `gap_cm` for `take`, `give`, `put` (`4ebe9bd`).
- `docs/verbs.md` split into an index and four family files (`625c07d`).
- `attempts(version)`: every submission with its outcome, on both worlds and the CLI (`07d650d`).
- Bleeding, the second scheduled cause and the first that chains; a destroyed body is no agent
  (`8291b5a`).
- Small gaps: a bite must fit the bars, a self-closing gate waits for whoever stands in it, a body
  bled out drops what it held; this file tracked in `plans/` (`f3e3e69`). Stored worlds are
  `schema_version` 5.
- No verb leans on the validation step: seven paths now refuse or write a valid result, and the
  property test fails if an accepted command is ever downgraded (`3778007`).
- A destroyed observer senses nothing, `observer_destroyed` (`f0981a5`).
- Random runs open wounds: half the generated blows aim at parts that come off (`875a1df`).
- A closing gate, by hand or by itself, moves what stands on its footprint just clear to the side
  its centre is on (a tie goes positive), uncovering what it hid; nothing stops it any more.
  Crushing is postponed.

Checked and not an item: `npm run bench` gives 4.3 ms per command over 10k commands, the same as
before the clock and the schedule (`fe38460`: 4.3), so the per-command scans they added cost
nothing measurable.

## Next

### 1. One planning file

There are two: `backlog.md` at the root, which holds the process rules (one item per block, lanes,
scope line, out of scope) and is now empty of items, and this file, which holds the items. The
overview links to `backlog.md`; nothing links here. Two lists will drift.

- Decided: one file.
- Open: which. Folding these items into `backlog.md` keeps the established place, its rule
  ("delete an item in the same commit that ships it", so no Done list; git history records it)
  and the overview's link, and retires `plans/`; keeping this file means moving the process rules
  here and repointing the overview.

## Not planned

Raised and set aside; each would come back with a scenario that needs it.

- A `distance` query: facts are true, false or unknown, and positions are in every observation.
- Affordance enumeration: replaced by the targeted controller queries and `check`.
- Verbs `turn` (needs a facing direction), `use` (too general), `throw` (would deal impact damage
  to agents), `bandage` (a bleed stops by its count).
- Several parents per event (`causes: [...]`), and a stored `root_id`.
- Stepping onto shards having a consequence.
- Pathfinding: a caller routes around a barrier in several moves.
- Agents acting in parallel: a `beat` is an ordered batch, and two commands never share a tick.
- An agent slipping through a gap; a head sized apart from the body for bites.
- A wound from a detachment written by `edit`.
- A gate or door that crushes what is in its way (a prop that turns it on, the damage deciding
  whether the thing is destroyed or stops the closure): postponed in favour of pushing aside.
- Migrating stored worlds between `schema_version`s: a world from an older format is refused, never
  read as if it matched (AGENTS.md: no silent migration); a tool comes when a world must be kept.
- Facing and a sight cone: `backlog.md` names it the costliest limit and the first to revisit,
  when darkness, concealment and staging cannot give what a concrete world needs.
