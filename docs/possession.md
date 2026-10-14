# Possession: a curse on a body

A body can be possessed through a link entity (`templates/curse.json`, abstract, no parts). While the
possession holds, the body's own commands are refused `possessed`, and only its possessor's commands
pass, sent with `via` ([command-via.md](command-via.md)).

```
curse ---possessor---> curser (agent)
  ^
  | possessed_by        actor = victim, via = curser: accepted
victim (body)           actor = victim, no via:       refused possessed
```

- `possessed_by` (on the body) names the link. `possessor` (on the link) names the agent in control.
  `lapses_at` (on the link) is the first tick the possession no longer holds; absent, it holds until the
  link goes.
- Held when the link and the possessor exist and are not destroyed, the possessor is an agent, and
  `lapses_at` is absent or after the current tick. Derived each time: a lapse writes nothing.
- Checked after `unconscious`, so an unconscious victim is refused for everyone. Power is not read: a
  curse is not a control walk, so a curse on a human works where `controlled_by` would be `unpowered`.
- A curse that names itself is a `control_loop`; a dangling `possessed_by` or `possessor` is a
  `dangling_reference`, so removing a curse needs its body released first.
- Ending it early is an author's edit clearing `possessed_by`, or destroying the link.
