# A run

A run is one simulation made from a scene ([scenario.md](scenario.md)). The snapshot's `run` holds
its `state`: `registering` when the scene is built, `running` once the author starts it, and `ended`
for a reason, with `ended` `{ reason, tick }`. A world with no `run` is not a run and is untouched.

**Edits.** `start_run` moves a registering run to running (else `run_not_registering`), and
`end_run` ends a running one with reason `director` (else `run_not_running`). A world with no run
refuses both `no_run`. Each is recorded by its own `edit` event, which nobody senses.

**Gates.** A registering run takes no command but an edit, so an agent's command and the author's
`advance` are refused `run_not_running` and take no time; the author's other edits go through to
set the scene up. A running run takes an agent's command and the `advance` only in a round, else
`round_only` ([rounds.md](rounds.md)). An ended run takes no command and no edit at all, each
refused `run_ended`. Reads answer as ever. These refusals belong to the world, not a verb, as
scenery's does.

**The tick limit.** A running run's clock never passes `tick_limit`. While it runs, time passes only
in rounds, one tick each, so the round whose close reaches the limit runs what falls due there and
ends the run, with reason `tick_limit`. Nothing is left to run at the limit: a round after it is
refused `run_ended`. The pipeline also cuts any timed command at the limit, which a running run's
commands cannot reach by way of a round, since a move takes no time and `wait` is not a move.

**No live players.** A running run with `slots` ends, `no_live_players`, after any ok command or
edit that leaves none of its slots alive: each is gone from the world or destroyed (a bleed-out
counts). A run with no slots, or one still registering, never ends this way.

**The end.** What is still scheduled is dropped with nothing recorded, since no time passes again;
modifiers stay as they were. The end is in the snapshot's `run.ended`, and `validateSnapshot`
refuses an ended run that still schedules anything.

**Not in it.** Rounds, roles and handles, who may start or end a run (the author, for now), and
successors keeping a slot alive. Tests: `tests/run.test.ts`.
