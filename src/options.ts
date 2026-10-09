import type { Command, CommandContext, Result } from "./engine/command.js";
import { addressable } from "./engine/query.js";
import { isAbstract, isScenery } from "./engine/resolve.js";
import { visibleParts } from "./engine/projection.js";
import { isAgent } from "./engine/verbs/address.js";
import { verbRegistry } from "./engine/verbs/index.js";
import { WorldError } from "./errors.js";
import { own, type Id, type Snapshot } from "./model.js";
import type { TemplateRegistry } from "./templates.js";

// A command an actor could issue now, to be sent as it is: the verb, its target, and the args a
// verb that needs some suggested (ids the actor could already name); none for a verb that takes none.
export interface ReadyOption {
  verb: string;
  target?: Id;
  args?: Record<string, unknown>;
}

export interface BlockedOption extends ReadyOption {
  reason_code: string;
}

export interface Options {
  actor: Id;
  version: number;
  ready: ReadyOption[];
  // Verbs that need args no list holds (a position, an amount, a token, a tick count): they are
  // judged only once given some. A verb whose args `suggest` lists in full appears above instead.
  needs_args: string[];
  blocked?: BlockedOption[];
}

export interface OptionsRequest {
  refused?: boolean;
}

// What an actor can try now, by dry-running each verb against each thing it could name (`addressable`:
// the rule target resolution applies, so nothing it cannot tell is there is offered) and once with no
// target for a verb that takes none. A verb that answers `invalid_args` is tried again with each arg
// set its `suggest` lists, and stays in `needs_args` only if it has `free_args` or no `suggest`.
// A destroyed body, or anything that is no agent, has no options.
// `dry` judges a command against `snapshot` and writes nothing; the caller binds it to its own world.
export function listOptions(
  snapshot: Snapshot,
  registry: TemplateRegistry,
  actor: Id,
  request: OptionsRequest,
  dry: (command: Command) => Result,
): Options {
  if (own(snapshot.entities, actor) === undefined) {
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
          !isScenery(registry, snapshot.entities[id]) &&
          addressable(snapshot, registry, actor, id),
      );
    const actorEntity = snapshot.entities[actor]!;
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
          if (declared.suggest === undefined || declared.free_args === true) {
            needsArgs.add(verb);
          }
          if (declared.suggest !== undefined) {
            const context: CommandContext = {
              snapshot,
              registry,
              command: { command_id: "options", actor, verb, ...named },
              actor: actorEntity,
              target: target === undefined ? null : { entity_id: target, part: null, address: target },
              verb: declared,
            };
            for (const args of declared.suggest(context, targets)) {
              const tried = dry({ command_id: "options", actor, verb, ...named, args });
              if (tried.status === "ok") {
                options.ready.push({ verb, ...named, args });
              } else {
                blocked.push({ verb, ...named, args, reason_code: tried.reason_code ?? tried.status });
              }
            }
          }
        } else {
          blocked.push({ verb, ...named, reason_code: outcome.reason_code ?? outcome.status });
        }
        // A verb that acts on parts is also tried at each part of the body that is still on it, by name
        // order so the entries sort as their addresses do.
        if (declared.aims_at_parts === true && target !== undefined) {
          const parts = (visibleParts(snapshot, registry, actor, target) ?? [])
            .filter((part) => part.status !== "detached")
            .map((part) => part.name)
            .sort();
          for (const part of parts) {
            const address = `${target}.${part}`;
            const tried = dry({ command_id: "options", actor, verb, target: address });
            if (tried.status === "ok") {
              options.ready.push({ verb, target: address });
            } else {
              blocked.push({ verb, target: address, reason_code: tried.reason_code ?? tried.status });
            }
          }
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
