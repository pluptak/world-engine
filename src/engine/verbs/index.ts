import type { VerbCatalogEntry, VerbRegistry } from "../command.js";
import { dropVerb } from "./drop.js";
import { editVerb } from "./edit.js";
import { moveVerb } from "./move.js";
import { closeVerb, lockVerb, openVerb, unlockVerb } from "./openable.js";
import { pullVerb, pushVerb } from "./push.js";
import { takeVerb } from "./take.js";
import { attackVerb } from "./attack.js";
import { giveVerb } from "./give.js";
import { putVerb } from "./put.js";
import { waitVerb } from "./wait.js";

export const verbRegistry: VerbRegistry = new Map([
  ["move", moveVerb],
  ["take", takeVerb],
  ["drop", dropVerb],
  ["put", putVerb],
  ["give", giveVerb],
  ["open", openVerb],
  ["close", closeVerb],
  ["lock", lockVerb],
  ["unlock", unlockVerb],
  ["push", pushVerb],
  ["pull", pullVerb],
  ["attack", attackVerb],
  ["wait", waitVerb],
  ["edit", editVerb],
]);

// The catalog is derived from what the verbs declare, never maintained beside them, and the
// entries are copies: `readonly` stops nobody at runtime, so the engine never hands out the
// objects its checks read.
export function verbCatalog(registry: VerbRegistry = verbRegistry): VerbCatalogEntry[] {
  return [...registry.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, verb]) => {
      if (verb.args === undefined || verb.refuses === undefined) {
        throw new TypeError(`Verb ${name} does not describe itself`);
      }
      return structuredClone({
        verb: name,
        requires_target: verb.requires_target,
        args: verb.args,
        requires: verb.requires ?? [],
        carry_alternatives: verb.carry_alternatives ?? [],
        attack_modes: verb.attack_modes ?? [],
        refuses: [...verb.refuses],
      });
    });
}
