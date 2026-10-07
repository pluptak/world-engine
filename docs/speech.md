# Speech

Characters talk, and who hears it is a perception question the engine can answer. What it means is
not, and the engine never holds the words (`AGENTS.md`: no prose crosses the boundary; the engine owns
world state, never knowledge). A speech act carries an opaque *token* the caller made up, and the
caller keeps the text and maps the token to it outside.

**The verb.** `say` ([verbs-other.md](verbs-other.md)): `args.utterance`, a token matching
`^[A-Za-z0-9_.:-]{1,64}$` that is stored and never interpreted; `args.volume`, `whisper`, `normal` (the
default) or `shout`; an optional target, the addressee, any entity address. It needs a `speech`
capacity of 50 from the actor's parts (`requires`, as `lock` needs `manipulation`) and takes one tick.
A missing or malformed token or an unknown volume is `invalid_args`; too little speech is
`insufficient_speech`. The catalog declares the token as an arg of kind `token`, and `volume` as an
`optional` enum.

**The event.** One root event `say` on the *speaker* (not the addressee, even when addressed), with
data `{ utterance, volume, to? }`. `to` is the addressee as a plain fact of the act, not a claim that
anyone understood or even heard. Saying changes no other state, and the world records nothing about
who understood.

**Hearing.** The `say` row of [senses.md](senses.md): sight is the `event` row's (the speaking is seen in
a lit room, the words are not heard by sight), smell is false and touch is the speaker's own. Hearing is
by volume:

| volume | the speaker's room | across a doorway |
| --- | --- | --- |
| `whisper` | only within `NEAR_THRESHOLD_CM` of the speaker (both positions must be known, else false: `too_far`) | no |
| `normal` | everywhere | no |
| `shout` | everywhere | yes, open or shut |

A speaker hears their own `say`. Hearing does not need light, so a dark room still lets an observer hear
a speaker it cannot see.

**The words stay out of a projection that did not hear them.** `ObservedEvent` carries `utterance` and
`volume` only when the observer's hearing of that event is true; an observer who only saw the speaker has
the event, with `sight` among its senses, and no token. `Result.events` and `since` stay the omniscient
record and carry the token, as they carry every event's data. `perceivers: true` names, by sense, who
heard.

**Capacity.** `speech` is contributed by a human's `head` (100); animals have none, so a dog's `say` is
`insufficient_speech`, and a human whose head is destroyed has none either, with no rule of its own. Adding
the capacity changed the human template and so `templates_hash`: a stored world made before it reports
`templates_changed` and needs `upgradeTemplates` or a re-init ([templates.md](templates.md)).

`tests/speech.test.ts` is the spec; the property test generates `say` and every step stays valid.
