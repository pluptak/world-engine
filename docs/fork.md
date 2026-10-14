# Forks

`MemoryWorld.Fork()` returns a memory world over the snapshot as it is now (snapshots are immutable,
so nothing is copied), with the same templates, names, coverage and dice, so it continues the same
dice. Its history begins at that version: `since`, `attempts` and a `trace` of anything older throw
`history_unavailable`, as for any memory world. It shares nothing mutable with its parent, so a
caller can run what-ifs or many rollouts without copying snapshots by hand. It writes no
directory and appends to no log, and nothing it does reaches its parent or its other forks. A
stored world has no fork: a caller forks one by building a `MemoryWorld` over its
`CurrentSnapshot()`.
