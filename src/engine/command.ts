import type { Delta, Entity, Id, PartState, Pos, ReasonData, Snapshot, Status, WorldEvent } from "../model.js";
import type { EntityOverrides } from "./spawn.js";
import type { TemplateRegistry } from "../templates.js";
import type { Projection } from "./projection.js";

// The reserved author of direct world edits: causality, not state, so it never appears in entities.
export const WORLD_AUTHOR: Id = "world";

export interface SpawnEdit {
  kind: "spawn";
  template: string;
  overrides?: EntityOverrides;
}

export interface RemoveEdit {
  kind: "remove";
  target: Id;
}

// A position written against a named reference point rather than in centimetres: it resolves, when
// the world is written, to anchor.pos + (dx, dy) and the anchor's room as the holder. Nothing keeps
// the anchor afterwards, so it adds no relation.
export interface AnchorPos {
  anchor: Id | string;
  dx: number;
  dy: number;
}

export interface PlaceEdit {
  kind: "place";
  target: Id;
  support?: Id | null;
  contained_in?: Id | null;
  // The holder's part the entity sits in; null clears it. Omitted leaves it as it is.
  in_part?: string | null;
  // What the entity is hidden under or behind; null clears it. Omitted leaves it as it is.
  concealed_by?: Id | null;
  pos?: Pos | AnchorPos | null;
}

// `set_props` replaces the entity's props with these; `update_props` writes these keys over them.
export interface PropsEdit {
  kind: "set_props" | "update_props";
  target: Id;
  props: Record<string, number | string | boolean>;
}

// The entity becomes a more specific preset: one that extends the one it is. Its definitions are the new
// preset's; the state it has stays where the new preset still has a field for it.
export interface RefineEdit {
  kind: "refine";
  target: Id;
  template: string;
}

export interface PartEdit {
  kind: "set_part";
  target: Id;
  part: string;
  state: PartState;
}

// Gives the world's dice a state, replacing the one it has: an integer from 0 to 2^32 - 1.
export interface SeedEdit {
  kind: "set_seed";
  seed: number;
}

// What a scheduled beat does when it falls due: a sound on an entity, or one of the author's own
// edits, applied through the same edit transition.
export interface SoundAction {
  kind: "sound";
  entity: Id;
  loud?: boolean;
}

export type BeatAction = SoundAction | SpawnEdit | RemoveEdit | PlaceEdit | PropsEdit | PartEdit;

// Read at the due tick, in one of three forms: an entity's prop against a value, whether an entity
// stands in a room, and whether a live agent does.
export interface PropCondition {
  entity: Id;
  prop: string;
  op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte";
  value: number | string | boolean;
}

export interface InCondition {
  entity: Id;
  in: Id;
}

export interface OccupiedCondition {
  room: Id;
  occupied: boolean;
}

export type SingleCondition = PropCondition | InCondition | OccupiedCondition;

// Every one of its conditions holds: one to `MAX_ALL` of the single forms, no nesting.
export interface AllCondition {
  all: SingleCondition[];
}

export type BeatCondition = SingleCondition | AllCondition;

// A beat that follows another, `delay_ticks` after its parent runs.
export interface BeatChild {
  id: string;
  delay_ticks: number;
  action: BeatAction;
  only_if?: BeatCondition;
  then?: BeatChild[];
}

// A beat that comes round again: `times` more runs, `every_ticks` apart, after the first. With
// `until_ran` it is a watch: it ends after the first run whose action ran, and a run whose condition
// is false records nothing.
export interface BeatRepeat {
  every_ticks: number;
  times: number;
  until_ran?: true;
}

// Puts a beat on the schedule for `at_tick`, which must be ahead of the clock. A repeating beat has
// no followers: its runs would schedule the same ids again while the last run's were still pending.
export interface ScheduleBeatEdit {
  kind: "schedule_beat";
  id: string;
  at_tick: number;
  action: BeatAction;
  only_if?: BeatCondition;
  then?: BeatChild[];
  repeat?: BeatRepeat;
}

// Withdraws a pending beat by id.
export interface CancelBeatEdit {
  kind: "cancel_beat";
  id: string;
}

