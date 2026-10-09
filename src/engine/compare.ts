// The ordering ops, shared by a process's `while` and a beat's condition. Both callers check that
// both sides are numbers first, which is where the "an absent or non-numeric prop satisfies none of
// them" rule lives.
export const ORDER_OPS: Record<"lt" | "lte" | "gt" | "gte", (have: number, want: number) => boolean> = {
  lt: (have, want) => have < want,
  lte: (have, want) => have <= want,
  gt: (have, want) => have > want,
  gte: (have, want) => have >= want,
};
