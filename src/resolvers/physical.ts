import { elevation, effectivePos } from "../engine/geometry.js";
import { addResidue } from "../engine/residue.js";
import { spawnUnder } from "../engine/spawn.js";
import { innerDimensions, misfit } from "../engine/fit.js";
import { removeEntity } from "../engine/verbs/edit.js";
import { revealConcealed } from "../engine/verbs/search.js";
import type { Entity, Id, Pos } from "../model.js";
import type { TransitionContext } from "../engine/command.js";

interface Landing {
  support: Id | null;
  location: Id | null;
  pos: Pos | null;
}

type LossRequest =
  | { entity: Id; cause: Id; displaced: boolean }
  | { entity: Id; cause: Id; displaced: boolean; landing: Landing; fall_cm: number };

function requireEntity(context: TransitionContext, entityId: Id) {
  const entity = context.snapshot.entities[entityId];
  if (entity === undefined) {
    throw new TypeError(`Unknown entity ${entityId}`);
  }
  return entity;
}

// What a thing falling at a point of a room comes to rest on: the tallest surface standing on that
// room — what `put` could set it on — lower than the height it falls from, whose footprint holds
// the point strictly inside (compared on doubled coordinates) and is at least as wide and deep as
// the faller's. The faller and whatever it fell from are not candidates.
export function restingPlace(
  context: TransitionContext,
  roomId: Id,
  pos: Pos,
  from_cm: number,
  faller: Id,
  exclude: readonly Id[],
): { support: Id; height_cm: number } | null {
  const fallerTemplate = context.registry[requireEntity(context, faller).template];
  if (fallerTemplate === undefined) {
    throw new TypeError(`Unknown template ${requireEntity(context, faller).template}`);
  }
  let best: { support: Id; height_cm: number } | null = null;
  for (const id of Object.keys(context.snapshot.entities).sort()) {
    const entity = requireEntity(context, id);
    const template = context.registry[entity.template];
    if (
      template === undefined ||
      id === faller ||
      exclude.includes(id) ||
      entity.support !== roomId ||
      entity.contained_in !== null ||
      entity.pos === null ||
      entity.status === "destroyed" ||
      entity.props.surface !== true ||
      template.size_cm.h >= from_cm ||
      template.size_cm.w < fallerTemplate.size_cm.w ||
      template.size_cm.d < fallerTemplate.size_cm.d
    ) {
      continue;
    }
    if (
      2 * Math.abs(pos.x - entity.pos.x) >= template.size_cm.w ||
      2 * Math.abs(pos.y - entity.pos.y) >= template.size_cm.d
    ) {
      continue;
    }
    if (best === null || template.size_cm.h > best.height_cm) {
      best = { support: id, height_cm: template.size_cm.h };
    }
  }
  return best;
}

function landingLocation(context: TransitionContext, supportId: Id | null): Id | null {
  if (supportId === null) {
    return null;
  }
  const support = requireEntity(context, supportId);
  return support.template === "room" ? support.id : support.location;
}

function landingFromSupport(
  context: TransitionContext,
  entityId: Id,
  oldSupportId: Id,
): { landing: Landing; fall_cm: number } {
  const entity = requireEntity(context, entityId);
  const oldSupport = requireEntity(context, oldSupportId);
  const oldElevation = elevation(context.snapshot, context.registry, entityId);
  const pos = effectivePos(context.snapshot, oldSupportId);
  let supportId: Id | null = oldSupport.template === "room" ? oldSupport.id : oldSupport.support;
  let lastSupport: Id | null = null;

  while (supportId !== null) {
    const support = requireEntity(context, supportId);
    if (support.template === "room") {
      break;
    }
    lastSupport = supportId;
    supportId = support.support;
  }

  if (supportId === null) {
    const location = entity.location;
    const locationEntity = location === null ? undefined : context.snapshot.entities[location];
    supportId = locationEntity?.template === "room" ? location : lastSupport;
  }

  let newElevation = 0;
  let landingPos = pos;
  const floor = supportId === null ? undefined : context.snapshot.entities[supportId];
  const rest =
    floor?.template === "room" && pos !== null
      ? restingPlace(context, floor.id, pos, oldElevation, entityId, [oldSupportId])
      : null;
  if (rest !== null) {
    supportId = rest.support;
    newElevation = rest.height_cm;
    landingPos = null;
  } else if (supportId !== null) {
    const support = requireEntity(context, supportId);
    if (support.template !== "room") {
      const template = context.registry[support.template];
      if (template === undefined) {
        throw new TypeError(`Unknown template ${support.template}`);
      }
      newElevation = elevation(context.snapshot, context.registry, supportId) + template.size_cm.h;
    }
  }

  return {
    landing: {
      support: supportId,
      location: landingLocation(context, supportId) ?? entity.location,
      pos: landingPos,
    },
    fall_cm: oldElevation - newElevation,
  };
}

