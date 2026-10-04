import { capacities, capacity, structuralCapacities } from "../capacity.js";
import { effectivePos } from "../geometry.js";
import { addResidue } from "../residue.js";
import { carryAlternatives, insufficientCode, lostCarry } from "../carry.js";
import type { PartState } from "../../model.js";
import type { AttackMode, CommandContext, PreconditionResult, TransitionContext, Verb } from "../command.js";
import { dropCarriedItem } from "./drop.js";
import { reachData } from "./address.js";
import { spawn } from "../spawn.js";

// A fist needs hands, a bite a jaw; the damage of the mode used comes from the attacker's template.
const attackModes: readonly AttackMode[] = [
  { capacity: "manipulation", at_least: 1, damage_prop: "attack_damage" },
  { capacity: "mouth_carry", at_least: 1, damage_prop: "bite_damage" },
];

interface AttackTarget {
  entityId: string;
  partName: string | null;
  damage: number;
}

type AttackChoice =
  | { kind: "chosen"; damage: number }
  | { kind: "no_capacity" }
  | { kind: "no_damage" };

function attackStructure(context: CommandContext): { entityId: string; partName: string | null } | null {
  const target = context.target;
  if (target === null) {
    return null;
  }
  const entity = context.snapshot.entities[target.entity_id];
  const template = entity === undefined ? undefined : context.registry[entity.template];
  if (entity === undefined || template === undefined) {
    return null;
  }

  let partName = target.part;
  if (partName === null && template.parts.length > 0) {
    const defaultPart = template.props.default_hit_part;
    if (typeof defaultPart !== "string") {
      return null;
    }
    partName = defaultPart;
  }
  if (
    partName !== null &&
    (!template.parts.some((part) => part.name === partName) || entity.parts[partName] === undefined)
  ) {
    return null;
  }

  return { entityId: entity.id, partName };
}

// The first declared mode the attacker can use: enough of its capacity and a usable damage value.
// Having a capacity but no damage is template data gone wrong, reported apart from the refusal.
function chooseAttack(context: CommandContext): AttackChoice {
  let hadCapacity = false;
  for (const mode of context.verb.attack_modes ?? []) {
    if (
      (capacity(context.snapshot, context.registry, context.actor.id, mode.capacity) ?? 0) <
      mode.at_least
    ) {
      continue;
    }
    hadCapacity = true;
    const damage = context.actor.props[mode.damage_prop];
    if (typeof damage === "number" && Number.isSafeInteger(damage) && damage > 0) {
      return { kind: "chosen", damage };
    }
  }
  return hadCapacity ? { kind: "no_damage" } : { kind: "no_capacity" };
}

function preconditions(context: CommandContext): PreconditionResult {
  const target = context.target;
  if (target === null) {
    return { status: "invalid", reason_code: "missing_target" };
  }
  const structure = attackStructure(context);
  if (structure === null) {
    return { status: "invalid", reason_code: "invalid_attack_target" };
  }

  const entity = context.snapshot.entities[structure.entityId]!;
  const actorPos = effectivePos(context.snapshot, context.actor.id);
  const targetPos = effectivePos(context.snapshot, entity.id);
  const reach = context.actor.props.reach_cm;
  if (
    actorPos === null ||
    targetPos === null ||
    entity.location !== context.actor.location ||
    typeof reach !== "number" ||
    (actorPos.x - targetPos.x) ** 2 + (actorPos.y - targetPos.y) ** 2 > reach ** 2
  ) {
    const data = reachData(context.snapshot, context.actor.id, entity.id);
    return {
      status: "refused",
      reason_code: "out_of_reach",
      ...(data !== null && { reason_data: data }),
    };
  }
  const choice = chooseAttack(context);
  if (choice.kind === "no_capacity") {
    const [firstMode] = context.verb.attack_modes ?? [];
    return {
      status: "refused",
      reason_code: insufficientCode(context.verb.attack_modes ?? []),
      ...(firstMode !== undefined && {
        reason_data: {
          capacity: firstMode.capacity,
          have: capacity(context.snapshot, context.registry, context.actor.id, firstMode.capacity) ?? 0,
          need: firstMode.at_least,
        },
      }),
    };
  }
  if (choice.kind === "no_damage") {
    return { status: "invalid", reason_code: "invalid_attack_target" };
  }
  return { status: "ok" };
}

