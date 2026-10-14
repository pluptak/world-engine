# Command via: who sent an actor's command

A command names the body it acts for in `actor`. An actor view may also name the agent that sent it, `via`: the
body's controller, the one whose `controlled_by` walk reaches the body.

```
terminal ---controls---> arm        actor_command(arm, via: terminal)
   (agent)                 (body)   accepted: terminal is arm's controller
bob (agent)                         via: bob  -> refused not_controller
```

- `via` is set only by an actor view (`ActorWorld`'s `via`, the CLI's `via` on `actor_check` and `actor_command`).
  The bare `command` op does not take it.
- Checked after the agent-fault rule: an unknown `via` is `no_such_actor`, a non-agent `not_an_agent` (invalid);
  one that is not the body's controller is refused `not_controller`. With no `via`, nothing changes.
- The log keeps it: a logged command written with `via` says so on its line, and a replay folds it like any field.
  A line with no `via` reads as before.
