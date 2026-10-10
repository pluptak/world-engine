import { z } from "zod";

export const IdSchema = z.string();

export const PosSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
}).strict();

// A position written against a named reference point; it resolves to anchor.pos + (dx, dy).
export const AnchorPosSchema = z.object({
  anchor: z.string().min(1),
  dx: z.number().int(),
  dy: z.number().int(),
}).strict();

const PlacementPosSchema = z.union([PosSchema, AnchorPosSchema]);

const PrimitiveSchema = z.union([z.number(), z.string(), z.boolean()]);

const ModifierSchema = z.object({
  capacity: z.string(),
  delta: z.number().int(),
  expires_at_tick: z.number().int().nullable(),
  cause_id: z.string(),
}).strict();

const PartStateSchema = z.object({
  integrity: z.number().int().min(0).max(100),
  status: z.enum(["intact", "damaged", "detached", "destroyed"]),
}).strict();

export const CommandSchema = z.object({
  command_id: IdSchema,
  actor: IdSchema,
  verb: z.string(),
  target: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  perceivers: z.boolean().optional(),
}).strict();

// What an actor op may send: the actor is the request's own, and `perceivers` is the world's record,
// so a command that names either is invalid rather than quietly obeyed.
const ActorCommandSchema = CommandSchema.pick({ command_id: true, verb: true, target: true, args: true }).strict();

export const QuerySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fact"),
    subject: IdSchema,
    relation: z.string(),
    object: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("perceive"),
    observer: IdSchema,
    event_id: IdSchema.optional(),
    entity: IdSchema.optional(),
    sense: z.string(),
  }).strict(),
]);

export const EntityOverridesSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  location: z.string().nullable().optional(),
  support: z.string().nullable().optional(),
  contained_in: z.string().nullable().optional(),
  in_part: z.string().nullable().optional(),
  concealed_by: z.string().nullable().optional(),
  pos: PosSchema.nullable().optional(),
  detached_from: z.object({ entity: z.string(), part: z.string() }).strict().nullable().optional(),
  integrity: z.number().int().optional(),
  status: z.enum(["intact", "broken", "destroyed"]).optional(),
  residue: z.record(z.string(), z.number().int()).optional(),
  modifiers: z.array(ModifierSchema).optional(),
  props: z.record(z.string(), PrimitiveSchema).optional(),
  traits: z.record(z.string(), z.string()).optional(),
}).strict();

// A scenario entry may place its entity against an anchor; a spawn edit may not, so only the
// scenario's overrides admit the anchor form of a position.
// The architect's forms (`src/engine/forms.ts`) are scenario-only; the engine refuses a bad one with its own
// code, so the percentages are numbers here and not narrowed to whole ones.
export const ScenarioOverridesSchema = EntityOverridesSchema.extend({
  pos: PlacementPosSchema.nullable().optional(),
  fuel_pct: z.number().optional(),
  liquid: z.object({ material: z.string().optional(), pct: z.number() }).strict().optional(),
  condition: z.string().optional(),
  hunger_pct: z.number().optional(),
  portions_pct: z.number().optional(),
});

// A scenario entry may declare a name for the entity it spawns; createWorld resolves names to ids
// before anything spawns, so a duplicate, an unknown reference, or an id-shaped name is refused.
export const ScenarioSchema = z.array(z.object({
  id: z.string().min(1).optional(),
  template: z.string().min(1),
  overrides: ScenarioOverridesSchema.optional(),
}).strict());

