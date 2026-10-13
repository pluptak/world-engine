using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// The open, close, lock and unlock verbs (src/engine/verbs/openable.ts): a door, lid or gate is opened or shut, and a lock
// is turned with a key carried in hand. Each is reached as a device is (`Remote`). A door with `shut_ticks` shuts that
// many ticks on, under a `closing` window; one with `closes_after` swings shut that many ticks after it is opened.
// A remote command to a device with `jam_pct` rolls the dice and may jam: the tick is spent and nothing else happens.
public static class OpenVerbs
{
    private enum Kind
    {
        Open,
        Close,
        Lock,
        Unlock,
    }

    // Turning a key needs hands; nosing a door open or shut does not. Declared before the verbs, which read it as they are built.
    private static readonly IReadOnlyList<Pipeline.Requirement> Hands = [new Pipeline.Requirement("manipulation", 50)];

    public static Pipeline.VerbDecl Open { get; } = Declare(Kind.Open);

    public static Pipeline.VerbDecl Close { get; } = Declare(Kind.Close);

    public static Pipeline.VerbDecl Lock { get; } = Declare(Kind.Lock);

    public static Pipeline.VerbDecl Unlock { get; } = Declare(Kind.Unlock);

    private static Pipeline.VerbDecl Declare(Kind kind) => new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: context => Preconditions(context, kind),
        Duration: _ => 1,
        OneTick: true,
        Requires: kind is Kind.Lock or Kind.Unlock ? Hands : null,
        Transition: (working, context, rootEventId) => Transition(working, context, rootEventId, kind));

    // The entity a command names, once it is one the actor can operate: openable, and in reach or worked remotely.
    private static (Entity? Entity, Pipeline.Refusal? Failure) OpenableTarget(Pipeline.CommandContext context)
    {
        var target = context.Target;
        if (target is null)
        {
            return (null, Pipeline.Invalid("missing_target"));
        }
        if (!context.Snapshot.Entities.TryGetValue(target.EntityId, out var entity))
        {
            return (null, Pipeline.Invalid("no_such_entity"));
        }
        if (!PropValues.IsTrue(entity.Props, "openable"))
        {
            return (null, Pipeline.Refused("not_openable"));
        }
        if (!Remote.WorksRemotely(context, entity) && !Remote.DeviceInReach(context, entity))
        {
            var measure = Address.ReachData(context.Snapshot, context.Command.Actor, entity.Id);
            return (null, new Pipeline.Refusal(
                Status.Refused,
                "out_of_reach",
                measure is null ? null : Pipeline.Reason(("distance_cm", measure.DistanceCm), ("reach_cm", measure.ReachCm))));
        }
        return (entity, null);
    }

    // Whether the actor carries a key that opens the target.
    private static bool CarriedKeyFor(Pipeline.CommandContext context, string targetId) =>
        context.Snapshot.Entities.Values.Any(entity =>
            entity.ContainedIn == context.Command.Actor && PropValues.GetString(entity.Props, "opens") == targetId);

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context, Kind kind)
    {
        var (entity, failure) = OpenableTarget(context);
        if (failure is not null)
        {
            return failure;
        }
        var target = entity!;

        // Opening what is open, shutting what is shut, locking what is locked or unlocking what is not would change nothing
        // but the clock. A door on its way shut is open still, so `open` is not a no-op for it: it stops the shut.
        if (kind == Kind.Open && PropValues.IsTrue(target.Props, "open") && !PropValues.IsTrue(target.Props, "closing"))
        {
            return Pipeline.Refused("already_open");
        }
        if (kind == Kind.Close && !PropValues.IsTrue(target.Props, "open"))
        {
            return Pipeline.Refused("already_closed");
        }
        if (kind == Kind.Lock && PropValues.IsTrue(target.Props, "locked"))
        {
            return Pipeline.Refused("already_locked");
        }
        if (kind == Kind.Unlock && !PropValues.IsTrue(target.Props, "locked"))
        {
            return Pipeline.Refused("already_unlocked");
        }
        if (kind == Kind.Open && PropValues.IsTrue(target.Props, "locked"))
        {
            return Pipeline.Refused("locked");
        }
        // Until a door on its way shut has shut, neither a shut nor a lock can be made of it.
        if (kind is Kind.Close or Kind.Lock && PropValues.IsTrue(target.Props, "closing"))
        {
            return Pipeline.Refused("closing");
        }
        if (Remote.WorksRemotely(context, target))
        {
            return Remote.RemoteFaultFor(context, target) is { } fault
                ? new Pipeline.Refusal(Status.Refused, fault.ReasonCode, fault.ReasonData)
                : null;
        }
        if (kind is Kind.Lock or Kind.Unlock && !CarriedKeyFor(context, target.Id))
        {
            return Pipeline.Refused("no_key");
        }
        return Pipeline.RequirementRefusal(context);
    }

    // A whole number prop, or null.
    private static long? WholeNumber(IReadOnlyDictionary<string, JsonNode?> props, string key)
    {
        var value = PropValues.GetNumber(props, key);
        return value is { } number && IsWhole(number)
            ? (long)number
            : null;
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId, Kind kind)
    {
        var (entity, failure) = OpenableTarget(context);
        if (failure is not null)
        {
            throw new InvalidOperationException("Openable target changed after validation");
        }
        var target = entity!;
        if (Jams(working, context, target))
        {
            working.Emit("jammed", target.Id, new Dictionary<string, JsonNode?> { ["verb"] = JsonValue.Create(KindName(kind)) }, rootEventId);
            return;
        }

        // Opening stops a shut on its way, and a shut that has come clears the window; a shut with `shut_ticks` opens the
        // window here instead, the shut a scheduled close caused by it.
        var others = new Dictionary<string, JsonNode?>(target.Props, StringComparer.Ordinal);
        others.Remove("closing");
        var shutTicks = WholeNumber(target.Props, "shut_ticks");
        if (kind == Kind.Close && shutTicks is > 0 && TryAdd(working.Snapshot.Tick, shutTicks.Value, out _))
        {
            StartClosing(working, target, shutTicks.Value, rootEventId);
            return;
        }

        var (prop, value, eventType) = kind switch
        {
            Kind.Open => ("open", true, "opened"),
            Kind.Close => ("open", false, "closed"),
            Kind.Lock => ("locked", true, "locked"),
            _ => ("locked", false, "unlocked"),
        };
        var props = new Dictionary<string, JsonNode?>(kind == Kind.Open ? others : new Dictionary<string, JsonNode?>(target.Props, StringComparer.Ordinal), StringComparer.Ordinal)
        {
            [prop] = JsonValue.Create(value),
        };
        var eventId = working.Emit(eventType, target.Id, new Dictionary<string, JsonNode?>(), rootEventId);
        working.SetProps(target.Id, props, eventId);
        if (kind == Kind.Close)
        {
            Gate.PushOccupantsAside(working, context.Registry, target.Id, eventId);
        }

        // A target with `closes_after` swings shut that many ticks after it is opened; opening it again starts the count
        // over, and shutting it by hand leaves nothing to come.
        if (kind is Kind.Open or Kind.Close)
        {
            Schedule.Cancel(working, "close", target.Id);
        }
        var closesAfter = WholeNumber(props, "closes_after");
        if (kind == Kind.Open && closesAfter is > 0 && TryAdd(working.Snapshot.Tick, closesAfter.Value, out var closeTick))
        {
            Schedule.Add(working, new ScheduledCause(closeTick, "close", target.Id, eventId));
        }
    }

    // A remote command to a device with a `jam_pct` rolls once, and a roll under the chance jams it: the tick is spent and the device
    // does nothing else. A hand never rolls. A director's steered odds (`docs/roles.md`) are in force over the template's value.
    private static bool Jams(Working working, Pipeline.CommandContext context, Entity target)
    {
        var steered = working.Snapshot.Run?.Steered?.FirstOrDefault(entry => entry.Entity == target.Id && entry.Prop == "jam_pct");
        var pct = steered is { } given ? given.Value : PropValues.GetNumber(target.Props, "jam_pct");
        if (pct is null || pct <= 0 || !Remote.WorksRemotely(context, target))
        {
            return false;
        }
        return working.Random() * 100 < pct;
    }

    private static string KindName(Kind kind) => kind switch
    {
        Kind.Open => "open",
        Kind.Close => "close",
        Kind.Lock => "lock",
        _ => "unlock",
    };

    // The window a door with `shut_ticks` opens: a `closing` event, and the shut a scheduled close caused by it.
    private static void StartClosing(Working working, Entity target, long shutTicks, string? rootEventId)
    {
        var eventId = working.Emit("closing", target.Id, new Dictionary<string, JsonNode?>(), rootEventId);
        var props = new Dictionary<string, JsonNode?>(target.Props, StringComparer.Ordinal)
        {
            ["closing"] = JsonValue.Create(true),
        };
        working.SetProps(target.Id, props, eventId);
        Schedule.Cancel(working, "close", target.Id);
        Schedule.Add(working, new ScheduledCause(working.Snapshot.Tick + shutTicks, "close", target.Id, eventId));
    }
}
