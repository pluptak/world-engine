# Roles

Who may do what, and when. A plan, not built: `backlog.md` items come from it one at a time. Today
there are two roles, the world author (`WORLD_AUTHOR`: every `edit` and `advance`, at any time) and
the agents (commands, `actorWorld`).

## Roles are permission sets

A role is not an entity and not a mind: it is a set of permissions a handle carries, and whoever
holds it (a human, an AI agent, a test, a middleware) is outside the engine. The engine checks each
operation against the set it arrives with and records the role in the log, so `attempts` shows
under which role each thing was done. `WORLD_AUTHOR` stays, every permission at once, for tests and
repair, until the roles replace it.

## One flow

A simulation is one run: a world made from a scene, started once, ended once. Nothing continues a
run or turns it back into a scene.

1. **Architect: makes a scene.** Sets the scene up (entities, places, state-tier props of
   `src/engine/fields.ts`, the seed), queues its timeline of beats (a knock included: everything
   that will happen by intention is queued here), declares the odds the director may steer, each
   with its range, and the tick limit. Then it saves the scene. It never touches a run.
2. **Director: runs it, as a game master.** Picks a scene from the saved ones, makes a run from it,
   registers the players (binds each one's handle to its character's body) and starts it. During
   the run it reads everything and, from what it sees, steers the odds within their ranges and
   brings a queued beat forward, puts it back or cancels it; it runs the clock (`advance`,
   stopping before a beat). It never makes a beat, never retimes what the engine scheduled (a
   door's shut, a bleed, a process) and never edits the world. It declares the end; the tick limit
   ends a run it does not. Its further powers are for later.
3. **Character: plays.** Acts and senses in the running world through one view (`actorWorld`),
   free to do anything the engine allows and nothing else. Any agent the templates allow, not a
   human only: a dog, a terminal, a sword with a will. A body may be several entities apart (the
   lab's AI is its terminal, its arm and its cameras): the handle names every entity it drives, and
   its view has one alias for each thing, read through all of their senses.

## The run

A run is `registering`, `running` or `ended`. Before the start nothing acts and no time passes;
characters' commands and the director's steering are refused on a run that is not running
(`run_not_running`). The end stops the clock: every pending cause is dropped, nothing more is
accepted, and the world stays readable as the record of the run. The scene's beats are queued
at the start, their ticks counted from it.

## Open

1. What a saved scene is: today's `scenarios/*.json` grown with beats, odds and the tick limit, or
   a snapshot saved from a world the architect edited; and where the list of scenes lives (a
   directory the host names, the engine reading it, or the host alone).
2. The steerable odds: which (`jam_pct`, a process's `chance_pct`) and how a steer is stored (a
   state prop read in place of the template's value).
3. A body of several entities: separate agents one handle lists, or parts of one body standing in
   several places (parts share their entity's position today, so that is an engine change).
4. A character that is a thing: whether an agent can be carried (the sword) and still act.
5. An observer (a player with no body and no voice, read only) is out of this flow; kept for later?