function descendantNames(
  templateParts: Array<{ name: string; parent: string | null }>,
  rootName: string,
): string[] {
  const byName = new Map(templateParts.map((part) => [part.name, part]));
  const isInSubtree = (name: string): boolean => {
    let parent = byName.get(name)?.parent ?? null;
    const seen = new Set<string>();
    while (parent !== null) {
      if (parent === rootName) {
        return true;
      }
      if (seen.has(parent)) {
        throw new TypeError(`Part cycle at ${parent}`);
      }
      seen.add(parent);
      parent = byName.get(parent)?.parent ?? null;
    }
    return false;
  };
  return templateParts
    .map((part) => part.name)
    .filter((name) => name === rootName || isInSubtree(name))
    .sort();
}

function floorSupport(context: TransitionContext, entityId: string): string | null {
  const entity = context.snapshot.entities[entityId];
  if (entity === undefined) {
    return null;
  }
  if (entity.location !== null && context.snapshot.entities[entity.location]?.template === "room") {
    return entity.location;
  }
  let supportId = entity.support;
  const seen = new Set<string>();
  while (supportId !== null) {
    if (seen.has(supportId)) {
      throw new TypeError(`Support cycle at ${supportId}`);
    }
    seen.add(supportId);
    const support = context.snapshot.entities[supportId];
    if (support === undefined) {
      return null;
    }
    if (support.template === "room") {
      return support.id;
    }
    supportId = support.support;
  }
  return null;
}

function emitCapabilityChanges(
  context: TransitionContext,
  entityId: string,
  before: Record<string, number> | null,
  after: Record<string, number> | null,
  causeId: string,
): Map<string, string> {
  const names = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const events = new Map<string, string>();
  for (const name of names) {
    const from = before?.[name] ?? 0;
    const to = after?.[name] ?? 0;
    if (from !== to) {
      const eventId = context.emit(
        "capability_changed",
        entityId,
        { capacity: name, from, to },
        causeId,
      );
      events.set(name, eventId);
    }
  }
  return events;
}

function addBreakResidue(
  context: TransitionContext,
  entityId: string,
  eventId: string,
): void {
  const entity = context.snapshot.entities[entityId];
  const template = entity === undefined ? undefined : context.registry[entity.template];
  if (entity === undefined || template === undefined) {
    throw new TypeError(`Unknown entity or template ${entityId}`);
  }

  const surfaceId = entity.support ?? entity.contained_in ?? entity.location;
  if (surfaceId === null || Object.keys(template.break_residue).length === 0) {
    return;
  }
  addResidue(context, surfaceId, template.break_residue, eventId);
}

function detachPart(
  context: TransitionContext,
  entityId: string,
  partName: string,
  nextIntegrity: number,
  eventId: string,
): void {
  const entity = context.snapshot.entities[entityId];
  const template = entity === undefined ? undefined : context.registry[entity.template];
  const partDecl = template?.parts.find((part) => part.name === partName);
  if (entity === undefined || template === undefined || partDecl === undefined) {
    throw new TypeError(`Unknown part ${partName}`);
  }

  const subtree = descendantNames(template.parts, partName);
  const subtreeSet = new Set(subtree);
  const detachedParts: Record<string, PartState> = { ...entity.parts };
  for (const name of subtree) {
    const state = entity.parts[name];
    if (state !== undefined) {
      detachedParts[name] = {
        ...state,
        ...(name === partName && { integrity: nextIntegrity }),
        status: "detached",
      };
    }
  }
  context.set(entityId, "parts", detachedParts, eventId);

  const detachedTemplateId = `${entity.template}.${partName}`;
  const detachedTemplate = context.registry[detachedTemplateId];
  if (detachedTemplate === undefined) {
    throw new TypeError(`Missing detached part template ${detachedTemplateId}`);
  }
  const detachedPos = effectivePos(context.snapshot, entityId);
  const support = floorSupport(context, entityId);
  const created = spawn(context.snapshot, context.registry, detachedTemplateId, {
    name: partName,
    location: support,
    support,
    pos: detachedPos,
    detached_from: { entity: entityId, part: partName },
    integrity: nextIntegrity,
  });
  context.snapshot = created.snapshot;
  context.recordDelta(created.id, "entity", null, context.snapshot.entities[created.id], eventId);
  const spawnedEvent = context.emit("spawned", created.id, { template: detachedTemplateId }, eventId);

  const copiedParts: Record<string, PartState> = {};
  for (const part of detachedTemplate.parts) {
    if (!subtreeSet.has(part.name) || part.name === partName) {
      throw new TypeError(`Detached template ${detachedTemplateId} does not match its part subtree`);
    }
    const state = entity.parts[part.name];
    if (state === undefined) {
      throw new TypeError(`Missing descendant part state ${part.name}`);
    }
    copiedParts[part.name] = { ...state };
  }
  context.set(created.id, "parts", copiedParts, spawnedEvent);
}

