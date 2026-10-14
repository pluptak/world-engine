using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// What a controller may send: its verb, target and args. Never an actor or `perceivers`, which the view and the world fill
// (src/actor-world.ts `ActorCommand`).
public sealed record ActorCommand(
    string CommandId,
    string Verb,
    string? Target = null,
    Value.Map? Args = null);

// What an actor senses: the world's projection with every id an alias, and the tick in place of a version.
public sealed record ActorObservation(
    string Observer,
    long Tick,
    IReadOnlyList<string> UnknownSenses,
    IReadOnlyList<Projection.ObservedEntity> Entities,
    IReadOnlyList<Projection.SensedEvent> Events);

// What came of a command, as the actor could know it; an applied one carries what the actor sensed of it.
public sealed record ActorVerdict(
    Status Status,
    string CommandId,
    string? ResolvedTarget = null,
    IReadOnlyList<string>? Candidates = null,
    Code? ReasonCode = null,
    Value.Map? ReasonData = null,
    ActorObservation? Observation = null);

// What an actor can try now; a body that is out has none, and says why.
public sealed record ActorOptions(
    string Actor,
    IReadOnlyList<Options.ReadyOption> Ready,
    IReadOnlyList<string> NeedsArgs,
    IReadOnlyList<Options.BlockedOption>? Blocked = null,
    Code? ReasonCode = null);

// What an actor calls things by (src/actor-world.ts `aliasOf`): `x` and the first 12 hex digits of a hash of the view's key and the
// id, with a part address keeping its part. Nothing is stored, and no count shows through.
public static class ActorAlias
{
    private static readonly Regex Pattern = new(@"^x[0-9a-f]{12}(\..+)?\z", RegexOptions.CultureInvariant);

    public static string Of(string key, string id)
    {
        var dot = id.IndexOf('.');
        var (entity, part) = dot < 0 ? (id, "") : (id[..dot], id[dot..]);
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes($"{key}:{entity}"));
        return $"x{Convert.ToHexString(digest).ToLowerInvariant()[..12]}{part}";
    }

    // Whether a text has the shape of an alias, with a part address or without.
    public static bool Looks(string text) => Pattern.IsMatch(text);

    // The part of an alias-shaped text after its entity (`.hand_l`), or empty.
    public static string PartOf(string text)
    {
        var match = Pattern.Match(text);
        return match.Groups[1].Success ? match.Groups[1].Value : "";
    }
}

// One actor's side of a world (src/actor-world.ts `actorWorld`): what it senses, what it can try, and what came of what it did, with
// every id it sees as an alias of its own and no version. A view of one body keys its aliases by that body; a slot's view keys them by
// its first body, and reads through each of its bodies (`senses`). The world it wraps stays the trusted caller's.
public sealed class ActorWorld
{
    // The reason_data keys an actor is never told: how much a vessel holds is read, not told.
    private static readonly string[] UntoldAmounts = ["available", "held"];

    private readonly IWorld world;
    private readonly string actor;
    private readonly string key;
    private readonly IReadOnlyList<string> senses;

    public ActorWorld(IWorld world, string actor, string? key = null, IReadOnlyList<string>? senses = null)
    {
        if (world.EntityOf(actor) is null)
        {
            throw new WorldError(Code.NoSuchEntity, $"Unknown actor {actor}");
        }
        this.world = world;
        this.actor = actor;
        this.key = key ?? actor;
        this.senses = senses ?? [actor];
    }

    public string Actor => actor;

    // What it senses now, or since a tick (`since_tick`), merged over its bodies.
    public ActorObservation Observe(long? sinceTick = null) => ToActor(ObserveAll(sinceTick));

    // One entity in detail, as one of its bodies senses it; null when none does.
    public Projection.Inspection? Inspect(string entity)
    {
        var id = Unalias(entity);
        foreach (var sense in Present())
        {
            var inspection = world.Inspect(sense, id);
            if (inspection is not null)
            {
                return InspectionOut(inspection);
            }
        }
        return null;
    }

    // Judged as the world would judge it now, with nothing applied.
    public ActorVerdict Check(ActorCommand command) => VerdictOf(world.Check(Decode(command)), ObserveAll());

    // What it can try now, from what it can name, with the refusals if asked.
    public ActorOptions OptionsOf(bool refused = false)
    {
        var snapshot = world.CurrentSnapshot();
        var options = world.OptionsFor(actor, refused);
        return new ActorOptions(
            Alias(options.Actor),
            [.. options.Ready.Select(option => option with { Target = AliasOf(option.Target), Args = ArgsOut(snapshot, option.Args) })],
            options.NeedsArgs,
            options.Blocked?.Select(option => option with { Target = AliasOf(option.Target), Args = ArgsOut(snapshot, option.Args) }).ToList());
    }

