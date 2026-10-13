namespace WorldEngine.Core.Engine;

// A roll in a world with no seed (src/engine/rng.ts `NoSeedError`): the pipeline turns it into a refusal, so a world is never given a
// seed it did not ask for. Thrown wherever in the command the roll falls.
public sealed class NoSeedError() : Exception("The world has no seed to roll with");
