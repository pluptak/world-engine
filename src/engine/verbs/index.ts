import type { VerbRegistry } from "../command.js";
import { dropVerb } from "./drop.js";
import { moveVerb } from "./move.js";
import { pullVerb, pushVerb } from "./push.js";
import { takeVerb } from "./take.js";
import { attackVerb } from "./attack.js";
import { waitVerb } from "./wait.js";

export const verbRegistry: VerbRegistry = new Map([
  ["move", moveVerb],
  ["take", takeVerb],
  ["drop", dropVerb],
  ["push", pushVerb],
  ["pull", pullVerb],
  ["attack", attackVerb],
  ["wait", waitVerb],
]);
