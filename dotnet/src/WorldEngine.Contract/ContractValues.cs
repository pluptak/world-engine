namespace WorldEngine.Contract;

// A position written against a named reference point; it resolves to the anchor's position plus (dx, dy) (src/contract.ts
// `AnchorPosSchema`). The anchor is a name, never empty.
public sealed record AnchorPos(string Anchor, long Dx, long Dy);
