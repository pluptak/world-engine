# Transition pipeline

Commands pass through target resolution, preconditions, a verb transition, physical consequences,
and causal events, and return a status, deltas, and events chained by command and cause ID. Non-ok
results leave the snapshot unchanged; a success advances the clock by its verb's duration once the
transition has run ([time.md](time.md)), bumps its version, and a verb may declare
`validateResult`, run after its transition: it refuses a result that breaks an invariant. The engine
is pure: a transition takes a snapshot and returns a new one; I/O stays outside.

Each verb declares its args, its duration, the capacities it needs and the refusal codes it can
return; `verbs()` is the catalog read from those declarations, and a refusal with an undeclared code
is an engine bug that throws. Each verb, its arguments and its rules are in [verbs.md](verbs.md).
