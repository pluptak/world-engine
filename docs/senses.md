# Senses

One row per class of event, one column per sense and situation: `s`, `h`, `m` and `t` are sight,
hearing, smell and touch, `A` the same room, `+` an open door and `B` a shut door. `T` is true,
`L` is true only if the event is loud (`broken`, `detached`, or a `dropped` of 50 cm or more) and
`F` is false. Touch ignores rooms: `O` is felt when the observer is the subject or holds it in a
grip, and not felt otherwise; a `collided` is felt through what it hit as well.

| row | sA | s+ | sB | hA | h+ | hB | mA | m+ | mB | t |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `authored` | F | F | F | F | F | F | F | F | F | F |
| `pour` | T | T | F | T | L | L | T | F | F | O |
| `broken` | T | T | F | T | L | L | T | L | L | O |
| `event` | T | T | F | T | L | L | F | F | F | O |
| `silent` | T | T | F | F | F | F | F | F | F | O |
| `entity-odorous` | T | T | F | T | F | F | T | F | F | O |
| `entity-odourless` | T | T | F | T | F | F | F | F | F | O |

`authored` is `edit`, `advance`, `placed`, `edited`, `removed`, `beat_skipped`, and a `spawned`
whose cause is one of those: the world author's own work, which nobody senses, though its
consequences (`displaced`, `dropped`, `broken`, a product's `spawned`) are sensed as any other
event. `pour` is `pour`, `poured` and `spilled`; `broken` is a break whose entity held a liquid or
residue; `event` is any other. The `entity-` rows are the entity form, where there is no event and
so nothing is loud. `found` is read against the concealer it names, `revealed` against the thing
revealed. `sounded` (an authored beat's knock or bang, [beats-actions.md](beats-actions.md)) is the
`event` row for hearing and nothing else: never seen (`unseen`), never smelt, never touched, and
heard next door only when its data says `loud`. `say` (speech, [speech.md](speech.md)) is the
`event` row for sight and smell and is heard by volume: a `whisper` only within `NEAR_THRESHOLD_CM`
of the speaker (`too_far` otherwise), `normal` throughout the room, a `shout` across a doorway as
well (it counts as loud). A speaker hears their own. `silent` is `changed` (a template's process
moving a prop, [processes-runs.md](processes-runs.md)), `light`, `douse`, `lit` and `doused`,
`consume` and `consumed`, `spent` (a thing used up; the products it spawns are `spawned`, heard like
a break's), the hand acts (`take`, `give`, `put`, `search`, `found`, `revealed`), `wait`,
`capability_changed`, and a `moved` whose cause chain starts at `take`, `give` or `put`; its hearing
is `quiet`. A `moved` under `move`, `push` or `pull` is footsteps or scraping, and stays `event`.

A sleeping body (`asleep`, a state prop an author sets, `scenarios/watch.json`) is `false` / `asleep` for sight
and hearing, so it hears no knock and no speech; touch and smell read as they do for anyone. Its own commands
are refused `asleep`, and the world author may still act on it.
A blind body (`blind`) is `false` / `blind` for sight and a deaf one (`deaf`) `false` / `deaf` for hearing; both
still act, touch and smell, and their capacities stay as they are: the condition is not damage.

An unconscious body (`unconscious`, a state prop an author sets, and an edit ends) is `false` / `unconscious` for every
sense, and its capacities read zero (`capacity`); what it holds stays held, since structural capacities are unchanged.
Its own commands are refused `unconscious`.

What `perceive` answers with, the basis codes, is [senses-bases.md](senses-bases.md).