function breakOnFall(
  context: TransitionContext,
  entityId: Id,
  causeId: Id,
  fall_cm: number,
  landing: Landing,
  queue: LossRequest[],
): void {
  const entity = requireEntity(context, entityId);
  const threshold = entity.props.break_fall_cm;
  if (
    entity.status === "broken" ||
    entity.status === "destroyed" ||
    typeof threshold !== "number" ||
    fall_cm < threshold
  ) {
    spillVessel(context, entityId, causeId, fall_cm, landing);
    return;
  }
  breakEntity(context, entityId, causeId, fall_cm, landing, queue);
}

function breakEntity(
  context: TransitionContext,
  entityId: Id,
  causeId: Id,
  fall_cm: number,
  landing: Landing,
  queue: LossRequest[],
): void {
  const entity = requireEntity(context, entityId);
  const template = context.registry[entity.template];
  if (template === undefined) {
    throw new TypeError(`Unknown template ${entity.template}`);
  }

  const contents = Object.keys(context.snapshot.entities)
    .sort()
    .filter((id) => context.snapshot.entities[id]?.contained_in === entityId);
  const brokenEvent = context.emit("broken", entityId, {}, causeId);
  context.set(entityId, "status", "broken", brokenEvent);

  const landingSurface =
    landing.support === null ? undefined : context.snapshot.entities[landing.support];
  const location =
    landingSurface?.template === "room" ? landingSurface.id : landing.location;

  for (const product of template.break_products) {
    if (!Number.isSafeInteger(product.count) || product.count < 0) {
      throw new TypeError(`Invalid break product count for ${entity.template}`);
    }
    for (let index = 0; index < product.count; index += 1) {
      spawnUnder(context, product.template, {
        support: landing.support,
        location,
        pos: landing.pos,
      }, brokenEvent);
    }
  }

  const residueAdds: Record<string, number> = { ...template.break_residue };
  const liquidMaterial = entity.props.liquid_material;
  const liquidAmount = entity.props.liquid_amount;
  if (typeof liquidMaterial === "string" && liquidMaterial.length > 0 && typeof liquidAmount === "number") {
    residueAdds[liquidMaterial] = (residueAdds[liquidMaterial] ?? 0) + liquidAmount;
  }

  const residueSurfaceId = landing.support ?? location;
  if (residueSurfaceId !== null && Object.keys(residueAdds).length > 0) {
    addResidue(context, residueSurfaceId, residueAdds, brokenEvent);
  }

  if (typeof liquidMaterial === "string" || typeof liquidAmount === "number") {
    const props = { ...entity.props };
    if (typeof liquidMaterial === "string") {
      props.liquid_material = "";
    }
    if (typeof liquidAmount === "number") {
      props.liquid_amount = 0;
    }
    context.set(entityId, "props", props, brokenEvent);
  }

  if (landing.support !== null) {
    for (const contentId of contents) {
      queue.push({
        entity: contentId,
        cause: brokenEvent,
        displaced: false,
        landing,
        fall_cm,
      });
    }
  }
}

// Where a used-up thing stood, which is where it leaves what it leaves: its own place, the plain
// container it was in, or, in an agent's grip or pocket, the holder's feet (a grip holds one item, so
// nothing is left in it). A holder carried in turn leaves it where its carrier stands.
interface Placement {
  support: Id | null;
  contained_in: Id | null;
  location: Id | null;
  pos: Pos | null;
}