// A scenario file is the list above, or a scene: that list as `entities` beside the `seed` the world's
// dice start from (a whole number from 0 to 2^32 - 1), the `beats` queued at creation and the `run`'s
// limits (`docs/scenario.md`). A list alone gives a world no seed, no beats and no run. The engine reads
// each beat's body and each run key, and refuses what is wrong with `invalid_scenario`.
export const SeededScenarioSchema = z.object({
  seed: z.number().int().min(0).max(4294967295).optional(),
  entities: ScenarioSchema,
  beats: z.array(z.record(z.string(), z.unknown())).optional(),
  run: z.object({
    tick_limit: z.number().int().min(1).optional(),
    slots: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
}).strict();

// The beat action and its followers, written once: a scheduled beat carries them in the snapshot's
// schedule, and `schedule_beat` carries them in an edit.
const BeatActionFieldsSchema = {
  action: z.record(z.string(), z.unknown()),
  only_if: z.record(z.string(), z.unknown()).optional(),
  then: z.array(z.record(z.string(), z.unknown())).optional(),
  repeat: z.record(z.string(), z.unknown()).optional(),
};

export const WorldEditSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("spawn"),
    template: z.string().min(1),
    overrides: EntityOverridesSchema.optional(),
  }).strict(),
  z.object({ kind: z.literal("remove"), target: IdSchema }).strict(),
  z.object({
    kind: z.literal("place"),
    target: IdSchema,
    support: IdSchema.nullable().optional(),
    contained_in: IdSchema.nullable().optional(),
    in_part: IdSchema.nullable().optional(),
    concealed_by: IdSchema.nullable().optional(),
    pos: PlacementPosSchema.nullable().optional(),
  }).strict(),
  z.object({
    kind: z.literal("set_props"),
    target: IdSchema,
    props: z.record(z.string(), PrimitiveSchema),
  }).strict(),
  z.object({
    kind: z.literal("update_props"),
    target: IdSchema,
    props: z.record(z.string(), PrimitiveSchema),
  }).strict(),
  z.object({ kind: z.literal("set_seed"), seed: z.number().int().min(0).max(4294967295) }).strict(),
  // The action and the followers are checked by the engine, which answers `invalid_args`.
  z.object({
    kind: z.literal("schedule_beat"),
    id: z.string(),
    at_tick: z.number().int(),
    ...BeatActionFieldsSchema,
  }).strict(),
  z.object({ kind: z.literal("cancel_beat"), id: z.string() }).strict(),
  // The engine checks the id is pending and the tick ahead, answering `no_such_beat` and `beat_in_past`.
  z.object({ kind: z.literal("retime_beat"), id: z.string(), at_tick: z.number().int() }).strict(),
  // The run's edits: a registering run starts, a running one ends (`docs/run.md`).
  z.object({ kind: z.literal("start_run") }).strict(),
  z.object({ kind: z.literal("register_player"), handle: z.string().min(1), slot: IdSchema }).strict(),
  z.object({ kind: z.literal("end_run") }).strict(),
  z.object({
    kind: z.literal("set_part"),
    target: IdSchema,
    part: z.string().min(1),
    state: PartStateSchema,
  }).strict(),
  z.object({ kind: z.literal("refine"), target: IdSchema, template: z.string().min(1) }).strict(),
]);

const CapacityRequirementSchema = z.object({
  capacity: z.string(),
  at_least: z.number().int(),
}).strict();

const CarryAlternativeSchema = z.object({
  capacity: z.string(),
  per_hand: z.number().int().optional(),
  at_least: z.number().int().optional(),
  max_hands: z.number().int().optional(),
  mass_limit_prop: z.string().optional(),
  holds: z.number().int().optional(),
}).strict();

const AttackModeSchema = z.object({
  capacity: z.string(),
  at_least: z.number().int(),
  damage_prop: z.string(),
  crosses_gap: z.enum(["limb", "body"]),
}).strict();

const ArgDeclSchema = z.union([
  z.object({
    kind: z.enum(["address", "address_list", "pos", "room", "int", "world_edit", "token"]),
    optional: z.boolean().optional(),
  }).strict(),
  z.object({ kind: z.literal("enum"), values: z.array(z.string()), optional: z.boolean().optional() }).strict(),
]);

