namespace WorldEngine.Core.Model;

// What a command is, what the log records for it, and what the world answers (src/engine/command.ts, src/model.ts).

public enum Status
{
    Ok,
    Refused,
    Ambiguous,
    Unresolved,
    Preempted,
    Invalid,
}

public enum Role
{
    Author,
    Director,
    Player,
}

// The role a command was sent under (`docs/roles.md`); absent for the author of a bare world.
public sealed record By(
    Role Role,
    string? Handle = null);

// Where a logged command sits in a round (`docs/rounds.md`).
public sealed record RoundMark(
    long Number,
    long? Place = null,
    bool? Close = null);

public sealed record Command(
    string CommandId,
    string Actor,
    string Verb,
    string? Target = null,
    Value.Map? Args = null,
    bool? Perceivers = null,
    bool? Round = null,
    By? By = null,
    // The agent issuing a command for the body named by Actor; set only by an actor view (`docs/actor-view.md`).
    string? Via = null);

// A command as the log holds it: refused and invalid ones too, with the version it was decided at.
public sealed record Attempt(
    Command Command,
    long BasedOnVersion,
    long Version,
    Status Status,
    Code? ReasonCode = null,
    Value.Map? ReasonData = null,
    IReadOnlyList<string>? Candidates = null,
    RoundMark? Round = null,
    By? By = null);