function placementOf(context: TransitionContext, entity: Entity): Placement {
  const holder = entity.in_part === null || entity.contained_in === null ? undefined : context.snapshot.entities[entity.contained_in];
  if (holder !== undefined) {
    return placementOf(context, holder);
  }
  return {
    support: entity.support,
    contained_in: entity.contained_in,
    location: entity.location,
    pos: entity.pos === null ? null : { ...entity.pos },
  };
}

// Where a product of the given size goes when the thing stood at `at`: there, unless that is a container it
// does not fit, in which case beside the container (where it stands, in turn), so that being used up can
// never leave a snapshot the validation would refuse, in a cause that cannot be refused.
function fitting(context: TransitionContext, at: Placement, size: { w: number; d: number; h: number }): Placement {
  const holder = at.contained_in === null ? undefined : context.snapshot.entities[at.contained_in];
  const inner = holder === undefined ? null : innerDimensions(holder.props);
  if (holder === undefined || inner === null || misfit([size.w, size.d, size.h], inner) === null) {
    return at;
  }
  return fitting(context, placementOf(context, holder), size);
}

// Where a new thing of `templateId` goes when it takes the place of `entity`: where the entity stood, or at
// its holder's feet, or beside a container it does not fit, as a used-up thing's products go. A destroyed
// body's successor (`engine/harm.ts`) is placed this way, so a body carried when it dies leaves its successor
// on the floor rather than in a grip that holds one item.
export function placeInstead(context: TransitionContext, entity: Entity, templateId: string): Placement {
  const at = placementOf(context, entity);
  const size = context.registry[templateId]?.size_cm;
  const lands = size === undefined ? at : fitting(context, at, size);
  return { ...lands, pos: lands.pos === null ? null : { ...lands.pos } };
}

// An entity used up: a `spent` event on it, then each of its template's `spent_products` spawned where it
// stood and its `spent_residue` added to the surface they went to, every `spawned` caused by `spent`, and
// last the entity itself removed under `spent`. What the author's `edit remove` and a process's `remove`
// do is a removal with none of this. A room is never used up.
export function spendEntity(context: TransitionContext, entityId: Id, causeId: Id): boolean {
  const entity = requireEntity(context, entityId);
  const template = context.registry[entity.template];
  if (template === undefined) {
    throw new TypeError(`Unknown template ${entity.template}`);
  }
  if (entity.template === "room") {
    return false;
  }
  const spentEvent = context.emit("spent", entityId, {}, causeId);
  const at = placementOf(context, entity);
  for (const product of template.spent_products ?? []) {
    for (let index = 0; index < product.count; index += 1) {
      const size = context.registry[product.template]?.size_cm;
      const lands = size === undefined ? at : fitting(context, at, size);
      spawnUnder(context, product.template, {
        support: lands.support,
        contained_in: lands.contained_in,
        location: lands.location,
        pos: lands.pos === null ? null : { ...lands.pos },
      }, spentEvent);
    }
  }
  const residue = template.spent_residue ?? {};
  const surface = at.support ?? at.contained_in ?? at.location;
  if (surface !== null && Object.keys(residue).length > 0) {
    addResidue(context, surface, residue, spentEvent);
  }
  return removeEntity(context, entityId, spentEvent);
}

// A vessel that falls without breaking spills all it holds onto its landing: one `spilled`
// event caused by the drop, residue through the same path a break uses, and empty props after.
// A break and a spill are the two arms of the threshold check above, so one fall never does both.
function spillVessel(
  context: TransitionContext,
  entityId: Id,
  droppedEventId: Id,
  fall_cm: number,
  landing: Landing,
): void {
  if (fall_cm <= 0) {
    return;
  }
  const entity = requireEntity(context, entityId);
  const material = entity.props.liquid_material;
  const amount = entity.props.liquid_amount;
  if (
    typeof material !== "string" ||
    material.length === 0 ||
    typeof amount !== "number" ||
    amount <= 0
  ) {
    return;
  }
  // A shut vessel keeps what it holds, the way a shut destination refuses a pour.
  if (entity.props.openable === true && entity.props.open !== true) {
    return;
  }
  const surface = landing.support ?? landing.location;
  const spilledEvent = context.emit(
    "spilled",
    entityId,
    { material, amount, to: surface },
    droppedEventId,
  );
  if (surface !== null) {
    addResidue(context, surface, { [material]: amount }, spilledEvent);
  }
  context.set(
    entityId,
    "props",
    { ...entity.props, liquid_material: "", liquid_amount: 0 },
    spilledEvent,
  );
}

