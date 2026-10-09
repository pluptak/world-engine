import { own, type Entity, type PartState, type Snapshot } from "../model.js";
import type { Template, TemplateRegistry } from "../templates.js";
import type { PreconditionResult } from "./command.js";
import { PROP_FIELDS } from "./fields.js";
import { misfit } from "./fit.js";
import { withParts } from "./parts.js";

// Refinement: an entity becomes a more specific preset (a table a smaller table, a lantern a candle)
// without being respawned. What the new preset says about what a thing is, its definitions, replaces the
// old; the state the entity already has, where the new preset still has a field for it, stays.

// A preset is a refinement of another when it extends it, directly or through others.
export function descendsFrom(template: Template, ancestor: string): boolean {
  return template.lineage?.includes(ancestor) === true;
}

function isStateProp(template: Template, name: string): boolean {
  return PROP_FIELDS[name]?.tier === "state" || template.fields?.[name]?.tier === "state";
}

// The new preset's props, with the entity's state props the new preset declares laid over them. A
// state prop the new preset does not declare is dropped with the field it belonged to.
export function refinedProps(subject: Entity, next: Template): Record<string, number | string | boolean> {
  const carried: Record<string, number | string | boolean> = {};
  for (const [name, value] of Object.entries(subject.props)) {
    if (isStateProp(next, name) && Object.hasOwn(next.props, name)) {
      carried[name] = value;
    }
  }
  return { ...next.props, ...carried };
}

// The stored part state under the new preset's defaults: a part that now sits at its default is
// not stored. Null when a stored part is one the new preset has no part of.
export function refinedParts(subject: Entity, next: Template): Record<string, PartState> | null {
  if (Object.keys(subject.parts).some((name) => !next.parts.some((part) => part.name === name))) {
    return null;
  }
  return withParts(next, {}, subject.parts);
}

function liquidCapacity(props: Record<string, number | string | boolean>): number | null {
  const declared = props.capacity_cm3;
  if (typeof declared === "number" && Number.isSafeInteger(declared) && declared > 0) {
    return declared;
  }
  const { inner_w_cm: width, inner_d_cm: depth, inner_h_cm: height } = props;
  return typeof width === "number" && typeof depth === "number" && typeof height === "number"
    ? Math.trunc(width * depth * height)
    : null;
}

// Why an entity cannot become `next` here, or ok. Contents that no longer fit their holder or its parts
// are the snapshot's own rules, held after the transition; what only a refinement can break is checked
// here: it is not a refinement of what it is, a stored part is stronger than the new preset allows, it
// no longer fits the surface it stands on or the things that stand on it, or it holds more liquid than
// it now can.
export function refineRefusal(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  subject: Entity,
  next: Template,
): PreconditionResult {
  if (!descendsFrom(next, subject.template)) {
    return { status: "refused", reason_code: "not_a_refinement" };
  }
  if (refinedParts(subject, next) === null) {
    return { status: "refused", reason_code: "unknown_part" };
  }
  // A part cannot be sounder than the new preset lets it be.
  for (const [name, state] of Object.entries(subject.parts)) {
    if (state.integrity > next.parts.find((part) => part.name === name)!.max_integrity) {
      return { status: "refused", reason_code: "integrity_out_of_range" };
    }
  }
  const props = refinedProps(subject, next);
  const footprint = [next.size_cm.w, next.size_cm.d];

  const support = subject.support === null ? undefined : own(snapshot.entities, subject.support);
  const supportTemplate = support === undefined ? undefined : own(registry, support.template);
  if (supportTemplate !== undefined && support!.props.surface === true) {
    const data = misfit(footprint, [supportTemplate.size_cm.w, supportTemplate.size_cm.d]);
    if (data !== null) {
      return { status: "refused", reason_code: "too_large", reason_data: data };
    }
  }

  // What stands on a surface has to keep a surface to stand on, and fit it.
  for (const id of subject.props.surface === true ? Object.keys(snapshot.entities).sort() : []) {
    const rider = own(snapshot.entities, id);
    if (rider?.support !== subject.id) {
      continue;
    }
    if (props.surface !== true) {
      return { status: "refused", reason_code: "not_a_surface" };
    }
    const size = own(registry, rider.template)?.size_cm;
    const data = size === undefined ? null : misfit([size.w, size.d], footprint);
    if (data !== null) {
      return { status: "refused", reason_code: "too_large", reason_data: data };
    }
  }

  const held = props.liquid_amount;
  const capacity = liquidCapacity(props);
  if (typeof held === "number" && capacity !== null && held > capacity) {
    return { status: "refused", reason_code: "liquid_exceeds_capacity", reason_data: { held, capacity } };
  }
  return { status: "ok" };
}
