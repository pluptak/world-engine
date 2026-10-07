export * from "./api.js";
export * from "./actor-world.js";

export const PIPELINE = [
  "command",
  "target resolution",
  "preconditions",
  "action",
  "world transition",
  "consequences",
  "events",
] as const;