const VerbCatalogEntrySchema = z.object({
  verb: z.string(),
  requires_target: z.boolean(),
  args: z.record(z.string(), ArgDeclSchema),
  duration: z.union([
    z.object({ ticks: z.number().int().nonnegative() }).strict(),
    z.object({ arg: z.string() }).strict(),
  ]),
  requires: z.array(CapacityRequirementSchema),
  carry_alternatives: z.array(CarryAlternativeSchema),
  attack_modes: z.array(AttackModeSchema),
  refuses: z.array(z.string()),
}).strict();

export const RequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("command"),
    world: z.string().min(1),
    based_on_version: z.number().int().optional(),
    command: CommandSchema,
    include_snapshot: z.boolean().optional(),
    observe: z.boolean().optional(),
  }).strict(),
  z.object({
    op: z.literal("edit"),
    world: z.string().min(1),
    command_id: IdSchema.optional(),
    based_on_version: z.number().int().optional(),
    edit: WorldEditSchema,
    perceivers: z.boolean().optional(),
    include_snapshot: z.boolean().optional(),
  }).strict(),
  // A director's edit (`docs/roles.md`): the same as `edit`, sent under the director role.
  z.object({
    op: z.literal("director_edit"),
    world: z.string().min(1),
    command_id: IdSchema.optional(),
    based_on_version: z.number().int().optional(),
    edit: WorldEditSchema,
    perceivers: z.boolean().optional(),
    include_snapshot: z.boolean().optional(),
  }).strict(),
  z.object({
    op: z.literal("check"),
    world: z.string().min(1),
    command: CommandSchema,
  }).strict(),
  z.object({
    op: z.literal("since"),
    world: z.string().min(1),
    version: z.number().int(),
  }).strict(),
  z.object({
    op: z.literal("attempts"),
    world: z.string().min(1),
    version: z.number().int(),
  }).strict(),
  z.object({
    op: z.literal("verify"),
    world: z.string().min(1),
  }).strict(),
  z.object({
    op: z.literal("trace"),
    world: z.string().min(1),
    query: z.union([
      z.object({ event_id: IdSchema }).strict(),
      z.object({ entity: IdSchema, field: z.string().min(1) }).strict(),
    ]),
  }).strict(),
  z.object({
    op: z.literal("beat"),
    world: z.string().min(1),
    based_on_version: z.number().int().optional(),
    commands: z.array(CommandSchema),
    include_snapshot: z.boolean().optional(),
  }).strict(),
  // One round (`docs/rounds.md`): the moves decided against one world, taken in an order no caller picks,
  // and the clock's one tick. A move carries no `round` flag: the round sets it.
  z.object({
    op: z.literal("round"),
    world: z.string().min(1),
    moves: z.array(CommandSchema),
  }).strict(),
  z.object({
    op: z.literal("query"),
    world: z.string().min(1),
    query: QuerySchema,
  }).strict(),
  z.object({
    op: z.literal("observe"),
    world: z.string().min(1),
    observer: IdSchema,
    since: z.number().int().optional(),
  }).strict(),
  z.object({
    op: z.literal("snapshot"),
    world: z.string().min(1),
  }).strict(),
  // What the world will do by itself, as stored, filtered (`docs/schedule-api.md`); changes nothing.
  z.object({
    op: z.literal("schedule"),
    world: z.string().min(1),
    filter: z.object({
      kind: z.enum(["close", "bleed", "process", "beat"]).optional(),
      entity: IdSchema.optional(),
      until_tick: z.number().int().optional(),
    }).strict().optional(),
  }).strict(),
  z.object({
    op: z.literal("verbs"),
  }).strict(),
  z.object({
    op: z.literal("capabilities"),
  }).strict(),
  // The presets of a world's template set, or of the shipped one when no world is named.
  z.object({
    op: z.literal("catalog"),
    world: z.string().min(1).optional(),
  }).strict(),
  z.object({
    op: z.literal("schema"),
  }).strict(),
  z.object({
    op: z.literal("inspect"),
    world: z.string().min(1),
    observer: IdSchema,
    entity: IdSchema,
  }).strict(),
  z.object({
    op: z.literal("options"),
    world: z.string().min(1),
    actor: IdSchema,
    refused: z.boolean().optional(),
  }).strict(),
  // One actor's side of the world (`actorWorld`): a runtime limited to these five ops learns only what
  // that actor could sense or name.
  z.object({
    op: z.literal("actor_observe"),
    world: z.string().min(1),
    actor: IdSchema,
    since_tick: z.number().int().optional(),
  }).strict(),
  z.object({
    op: z.literal("actor_inspect"),
    world: z.string().min(1),
    actor: IdSchema,
    entity: IdSchema,
  }).strict(),
  z.object({
    op: z.literal("actor_options"),
    world: z.string().min(1),
    actor: IdSchema,
    refused: z.boolean().optional(),
  }).strict(),
  z.object({
    op: z.literal("actor_check"),
    world: z.string().min(1),
    actor: IdSchema,
    command: ActorCommandSchema,
  }).strict(),
  z.object({
    op: z.literal("actor_command"),
    world: z.string().min(1),
    actor: IdSchema,
    command: ActorCommandSchema,
  }).strict(),
]);