// Moves a pending beat to `at_tick`, ahead of the clock, and changes nothing else about it: its action,
// condition, followers and cause stay as they were. A repeating beat's next run moves; its later runs follow.
export interface RetimeBeatEdit {
  kind: "retime_beat";
  id: string;
  at_tick: number;
}

export type WorldEdit =
  | SpawnEdit
  | RemoveEdit
  | PlaceEdit
  | PropsEdit
  | PartEdit
  | RefineEdit
  | SeedEdit
  | ScheduleBeatEdit
  | CancelBeatEdit
  | RetimeBeatEdit;

export interface Command {
  command_id: Id;
  actor: Id;
  verb: string;
  target?: string;
  args?: Record<string, unknown>;
  // Ask for the batch form of perceive: every event of an ok command names its perceivers.
  perceivers?: boolean;
}

export interface Result {
  status: Status;
  command_id: Id;
  resolved_target: Id | null;
  candidates?: Id[];
  reason_code?: string;
  reason_data?: ReasonData;
  snapshot: Snapshot;
  deltas: Delta[];
  events: WorldEvent[];
  // With `observe: true`: what the actor could sense afterwards, and which of this command's events.
  observation?: Projection;
}

// The verdict fields every view of a result carries, for the views that pass one through as it
// came: the API's check and the CLI's command response. A view that filters what the actor may see
// writes its own.
export function verdictFields(
  result: Result,
): Pick<Result, "status" | "command_id" | "resolved_target" | "candidates" | "reason_code" | "reason_data"> {
  return {
    status: result.status,
    command_id: result.command_id,
    resolved_target: result.resolved_target,
    ...(result.candidates !== undefined && { candidates: result.candidates }),
    ...(result.reason_code !== undefined && { reason_code: result.reason_code }),
    ...(result.reason_data !== undefined && { reason_data: result.reason_data }),
  };
}

// One submission as the world recorded it: what was tried, against which version, and how it came
// out. A store world keeps it as a log line; a failed one has no events and took no time.
export interface Attempt {
  command: Command;
  based_on_version: number;
  // The world's version when the command was decided; an ok one produced version + 1.
  version: number;
  status: Status;
  reason_code?: string;
  reason_data?: ReasonData;
  candidates?: Id[];
}

export function attemptOf(command: Command, basedOn: number, version: number, result: Result): Attempt {
  return {
    command,
    based_on_version: basedOn,
    version,
    status: result.status,
    ...(result.reason_code !== undefined && { reason_code: result.reason_code }),
    ...(result.reason_data !== undefined && { reason_data: result.reason_data }),
    ...(result.candidates !== undefined && { candidates: result.candidates }),
  };
}

export interface TargetAddress {
  entity_id: Id;
  part: string | null;
  address: Id;
}

export interface CommandContext {
  snapshot: Snapshot;
  registry: TemplateRegistry;
  command: Command;
  actor: Entity;
  target: TargetAddress | null;
  verb: Verb;
}

export interface TransitionContext extends CommandContext {
  root_event_id: Id | null;
  // Every change recorded so far in this command, in order: a live view, not a copy.
  deltas: readonly Delta[];
  // Every event emitted so far in this command, in order: also a live view.
  events: readonly WorldEvent[];
  recordDelta(entity: Id, field: string, from: unknown, to: unknown, eventId: Id): void;
  emit(type: string, entity: Id, data: Record<string, unknown>, causeId: Id | null): Id;
  set(entity: Id, field: string, value: unknown, eventId: Id): void;
  // The next number in [0, 1) from the world's own dice, advancing `snapshot.rng`. A world with no
  // seed refuses the whole command with `no_seed`; nothing here ever invents one.
  random(): number;
}

export type PreconditionResult =
  | { status: "ok" }
  | { status: "refused"; reason_code: string; reason_data?: ReasonData }
  | { status: "unresolved" }
  | { status: "ambiguous"; candidates: Id[] }
  | { status: "invalid"; reason_code: string };

