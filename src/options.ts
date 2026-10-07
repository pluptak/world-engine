import type { Command, Result } from "./engine/command.js";
import { addressable } from "./engine/query.js";
import { isAbstract } from "./engine/resolve.js";
import { isAgent } from "./engine/verbs/address.js";
import { verbRegistry } from "./engine/verbs/index.js";
import { WorldError } from "./errors.js";
import type { Id, Snapshot } from "./model.js";
import type { TemplateRegistry } from "./templates.js";

// A command an actor could issue now, to be sent as it is: the verb and its target, with no args.
export interface ReadyOption {
  verb: string;
  target?: Id;
}

export interface BlockedOption extends ReadyOption {
  reason_code: string;
}

export interface Options {
  actor: Id;
  version: number;
  ready: ReadyOption[];
  // Verbs that need args to be judged at all: they are neither ready nor blocked until given some.
  needs_args: string[];
  blocked?: BlockedOption[];
}

export interface OptionsRequest {
  refused?: boolean;
}

// What an actor can try now, by dry-running each verb against each thing it could name (`addressable`:
// the rule target resolution applies, so nothing it cannot tell is there is offered) and once with no
// target for a verb that takes none. A destroyed body, or anything that is no agent, has no options.
// `dry` judges a command against `snapshot` and writes nothing; the caller binds it to its own world.
export function listOptions(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  actor: Id,
  request: OptionsRequest,
  dry: (command: Command) => Result,
): Options {
  if (snapshot.entities[actor] === undefined) {
    throw new WorldError("no_such_entity", `Unknown actor ${actor}`);
  }
  const options: Options = { actor, version: snapshot.version, ready: [], needs_args: [] };
  const blocked: BlockedOption[] = [];
  if (isAgent(snapshot, actor)) {
    // Computed once: what the actor could name does not depend on the verb.
    const targets = Object.keys(snapshot.entities)
      .sort()
      .filter(
        (id) =>
          id !== actor &&
          !isAbstract(registry, snapshot.entities[id]) &&
          addressable(snapshot, registry, actor, id),
      );
    const needsArgs = new Set<string>();
    for (const verb of [...verbRegistry.keys()].sort()) {
      const declared = verbRegistry.get(verb)!;
      if (declared.author_only === true) {
        continue;
      }
      for (const target of declared.requires_target ? targets : [undefined]) {
        const named = target === undefined ? {} : { target };
        const outcome = dry({ command_id: "options", actor, verb, ...named });
        if (outcome.status === "ok") {
          options.ready.push({ verb, ...named });
        } else if (outcome.status === "invalid" && outcome.reason_code === "invalid_args") {
          needsArgs.add(verb);
        } else {
          blocked.push({ verb, ...named, reason_code: outcome.reason_code ?? outcome.status });
        }
      }
    }
    // Verbs were visited in name order, so this is sorted already.
    options.needs_args = [...needsArgs];
  }
  if (request.refused === true) {
    options.blocked = blocked;
  }
  return options;
}