    // Decided against the world as it is, and applied if accepted: an actor has no version to base a command on, so none is ever
    // preempted by what it could not see. The verdict carries what it sensed of its own command.
    public ActorVerdict Apply(ActorCommand command)
    {
        var result = world.Apply(Decode(command), observe: true);
        var observation = ObservedAfter(result);
        return VerdictOf(result, observation) with { Observation = ToActor(observation) };
    }

    // An alias or a raw id of this view's command, read back to the world's ids as the view's own `check` reads them. Internal, as the
    // handles that hold a move read it (src/internal.ts `VIEW_COMMANDS`).
    internal Command Decode(ActorCommand command)
    {
        var snapshot = world.CurrentSnapshot();
        Dictionary<string, string>? table = null;
        string Read(string text)
        {
            if (table is null && ActorAlias.Looks(text))
            {
                table = AliasTable(snapshot);
            }
            return UnaliasIn(snapshot, table, text);
        }

        var args = command.Args is null
            ? null
            : Value.Of(command.Args.Select(pair => KeyValuePair.Create(
                pair.Key,
                (Value?)(pair.Value.AsText() is { } text && !IsToken(command.Verb, pair.Key) ? Read(text) : pair.Value))));
        return new Command(
            command.CommandId,
            actor,
            command.Verb,
            Target: command.Target is null ? null : Read(command.Target),
            Args: args);
    }

    // A `token` arg (what `say` says) is opaque text, passed as it is: never an alias, and never an id-shaped word rewritten.
    internal static bool IsToken(string verb, string key) =>
        VerbSpecs.ByVerb.TryGetValue(verb, out var spec)
        && spec.Args.GetValueOrDefault(key)?.Kind == ArgKind.Token;

    private string Alias(string id) => ActorAlias.Of(key, id);

    private bool IsAddress(Snapshot snapshot, string value) => snapshot.Entities.ContainsKey(value.Split('.')[0]);

    private string? AliasOf(string? id) => id is null ? null : Alias(id);

    // A value that names an entity or a part of one, as its alias; any other value as it is.
    private Value AliasValue(Snapshot snapshot, Value value) =>
        value.AsText() is { } text && IsAddress(snapshot, text) ? Alias(text) : value;

    private Value.Map? ArgsOut(Snapshot snapshot, Value.Map? args) =>
        args is null ? null : Value.Of(args.Select(pair => KeyValuePair.Create(pair.Key, (Value?)AliasValue(snapshot, pair.Value))));

    // A word no name, alias or id in the world is: names are free text, so the first `nothing<n>` none of them is.
    private string Nothing()
    {
        var snapshot = world.CurrentSnapshot();
        var taken = new HashSet<string>(snapshot.Entities.Keys, StringComparer.Ordinal);
        foreach (var entity in snapshot.Entities.Values)
        {
            taken.Add(entity.Name.ToLowerInvariant());
            foreach (var name in entity.Aliases)
            {
                taken.Add(name.ToLowerInvariant());
            }
        }
        var n = 0;
        while (taken.Contains($"nothing{n}"))
        {
            n += 1;
        }
        return $"nothing{n}";
    }

