import { own, type Entity, type Id, type Snapshot } from "../model.js";

// The two links a device may have, each a prop naming one entity (`docs/power.md`). Loops are
// refused by `validateSnapshot`; the walks still stop at one, so a bad snapshot cannot hang them.

function walk(snapshot: Snapshot, id: Id, prop: string): Id[] {
  const path: Id[] = [];
  let current: Id | undefined = id;
  while (current !== undefined && !path.includes(current)) {
    const entity: Entity | undefined = own(snapshot.entities, current);
    if (entity === undefined) {
      break;
    }
    path.push(current);
    const next: unknown = entity.props[prop];
    current = typeof next === "string" ? next : undefined;
  }
  return path;
}

// Power reaches an entity when every link from it to a source, itself included, is not destroyed
// and the walk ends at a `power_source`.
export function powered(snapshot: Snapshot, id: Id): boolean {
  const path = walk(snapshot, id, "powered_by");
  const links = path.map((link) => own(snapshot.entities, link)!);
  const last = links.at(-1);
  return (
    last !== undefined &&
    last.props.power_source === true &&
    typeof last.props.powered_by !== "string" &&
    links.every((link) => link.status !== "destroyed")
  );
}

// The agent at the end of an entity's `controlled_by` walk, whatever state the links are in.
export function controller(snapshot: Snapshot, id: Id): Id | null {
  const path = walk(snapshot, id, "controlled_by");
  if (path.length < 2) {
    return null;
  }
  const last = own(snapshot.entities, path.at(-1)!)!;
  return last.props.agent === true && typeof last.props.controlled_by !== "string" ? last.id : null;
}

export type RemoteFault = { reason_code: "disconnected" | "unpowered"; reason_data: { at: Id } };

// The first link from the device toward its controller, the device included and the controller
// not, that cannot carry a command: a destroyed one, then one with no power.
export function remoteFault(snapshot: Snapshot, device: Id): RemoteFault | null {
  for (const link of walk(snapshot, device, "controlled_by").slice(0, -1)) {
    if (own(snapshot.entities, link)!.status === "destroyed") {
      return { reason_code: "disconnected", reason_data: { at: link } };
    }
    if (!powered(snapshot, link)) {
      return { reason_code: "unpowered", reason_data: { at: link } };
    }
  }
  return null;
}