export const EntitySchema = z.object({
  id: IdSchema,
  template: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  location: IdSchema.nullable(),
  support: IdSchema.nullable(),
  contained_in: IdSchema.nullable(),
  in_part: z.string().nullable(),
  concealed_by: IdSchema.nullable(),
  pos: PosSchema.nullable(),
  detached_from: z.object({ entity: IdSchema, part: z.string() }).strict().nullable(),
  integrity: z.number().int().min(0).max(100),
  status: z.enum(["intact", "broken", "destroyed"]),
  parts: z.record(z.string(), PartStateSchema),
  residue: z.record(z.string(), z.number().int()),
  modifiers: z.array(ModifierSchema),
  props: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  traits: z.record(z.string(), z.string()).optional(),
}).strict();

export const CoverageSchema = z.object({
  relations: z.array(z.string()),
  senses: z.array(z.string()),
  properties: z.array(z.string()),
}).strict();

// A pending cause as stored (`docs/schedule.md`), also what the schedule read answers with.
export const ScheduledCauseSchema = z.discriminatedUnion("kind", [
  z.object({ due_tick: z.number().int(), kind: z.literal("close"), entity: IdSchema, cause_id: IdSchema.nullable() }).strict(),
  z.object({
    due_tick: z.number().int(),
    kind: z.literal("bleed"),
    entity: IdSchema,
    cause_id: IdSchema,
    remaining: z.number().int(),
  }).strict(),
  z.object({
    due_tick: z.number().int(),
    kind: z.literal("process"),
    entity: IdSchema,
    cause_id: IdSchema.nullable(),
    process: z.string(),
  }).strict(),
  z.object({
    due_tick: z.number().int(),
    kind: z.literal("beat"),
    entity: IdSchema,
    cause_id: IdSchema.nullable(),
    id: z.string(),
    ...BeatActionFieldsSchema,
  }).strict(),
]);

// A scene's run as stored (`docs/run.md`): a tick limit, the agents that are its slots, or both, and its state.
export const RunSchema = z.object({
  tick_limit: z.number().int().min(1).optional(),
  slots: z.array(IdSchema).min(1).optional(),
  state: z.enum(["registering", "running", "ended"]),
  ended: z.object({
    reason: z.enum(["director", "tick_limit", "no_live_players"]),
    tick: z.number().int(),
  }).strict().optional(),
  players: z.array(z.object({ handle: z.string().min(1), slot: IdSchema }).strict()).optional(),
}).strict();

// The role a command was sent under (`docs/roles.md`); absent for the author.
export const BySchema = z.object({
  role: z.enum(["author", "director", "player"]),
  handle: z.string().min(1).optional(),
}).strict();

export const SnapshotSchema = z.object({
  version: z.number().int(),
  tick: z.number().int(),
  next_seq: z.number().int(),
  templates_hash: z.string(),
  coverage: CoverageSchema,
  entities: z.record(z.string(), EntitySchema),
  schedule: z.array(ScheduledCauseSchema).optional(),
  run: RunSchema.optional(),
  rng: z.number().int().optional(),
}).strict();