    private Dictionary<string, string> AliasTable(Snapshot snapshot)
    {
        var table = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var id in snapshot.Entities.Keys)
        {
            table[Alias(id)] = id;
        }
        return table;
    }

    private string Unalias(string text) => UnaliasIn(world.CurrentSnapshot(), null, text);

    // One of this view's aliases back to the id it stands for. A raw id of the world names nothing in the view, and another view's
    // alias passes as text, as a name no one holds would.
    private string UnaliasIn(Snapshot snapshot, Dictionary<string, string>? table, string text)
    {
        if (!ActorAlias.Looks(text))
        {
            return IsAddress(snapshot, text) ? Nothing() : text;
        }
        var part = ActorAlias.PartOf(text);
        var entity = text.Substring(0, text.Length - part.Length);
        var id = table is not null
            ? (table.TryGetValue(entity, out var found) ? found : null)
            : snapshot.Entities.Keys.FirstOrDefault(candidate => Alias(candidate) == entity);
        return id is null ? text : id + part;
    }

    // Built from the world's own projection of each body, the first body that senses an entity giving its facts.
    private static Projection.Observation Merge(IReadOnlyList<Projection.Observation> parts, string observer)
    {
        var entities = new List<Projection.ObservedEntity>();
        var seenEntities = new HashSet<string>(StringComparer.Ordinal);
        var events = new List<Projection.SensedEvent>();
        var seenEvents = new HashSet<string>(StringComparer.Ordinal);
        foreach (var part in parts)
        {
            entities.AddRange(part.Entities.Where(entity => seenEntities.Add(entity.Id)));
            events.AddRange(part.Events.Where(@event => seenEvents.Add(@event.EventId)));
        }
        return new Projection.Observation(
            observer,
            parts.Count == 0 ? 0 : parts.Max(part => part.Version),
            parts.Count == 0 ? [] : parts[0].UnknownSenses,
            entities,
            [.. events.OrderBy(@event => long.Parse(@event.EventId[2..]))]);
    }

    private List<string> Present() => [.. senses.Where(sense => world.EntityOf(sense) is not null)];

    private Projection.Observation ObserveAll(long? sinceTick = null) =>
        Merge([.. Present().Select(sense => world.Observe(sense, sinceTick: sinceTick))], key);

    // What the bodies sense after a command, since the version it was applied to: the actor's own observation for its own body, and
    // each other body's since the same version.
    private Projection.Observation ObservedAfter(Pipeline.Result result)
    {
        var since = result.Status == Status.Ok ? result.Snapshot.Version - 1 : world.CurrentSnapshot().Version;
        return Merge(
            [.. Present().Select(sense => sense == actor && result.Observation is not null
                ? result.Observation
                : world.Observe(sense, since: since))],
            key);
    }

    private Projection.Facts? FactsOut(Projection.Facts? facts) => facts is null
        ? null
        : facts with { Location = AliasOf(facts.Location), Support = AliasOf(facts.Support), ContainedIn = AliasOf(facts.ContainedIn) };

    private Projection.ObservedEntity EntityOut(Projection.ObservedEntity entity) =>
        entity with { Id = Alias(entity.Id), Facts = FactsOut(entity.Facts) };

    private Projection.Inspection InspectionOut(Projection.Inspection inspection)
    {
        var snapshot = world.CurrentSnapshot();
        return inspection with
        {
            Id = Alias(inspection.Id),
            Facts = FactsOut(inspection.Facts),
            Props = inspection.Props is null
                ? null
                : Value.Of(inspection.Props.Select(pair => KeyValuePair.Create(
                    pair.Key,
                    (Value?)(Prop.Table.TryGetValue(pair.Key, out var field) && field.Type == PropType.Id
                        ? AliasValue(snapshot, pair.Value)
                        : pair.Value)))),
            Holds = inspection.Holds?.Select(Alias).Order(StringComparer.Ordinal).ToList(),
        };
    }

    // A verdict as the actor could know it: what it named itself, its room and what it senses are the ids it may see; a reason
    // naming any other entity it could not name is left out.
    private ActorVerdict VerdictOf(Pipeline.Result result, Projection.Observation view)
    {
        var known = new HashSet<string>(StringComparer.Ordinal) { actor };
        foreach (var entity in view.Entities)
        {
            known.Add(entity.Id);
        }
        if (world.EntityOf(actor)?.Location is { } room)
        {
            known.Add(room);
        }
        foreach (var address in new[] { result.ResolvedTarget }.Concat(result.Candidates ?? []))
        {
            if (address is not null)
            {
                known.Add(address);
                known.Add(address.Split('.')[0]);
            }
        }
        var snapshot = world.CurrentSnapshot();
        bool Told(string name)
        {
            var text = result.ReasonData![name].AsText();
            return !UntoldAmounts.Contains(name)
                && (text is null || !snapshot.Entities.ContainsKey(text) || known.Contains(text) || Perception.Gropable(snapshot, actor, text));
        }
        var data = ArgsOut(snapshot, result.ReasonData?.Only(Told));
        return new ActorVerdict(
            result.Status,
            result.CommandId,
            AliasOf(result.ResolvedTarget),
            result.Candidates?.Select(Alias).ToList(),
            result.ReasonCode,
            data is { Count: > 0 } ? data : null);
    }

    // Entities listed by alias in alias order, and events in the order they happened, which the actor could tell.
    private ActorObservation ToActor(Projection.Observation projection) => new(
        Alias(projection.Observer),
        world.CurrentSnapshot().Tick,
        projection.UnknownSenses,
        [.. projection.Entities.Select(EntityOut).OrderBy(entity => entity.Id, StringComparer.Ordinal)],
        [.. projection.Events.Select(@event => @event with
        {
            EventId = Alias(@event.EventId),
            Entity = AliasOf(@event.Entity),
            HeardFrom = AliasOf(@event.HeardFrom),
        })]);
}
