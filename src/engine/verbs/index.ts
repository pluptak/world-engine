import type { VerbRegistry } from "../command.js";
import { dropVerb } from "./drop.js";
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
]);