export const PerceiversSchema = z.object({
  sight: z.array(IdSchema),
  hearing: z.array(IdSchema),
  smell: z.array(IdSchema),
  touch: z.array(IdSchema),
  unknown_senses: z.array(z.string()),
}).strict();

export const WorldEventSchema = z.object({
  event_id: IdSchema,
  cause_id: IdSchema.nullable(),
  command_id: IdSchema,
  tick: z.number().int(),
  type: z.string(),
  entity: IdSchema,
  data: z.record(z.string(), z.unknown()),
  perceivers: PerceiversSchema.optional(),
}).strict();

export const DeltaSchema = z.object({
  event_id: IdSchema,
  entity: IdSchema,
  field: z.string(),
  from: z.unknown(),
  to: z.unknown(),
}).strict();

export const StatusSchema = z.enum([
  "ok",
  "refused",
  "ambiguous",
  "unresolved",
  "preempted",
  "invalid",
]);

// Structured refusal data: ints and id strings only, never prose.
export const ReasonDataSchema = z.record(z.string(), z.union([z.number().int(), z.string()]));

const ObservedEntitySchema = z.object({
  id: IdSchema,
  template: z.string(),
  name: z.string(),
  senses: z.array(z.string()),
  facts: z.object({
    location: IdSchema.nullable().optional(),
    support: IdSchema.nullable().optional(),
    contained_in: IdSchema.nullable().optional(),
    in_part: z.string().nullable().optional(),
    status: z.string().optional(),
    integrity: z.number().int().optional(),
    residue: z.record(z.string(), z.number().int()).optional(),
    pos: PosSchema.nullable().optional(),
  }).strict().optional(),
});

export const ProjectionSchema = z.object({
  observer: IdSchema,
  version: z.number().int(),
  unknown_senses: z.array(z.string()),
  entities: z.array(ObservedEntitySchema.strict()),
  events: z.array(z.object({
    event_id: IdSchema,
    tick: z.number().int(),
    type: z.string(),
    entity: IdSchema.optional(),
    from: z.enum(["here", "next_door", "intercom"]).optional(),
    senses: z.array(z.string()),
    utterance: z.string().optional(),
    volume: z.string().optional(),
  }).strict().refine((event) => (event.entity === undefined) !== (event.from === undefined), {
    message: "an observed event names its entity or says where it was heard from, never both or neither",
  })),
}).strict();

// What an actor sees: the tick in place of the version, which would count others' commands.
export const ActorProjectionSchema = ProjectionSchema.omit({ version: true }).extend({
  tick: z.number().int(),
}).strict();

// An amount as a look reads it: a band of whole percentages of what full is.
const LevelSchema = z.object({
  min_pct: z.number().int().min(0).max(100),
  max_pct: z.number().int().min(0).max(100),
}).strict();

export const InspectResponseSchema = z.object({
  inspection: ObservedEntitySchema.extend({
    props: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    levels: z.object({
      liquid_amount: LevelSchema.optional(),
      fuel: LevelSchema.optional(),
    }).strict().optional(),
    size_cm: z.object({ w: z.number(), d: z.number(), h: z.number() }).strict().optional(),
    parts: z.array(z.object({
      name: z.string(),
      status: z.enum(["intact", "damaged", "detached", "destroyed"]),
      integrity: z.number().int().optional(),
    }).strict()).optional(),
    reachable: z.boolean().optional(),
    holds: z.array(IdSchema).optional(),
    traits: z.record(z.string(), z.string()).optional(),
  }).strict().nullable(),
}).strict();

export const OptionsResponseSchema = z.object({
  actor: IdSchema,
  version: z.number().int(),
  ready: z.array(z.object({ verb: z.string(), target: IdSchema.optional(), args: z.record(z.string(), z.unknown()).optional() }).strict()),
  needs_args: z.array(z.string()),
  blocked: z.array(z.object({
    verb: z.string(),
    target: IdSchema.optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    reason_code: z.string(),
  }).strict()).optional(),
}).strict();

