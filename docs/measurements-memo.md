# Measurements: the frozen memo

The current snapshot a store process keeps is deep-frozen when it is kept (`rememberCurrent`,
`src/store/file-store.ts`), so a caller that changes a snapshot it was given throws instead of
changing what the next read sees. Only objects not yet frozen are walked, so a command pays for what
it changed, not the whole snapshot.

`npm run bench:scale`, ms per command, rest phase (load, serialise, write), one run each, same
machine as [measurements-commands.md](measurements-commands.md):

| | before freezing | with freezing |
|---|---|---|
| 500 entities, rest (mean of the 500 sampled commands) | 4.59 | 4.47 |
| 500 entities, first / last 1k | 7.37 / 7.40 | 7.45 / 7.08 |

The difference is inside the run-to-run noise of this machine (the same code measured 4.6 to 5.1 ms
of rest across runs), so the freeze stays. Test: `tests/file-store.test.ts`.
