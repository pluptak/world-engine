import { own, type Entity, type Id, type Snapshot } from "../model.js";
import { inReach } from "./verbs/address.js";

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

export type RemoteFault =
  | { reason_code: "disconnected"; reason_data: { at: Id } }
  | { reason_code: "unpowered"; reason_data: { at: Id; cut: Id } };

// Where power stops for a link with none: the first destroyed entity on its `powered_by` walk, else
// the walk's last entity, which is no source (the link itself when it has no `powered_by`).
function cutOf(snapshot: Snapshot, link: Id): Id {
  const path = walk(snapshot, link, "powered_by");
  return path.find((id) => own(snapshot.entities, id)!.status === "destroyed") ?? path.at(-1)!;
}

// The first of these links that cannot carry a command: a destroyed one, then one with no power.
function faultOn(snapshot: Snapshot, links: Id[]): RemoteFault | null {
  for (const link of links) {
    if (own(snapshot.entities, link)!.status === "destroyed") {
      return { reason_code: "disconnected", reason_data: { at: link } };
    }
    if (!powered(snapshot, link)) {
      return { reason_code: "unpowered", reason_data: { at: link, cut: cutOf(snapshot, link) } };
    }
  }
  return null;
}

// The first link from the device toward its controller, the device included and the controller
// not, that cannot carry a command.
export function remoteFault(snapshot: Snapshot, device: Id): RemoteFault | null {
  return faultOn(snapshot, walk(snapshot, device, "controlled_by").slice(0, -1));
}

// The same walk, cut at the panel a subject works the device through: the panel included, the rest of
// the walk to the controller not (`docs/panel.md`).
export function panelFault(snapshot: Snapshot, device: Id, panel: Id): RemoteFault | null {
  const path = walk(snapshot, device, "controlled_by");
  return faultOn(snapshot, path.slice(0, path.indexOf(panel) + 1));
}

// The panel an actor works a device through, for an actor that is not the device's controller and
// cannot reach the device by hand: the nearest intact panel on the device's control walk, first from
// the device, that the actor can reach. Null when there is none or the walk ends at no agent.
export function panelFor(snapshot: Snapshot, device: Id, actor: Id): Id | null {
  if (controller(snapshot, device) === null) {
    return null;
  }
  return (
    walk(snapshot, device, "controlled_by")
      .slice(1, -1)
      .find((id) => {
        const entity = own(snapshot.entities, id)!;
        return entity.props.panel === true && entity.status !== "destroyed" && inReach(snapshot, actor, id);
      }) ?? null
  );
}

// Why an agent cannot act or sense now: a controlled one its own control walk's fault, else its
// controller's; any other its own power, when it has a `powered_by`. Null for an agent with neither.
export function agentFault(snapshot: Snapshot, agent: Id): RemoteFault | null {
  const entity = own(snapshot.entities, agent);
  if (entity === undefined) {
    return null;
  }
  if (typeof entity.props.controlled_by === "string") {
    const fault = remoteFault(snapshot, agent);
    if (fault !== null) {
      return fault;
    }
    const head = controller(snapshot, agent);
    return head === null ? null : agentFault(snapshot, head);
  }
  if (typeof entity.props.powered_by === "string" && !powered(snapshot, agent)) {
    return { reason_code: "unpowered", reason_data: { at: agent, cut: cutOf(snapshot, agent) } };
  }
  return null;
}

// The devices of one kind (a camera's sight, an intercom's sound) whose feed reaches the observer now:
// each one not destroyed, its control walk ending at the observer and carrying a command, in id order.
export function feeds(snapshot: Snapshot, observer: Id, kind: "camera" | "intercom"): Id[] {
  return Object.keys(snapshot.entities)
    .sort()
    .filter((id) => {
      const device = own(snapshot.entities, id)!;
      return (
        (kind === "camera" ? device.props.camera === true : device.props.intercom === true) &&
        device.status !== "destroyed" &&
        controller(snapshot, id) === observer &&
        remoteFault(snapshot, id) === null
      );
    });
}
