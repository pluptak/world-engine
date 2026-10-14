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
    private static readonly IReadOnlyList<Pipeline.Requirement> Hands = [new Pipeline.Requirement(Capacity.Manipulation, 50)];

    public static Pipeline.VerbDecl Open { get; } = Declare(Kind.Open);

    public static Pipeline.VerbDecl Close { get; } = Declare(Kind.Close);

    public static Pipeline.VerbDecl Lock { get; } = Declare(Kind.Lock);

    public static Pipeline.VerbDecl Unlock { get; } = Declare(Kind.Unlock);

    private static Pipeline.VerbDecl Declare(Kind kind) => new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: context => Preconditions(context, kind),
        OneTick: true,
        Requires: kind is Kind.Lock or Kind.Unlock ? Hands : null,
        Transition: (working, context, rootEventId) => Transition(working, context, rootEventId, kind));

    // The entity a command names, once it is one the actor can operate: openable, and in reach or worked remotely.
    private static (Entity? Entity, Pipeline.Refusal? Failure) OpenableTarget(Pipeline.CommandContext context)
    {
        var target = context.Target;
        if (target is null)
        {
            return (null, Pipeline.Invalid(Code.MissingTarget));
        }
        if (!context.Snapshot.Entities.TryGetValue(target.EntityId, out var entity))
        {
            return (null, Pipeline.Invalid(Code.NoSuchEntity));
        }
        if (!entity.Props.Is(Prop.Openable))
        {
            return (null, Pipeline.Refused(Code.NotOpenable));
        }
        if (!Remote.WorksRemotely(context, entity) && !Remote.DeviceInReach(context, entity))
        {
            var measure = Address.ReachData(context.Snapshot, context.Command.Actor, entity.Id);
            return (null, new Pipeline.Refusal(
                Status.Refused,
                Code.OutOfReach,
                measure is null ? null : Pipeline.Reason(("distance_cm", measure.DistanceCm), ("reach_cm", measure.ReachCm))));
        }
        return (entity, null);
    }

    // Whether the actor carries a key that opens the target.
    private static bool CarriedKeyFor(Pipeline.CommandContext context, string targetId) =>
        context.Snapshot.Entities.Values.Any(entity =>
            entity.ContainedIn == context.Command.Actor && entity.Props.Get(Prop.Opens) == targetId);

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
        if (kind == Kind.Open && target.Props.Is(Prop.Open) && !target.Props.Is(Prop.Closing))
        {
            return Pipeline.Refused(Code.AlreadyOpen);
        }
        if (kind == Kind.Close && !target.Props.Is(Prop.Open))
        {
            return Pipeline.Refused(Code.AlreadyClosed);
        }
        if (kind == Kind.Lock && target.Props.Is(Prop.Locked))
        {
            return Pipeline.Refused(Code.AlreadyLocked);
        }
        if (kind == Kind.Unlock && !target.Props.Is(Prop.Locked))
        {
            return Pipeline.Refused(Code.AlreadyUnlocked);
        }
        if (kind == Kind.Open && target.Props.Is(Prop.Locked))
        {
            return Pipeline.Refused(Code.Locked);
        }
        // Until a door on its way shut has shut, neither a shut nor a lock can be made of it.
        if (kind is Kind.Close or Kind.Lock && target.Props.Is(Prop.Closing))
        {
            return Pipeline.Refused(Code.Closing);
        }
        if (Remote.WorksRemotely(context, target))
        {
            return Remote.RemoteFaultFor(context, target) is { } fault
                ? new Pipeline.Refusal(Status.Refused, fault.ReasonCode, fault.ReasonData)
                : null;
        }
        if (kind is Kind.Lock or Kind.Unlock && !CarriedKeyFor(context, target.Id))
        {
            return Pipeline.Refused(Code.NoKey);
        }
        return Pipeline.RequirementRefusal(context);
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
            working.Emit(EventType.Jammed, target.Id, new Dictionary<string, JsonNode?> { ["verb"] = JsonValue.Create(KindName(kind)) }, rootEventId);
            return;
        }

        // Opening stops a shut on its way, and a shut that has come clears the window; a shut with `shut_ticks` opens the
        // window here instead, the shut a scheduled close caused by it.
        var shutTicks = target.Props.Get(Prop.ShutTicks);
        if (kind == Kind.Close && shutTicks is > 0 && TryAdd(working.Snapshot.Tick, shutTicks.Value, out _))
        {
            StartClosing(working, target, shutTicks.Value, rootEventId);
            return;
        }

        var (prop, value, eventType) = kind switch
        {
            Kind.Open => (Prop.Open, true, EventType.Opened),
            Kind.Close => (Prop.Open, false, EventType.Closed),
            Kind.Lock => (Prop.Locked, true, EventType.Locked),
            _ => (Prop.Locked, false, EventType.Unlocked),
        };
        var props = (kind == Kind.Open ? target.Props.Without(Prop.Closing) : target.Props).With(prop, value);
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
            Schedule.Cancel(working, CauseKind.Close, target.Id);
        }
        var closesAfter = props.Get(Prop.ClosesAfter);
        if (kind == Kind.Open && closesAfter is > 0 && TryAdd(working.Snapshot.Tick, closesAfter.Value, out var closeTick))
        {
            Schedule.Add(working, new CloseCause(closeTick, target.Id, eventId));
        }
    }

    // A remote command to a device with a `jam_pct` rolls once, and a roll under the chance jams it: the tick is spent and the device
    // does nothing else. A hand never rolls. A director's steered odds (`docs/roles.md`) are in force over the template's value.
    private static bool Jams(Working working, Pipeline.CommandContext context, Entity target)
    {
        var steered = working.Snapshot.Run?.Steered?.FirstOrDefault(entry => entry.Entity == target.Id && entry.Prop == Prop.JamPct);
        var pct = steered is { } given ? given.Value : target.Props.Get(Prop.JamPct);
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
        var eventId = working.Emit(EventType.Closing, target.Id, new Dictionary<string, JsonNode?>(), rootEventId);
        working.SetProps(target.Id, target.Props.With(Prop.Closing, true), eventId);
        Schedule.Cancel(working, CauseKind.Close, target.Id);
        Schedule.Add(working, new CloseCause(working.Snapshot.Tick + shutTicks, target.Id, eventId));
    }
}
