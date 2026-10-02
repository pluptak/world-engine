import { elevation, effectivePos } from "../engine/geometry.js";
import { addResidue } from "../engine/residue.js";
import { spawn } from "../engine/spawn.js";
import type { Id, Pos } from "../model.js";
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
  if (supportId !== null) {
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
      pos,
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
    return;
  }

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
      const created = spawn(context.snapshot, context.registry, product.template, {
        support: landing.support,
        location,
        pos: landing.pos,
      });
      context.snapshot = created.snapshot;
      const spawnedEvent = context.emit("spawned", created.id, { template: product.template }, brokenEvent);
      context.recordDelta(created.id, "entity", null, context.snapshot.entities[created.id], spawnedEvent);
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
    pos: entity.pos ??
      (entity.support === null ? null : effectivePos(context.snapshot, entity.support)),
  };
  const queue: LossRequest[] = [];
  breakOnFall(context, entityId, droppedEventId, fall_cm, landing, queue);
  processQueue(context, queue);
}