// One way a body can hold a thing, tried in declaration order. `per_hand` scales with the item's
// `hands_required` (one hand needs per_hand, two need twice that); the flat form takes `at_least`
// of the capacity. `max_hands` refuses items needing more hands than the body part offers,
// `mass_limit_prop` names the carrier prop that caps the item's mass, and `holds` caps how many
// things the body part holds at once.
export interface CarryAlternative {
  capacity: string;
  per_hand?: number;
  at_least?: number;
  max_hands?: number;
  mass_limit_prop?: string;
  holds?: number;
}

// An unconditional capacity floor for acting at all, read from the verb's own declaration.
export interface CapacityRequirement {
  capacity: string;
  at_least: number;
}

// One way a body can strike: it needs at_least of the capacity, and the damage comes from the
// attacker's prop the mode names.
export interface AttackMode {
  capacity: string;
  at_least: number;
  damage_prop: string;
  // Across a barrier's gap: a `limb` reaches through any gap, a `body` strike (a bite) needs the
  // attacker's own smallest dimension to fit it.
  crosses_gap: "limb" | "body";
}

// One entry of a verb's declared args shape; `enum` carries its values. A `token` is an opaque
// string of 1-64 letters, digits and `_.:-` that the engine stores and never reads. `optional` says
// the command may leave the arg out.
export interface ArgDecl {
  kind: "address" | "address_list" | "pos" | "room" | "int" | "enum" | "world_edit" | "token";
  values?: readonly string[];
  optional?: boolean;
}

// How many ticks an ok command takes: a fixed count, or the value of the named positive int arg.
export type VerbDuration = { ticks: number } | { arg: string };

// What the engine tells a caller about one verb, read from the verb's own declarations.
export interface VerbCatalogEntry {
  verb: string;
  requires_target: boolean;
  args: Readonly<Record<string, ArgDecl>>;
  duration: VerbDuration;
  requires: readonly CapacityRequirement[];
  carry_alternatives: readonly CarryAlternative[];
  attack_modes: readonly AttackMode[];
  refuses: readonly string[];
}

// The beat an advance stops before: its id, and the tick it falls due at, which names the one run stopped for.
export interface StopBeat {
  id: string;
  due_tick: number;
}

export interface Verb {
  requires_target: boolean;
  // Only the reserved author `world` may issue it, and it needs no agent body: `edit` and `advance`.
  author_only?: boolean;
  args: Readonly<Record<string, ArgDecl>>;
  refuses: readonly string[];
  duration: VerbDuration;
  // Agents whose senses end this command's time early, read from the command: the clock stops at
  // the first tick one of them could sense something, and the root event says how long it ran.
  wake_on?: (command: Command) => readonly Id[];
  // For a verb whose time may end before its span, at a pending beat (`docs/time.md`): the beat, read from
  // the snapshot the command is decided against. Null when the command names none.
  stop_before?: (command: Command, snapshot: Snapshot) => StopBeat | null;
  // Where the root event lands and what it carries, when it is not the target (or the actor) with no
  // data: a speaker's `say` is on the speaker even when it is addressed to another.
  rootEvent?: (command: Command, actor: Entity, target: TargetAddress | null) => { entity: Id; data: Record<string, unknown> };
  // For a verb that answers `invalid_args` until given some: the arg sets worth trying, in a fixed
  // order, read from the snapshot alone. `nameable` is every id the actor could name but itself, in
  // id order, as `options` computed it; a set holds ids from there, or the room behind a doorway
  // from there, and nothing the actor could not already address. `options` dry-runs each one.
  suggest?: (context: CommandContext, nameable: readonly Id[]) => readonly Record<string, unknown>[];
  // The verb acts on a part of a body when its target is one (`<id>.<part>`): `options` also tries it
  // at each part of a body the actor sees or feels that has not come off.
  aims_at_parts?: boolean;
  // The verb also takes args no list can hold (a position, a partial amount, a token, a tick
  // count), so `options` keeps it among the verbs that need args even when `suggest` lists some.
  free_args?: boolean;
  requires?: readonly CapacityRequirement[];
  carry_alternatives?: readonly CarryAlternative[];
  attack_modes?: readonly AttackMode[];
  preconditions(context: CommandContext): PreconditionResult;
  transition(context: TransitionContext): void;
  validateResult?: (context: CommandContext) => PreconditionResult;
}

export type VerbRegistry = ReadonlyMap<string, Verb>;
