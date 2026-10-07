import { capacities } from "../capacity.js";
import { insufficientCode, meetsRequirements, unmetRequirement } from "../carry.js";
import type { CommandContext, PreconditionResult, Verb } from "../command.js";

// What a speaker says is a token the caller made up and keeps the text of: the engine stores it on
// the event and never interprets it, so no prose crosses the boundary (`docs/speech.md`).
const UTTERANCE = /^[A-Za-z0-9_.:-]{1,64}$/;
export const VOLUMES = ["whisper", "normal", "shout"] as const;

export function isUtterance(value: unknown): value is string {
  return typeof value === "string" && UTTERANCE.test(value);
}

function volumeOf(args: Record<string, unknown>): string | null {
  const volume = args.volume ?? "normal";
  return typeof volume === "string" && (VOLUMES as readonly string[]).includes(volume) ? volume : null;
}

function preconditions(context: CommandContext): PreconditionResult {
  const args = context.command.args ?? {};
  if (!isUtterance(args.utterance) || volumeOf(args) === null) {
    return { status: "invalid", reason_code: "invalid_args" };
  }
  const required = context.verb.requires ?? [];
  const have = capacities(context.snapshot, context.registry, context.actor.id);
  if (!meetsRequirements(have, required)) {
    const data = unmetRequirement(have, required);
    return {
      status: "refused",
      reason_code: insufficientCode(required),
      ...(data !== null && { reason_data: data }),
    };
  }
  return { status: "ok" };
}

// Saying changes no state: the event is the whole of it, on the speaker, naming the addressee as a
// fact of the act and not a claim that anyone understood.
export const sayVerb: Verb = {
  requires_target: false,
  args: { utterance: { kind: "token" }, volume: { kind: "enum", values: VOLUMES, optional: true } },
  refuses: ["insufficient_speech"],
  duration: { ticks: 1 },
  requires: [{ capacity: "speech", at_least: 50 }],
  rootEvent: (command, actor, target) => ({
    entity: actor.id,
    data: {
      utterance: command.args?.utterance,
      volume: volumeOf(command.args ?? {}) ?? "normal",
      ...(target !== null && { to: target.entity_id }),
    },
  }),
  preconditions,
  transition: () => {},
};
