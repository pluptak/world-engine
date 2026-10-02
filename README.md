# world-engine

A deterministic, persistent, causal world-transition engine: persistent causal world state, with
physics as one resolver underneath it.

```
Command → Target resolution → Preconditions → Action → World transition (resolvers)
        → Consequences → Events (causal chain)
```

Every command enters that pipeline and leaves as statuses, deltas and events — never prose.

```bash
npm run check     # tsc --noEmit && node --import tsx --test
npm test          # node:test via tsx
npm run typecheck # tsc --noEmit
```

Node ≥ 20. See `docs/DESIGN.md` (written at block 9) for the built model.