export const ActorOptionsResponseSchema = OptionsResponseSchema.omit({ version: true }).strict();

// The verdict a command or a check answers with, written once: the two responses agree about which
// fields a verdict carries, and `attempts` rows carry the same codes.
const VerdictFieldsSchema = {
  status: StatusSchema,
  command_id: IdSchema,
  resolved_target: IdSchema.nullable(),
  candidates: z.array(IdSchema).optional(),
  reason_code: z.string().optional(),
  reason_data: ReasonDataSchema.optional(),
};

export const CommandResponseSchema = z.object({
  ...VerdictFieldsSchema,
  snapshot_version: z.number().int(),
  deltas: z.array(DeltaSchema),
  events: z.array(WorldEventSchema),
  snapshot: SnapshotSchema.optional(),
  observation: ProjectionSchema.optional(),
}).strict();

export const AnswerSchema = z.object({
  value: z.enum(["true", "false", "unknown"]),
  basis_code: z.string(),
}).strict();

export const CheckResponseSchema = z.object({
  ...VerdictFieldsSchema,
}).strict();

// An actor command's verdict and what the actor sensed of it: never the snapshot, deltas or events.
export const ActorCommandResponseSchema = CheckResponseSchema.extend({
  observation: ActorProjectionSchema,
}).strict();

export const SinceResponseSchema = z.object({
  deltas: z.array(DeltaSchema),
  events: z.array(WorldEventSchema),
}).strict();

// Where a logged command stood in a round (`docs/rounds.md`).
export const RoundMarkSchema = z.object({
  number: z.number().int(),
  place: z.number().int().optional(),
  close: z.literal(true).optional(),
}).strict();

export const AttemptsResponseSchema = z.object({
  attempts: z.array(z.object({
    command: CommandSchema.extend({ round: z.boolean().optional(), by: BySchema.optional() }),
    based_on_version: z.number().int(),
    version: z.number().int(),
    status: StatusSchema,
    reason_code: z.string().optional(),
    reason_data: ReasonDataSchema.optional(),
    candidates: z.array(IdSchema).optional(),
    round: RoundMarkSchema.optional(),
    by: BySchema.optional(),
  }).strict()),
}).strict();

export const VerifyResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    entries: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    divergence: z.object({
      file: z.union([
        z.enum(["snapshot.json", "events.jsonl", "deltas.jsonl", "log.jsonl"]),
        z.string().regex(/^checkpoints\/\d+-\d+\.json$/),
      ]),
      line: z.number().int().nonnegative(),
      code: z.enum(["differs", "missing", "extra", "status_differs"]),
    }).strict(),
  }).strict(),
]);

export const TraceResponseSchema = z.object({
  events: z.array(WorldEventSchema),
}).strict();

export const ScheduleResponseSchema = z.object({
  schedule: z.array(ScheduledCauseSchema),
}).strict();

export const BeatResponseSchema = z.object({
  results: z.array(CommandResponseSchema),
}).strict();

export const RoundResponseSchema = z.object({
  status: StatusSchema,
  reason_code: z.string().optional(),
  round: z.number().int().optional(),
  results: z.array(CommandResponseSchema),
  closing: CommandResponseSchema.optional(),
}).strict();

export const VerbsResponseSchema = z.object({
  verbs: z.array(VerbCatalogEntrySchema),
}).strict();

const CatalogFormsSchema = z.object({
  fuel_pct: z.number().int().optional(),
  liquid: z.object({ material: z.string().nullable(), pct: z.number().int() }).strict().optional(),
  condition: z.literal("intact"),
  hunger_pct: z.number().int().optional(),
  portions_pct: z.number().int().optional(),
  approximate: z.array(z.enum(["liquid", "hunger_pct"])).optional(),
}).strict();

