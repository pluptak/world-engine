using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// What a controller may send: its verb, target and args. Never an actor or `perceivers`, which the view and the world fill
// (src/actor-world.ts `ActorCommand`).
public sealed record ActorCommand(
    string CommandId,
    string Verb,
    string? Target = null,
    IReadOnlyDictionary<string, JsonNode?>? Args = null);

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
            throw new WorldError("no_such_entity", $"Unknown actor {actor}");
        }
        this.world = world;
        this.actor = actor;
        this.key = key ?? actor;
        this.senses = senses ?? [actor];
    }

    public string Actor => actor;

    // What it senses now, or since a tick (`since_tick`), merged over its bodies.
    public JsonObject Observe(long? sinceTick = null) => ToActor(ObserveAll(sinceTick));

    // One entity in detail, as one of its bodies senses it; null when none does.
    public JsonObject? Inspect(string entity)
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
    public JsonObject Check(ActorCommand command) => Verdict(world.Check(Decode(command)), ObserveAll());

    // What it can try now, from what it can name, with the refusals if asked.
    public JsonObject OptionsOf(bool refused = false)
    {
        var snapshot = world.CurrentSnapshot();
        var options = JsonNode.Parse(WorldJson.Write(world.OptionsFor(actor, refused)))!.AsObject();
        var output = new JsonObject
        {
            ["actor"] = ActorAlias.Of(key, options["actor"]!.GetValue<string>()),
            ["ready"] = new JsonArray([.. options["ready"]!.AsArray().Select(option => (JsonNode?)OptionOut(option!.AsObject(), snapshot))]),
            ["needs_args"] = options["needs_args"]!.DeepClone(),
        };
        if (options["blocked"] is JsonArray blocked)
        {
            output["blocked"] = new JsonArray([.. blocked.Select(option => (JsonNode?)OptionOut(option!.AsObject(), snapshot))]);
        }
        return output;
    }

    // Decided against the world as it is, and applied if accepted: an actor has no version to base a command on, so none is ever
    // preempted by what it could not see. The verdict carries what it sensed of its own command.
    public JsonObject Apply(ActorCommand command)
    {
        var result = world.Apply(Decode(command), observe: true);
        var observation = ObservedAfter(result);
        var verdict = Verdict(result, observation);
        verdict["observation"] = ToActor(observation);
        return verdict;
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

        var args = command.Args?.ToDictionary(
            pair => pair.Key,
            pair => (JsonNode?)(JsonReads.Text(pair.Value) is { } text && !IsToken(command.Verb, pair.Key)
                ? JsonValue.Create(Read(text))
                : pair.Value?.DeepClone()),
            StringComparer.Ordinal);
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
        && JsonNode.Parse(spec.Args)?[key]?["kind"]?.GetValue<string>() == "token";

    private string Alias(string id) => ActorAlias.Of(key, id);

    private bool IsAddress(Snapshot snapshot, string value) => snapshot.Entities.ContainsKey(value.Split('.')[0]);

    private JsonNode? AliasValue(Snapshot snapshot, JsonNode? value) =>
        JsonReads.Text(value) is { } text && IsAddress(snapshot, text) ? JsonValue.Create(Alias(text)) : value?.DeepClone();

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
    private static JsonObject Merge(IReadOnlyList<JsonObject> parts, string observer)
    {
        var entities = new List<JsonObject>();
        var seenEntities = new HashSet<string>(StringComparer.Ordinal);
        var events = new List<JsonObject>();
        var seenEvents = new HashSet<string>(StringComparer.Ordinal);
        foreach (var part in parts)
        {
            foreach (var entity in part["entities"]!.AsArray())
            {
                if (seenEntities.Add(entity!["id"]!.GetValue<string>()))
                {
                    entities.Add(entity.AsObject());
                }
            }
            foreach (var @event in part["events"]!.AsArray())
            {
                if (seenEvents.Add(@event!["event_id"]!.GetValue<string>()))
                {
                    events.Add(@event.AsObject());
                }
            }
        }
        var ordered = events.OrderBy(@event => long.Parse(@event["event_id"]!.GetValue<string>()[2..])).ToList();
        return new JsonObject
        {
            ["observer"] = observer,
            ["version"] = JsonValue.Create(parts.Count == 0 ? 0L : parts.Max(part => part["version"]!.GetValue<long>())),
            ["unknown_senses"] = parts.Count == 0 ? new JsonArray() : parts[0]["unknown_senses"]!.DeepClone(),
            ["entities"] = new JsonArray([.. entities.Select(entity => (JsonNode?)entity.DeepClone())]),
            ["events"] = new JsonArray([.. ordered.Select(@event => (JsonNode?)@event.DeepClone())]),
        };
    }

    private List<string> Present() => [.. senses.Where(sense => world.EntityOf(sense) is not null)];

    private JsonObject ObserveAll(long? sinceTick = null) =>
        Merge([.. Present().Select(sense => world.Observe(sense, sinceTick: sinceTick))], key);

    // What the bodies sense after a command, since the version it was applied to: the actor's own observation for its own body, and
    // each other body's since the same version.
    private JsonObject ObservedAfter(Pipeline.Result result)
    {
        var since = result.Status == Status.Ok ? result.Snapshot.Version - 1 : world.CurrentSnapshot().Version;
        return Merge(
            [.. Present().Select(sense => sense == actor && result.Observation is not null
                ? result.Observation
                : world.Observe(sense, since: since))],
            key);
    }

    private JsonObject EntityOut(JsonObject entity)
    {
        var copy = entity.DeepClone().AsObject();
        copy["id"] = Alias(copy["id"]!.GetValue<string>());
        if (copy["facts"] is JsonObject facts)
        {
            foreach (var field in new[] { "location", "support", "contained_in" })
            {
                if (facts.ContainsKey(field))
                {
                    facts[field] = JsonReads.Text(facts[field]) is { } text ? JsonValue.Create(Alias(text)) : facts[field]?.DeepClone();
                }
            }
        }
        return copy;
    }

    private JsonObject InspectionOut(JsonObject inspection)
    {
        var snapshot = world.CurrentSnapshot();
        var copy = EntityOut(inspection);
        if (copy["props"] is JsonObject props)
        {
            var mapped = new JsonObject();
            foreach (var (name, value) in props)
            {
                mapped[name] = PropFields.Table.TryGetValue(name, out var field) && field.Type == PropType.Id
                    ? AliasValue(snapshot, value)
                    : value?.DeepClone();
            }
            copy["props"] = mapped;
        }
        if (copy["holds"] is JsonArray holds)
        {
            var aliased = holds.Select(holder => Alias(JsonReads.Text(holder)!)).Order(StringComparer.Ordinal);
            copy["holds"] = new JsonArray([.. aliased.Select(text => (JsonNode?)JsonValue.Create(text))]);
        }
        return copy;
    }

    private JsonObject OptionOut(JsonObject option, Snapshot snapshot)
    {
        var copy = option.DeepClone().AsObject();
        if (JsonReads.Text(copy["target"]) is { } target)
        {
            copy["target"] = Alias(target);
        }
        if (copy["args"] is JsonObject args)
        {
            var mapped = new JsonObject();
            foreach (var (name, value) in args)
            {
                mapped[name] = AliasValue(snapshot, value);
            }
            copy["args"] = mapped;
        }
        return copy;
    }

    // A verdict as the actor could know it: what it named itself, its room and what it senses are the ids it may see; a reason
    // naming any other entity it could not name is left out.
    private JsonObject Verdict(Pipeline.Result result, JsonObject view)
    {
        var known = new HashSet<string>(StringComparer.Ordinal) { actor };
        foreach (var entity in view["entities"]!.AsArray())
        {
            known.Add(entity!["id"]!.GetValue<string>());
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
        var data = new List<KeyValuePair<string, JsonNode?>>();
        foreach (var name in (result.ReasonData?.Keys ?? []).Order(StringComparer.Ordinal))
        {
            if (UntoldAmounts.Contains(name))
            {
                continue;
            }
            var value = result.ReasonData![name];
            var text = JsonReads.Text(value);
            if (text is null || !snapshot.Entities.ContainsKey(text) || known.Contains(text) || Perception.Gropable(snapshot, actor, text))
            {
                data.Add(new KeyValuePair<string, JsonNode?>(name, value));
            }
        }
        var output = new JsonObject
        {
            ["status"] = WorldJson.Name(result.Status),
            ["command_id"] = result.CommandId,
            ["resolved_target"] = result.ResolvedTarget is null ? null : (JsonNode)Alias(result.ResolvedTarget),
        };
        if (result.Candidates is not null)
        {
            output["candidates"] = new JsonArray([.. result.Candidates.Select(candidate => (JsonNode?)Alias(candidate))]);
        }
        if (result.ReasonCode is not null)
        {
            output["reason_code"] = result.ReasonCode;
        }
        if (data.Count > 0)
        {
            output["reason_data"] = new JsonObject(data.Select(pair => KeyValuePair.Create(pair.Key, AliasValue(snapshot, pair.Value))));
        }
        return output;
    }

    // Entities listed by alias in alias order, and events in the order they happened, which the actor could tell.
    private JsonObject ToActor(JsonObject projection)
    {
        var snapshot = world.CurrentSnapshot();
        var entities = projection["entities"]!.AsArray()
            .Select(entity => EntityOut(entity!.AsObject()))
            .OrderBy(entity => entity["id"]!.GetValue<string>(), StringComparer.Ordinal)
            .Select(entity => (JsonNode?)entity)
            .ToArray();
        var events = projection["events"]!.AsArray().Select(@event =>
        {
            var copy = @event!.DeepClone().AsObject();
            copy["event_id"] = Alias(copy["event_id"]!.GetValue<string>());
            foreach (var field in new[] { "entity", "heard_from" })
            {
                if (JsonReads.Text(copy[field]) is { } text)
                {
                    copy[field] = Alias(text);
                }
            }
            return (JsonNode?)copy;
        }).ToArray();
        return new JsonObject
        {
            ["observer"] = Alias(projection["observer"]!.GetValue<string>()),
            ["tick"] = JsonValue.Create(snapshot.Tick),
            ["unknown_senses"] = projection["unknown_senses"]!.DeepClone(),
            ["entities"] = new JsonArray(entities),
            ["events"] = new JsonArray(events),
        };
    }
}
