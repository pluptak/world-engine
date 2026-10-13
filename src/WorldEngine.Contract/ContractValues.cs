using System.Text.Json.Nodes;

namespace WorldEngine.Contract;

// A position written against a named reference point; it resolves to the anchor's position plus (dx, dy) (src/contract.ts
// `AnchorPosSchema`). The anchor is a name, never empty.
public sealed record AnchorPos(string Anchor, long Dx, long Dy);

// One reason a request was refused (src/contract.ts `ValidationIssueSchema`): `Path` names the part of the request at fault, by field name
// or by index. A member beyond these three is allowed (`passthrough`), so a caller may add its own.
public sealed record ValidationIssue(string Code, IReadOnlyList<JsonNode> Path, string Message);

// The answer to a request the contract refuses (src/contract.ts `ValidationFailureSchema`): its status is always "invalid".
public sealed record ValidationFailure(IReadOnlyList<ValidationIssue> Issues)
{
    public string Status => "invalid";
}

// A command a caller sends (src/contract.ts `CommandSchema`). The request names the actor itself; `round` and `by` belong to the log the
// world keeps, so a request that names them is refused. It is named apart from the log's command, which carries those.
public sealed record ContractCommand(
    string CommandId,
    string Actor,
    string Verb,
    string? Target = null,
    IReadOnlyDictionary<string, JsonNode?>? Args = null,
    bool? Perceivers = null);
