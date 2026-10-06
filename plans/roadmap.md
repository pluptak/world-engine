# Roadmap

What comes next. Each item says what is already decided and what is still open. `docs/` describes
only what is built; this file is the plan, tracked here in `plans/` (`docs/superpowers/` stays
ignored for tool scratch). As of `f3e3e69`, pushed.

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

## Next

### 1. No verb leans on the validation step

A verb is meant to refuse what it cannot do with a declared code. The store's validation step
(`resolveSubmission` runs `validateSnapshot` on every accepted result) is a safety net for verb
bugs: it downgrades a broken result to `invalid` with the rule's code and never writes it. Random
runs show seven paths that reach the net instead of a refusal (300 seeds × 60 steps):

| Verb | Rule it breaks | Count |
| --- | --- | --- |
| `take` | `support_or_containment_cycle` (an agent taking itself) | 60 |
| `push` | `pos_without_room_support` | 32 |
| `pull` | `pos_without_room_support` | 32 |
| `move` | `pos_without_room_support` | 30 |
| `move` | `support_and_contained_in` | 23 |
| `drop` | `room_support_without_pos` | 3 |
| `move` | `concealed_by_not_same_room` | 1 |

The clock now runs before validation, so a broken intermediate snapshot also reaches
`advanceClock` and the scheduled causes; `standingIn` was hardened against one such crash.

- Decided: each path gets either a declared refusal in its verb's preconditions or a transition
  that writes a valid result; then the property test asserts that a command `apply` accepts is
  never downgraded by validation, so a new path fails the suite instead of hiding in the log.
- Open:
  - Per path, refuse or fix. A guess to confirm by reading each: taking oneself is a refusal
    (`cannot_take_self`, like `give`'s `cannot_give_to_self`); `move`, `push` and `pull` of
    something standing on a non-room support (a table) probably need the walk/push rules to say
    what happens there, or to refuse it.
  - Whether the edits that set these states up (an agent placed on a table) are themselves fine.

### 2. A destroyed body as an observer

Bleeding made destroyed agents reachable in play. `isAgent` is false for them, so they cannot act
and `perceivers: true` leaves them out; but `perceive`, `observe` and `inspect` still answer for a
destroyed observer as if it saw and heard.

- Decided: nothing yet.
- Open: whether a destroyed observer senses nothing (`false` with a basis such as
  `observer_destroyed`) or whether that belongs to the caller, as knowledge does.

### 3. Wounds in the random runs

The property test's attacks sever a part about once in 3,000 steps, so bleeding rests on its spec
and the inn script. Making the generated bob hit harder was tried and did not help enough.

- Decided: the spec stays the authority; this is coverage, not behaviour.
- Open: aim some generated attacks at detachable parts, or start some sequences from a body with a
  wound already scheduled.

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
