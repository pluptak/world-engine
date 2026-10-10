// The world's dice. A 32-bit state lives in the snapshot (`rng`), so a roll is a function of the
// world and nothing else: the same seed and commands always roll the same. mulberry32, written out
// here so no dependency decides what a replay means.

export const RNG_MODULUS = 2 ** 32;

// Whether a value can be the state: a whole number from 0 to 2^32 - 1.
export function isRngState(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < RNG_MODULUS;
}

// One step: a number in [0, 1) and the state after it.
export function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / RNG_MODULUS, state: next };
}

// The order a round takes its moves in: a permutation drawn from a stream of its own, started from the
// dice's state at the round's start and the tick. It reads the dice and never advances them, so the order
// is a pure function of the seed and the tick, and no move's roll decides who goes first.
export function roundOrder<T>(state: number, tick: number, items: readonly T[]): T[] {
  let stream = (state ^ Math.imul(tick + 1, 0x9e3779b9)) >>> 0;
  const order = [...items];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const drawn = nextRandom(stream);
    stream = drawn.state;
    const j = Math.floor(drawn.value * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

// Thrown by a roll in a world that has no seed: the pipeline turns it into a refusal, so a world is
// never given a seed it did not ask for.
export class NoSeedError extends Error {
  constructor() {
    super("The world has no seed to roll with");
  }
}
