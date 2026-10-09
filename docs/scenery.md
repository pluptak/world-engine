# Scenery: perceived, acted on by nothing

A scene needs things that are there to be perceived and change nothing: a meadow, a painted stain,
the sky over a yard. A template that declares `scenery: true` makes its entities such things. It is
the other half of `abstract` ([state.md](state.md)): an abstract mark is never perceived and no
agent can name it; scenery is perceived and named like anything, and nothing an agent does reaches
it. Read from the template (`isScenery` in `src/engine/resolve.ts`), as `abstract` is.

- **Perceived** by the rules every entity follows: seen in a lit room and not in the dark, listed by
  `observe`, described by `inspect`; smelt only through residue or a liquid it carries.
- **Refused:** an agent's command whose target resolves to scenery is refused `scenery` in
  `pipeline.ts`, after resolution and before any precondition, and changes nothing. The code is
  the world's, as `no_seed` is, so no verb lists it. `options` leaves scenery out of what it tries,
  so it is never offered, blocked or suggested as an argument.
- **No footprint for movement:** a walk crosses it, `push` slides past it, and a shutting gate moves
  none of it (`walkStop`, `sweep` and `occupantsIn` skip it as they skip an abstract mark). A bound
  is a `barrier`, which scenery cannot be.
- **Still the world's:** the world author's `edit` places and changes it, and its template's
  processes run (a meadow may bloom by itself).
- **Refused pairings:** a template that declares `scenery` with `agent`, `surface`, `container`,
  `openable`, `light_source` or `barrier` is refused when its set is resolved (`validateProps` in
  `src/templates.ts`): nothing could use them.

No template in `templates/` declares it: a new file there changes every world's templates hash, so
a scene's scenery comes with its own registry. `tests/scenery.test.ts` holds these rules.
