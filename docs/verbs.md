# Verbs

Only an agent holds: agency is the template's `agent` prop, withheld from a detached part and a
destroyed body (one bled out, say), and an abstract template ([space.md](space.md)) is no target for
an agent's verb. A surface declares `surface`, sized by its footprint; a container declares
`container` and `inner_*_cm`. Every ok command takes one tick unless its verb says otherwise
([time.md](time.md)).

A verb that answers `invalid_args` until given some may declare `suggest`, a function from the
command's context and the ids the actor can name to the arg sets worth trying, in a fixed order and
from the snapshot alone, which `options` ([api-options.md](api-options.md)) dry-runs one by one.
`free_args: true` says the verb also takes args no list can hold (a position, a partial amount, a
token, a tick count), so it stays named in `needs_args`. A verb that `aims_at_parts` (`attack`) has
`options` try it at each part of a body in view still on. `give` and `put` list every argument they
take; `move` and `pour` list some and are free for the rest; `say` and `wait` list none and are
free. `tests/catalog.test.ts` holds the two to the verbs a bare command finds `invalid_args`.

This is the index: one line per verb, its rules in the family file it links to.

- `move`: walks to a position, or through an open door ([verbs-moving.md](verbs-moving.md)).
- `push`: shifts a target along a direction until it stops ([verbs-moving.md](verbs-moving.md)).
- `pull`: the same shift the other way ([verbs-moving.md](verbs-moving.md)).
- `take`: lifts a thing into a free grip ([verbs-holding.md](verbs-holding.md)).
- `drop`: lets go of a held thing at the actor's feet ([verbs-holding.md](verbs-holding.md)).
- `put`: sets a held thing on a surface or in a container ([verbs-holding.md](verbs-holding.md)).
- `give`: hands a held thing to another agent ([verbs-holding.md](verbs-holding.md)).
- `pour`: moves a carried liquid out ([verbs-holding.md](verbs-holding.md)).
- `consume`: eats or drinks something carried or in reach ([verbs-holding.md](verbs-holding.md)).
- `open`: opens an openable target ([verbs-openables.md](verbs-openables.md)).
- `close`: shuts it ([verbs-openables.md](verbs-openables.md)).
- `lock`: locks it with a carried key ([verbs-openables.md](verbs-openables.md)).
- `unlock`: unlocks it with a carried key ([verbs-openables.md](verbs-openables.md)).
- `switch_on`: switches a power link on ([verbs-power.md](verbs-power.md)).
- `switch_off`: switches it off ([verbs-power.md](verbs-power.md)).
- `attack`: strikes with the first mode the attacker can use ([verbs-combat.md](verbs-combat.md)).
- `search`: looks under or behind a target ([verbs-sensing.md](verbs-sensing.md)).
- `light`: sets a light source burning ([verbs-sensing.md](verbs-sensing.md)).
- `douse`: puts it out ([verbs-sensing.md](verbs-sensing.md)).
- `say`: says an opaque token at a volume, heard in earshot ([verbs-sensing.md](verbs-sensing.md)).
- `wait`: lets ticks pass ([verbs-time.md](verbs-time.md)).
- `advance`: the world author lets ticks pass, with no one acting ([verbs-time.md](verbs-time.md)).
- `edit`: the world author's one change ([verbs-edit.md](verbs-edit.md)).
