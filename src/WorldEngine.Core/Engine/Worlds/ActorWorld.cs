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
    private readonly string? via;
    private readonly string key;
    private readonly IReadOnlyList<string> senses;

    public ActorWorld(IWorld world, string actor, string? via = null, string? key = null, IReadOnlyList<string>? senses = null)
    {
        if (world.EntityOf(actor) is null)
        {
            throw new WorldError(Code.NoSuchEntity, $"Unknown actor {actor}");
        }
        this.world = world;
        this.actor = actor;
        this.via = via;
        this.key = key ?? actor;
        this.senses = senses ?? [actor];
    }

    public string Actor => actor;

    // What it senses now, or since a tick (`since_tick`), merged over its bodies.
    public ActorObservation Observe(long? sinceTick = null)
    {
        var parts = ObserveParts(sinceTick);
        return ToActor(Merge(parts, key), ShownOf(parts));
    }

    // One entity in detail, as one of its bodies senses it; null when none does.
    public Projection.Inspection? Inspect(string entity)
    {
        var seen = ViewNow();
        var id = Unalias(seen, entity);
        foreach (var sense in Present())
        {
            var inspection = world.Inspect(sense, id);
            if (inspection is not null)
            {
                return InspectionOut(seen, inspection);
            }
        }
        return null;
    }

    // Judged as the world would judge it now, with nothing applied.
    public ActorVerdict Check(ActorCommand command)
    {
        var prepared = Prepare(command);
        if (prepared.Ambiguous is not null)
        {
            return prepared.Ambiguous;
        }
        return VerdictOf(world.Check(prepared.Decoded!), Merge(prepared.Seen.Parts, key), prepared.Seen.Shown);
    }

    // What it can try now, from what it can name, with the refusals if asked.
    public ActorOptions OptionsOf(bool refused = false)
    {
        var seen = ViewNow();
        var options = world.OptionsFor(actor, refused);
        return new ActorOptions(
            Alias(seen.Shown, options.Actor),
            [.. options.Ready.Select(option => option with { Target = AliasOf(seen.Shown, option.Target), Args = ArgsOut(seen.Snapshot, seen.Shown, option.Args) })],
            options.NeedsArgs,
            options.Blocked?.Select(option => option with { Target = AliasOf(seen.Shown, option.Target), Args = ArgsOut(seen.Snapshot, seen.Shown, option.Args) }).ToList());
    }

    // Decided against the world as it is, and applied if accepted: an actor has no version to base a command on, so none is ever
    // preempted by what it could not see. The verdict carries what it sensed of its own command.
    public ActorVerdict Apply(ActorCommand command)
    {
        var prepared = Prepare(command);
        if (prepared.Ambiguous is not null)
        {
            return prepared.Ambiguous with { Observation = ToActor(Merge(prepared.Seen.Parts, key), prepared.Seen.Shown) };
        }
        var result = world.Apply(prepared.Decoded!, observe: true);
        var observation = ObservedAfter(result);
        var shown = ShownMap();
        return VerdictOf(result, observation, shown) with { Observation = ToActor(observation, shown) };
    }

    // True id to shown id for this view: a body its bodies see by sight alone wears its appearance.
    internal Dictionary<string, string> ShownMap() => ShownOf(ObserveParts());

    private Dictionary<string, string> ShownOf(IReadOnlyList<Projection.Observation> parts) =>
        ShownTable(world.CurrentSnapshot(), parts);

    // What the view reads now: the snapshot, each body's observation, and the shown map from them.
    private sealed record Seen(Snapshot Snapshot, IReadOnlyList<Projection.Observation> Parts, Dictionary<string, string> Shown);

    private Seen ViewNow()
    {
        var snapshot = world.CurrentSnapshot();
        var parts = ObserveParts();
        return new Seen(snapshot, parts, ShownTable(snapshot, parts));
    }

    // Each entity's shown id: its appearance when every sense telling it is sight alone, else itself.
    private static Dictionary<string, string> ShownTable(Snapshot snapshot, IReadOnlyList<Projection.Observation> parts)
    {
        var senses = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var part in parts)
        {
            foreach (var entity in part.Entities)
            {
                if (!senses.TryGetValue(entity.Id, out var set))
                {
                    set = new HashSet<string>(StringComparer.Ordinal);
                    senses[entity.Id] = set;
                }
                foreach (var sense in entity.Senses)
                {
                    set.Add(sense);
                }
            }
        }
        var shown = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var id in snapshot.Entities.Keys)
        {
            var worn = snapshot.Entities[id].Props.Get(Prop.Appearance);
            var seen = senses.TryGetValue(id, out var set) ? set : new HashSet<string>(StringComparer.Ordinal);
            var sightAlone = seen.Contains(Sense.Sight) && !seen.Contains(Sense.Touch) && !seen.Contains(Sense.Smell);
            shown[id] = sightAlone && worn is not null && snapshot.Entities.ContainsKey(worn) ? worn : id;
        }
        return shown;
    }

    // An alias or a raw id of this view's command, read back to the world's ids as the view's own `check` reads them. Internal, as the
    // handles that hold a move read it (src/internal.ts `VIEW_COMMANDS`).
    internal Command Decode(ActorCommand command) => Decode(ViewNow(), command);

    // The command read back, or the ambiguity when what it names is several: a shown alias or name shared by two
    // bodies answers `ambiguous` with both as candidates, and nothing is applied.
    internal (Command? Decoded, ActorVerdict? Ambiguous) TryDecode(ActorCommand command)
    {
        var prepared = Prepare(command);
        return (prepared.Decoded, prepared.Ambiguous);
    }

    private (Seen Seen, Command? Decoded, ActorVerdict? Ambiguous) Prepare(ActorCommand command)
    {
        var seen = ViewNow();
        if (MatchAmbiguous(seen, command) is { Count: > 1 } matches)
        {
            return (seen, null, new ActorVerdict(
                Status.Ambiguous,
                command.CommandId,
                Candidates: [.. matches.Select(id => Alias(seen.Shown, id))]));
        }
        return (seen, Decode(seen, command), null);
    }

    // The observed bodies sharing one shown alias or name, in id order, when more than one does.
    private IReadOnlyList<string>? MatchAmbiguous(Seen seen, ActorCommand command)
    {
        var texts = new List<string>();
        if (command.Target is not null)
        {
            texts.Add(command.Target);
        }
        if (command.Args is not null)
        {
            foreach (var pair in command.Args)
            {
                if (pair.Value.AsText() is { } text && !IsToken(command.Verb, pair.Key))
                {
                    texts.Add(text);
                }
            }
        }
        var observed = ObservedIds(seen);
        foreach (var text in texts)
        {
            if (ShownMatches(seen, observed, text) is { Count: > 1 } matches)
            {
                return matches;
            }
        }
        return null;
    }

    private static HashSet<string> ObservedIds(Seen seen) => new(
        seen.Parts.SelectMany(part => part.Entities).Select(entity => entity.Id), StringComparer.Ordinal);

    // Every observed body behind one shown alias or name, in id order. The face's owner elsewhere does not join:
    // what the view never shows, a command of the view does not resolve.
    private List<string> ShownMatches(Seen seen, HashSet<string> observed, string text)
    {
        var matches = new List<string>();
        if (ActorAlias.Looks(text))
        {
            foreach (var id in seen.Snapshot.Entities.Keys.Order(StringComparer.Ordinal))
            {
                if (observed.Contains(id) && Alias(seen.Shown, id) == text)
                {
                    matches.Add(id);
                }
            }
        }
        else if (!IsAddress(seen.Snapshot, text))
        {
            var search = text.ToLowerInvariant();
            foreach (var id in seen.Snapshot.Entities.Keys.Order(StringComparer.Ordinal))
            {
                if (!observed.Contains(id))
                {
                    continue;
                }
                var worn = seen.Snapshot.Entities.GetValueOrDefault(ShownId(seen.Shown, id)) ?? seen.Snapshot.Entities[id];
                if (worn.Name.ToLowerInvariant() == search || worn.Aliases.Any(name => name.ToLowerInvariant() == search))
                {
                    matches.Add(id);
                }
            }
        }
        return matches;
    }

    private Command Decode(Seen seen, ActorCommand command)
    {
        Dictionary<string, string>? table = null;
        HashSet<string>? observed = null;
        string Read(string text)
        {
            if (ActorAlias.Looks(text))
            {
                table ??= AliasTable(seen);
                return UnaliasIn(seen, table, text);
            }
            // One observed body behind a shown name it does not own is named directly; an unadorned name
            // passes through to the pipeline's own gate, as does none.
            if (!IsAddress(seen.Snapshot, text))
            {
                observed ??= ObservedIds(seen);
                if (ShownMatches(seen, observed, text) is { Count: 1 } single
                    && !FoldEquals(seen.Snapshot.Entities[single[0]].Name, ShownName(seen, single[0])))
                {
                    return single[0];
                }
            }
            return UnaliasIn(seen, table, text);
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
            Args: args,
            Via: via);
    }

    // A `token` arg (what `say` says) is opaque text, passed as it is: never an alias, and never an id-shaped word rewritten.
    // The ambiguity scan above skips tokens for the same reason: only a verb with a free-text non-token arg equal to a
    // shown name would false-positive, and no such verb exists.
    internal static bool IsToken(string verb, string key) =>
        VerbSpecs.ByVerb.TryGetValue(verb, out var spec)
        && spec.Args.GetValueOrDefault(key)?.Kind == ArgKind.Token;

    private string ShownId(Dictionary<string, string> shown, string id) => shown.GetValueOrDefault(id) ?? id;

    private string Alias(Dictionary<string, string> shown, string id)
    {
        var dot = id.IndexOf('.');
        var entity = dot < 0 ? id : id[..dot];
        return ActorAlias.Of(key, ShownId(shown, entity) + (dot < 0 ? "" : id[dot..]));
    }

    private bool IsAddress(Snapshot snapshot, string value) => snapshot.Entities.ContainsKey(value.Split('.')[0]);

    private string? AliasOf(Dictionary<string, string> shown, string? id) => id is null ? null : Alias(shown, id);

    // A value that names an entity or a part of one, as its shown alias; any other value as it is.
    private Value AliasValue(Snapshot snapshot, Dictionary<string, string> shown, Value value) =>
        value.AsText() is { } text && IsAddress(snapshot, text) ? Alias(shown, text) : value;

    private Value.Map? ArgsOut(Snapshot snapshot, Dictionary<string, string> shown, Value.Map? args) =>
        args is null ? null : Value.Of(args.Select(pair => KeyValuePair.Create(pair.Key, (Value?)AliasValue(snapshot, shown, pair.Value))));

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

    private string ShownName(Seen seen, string id) =>
        seen.Snapshot.Entities.GetValueOrDefault(ShownId(seen.Shown, id))?.Name ?? seen.Snapshot.Entities[id].Name;

    private static bool FoldEquals(string left, string right) =>
        string.Equals(left.ToLowerInvariant(), right.ToLowerInvariant(), StringComparison.Ordinal);

    // Id order with what the view shows first: an observed bearer reads back before its owner elsewhere,
    // and what nothing shows falls back to id order for the pipeline to gate as today.
    private static IEnumerable<string> ReadOrder(Seen seen)
    {
        var observed = ObservedIds(seen);
        var ordered = seen.Snapshot.Entities.Keys.Order(StringComparer.Ordinal).ToList();
        return ordered.Where(observed.Contains).Concat(ordered.Where(id => !observed.Contains(id)));
    }

    private Dictionary<string, string> AliasTable(Seen seen)
    {
        // First in read order names it: two bodies under one shown alias share it, and read back together.
        var table = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var id in ReadOrder(seen))
        {
            var alias = Alias(seen.Shown, id);
            if (!table.ContainsKey(alias))
            {
                table[alias] = id;
            }
        }
        return table;
    }

    private string Unalias(Seen seen, string text) => UnaliasIn(seen, null, text);

    // One of this view's aliases back to the id it stands for. A raw id of the world names nothing in the view, and another view's
    // alias passes as text, as a name no one holds would.
    private string UnaliasIn(Seen seen, Dictionary<string, string>? table, string text)
    {
        if (!ActorAlias.Looks(text))
        {
            return IsAddress(seen.Snapshot, text) ? Nothing() : text;
        }
        var part = ActorAlias.PartOf(text);
        var entity = text.Substring(0, text.Length - part.Length);
        var id = table is not null
            ? (table.TryGetValue(entity, out var found) ? found : null)
            : ReadOrder(seen).FirstOrDefault(candidate => Alias(seen.Shown, candidate) == entity);
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

    private IReadOnlyList<Projection.Observation> ObserveParts(long? sinceTick = null) =>
        [.. Present().Select(sense => world.Observe(sense, sinceTick: sinceTick))];

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

    private Projection.Facts? FactsOut(Dictionary<string, string> shown, Projection.Facts? facts) => facts is null
        ? null
        : facts with { Location = AliasOf(shown, facts.Location), Support = AliasOf(shown, facts.Support), ContainedIn = AliasOf(shown, facts.ContainedIn) };

    // Listed by its shown alias, name and template; everything else stays the body's own.
    private Projection.ObservedEntity EntityOut(Snapshot snapshot, Dictionary<string, string> shown, Projection.ObservedEntity entity)
    {
        var worn = snapshot.Entities.GetValueOrDefault(ShownId(shown, entity.Id)) ?? snapshot.Entities[entity.Id];
        return entity with { Id = Alias(shown, entity.Id), Template = worn.Template, Name = worn.Name, Facts = FactsOut(shown, entity.Facts) };
    }

    private Projection.Inspection InspectionOut(Seen seen, Projection.Inspection inspection)
    {
        var snapshot = seen.Snapshot;
        var shown = seen.Shown;
        var worn = snapshot.Entities.GetValueOrDefault(ShownId(shown, inspection.Id)) ?? snapshot.Entities[inspection.Id];
        return inspection with
        {
            Id = Alias(shown, inspection.Id),
            Template = worn.Template,
            Name = worn.Name,
            Facts = FactsOut(shown, inspection.Facts),
            Props = inspection.Props is null
                ? null
                : Value.Of(inspection.Props.Select(pair => KeyValuePair.Create(
                    pair.Key,
                    (Value?)(Prop.Table.TryGetValue(pair.Key, out var field) && field.Type == PropType.Id
                        ? AliasValue(snapshot, shown, pair.Value)
                        : pair.Value)))),
            Holds = inspection.Holds?.Select(held => Alias(shown, held)).Order(StringComparer.Ordinal).ToList(),
        };
    }

    // A verdict as the actor could know it: what it named itself, its room and what it senses are the ids it may see; a reason
    // naming any other entity it could not name is left out.
    private ActorVerdict VerdictOf(Pipeline.Result result, Projection.Observation view, Dictionary<string, string> shown)
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
        var data = ArgsOut(snapshot, shown, result.ReasonData?.Only(Told));
        return new ActorVerdict(
            result.Status,
            result.CommandId,
            AliasOf(shown, result.ResolvedTarget),
            result.Candidates?.Select(candidate => Alias(shown, candidate)).ToList(),
            result.ReasonCode,
            data is { Count: > 0 } ? data : null);
    }

    // Entities listed by alias in alias order, and events in the order they happened, which the actor could tell.
    private ActorObservation ToActor(Projection.Observation projection, Dictionary<string, string> shown) => new(
        Alias(shown, projection.Observer),
        world.CurrentSnapshot().Tick,
        projection.UnknownSenses,
        [.. projection.Entities.Select(entity => EntityOut(world.CurrentSnapshot(), shown, entity)).OrderBy(entity => entity.Id, StringComparer.Ordinal)],
        [.. projection.Events.Select(@event => @event with
        {
            EventId = Alias(shown, @event.EventId),
            Entity = AliasOf(shown, @event.Entity),
            HeardFrom = AliasOf(shown, @event.HeardFrom),
        })]);
}
