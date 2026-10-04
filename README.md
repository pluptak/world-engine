# world-engine

A deterministic, persistent, causal world-transition engine: persistent causal world state, with
physics as one resolver underneath it. An in-process library API; the CLI is a thin JSON adapter.

```
Command → Target resolution → Preconditions → Action → World transition (resolvers)
        → Consequences → Events (causal chain)
```

Every command leaves as statuses, deltas and events — never prose. Node ≥ 20.
```bash
npm run check     # the gate: tsc --noEmit + all tests
```
See `docs/DESIGN.md`, the index of the built model, and `CLAUDE.md` for the code map.