function transition(context: TransitionContext): void {
  const structure = attackStructure(context);
  if (structure === null) {
    throw new TypeError("Attack target changed after validation");
  }
  const choice = chooseAttack(context);
  if (choice.kind !== "chosen") {
    throw new TypeError("Attack mode changed after validation");
  }
  const attack: AttackTarget = {
    entityId: structure.entityId,
    partName: structure.partName,
    damage: choice.damage,
  };

  const target = context.snapshot.entities[attack.entityId]!;
  const template = context.registry[target.template]!;
  const before = capacities(context.snapshot, context.registry, target.id);
  const structuralBefore = structuralCapacities(context.snapshot, context.registry, target.id);
  let damageEvent: string;
  let detachEvent: string | null = null;

  if (attack.partName !== null) {
    const part = template.parts.find((decl) => decl.name === attack.partName)!;
    const state = target.parts[attack.partName]!;
    const integrity = Math.max(0, state.integrity - attack.damage);
    if (integrity === 0 && part.detachable) {
      damageEvent = context.emit("detached", target.id, { part: attack.partName }, context.root_event_id);
      detachEvent = damageEvent;
      detachPart(context, target.id, attack.partName, integrity, damageEvent);
    } else if (integrity === 0) {
      damageEvent = context.emit("destroyed", target.id, { part: attack.partName }, context.root_event_id);
      context.set(
        target.id,
        "parts",
        {
          ...target.parts,
          [attack.partName]: { integrity, status: "destroyed" },
        },
        damageEvent,
      );
    } else {
      damageEvent = context.emit(
        "damaged",
        target.id,
        { part: attack.partName, integrity },
        context.root_event_id,
      );
      context.set(
        target.id,
        "parts",
        {
          ...target.parts,
          [attack.partName]: { integrity, status: "damaged" },
        },
        damageEvent,
      );
      const capacityName = Object.keys(part.contributes).sort()[0];
      if (capacityName !== undefined) {
        const current = context.snapshot.entities[target.id]!;
        context.set(
          target.id,
          "modifiers",
          [
            ...current.modifiers,
            {
              capacity: capacityName,
              delta: -Math.trunc(attack.damage / 2),
              expires_at_tick: context.snapshot.tick + 3,
              cause_id: damageEvent,
            },
          ],
          damageEvent,
        );
      }
    }
  } else {
    const integrity = Math.max(0, target.integrity - attack.damage);
    if (integrity === 0) {
      damageEvent = context.emit("destroyed", target.id, { integrity }, context.root_event_id);
      context.set(target.id, "integrity", integrity, damageEvent);
      context.set(target.id, "status", "destroyed", damageEvent);
      addBreakResidue(context, target.id, damageEvent);
    } else {
      damageEvent = context.emit("damaged", target.id, { integrity }, context.root_event_id);
      context.set(target.id, "integrity", integrity, damageEvent);
    }
  }

  const after = capacities(context.snapshot, context.registry, target.id);
  const structuralAfter = structuralCapacities(context.snapshot, context.registry, target.id);
  const capabilityEvents = emitCapabilityChanges(context, target.id, before, after, damageEvent);
  // Whatever structurally lost the capacity that held a thing lets it fall; a stunned carrier can
  // hold on until the modifier expires. The cause is the event that took the capacity away.
  const victim = context.snapshot.entities[target.id]!;
  for (const itemId of Object.keys(context.snapshot.entities).sort()) {
    const item = context.snapshot.entities[itemId];
    if (item === undefined || item.contained_in !== target.id) {
      continue;
    }
    const lost = lostCarry(
      structuralBefore,
      structuralAfter,
      victim.props,
      item,
      context.registry,
      context.verb.carry_alternatives ?? [],
    );
    if (lost === null) {
      continue;
    }
    dropCarriedItem(context, target.id, itemId, capabilityEvents.get(lost) ?? detachEvent ?? damageEvent);
  }
}

export const attackVerb: Verb = {
  requires_target: true,
  args: {},
  refuses: ["out_of_reach", "insufficient_manipulation"],
  carry_alternatives: carryAlternatives,
  attack_modes: attackModes,
  preconditions,
  transition,
};
