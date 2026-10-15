# Backlog

One item = one small block: plan it, build it, `WORLD_ENGINE_DEEP=1 dotnet test WorldEngine.slnx`, review
the diff, commit. Each item keeps every invariant in AGENTS.md (determinism, pure core, JSON only in the codec, no prose,
coverage-governed `"unknown"`). Delete an item in the same commit that ships it — git history
records it; `docs/` describes what is built (index: `docs/DESIGN.md`).
Measurements and test results live in `docs/measurements.md`, not here; an item quotes a number only
when the item is about that number.

**Scope line.** The engine is a library: a typed, in-process API through which a caller manipulates
objects, humans and animals and asks about the world. The CLI is one thin adapter over that API, and
there is no web server. Turning prose or intent into calls, and choosing calls that reach a desired
world state, is the job of a middleware that does not exist and is not part of this project. Items
below may make the API easier for such a caller to drive (describing its own commands, dry-running
one, structured refusals), but never interpret text or plan on a caller's behalf.

## Priorities

Work top to bottom; take the first entry that is not blocked. Reorder here, nowhere else.

1. [Library worlds: a scenario and a manifest, by revision](#library-worlds-a-scenario-and-a-manifest-by-revision).
2. [Runs from a world revision, linked to the library](#runs-from-a-world-revision-linked-to-the-library).
3. [Identity by appearance: a body seen is named by the face it wears](#identity-by-appearance-a-body-seen-is-named-by-the-face-it-wears).

When nothing above is unblocked, stop and report. Gaps with no plan yet are in
[plans/candidates.md](plans/candidates.md); they are not work, and only the maintainer promotes one
to an item here.

## How the work runs

One item at a time on `main`. Sessions that run in parallel each work in their own git worktree and
commit only their own files. Additions to the shared registration points (`VerbRegistry.cs`,
`VerbSpecs.cs`, `Model/Code.cs`, the contract in `src/WorldEngine.Contract`, the `docs/verbs.md`
index, `CLAUDE.md`) are one line or one entry each, so parallel work conflicts at most trivially.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- Named coarse levels (`empty`/`half`/`full`, `fresh`/`stub`): the middleware translates them into the
  percentage and condition forms (`docs/forms.md`), unless several callers need them or they hold an
  invariant.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`), a generic relation graph,
  and continuous physics (Rapier/Box2D): revisit only when a concrete world needs them.
- More than single-parent `extends`: several parents, trait bundles, categories nothing reads, and
  see-through barriers (`docs/templates.md`).
- `move` suggesting where to stand: a free spot within reach of each thing is a position chosen to reach
  something, which is planning; `suggest` lists ids, never positions.
- A `distance` query: facts are true, false or unknown, and positions are in every observation.
- The verbs `turn` (it needs a facing direction), `use` (too general), `throw` (it would deal impact damage
  to agents) and `bandage` (a bleed stops by its count).
- Pathfinding: a caller routes around a barrier in several moves. Agents acting in parallel: a `beat` is an
  ordered batch.
- A gate or door that crushes what is in its way (a prop turning it on, the damage deciding whether the thing
  is destroyed or stops the closure): postponed in favour of pushing aside.
- Migrating stored worlds between `schema_version`s: an older world is refused, never read as if it matched
  (AGENTS.md: no silent migration); a tool comes when a world must be kept.
- Raised and set aside until a scenario needs them: several parents per event (`causes: [...]`) and a stored
  `root_id`; stepping onto shards having a consequence; an agent slipping through a gap, and a head sized apart
  from the body for bites; a wound from a detachment written by `edit`.
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed in `plans/candidates.md`.

## Items

One chain, promoted from `plans/candidates.md` ("Who authors templates"): a library of templates, worlds and
runs, each kept by revision. Decided by the maintainer: templates are fixed building blocks, never brought by a
scene and never made or changed inside a world; a template or world is changed only by writing a new revision,
and a revision never changes once written; a world links to its template revisions instead of copying them;
the caller chooses, before a run starts, the pinned or a newer revision of each template; deleting a world
deletes its runs. Exporting a run with its revisions copied in is not in it.

All three items live in `src/WorldEngine.Store/Library/` (new) and are reached by CLI requests that each name
`library`, a directory; the CLI stays a thin adapter (the scope line), so every request is one call of a Store
method. **The library is a directory holding `templates/`**, laid out as the repository's is, so the
repository root is a library: for now that is the one the maintainer uses. Moving to a directory of its own
happens as soon as a template is written for a story rather than for the engine, with no code change. The
suite never writes the repository's `templates/`: every library test copies it to a temp folder first, since
the goldens pin it. Every write takes the library's turn, `WorldLock.With(<library>/templates/.revisions, ...)`,
so two writers never interleave; reads take none.

### Library worlds: a scenario and a manifest, by revision

- **What:** `WorldLibrary` (`Library/WorldLibrary.cs`, new): a library world is a scenario and the template
  revisions it is pinned to, kept by revision; a world is added, edited (a new revision), listed and read.
- **Layout:** `worlds/<name>/<n>/scenario.json` (the scenario as given) and `worlds/<name>/<n>/manifest.json`
  (`{ templates: { <id>: <revision> } }`), `n` from 1. A name is an id-like token (lower letters, digits, `_`
  and `-`), else `invalid_world` (existing).
- **Rules:**
  - **Pinning.** A manifest pins every id of the latest set, each `Record`ed first, not only the scene's
    templates: an author's `spawn` or a beat may name any template in a run, and a closure of the scene's
    templates would miss them.
  - `TemplateLibrary.Resolve(library, manifest)` (new): the registry from the named revision files
    (`TemplateDirectory.ReadDeclarations` over their texts, then `TemplateResolver.Resolve`), so a world's set
    is the same however the latest set moves on. An unrecorded revision is `no_such_revision`.
  - **Add** `{ name, scenario }`: `world_exists` (existing) when the name is taken; the scenario checked as
    `init` checks it (`Checks.IsScenario`, then `WorldBuilder.Snapshot` against the pinned set, the snapshot
    discarded), else its existing refusal and nothing written; writes revision 1. **Edit** `{ name, scenario }`:
    the same checks, a new revision pinned to the latest set; `no_such_world` (existing) for an unknown name.
  - **Get** `{ name, revision? }` (latest by default): the scenario and the manifest. **List**: each name with
    its revisions.
- **CLI:** `world_add`, `world_edit`, `world_get`, `world_list`, each with `library`.
- **Files:** `Library/WorldLibrary.cs` (new), `Library/TemplateLibrary.cs` (`Resolve`), `Contract/Checks.cs`,
  `Cli/CliRunner.cs`, `docs/library.md`, `docs/api.md`.
- **Tests** (`LibraryWorldTests`): adding `scenarios/lab.json` writes revision 1 pinning every latest id; after
  a new `human` revision the world's resolved set still hashes (`TemplateHash`) as the set did at the add, and
  `world_edit` writes revision 2 pinning the new `human`; an invalid scenario is refused with nothing written;
  a taken name is `world_exists`; each request through `CliRunner`.
- **Done when:** as above.
- **Depends on:** Template library.

### Runs from a world revision, linked to the library

- **What:** a run is a store world made from one world revision, linked to its template revisions by a
  manifest instead of a copied `templates.json`; the caller lists the newer revisions first and chooses.
  Deleting a world deletes its runs, and a template revision nothing names may be deleted.
- **Layout:** `runs/<world>/<run>/`, an ordinary world directory (`docs/persistence.md`) whose `templates.json`
  is replaced by `manifest.json`: `{ world, world_revision, templates: { <id>: <revision> } }`.
- **Rules:**
  - `WorldFiles.ReadTemplates(dir)`: `templates.json` when present, as today; else `manifest.json`, resolved by
    `TemplateLibrary.Resolve` with the library found by the layout (the directory three above the run). The
    hash, `verify`, checkpoints and every world request are unchanged, since they read the resolved set.
    `manifest.json` joins `WorldFiles.AllNames`. A world with neither is `invalid_templates`.
  - **Plan** `{ world, revision? }` (latest by default): `{ world, revision, newer: [{ template, pinned, latest }],
    added: [id...] }`, the pinned templates with a higher recorded or latest revision (each `Record`ed) and the
    latest ids the manifest does not pin.
  - **Start** `{ world, revision?, run, use? }`: `use` maps an id to a revision number or `"latest"`; the manifest
    with `use` applied (an added id is pinned too) is resolved and validated, else `invalid_templates`
    (`no_such_revision` for an unrecorded one); the scenario is built with it (`WorldBuilder.Snapshot`) and
    created by a `WorldBuilder.Create` overload that writes the manifest instead of the set. `world_exists` when
    the run is there. A fresh run has no log, so there is no lost-field check (`UpgradeTemplates`).
  - **List runs** `{ world }`: each run with its `world_revision`.
  - `WorldBuilder.Restart` from a linked run copies its manifest; `to` outside that library's
    `runs/<world>/` is refused `outside_library` (new), since the copy would not find its revisions.
  - **Delete a world** `{ name }`: takes each run's `WorldLock` (`store_busy` while one is held) and removes
    `worlds/<name>/` and `runs/<name>/`.
  - **Delete a template revision** `{ id, revision }`: refused `revision_in_use` (new) while any world
    revision's or run's manifest pins it, or it is the latest's recorded revision.
- **CLI:** `run_plan`, `run_start` (answers the run's directory and `snapshot_version`), `run_list`,
  `world_delete`, `template_revision_delete`, each with `library`; a run is then played by every existing request
  with `world: <library>/runs/<world>/<run>`.
- **Files:** `Library/RunLibrary.cs` (new), `Library/WorldLibrary.cs` (delete), `Library/TemplateLibrary.cs`
  (revision delete, the pin scan), `Store/WorldFiles.cs`, `Store/WorldBuilder.cs`, `Model/Code.cs`
  (`revision_in_use`, `outside_library`), `Contract/Checks.cs`, `Cli/CliRunner.cs`, `docs/library.md`,
  `docs/persistence.md` (one line for `manifest.json`), `docs/restart.md` (one line), `docs/api.md`.
- **Tests** (`LibraryRunTests`): a run started from the lab world has the snapshot and `templates_hash` that
  `init` of the scenario with the same set gives; commands on it reopen and `verify` passes; after a new `human`
  revision `run_plan` lists it, a second run with `use: { human: "latest" }` hashes as the new set, and the first
  still verifies; deleting `human` revision 1 is `revision_in_use`, and after `world_delete` (both runs gone) it
  succeeds; a restart within the library keeps the manifest, one outside is `outside_library`; each request
  through `CliRunner`.
- **Non-goals:** exporting a run with its revisions copied in, deleting a single run, moving a run between
  libraries, a run changing its template revisions once started.
- **Done when:** as above, and every existing golden is unchanged except the catalog golden's new codes.
- **Depends on:** Library worlds.

### Identity by appearance: a body seen is named by the face it wears

Promoted from `plans/candidates.md`, triggered by `scenarios/disguise.json` (`docs/limits-disguise.md`). Decided
by the maintainer: the face only for now, no voice.

- **What:** a body may look like another entity, and an observer that only sees it names it as that entity: the
  alias, `name` and `template` of the one it looks like. Touch and smell see through it. Today a seen body is
  shown by its own alias (hashed from the view's key and its id), name and template (`ActorWorld`), so the
  engine itself would give a disguise away.
- **Prop** (`Engine/Prop.cs` and its table, `docs/fields.md`): `appearance` (state, id) on a body, the entity it
  looks like; absent, itself. Written by a scene entry's `props` (as `possessed_by` is, the scenario id resolved)
  or the author's `update_props`. `SnapshotValidation` adds it to the dangling-reference loop beside
  `possessed_by` (`SnapshotValidation.cs`, the `link` loop), so the entity it names cannot be removed while worn.
- **Rules** (`Worlds/ActorWorld.cs`, `Worlds/PlayerWorld.cs`):
  - **Shown.** For each entity the view lists or names, the *shown* id is its `appearance` when the observer's
    senses of it (the projection's `senses`, merged across a slot's bodies in `PlayerWorld`) are sight without
    touch or smell; otherwise its own id. Its alias is `ActorAlias.Of(key, shown)`, and `name` and `template`
    are the shown entity's. Facts, props, parts, `holds` and `size_cm` stay the body's own. A reference to it
    (in another entity's facts, an event's `entity`, an id prop, `reason_data`) uses the same shown id. With no
    `appearance` anywhere every alias is today's, so no golden moves.
  - **Read back.** An alias names every entity whose shown alias it is: one is the target, as today; two (sean
    and castor wearing his face, both only seen) answer `ambiguous` with both as candidates, as an ambiguous
    name does, and nothing is applied. A name in a command resolves against the shown names the same way.
  - **Invariant:** the alias in an observation is the alias a command of the view resolves, and no alias, name,
    fact or event in a view leads back to a worn-over id: `ActorGoldenTests`' rule, extended.
  - The omniscient record (`snapshot`, `trace`, `since`, `perceivers`, the trusted `observe` and `inspect`)
    keeps every id and own name.
- **Files:** `Engine/Prop.cs`, `Engine/SnapshotValidation.cs`, `Worlds/ActorWorld.cs`, `Worlds/PlayerWorld.cs`,
  `docs/appearance.md` (new, ≤ 40 lines, indexed in `docs/DESIGN.md`), `docs/actor-view.md` (one paragraph),
  `docs/fields.md`, `docs/limits-disguise.md` (its first line is built: removed, the other two kept).
- **Tests** (`AppearanceTests`, on the disguise scene with castor's `appearance` sean):
  `LimitsDisguiseTests.A_seen_body_is_shown_by_its_own_alias_name_and_template` becomes its opposite: the guard
  gets one alias for both, named `sean`, and a command naming it is `ambiguous` with two candidates; an
  observer that touches castor gets castor's own alias and name; clearing `appearance` brings castor's alias back; no observation of the guard's
  contains castor's id or name; removing sean while worn is a `dangling_reference`; a store world folds alike.
- **Non-goals:** voice; a face as a part that moves between bodies (the head is not detachable; a face entity
  for Sockets later); an observer linking two aliases to one body (knowledge); a shown `parts` or `size_cm`.
- **Done when:** the tests pass, `dotnet test WorldEngine.slnx` and the deep run pass, and every existing golden
  is unchanged.
- **Depends on:** nothing.
