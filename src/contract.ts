import { z } from "zod";

export const IdSchema = z.string();

export const PosSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
}).strict();

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
}).strict();

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
  pos: PosSchema.nullable().optional(),
  detached_from: z.object({ entity: z.string(), part: z.string() }).strict().nullable().optional(),
  integrity: z.number().int().optional(),
  status: z.enum(["intact", "broken", "destroyed"]).optional(),
  residue: z.record(z.string(), z.number().int()).optional(),
  modifiers: z.array(ModifierSchema).optional(),
  props: z.record(z.string(), PrimitiveSchema).optional(),
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
    pos: PosSchema.nullable().optional(),
  }).strict(),
  z.object({
    kind: z.literal("set_props"),
    target: IdSchema,
    props: z.record(z.string(), PrimitiveSchema),
  }).strict(),
  z.object({
    kind: z.literal("set_part"),
    target: IdSchema,
    part: z.string().min(1),
    state: PartStateSchema,
  }).strict(),
]);

export const RequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("command"),
    world: z.string().min(1),
    based_on_version: z.number().int().optional(),
    command: CommandSchema,
    include_snapshot: z.boolean().optional(),
  }).strict(),
  z.object({
    op: z.literal("edit"),
    world: z.string().min(1),
    command_id: IdSchema.optional(),
    based_on_version: z.number().int().optional(),
    edit: WorldEditSchema,
    include_snapshot: z.boolean().optional(),
  }).strict(),
  z.object({
    op: z.literal("query"),
    world: z.string().min(1),
    query: QuerySchema,
  }).strict(),
  z.object({
    op: z.literal("snapshot"),
    world: z.string().min(1),
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
}).strict();

export const WorldEventSchema = z.object({
  event_id: IdSchema,
  cause_id: IdSchema.nullable(),
  command_id: IdSchema,
  type: z.string(),
  entity: IdSchema,
  data: z.record(z.string(), z.unknown()),
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

export const CommandResponseSchema = z.object({
  status: StatusSchema,
  command_id: IdSchema,
  resolved_target: IdSchema.nullable(),
  candidates: z.array(IdSchema).optional(),
  reason_code: z.string().optional(),
  snapshot_version: z.number().int(),
  deltas: z.array(DeltaSchema),
  events: z.array(WorldEventSchema),
  snapshot: SnapshotSchema.optional(),
}).strict();

export const AnswerSchema = z.object({
  value: z.enum(["true", "false", "unknown"]),
  basis_code: z.string(),
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

export const ResponseSchema = z.union([
  CommandResponseSchema,
  AnswerSchema,
  SnapshotSchema,
  ValidationFailureSchema,
]);

export type Request = z.infer<typeof RequestSchema>;
export type Query = z.infer<typeof QuerySchema>;
export type Response = z.infer<typeof ResponseSchema>;
