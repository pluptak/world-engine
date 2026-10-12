namespace WorldEngine.Core.Engine;

// Raised for a command or world that needs a part of the TypeScript engine not ported yet, so that it fails loudly
// instead of answering as the port would wrongly guess.
public sealed class NotPortedException(string what) : Exception($"Not ported yet: {what}");
