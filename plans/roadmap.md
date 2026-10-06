# Roadmap

What comes next. Each item says what is already decided and what is still open. `docs/` describes
only what is built; this file is the plan, tracked here in `plans/` (`docs/superpowers/` stays
ignored for tool scratch).

## Done

The time/structure/capability specs and the controller review, taken on in this order:

- Sparse part state, materialization triggers, severed subtrees, structural-resolution tests.
- Thesis and structure docs; capability vs coverage.
- Walking and barriers (`fe38460`); controller queries: `reachable`, `inspect`, `observe` on a
  command (`7b1ad5b`).
- The clock: every ok command takes its verb's declared duration (`1528eeb`).
- Thesis line: commands are attempts, `edit` is the author's channel (`a452614`).
- Provenance docs, with an expiry's `modifiers` delta recorded under its own event (`92cbaa1`).
- A `tick` on every event; stored worlds `schema_version` 2 (`9006326`).
- Scheduled causes around the self-closing door; `schema_version` 3 (`b5d6d15`).
- The bars gap rule: smallest dimension against `gap_cm` for `take`, `give`, `put` (`4ebe9bd`).

## Next

### 1. Split `docs/verbs.md`

Built: `verbs.md` is a 25-line index; the rules are in `verbs-moving`, `verbs-holding`,
`verbs-openables` and `verbs-other`, held in step by `tests/catalog.test.ts`.

It was at its 40-line cap, so the next verb or refusal change had nowhere to go. AGENTS.md says a
topic that outgrows its cap splits rather than loses content.

- Decided: split it, keeping `verbs.md` as the index every lane bullet points at.
- Open: where the line falls; by family is the natural cut (moving and pushing, holding and
  passing, openables, combat and `wait`, `edit`).

### 2. Failed attempts as queryable history

Built: `attempts(version)` on both worlds and as a CLI op, every submission with its outcome;
log lines record it, `schema_version` 4. A dry run is not an attempt.

From the provenance item. A store world's `log.jsonl` keeps every command with its status and
reason code, but `since` and `trace` read only ok commands, so a controller cannot ask "what did
bob try, and why was it refused" after the fact.

- Decided: an attempt that failed stays out of the event chain; it has no events and takes no time.
- Open:
  - The shape: an option on `since` or a separate `attempts(version)`, and whether it reports the
    command, status, reason code and reason data, nothing more.
  - A memory world records only what it applied; it would need to keep its failures too, so both
    worlds answer alike.
  - Whether `check` (a dry run) is an attempt. Probably not: it is never logged.

### 3. A second kind of scheduled cause

Built: bleeding (`docs/bleeding.md`), a fixed count from `bleed_*` props on the body, each bleed
scheduling the next; a destroyed body is no agent. `schema_version` 5. A bandage verb is not built.

The schedule had one kind, `close`. The next kind came with a scenario that needs it.

- Decided: the shape stays (`due_tick`, `kind`, `entity`, `cause_id`, ordered by due tick then
  insertion); a cause the world overtook does nothing and says nothing; removal prunes.
- Open:
  - Which kind. Bleeding fits what exists: a severed part could schedule damage every N ticks.
    It needs a stopping rule (a fixed count, or a verb that stops it), which is new design.
  - Chaining: a cause that schedules the next one. `advanceClock` would already run one that
    falls due within the same command; nothing tests it, and the docs do not claim it.

### 4. Small gaps the last blocks left

Built: a bite crosses a gap only if the attacker's body fits it (`crosses_gap` on attack modes); a
self-closing gate waits for whoever stands in it; a body bled out drops what it held; `pour`
ignores the gap by design; this file moved to `plans/`. The notes below are what was weighed.

Each is a decision to make when a scenario hits it, not before.

- A strike or a bite through bars ignores the gap: a dog's jaw reaches through 12 cm bars.
- `pour` ignores the gap; liquid would pass anyway, but a container held through bars does not.
- A gate closing by itself on someone standing in the gateway: nothing reacts, and walking never
  stops an agent already overlapping something, so they walk out.
- Whether this roadmap should be tracked: either move it out of `docs/superpowers/` or stop
  ignoring that directory.

## Not planned

Raised and set aside; each would come back with a scenario that needs it.

- A `distance` query: facts are true, false or unknown, and positions are in every observation.
- Affordance enumeration: replaced by the targeted controller queries and `check`.
- Verbs `turn` (needs a facing direction), `use` (too general), `throw` (would deal impact damage
  to agents).
- Several parents per event (`causes: [...]`), and a stored `root_id`.
- Stepping onto shards having a consequence.
- Pathfinding: a caller routes around a barrier in several moves.
- Agents acting in parallel: a `beat` is an ordered batch, and two commands never share a tick.
- An agent slipping through a gap.