const CatalogEntrySchema = z.object({
  template: z.string(),
  size_cm: z.object({ w: z.number(), d: z.number(), h: z.number() }).strict(),
  mass_g: z.number(),
  container: z.boolean(),
  surface: z.boolean(),
  openable: z.boolean(),
  barrier: z.boolean(),
  light_source: z.boolean(),
  agent: z.boolean(),
  capacity_cm3: z.number().int().optional(),
  parts: z.array(z.string()),
  capacities: z.record(z.string(), z.number()),
  breaks_into: z.array(z.string()),
  forms: CatalogFormsSchema,
}).strict();

export const CatalogResponseSchema = z.object({
  catalog: z.array(CatalogEntrySchema),
}).strict();

export const CapabilitiesResponseSchema = z.object({
  relations: z.array(z.string()),
  senses: z.array(z.string()),
  computed_properties: z.array(z.string()),
}).strict();


export const ValidationIssueSchema = z.object({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
}).passthrough();

export const ValidationFailureSchema = z.object({
  status: z.literal("invalid"),
  issues: z.array(ValidationIssueSchema),
}).strict();

// What `{ "op": "schema" }` answers: the JSON Schema (draft 2020-12, from `z.toJSONSchema`) of every
// request and of the response each op gives, so a caller in another language, or one generating tool
// definitions, need not read this file. `failure` is the answer any op gives to a request it refuses.
export const SchemaResponseSchema = z.object({
  json_schema: z.literal("2020-12"),
  request: z.record(z.string(), z.unknown()),
  responses: z.record(z.string(), z.record(z.string(), z.unknown())),
  failure: z.record(z.string(), z.unknown()),
}).strict();

export type Request = z.infer<typeof RequestSchema>;
export type Op = Request["op"];

// The schema each op answers with. Every op of `RequestSchema` has exactly one entry (the compiler holds
// it to that), and `ResponseSchema`, which the CLI checks every answer against, is built from these.
// The order is the order the union tries them in, which decides what it parses an answer to.
export const RESPONSES = {
  command: CommandResponseSchema,
  edit: CommandResponseSchema,
  director_edit: CommandResponseSchema,
  query: AnswerSchema,
  snapshot: SnapshotSchema,
  check: CheckResponseSchema,
  actor_check: CheckResponseSchema,
  actor_command: ActorCommandResponseSchema,
  since: SinceResponseSchema,
  attempts: AttemptsResponseSchema,
  verify: VerifyResponseSchema,
  trace: TraceResponseSchema,
  schedule: ScheduleResponseSchema,
  beat: BeatResponseSchema,
  round: RoundResponseSchema,
  verbs: VerbsResponseSchema,
  capabilities: CapabilitiesResponseSchema,
  catalog: CatalogResponseSchema,
  schema: SchemaResponseSchema,
  inspect: InspectResponseSchema,
  actor_inspect: InspectResponseSchema,
  options: OptionsResponseSchema,
  actor_options: ActorOptionsResponseSchema,
  observe: ProjectionSchema,
  actor_observe: ActorProjectionSchema,
} satisfies Record<Op, z.ZodType>;

type AnyResponse = (typeof RESPONSES)[Op] | typeof ValidationFailureSchema;

export const ResponseSchema = z.union([
  ...new Set<AnyResponse>([...Object.values(RESPONSES), ValidationFailureSchema]),
] as [AnyResponse, ...AnyResponse[]]);

let described: z.infer<typeof SchemaResponseSchema> | undefined;

// The answer to the `schema` op. It depends on nothing but this file, so it is built once.
export function describeContract(): z.infer<typeof SchemaResponseSchema> {
  described ??= {
    json_schema: "2020-12",
    request: z.toJSONSchema(RequestSchema, { io: "input" }),
    responses: Object.fromEntries(Object.entries(RESPONSES).map(([op, schema]) => [op, z.toJSONSchema(schema)])),
    failure: z.toJSONSchema(ValidationFailureSchema),
  };
  return described;
}
