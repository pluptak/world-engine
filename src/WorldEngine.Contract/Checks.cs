using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using static WorldEngine.Contract.Shapes;

namespace WorldEngine.Contract;

// What the command line accepts before it runs anything: the shape of a request, of a scenario file and of a coverage file, each read
// as a value first (so a fraction or a null in a list is refused before any shape is judged). Only the outer shape is judged here. The inside of an edit, a command's args or a prop is the engine's own to read, with its own refusals.
public static class Checks
{
    public static bool IsRequest(Value? request) =>
        (request as Value.Map)?.GetValueOrDefault("op").AsText() is { } op
        && Requests.TryGetValue(op, out var shape)
        && shape(request);

    // A scenario file is a list of entries, or a scene.
    public static bool IsScenario(Value? scenario) => scenario is Value.List ? Entries(scenario) : Scene(scenario);

    public static bool IsCoverage(Value? coverage) => Coverage(coverage);

    private static (string, Field) Op(string name) => ("op", Req(Const(name)));
    private static readonly (string, Field) World = ("world", Req(NonEmpty));
    private static readonly (string, Field) Version = ("based_on_version", Opt(Int));
    private static readonly (string, Field) IncludeSnapshot = ("include_snapshot", Opt(Bool));

    private static readonly Shape Command = Obj(
        ("actor", Req(Text)), ("args", Opt(Record)), ("command_id", Req(Text)), ("perceivers", Opt(Bool)), ("target", Opt(Text)), ("verb", Req(Text)));

    private static readonly Shape ActorCommand = Obj(("args", Opt(Record)), ("command_id", Req(Text)), ("target", Opt(Text)), ("verb", Req(Text)));

    private static readonly Shape Move = Obj(
        ("args", Opt(Record)), ("body", Opt(NonEmpty)), ("command_id", Req(Text)), ("target", Opt(Text)), ("verb", Req(Text)));

    // An edit is an object that names its kind; each kind's own members are checked by the edit itself.
    private static readonly Shape Edit = value => (value as Value.Map)?.GetValueOrDefault("kind") is Value.Text;

    private static readonly Shape FactQuery = Obj(
        ("kind", Req(Const("fact"))), ("object", Opt(Text)), ("relation", Req(Text)), ("subject", Req(Text)));

    private static readonly Shape PerceiveQuery = Obj(
        ("entity", Opt(Text)), ("event_id", Opt(Text)), ("kind", Req(Const("perceive"))), ("observer", Req(Text)), ("sense", Req(Text)));

    private static readonly Shape TraceQuery = Or(
        Obj(("event_id", Req(Text))),
        Obj(("entity", Req(Text)), ("field", Req(NonEmpty))));

    private static readonly Shape Anchor = Obj(("anchor", Req(NonEmpty)), ("dx", Req(Int)), ("dy", Req(Int)));
    private static readonly Shape Plain = Obj(("x", Req(Int)), ("y", Req(Int)));

    private static readonly Shape Overrides = Obj(
        ("aliases", Opt(List(Text))),
        ("clear", Opt(List(OneOfText("location", "support", "contained_in", "in_part", "concealed_by", "pos")))),
        ("concealed_by", Opt(Text)),
        ("condition", Opt(Text)),
        ("contained_in", Opt(Text)),
        ("detached_from", Opt(Obj(("entity", Req(Text)), ("part", Req(Text))))),
        ("fuel_pct", Opt(Int)),
        ("hunger_pct", Opt(Int)),
        ("in_part", Opt(Text)),
        ("integrity", Opt(Int)),
        ("liquid", Opt(Obj(("material", Opt(Text)), ("pct", Req(Int))))),
        ("location", Opt(Text)),
        ("modifiers", Opt(List(Obj(
            ("capacity", Req(Text)), ("cause_id", Req(Text)), ("delta", Req(Int)), ("expires_at_tick", Opt(Int)))))),
        ("name", Opt(Text)),
        ("portions_pct", Opt(Int)),
        ("pos", Opt(Or(Plain, Anchor))),
        ("props", Opt(Record)),
        ("residue", Opt(Record)),
        ("status", Opt(OneOfText("intact", "broken", "destroyed"))),
        ("support", Opt(Text)),
        ("traits", Opt(Record)));

    private static readonly Shape Entry = Obj(("id", Opt(NonEmpty)), ("overrides", Opt(Overrides)), ("template", Req(NonEmpty)));

    private static readonly Shape Entries = List(Entry);

    private static readonly Shape Scene = Obj(
        ("beats", Opt(List(Record))),
        ("entities", Req(Entries)),
        ("run", Opt(Obj(
            ("odds", Opt(List(Obj(
                ("entity", Req(NonEmpty)), ("max", Req(Between(0, 100))), ("min", Req(Between(0, 100))), ("prop", Req(Const(Prop.JamPct))))))),
            ("pool", Opt(List(Record))),
            ("slots", Opt(List(Or(NonEmpty, List(NonEmpty))))),
            ("tick_limit", Opt(AtLeast(1)))))),
        ("seed", Opt(Between(0, uint.MaxValue))));