function processLoss(context: TransitionContext, request: LossRequest, queue: LossRequest[]): void {
  const entity = requireEntity(context, request.entity);
  let landing: Landing;
  let fall_cm: number;

  if ("landing" in request) {
    landing = request.landing;
    fall_cm = request.fall_cm;
  } else {
    const oldSupportId = entity.support;
    if (oldSupportId === null) {
      return;
    }
    ({ landing, fall_cm } = landingFromSupport(context, entity.id, oldSupportId));
  }

  let dropCause = request.cause;
  if (request.displaced) {
    dropCause = context.emit("displaced", entity.id, {}, request.cause);
  }
  const droppedEvent = context.emit("dropped", entity.id, { fall_cm }, dropCause);

  if (entity.contained_in !== null) {
    context.set(entity.id, "contained_in", null, droppedEvent);
  }
  context.set(entity.id, "support", landing.support, droppedEvent);
  context.set(entity.id, "location", landing.location, droppedEvent);
  context.set(entity.id, "pos", landing.pos, droppedEvent);
  // A thing that falls or is knocked out from under whatever hid it uncovers it, and stops being
  // hidden itself if it was under something else.
  revealConcealed(context, entity.id, droppedEvent);
  breakOnFall(context, entity.id, droppedEvent, fall_cm, landing, queue);
}

function processQueue(context: TransitionContext, queue: LossRequest[]): void {
  while (queue.length > 0) {
    const request = queue.shift();
    if (request !== undefined) {
      processLoss(context, request, queue);
    }
  }
}

export function propagateSupportLoss(
  context: TransitionContext,
  supportId: Id,
  causeId: Id,
): void {
  const queue: LossRequest[] = Object.keys(context.snapshot.entities)
    .sort()
    .flatMap((id) => {
      const entity = context.snapshot.entities[id];
      return entity?.support === supportId && entity.props.topples === true
        ? [{ entity: id, cause: causeId, displaced: true }]
        : [];
    });
  processQueue(context, queue);
}

export function resolveDropFall(
  context: TransitionContext,
  entityId: Id,
  droppedEventId: Id,
  fall_cm: number,
): void {
  const entity = requireEntity(context, entityId);
  const landing: Landing = {
    support: entity.support ?? entity.location,
    location: entity.location,
    pos: entity.pos,
  };
  const queue: LossRequest[] = [];
  breakOnFall(context, entityId, droppedEventId, fall_cm, landing, queue);
  processQueue(context, queue);
}

function massOf(context: TransitionContext, entityId: Id): number {
  const template = context.registry[requireEntity(context, entityId).template];
  if (template === undefined) {
    throw new TypeError(`Unknown template ${requireEntity(context, entityId).template}`);
  }
  return template.mass_g;
}

// A pushed thing that meets another strikes it with its mass times the distance it travelled.
// Either party breaks when that is at least what its own fall to breaking would take, its mass
// times `break_fall_cm`; what declares no threshold takes no harm. The struck one is read first.
export function resolveImpact(
  context: TransitionContext,
  moverId: Id,
  obstacleId: Id,
  distance_cm: number,
  collidedEventId: Id,
): void {
  const impact = massOf(context, moverId) * distance_cm;
  const queue: LossRequest[] = [];
  for (const id of [obstacleId, moverId]) {
    const entity = requireEntity(context, id);
    const threshold = entity.props.break_fall_cm;
    if (
      entity.status === "broken" ||
      entity.status === "destroyed" ||
      typeof threshold !== "number" ||
      impact < massOf(context, id) * threshold
    ) {
      continue;
    }
    const landing: Landing = {
      support: entity.support,
      location: entity.location,
      pos: effectivePos(context.snapshot, id),
    };
    breakEntity(context, id, collidedEventId, 0, landing, queue);
  }
  processQueue(context, queue);
}
