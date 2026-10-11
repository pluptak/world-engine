# Transition pipeline

A command is a try. The engine answers in fixed steps:

- Check the actor: it exists and can act.
- Find the target: name, alias, or `entity.part`.
- Check the verb's preconditions.
- Run the verb's transition.
- Run physical consequences: support loss, falls, breaks.
- Move the clock by the verb's duration.
- Answer with a status, deltas, and events chained by `cause_id`.

```
command -> actor -> target -> preconditions -> transition -> clock
                                               + physical     + duration (0, 1 or n)
```

- Any status but `ok` changes nothing.
- `ok` moves `tick` by the verb's duration ([time.md](time.md)).
- `ok` bumps `version`.
- A verb may declare `validateResult`. It refuses a result
  that breaks an invariant.
- Pure core: a transition takes a snapshot and returns a new one.
- I/O stays outside the engine.
- Each verb declares its args, duration, capacities, and refusal codes.
- `verbs()` is the catalog read from those declarations.
- A refusal with an undeclared code is a bug. It throws.
- All verbs are indexed in [verbs.md](verbs.md).
- Rules live in the family file the index links.
- A target names only what the actor can address
  ([perception.md](perception.md)).