    private static readonly Shape Coverage = Obj(("properties", Req(List(Text))), ("relations", Req(List(Text))), ("senses", Req(List(Text))));

    private static readonly Dictionary<string, Shape> Requests = new(StringComparer.Ordinal)
    {
        ["command"] = Obj(Op("command"), World, Version, ("command", Req(Command)), IncludeSnapshot, ("observe", Opt(Bool))),
        ["edit"] = Obj(Op("edit"), World, Version, ("command_id", Opt(Text)), ("edit", Req(Edit)), IncludeSnapshot, ("perceivers", Opt(Bool))),
        ["director_edit"] = Obj(
            Op("director_edit"), World, Version, ("command_id", Opt(Text)), ("edit", Req(Edit)), IncludeSnapshot, ("perceivers", Opt(Bool))),
        ["check"] = Obj(Op("check"), World, ("command", Req(Command))),
        ["beat"] = Obj(Op("beat"), World, Version, ("commands", Req(List(Command))), IncludeSnapshot),
        ["round"] = Obj(Op("round"), World, ("moves", Req(List(Command)))),
        ["since"] = Obj(Op("since"), World, ("version", Req(Int))),
        ["attempts"] = Obj(Op("attempts"), World, ("version", Req(Int))),
        ["verify"] = Obj(Op("verify"), World),
        ["snapshot"] = Obj(Op("snapshot"), World),
        ["restart"] = Obj(Op("restart"), World, ("to", Req(NonEmpty))),
        ["trace"] = Obj(Op("trace"), World, ("query", Req(TraceQuery))),
        ["query"] = Obj(Op("query"), World, ("query", Req(Or(FactQuery, PerceiveQuery)))),
        ["observe"] = Obj(Op("observe"), World, ("observer", Req(Text)), ("since", Opt(Int)), ("since_tick", Opt(Int))),
        ["inspect"] = Obj(Op("inspect"), World, ("entity", Req(Text)), ("observer", Req(Text))),
        ["options"] = Obj(Op("options"), World, ("actor", Req(Text)), ("refused", Opt(Bool))),
        ["schedule"] = Obj(
            Op("schedule"),
            World,
            ("filter", Opt(Obj(
                ("entity", Opt(Text)), ("kind", Opt(OneOfText(CauseKind.Close, CauseKind.Bleed, CauseKind.Process, CauseKind.Beat, CauseKind.Outcome))), ("until_tick", Opt(Int)))))),
        ["verbs"] = Obj(Op("verbs")),
        ["capabilities"] = Obj(Op("capabilities")),
        ["catalog"] = Obj(Op("catalog"), ("world", Opt(NonEmpty))),
        ["actor_observe"] = Obj(Op("actor_observe"), World, ("actor", Req(Text)), ("since_tick", Opt(Int))),
        ["actor_inspect"] = Obj(Op("actor_inspect"), World, ("actor", Req(Text)), ("entity", Req(Text))),
        ["actor_options"] = Obj(Op("actor_options"), World, ("actor", Req(Text)), ("refused", Opt(Bool))),
        ["actor_check"] = Obj(Op("actor_check"), World, ("actor", Req(Text)), ("command", Req(ActorCommand)), ("via", Opt(NonEmpty))),
        ["actor_command"] = Obj(Op("actor_command"), World, ("actor", Req(Text)), ("command", Req(ActorCommand)), ("via", Opt(NonEmpty))),
        ["player_observe"] = Obj(Op("player_observe"), World, ("handle", Req(NonEmpty)), ("since_tick", Opt(Int))),
        ["player_inspect"] = Obj(Op("player_inspect"), World, ("entity", Req(Text)), ("handle", Req(NonEmpty))),
        ["player_options"] = Obj(Op("player_options"), World, ("body", Opt(NonEmpty)), ("handle", Req(NonEmpty)), ("refused", Opt(Bool))),
        ["player_check"] = Obj(Op("player_check"), World, ("handle", Req(NonEmpty)), ("move", Req(Move))),
        ["player_submit"] = Obj(Op("player_submit"), World, ("handle", Req(NonEmpty)), ("move", Req(Move))),
        ["player_withdraw"] = Obj(Op("player_withdraw"), World, ("body", Opt(NonEmpty)), ("handle", Req(NonEmpty))),
        ["player_pending"] = Obj(Op("player_pending"), World, ("handle", Req(NonEmpty))),
        ["director_submitted"] = Obj(Op("director_submitted"), World),
        ["director_close_round"] = Obj(Op("director_close_round"), World),
        ["template_list"] = Obj(Op("template_list"), ("library", Req(NonEmpty))),
        ["template_get"] = Obj(Op("template_get"), ("library", Req(NonEmpty)), ("id", Req(NonEmpty)), ("revision", Opt(AtLeast(1)))),
        ["template_put"] = Obj(Op("template_put"), ("library", Req(NonEmpty)), ("template", Req(Record))),
        ["template_delete"] = Obj(Op("template_delete"), ("library", Req(NonEmpty)), ("id", Req(NonEmpty))),
    };
}
