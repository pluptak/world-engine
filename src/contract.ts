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
}).strict();

// A scenario entry may place its entity against an anchor; a spawn edit may not, so only the
// scenario's overrides admit the anchor form of a position.
export const ScenarioOverridesSchema = EntityOverridesSchema.extend({
  pos: PlacementPosSchema.nullable().optional(),
});

// A scenario entry may declare a name for the entity it spawns; createWorld resolves names to ids
// before anything spawns, so a duplicate, an unknown reference, or an id-shaped name is refused.
export const ScenarioSchema = z.array(z.object({
  id: z.string().min(1).optional(),
  template: z.string().min(1),
  overrides: ScenarioOverridesSchema.optional(),
}).strict());

// A scenario file is the list above, or that list as `entities` beside the `seed` the world's dice
// start from (a whole number from 0 to 2^32 - 1); a list alone gives a world no seed.
export const SeededScenarioSchema = z.object({
  seed: z.number().int().min(0).max(4294967295).optional(),
  entities: ScenarioSchema,
}).strict();

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
    action: z.record(z.string(), z.unknown()),
    only_if: z.record(z.string(), z.unknown()).optional(),
    then: z.array(z.record(z.string(), z.unknown())).optional(),
    repeat: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({ kind: z.literal("cancel_beat"), id: z.string() }).strict(),
  z.object({
    kind: z.literal("set_part"),
    target: IdSchema,
    part: z.string().min(1),
    state: PartStateSchema,
  }).strict(),
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
  z.object({
    op: z.literal("verbs"),
  }).strict(),
  z.object({
    op: z.literal("capabilities"),
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
    since: z.number().int().optional(),
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
    based_on_version: z.number().int().optional(),
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
}).strict();

export const CoverageSchema = z.object({
  relations: z.array(z.string()),
  senses: z.array(z.string()),
  properties: z.array(z.string()),
}).strict();

export const SnapshotSchema = z.object({
  version: z.number().int(),
  tick: z.number().int(),
  next_seq: z.number().int(),
  templates_hash: z.string(),
  coverage: CoverageSchema,
  entities: z.record(z.string(), EntitySchema),
  schedule: z.array(z.discriminatedUnion("kind", [
    z.object({ due_tick: z.number().int(), kind: z.literal("close"), entity: IdSchema, cause_id: IdSchema }).strict(),
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
      cause_id: IdSchema,
      id: z.string(),
      action: z.record(z.string(), z.unknown()),
      only_if: z.record(z.string(), z.unknown()).optional(),
      then: z.array(z.record(z.string(), z.unknown())).optional(),
      repeat: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
  ])).optional(),
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
    from: z.enum(["here", "next_door"]).optional(),
    senses: z.array(z.string()),
    utterance: z.string().optional(),
    volume: z.string().optional(),
  }).strict().refine((event) => (event.entity === undefined) !== (event.from === undefined), {
    message: "an observed event names its entity or says where it was heard from, never both or neither",
  })),
}).strict();

export const InspectResponseSchema = z.object({
  inspection: ObservedEntitySchema.extend({
    props: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    size_cm: z.object({ w: z.number(), d: z.number(), h: z.number() }).strict().optional(),
    parts: z.array(z.object({
      name: z.string(),
      status: z.enum(["intact", "damaged", "detached", "destroyed"]),
      integrity: z.number().int().optional(),
    }).strict()).optional(),
    reachable: z.boolean().optional(),
    holds: z.array(IdSchema).optional(),
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

export const CommandResponseSchema = z.object({
  status: StatusSchema,
  command_id: IdSchema,
  resolved_target: IdSchema.nullable(),
  candidates: z.array(IdSchema).optional(),
  reason_code: z.string().optional(),
  reason_data: ReasonDataSchema.optional(),
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
  status: StatusSchema,
  command_id: IdSchema,
  resolved_target: IdSchema.nullable(),
  candidates: z.array(IdSchema).optional(),
  reason_code: z.string().optional(),
  reason_data: ReasonDataSchema.optional(),
}).strict();

// An actor command's verdict and what the actor sensed of it: never the snapshot, deltas or events.
export const ActorCommandResponseSchema = CheckResponseSchema.extend({
  observation: ProjectionSchema,
}).strict();

export const SinceResponseSchema = z.object({
  deltas: z.array(DeltaSchema),
  events: z.array(WorldEventSchema),
}).strict();

export const AttemptsResponseSchema = z.object({
  attempts: z.array(z.object({
    command: CommandSchema,
    based_on_version: z.number().int(),
    version: z.number().int(),
    status: StatusSchema,
    reason_code: z.string().optional(),
    reason_data: ReasonDataSchema.optional(),
    candidates: z.array(IdSchema).optional(),
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

export const TraceQuerySchema = z.union([
  z.object({ event_id: IdSchema }).strict(),
  z.object({ entity: IdSchema, field: z.string().min(1) }).strict(),
]);

export const TraceResponseSchema = z.object({
  events: z.array(WorldEventSchema),
}).strict();

export const BeatResponseSchema = z.object({
  results: z.array(CommandResponseSchema),
}).strict();

export const VerbsResponseSchema = z.object({
  verbs: z.array(VerbCatalogEntrySchema),
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
  query: AnswerSchema,
  snapshot: SnapshotSchema,
  check: CheckResponseSchema,
  actor_check: CheckResponseSchema,
  actor_command: ActorCommandResponseSchema,
  since: SinceResponseSchema,
  attempts: AttemptsResponseSchema,
  verify: VerifyResponseSchema,
  trace: TraceResponseSchema,
  beat: BeatResponseSchema,
  verbs: VerbsResponseSchema,
  capabilities: CapabilitiesResponseSchema,
  schema: SchemaResponseSchema,
  inspect: InspectResponseSchema,
  actor_inspect: InspectResponseSchema,
  options: OptionsResponseSchema,
  actor_options: OptionsResponseSchema,
  observe: ProjectionSchema,
  actor_observe: ProjectionSchema,
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

export type Query = z.infer<typeof QuerySchema>;
export type Response = z.infer<typeof ResponseSchema>;
