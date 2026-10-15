# Template library

A library is a directory holding `templates/`, laid out as the repository's is.
The repository root is a library. `TemplateLibrary` (`Store/Library`) lists,
gets, puts and deletes its templates, every change kept as a revision.
`WorldLibrary` keeps the library's worlds the same way: a scenario and the
template revisions it is pinned to, by revision.

Layout:

- `templates/<id>.json` is the latest set, the file `TemplateDirectory` reads.
- `templates/.revisions/<id>/<n>.json`, `n` from 1 per template, holds every
  recorded revision in canonical form, never rewritten.
- `worlds/<name>/<n>/scenario.json` (the scenario as given) and `manifest.json`
  (`{ templates: { <id>: <revision> } }`), `n` from 1.

Rules:

- Ids. A template id is a plain file name: words of lower letters, digits and
  `_`, joined by `.` as a companion's are (`human.hand_l`). A put of any other
  is refused `invalid_templates`, a get or delete naming one `invalid_request`,
  before any path is made of it, so nothing outside `templates/` is read or
  written.
- Recording. Before any write for an id, the latest file whose canonical form
  differs from the highest recorded revision's (or with none recorded) is kept
  first as the next revision (`Record`, also used by later items).
- Put `{ template }`: the latest set with it in place of its id, resolved by
  `TemplateResolver`, else refused `invalid_templates` with nothing written. A
  declaration equal to the latest names the existing revision; otherwise the
  revision file is written, then `<id>.json`.
- Delete `{ id }`: drops `<id>.json` from the latest set, refused
  `invalid_templates` when the rest no longer resolves. Revisions stay.
- Get `{ id, revision? }`: the latest, or that revision's; `unknown_template`
  for an id with neither, `no_such_revision` for one not recorded.
- List: every id with a latest or a revision, `{ id, latest, revisions }`.

Worlds:

- A name is lower letters, digits, `_` and `-`, else `invalid_world`.
- A manifest pins every id of the latest set, each recorded first: an author's
  `spawn` or a beat may name any template, and a closure would miss them. The
  scenario is built against the latest set before anything is recorded, so a
  refused add or edit leaves the library as it was.
- `Resolve` rebuilds the registry from the named revision files, so a world's
  set never moves; an unrecorded revision is `no_such_revision`.
- Add `{ name, scenario }` writes revision 1, refused `world_exists` when taken;
  edit writes the next, refused `no_such_world` when unknown. The scenario is
  checked as `init` checks it, else its refusal and no world written.
- Get `{ name, revision? }` (latest by default) answers scenario and manifest;
  list answers each name with its revisions.

Every write takes the turn `WorldLock.With(<library>/templates/.revisions)`.
Reads take none. Tests copy `templates/` to a temp folder; the suite never
writes the repository's own.

Runs:

- `runs/<world>/<run>/` is an ordinary world directory whose `templates.json`
  is replaced by `manifest.json`: `{ world, world_revision, templates }`.
- `RunLibrary` plans, starts and lists them: `run_plan { world, revision? }`
  answers `{ world, revision, newer, added }`; `run_start` answers `{ run,
  snapshot_version }`; `run_list { world }` answers each run with its revision.
- A run is played by every existing request with `world: <library>/runs/<world>/<run>`.
- Deleting a world deletes its runs; a template revision nothing pins may be deleted.
