using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// What one verb declares beyond its behaviour, as the catalog lists it: the args it takes, the codes it may refuse with (any
// other throws in the pipeline), and for a verb that carries or strikes, the ways it may. Its duration is on the verb itself.
public sealed record VerbSpec(
    IReadOnlyDictionary<string, ArgSpec> Args,
    IReadOnlyList<Code> Refuses,
    IReadOnlyList<Carry.Alternative>? CarryAlternatives = null,
    IReadOnlyList<AttackVerb.AttackMode>? AttackModes = null);

public static class VerbSpecs
{
    private static readonly IReadOnlyDictionary<string, ArgSpec> NoArgs = new Dictionary<string, ArgSpec>();

    public static readonly IReadOnlyDictionary<string, VerbSpec> ByVerb = new Dictionary<string, VerbSpec>(StringComparer.Ordinal)
    {
        ["advance"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["ticks"] = new(ArgKind.Int),
                ["stop_on_perceived"] = new(ArgKind.AddressList, Optional: true),
                ["stop_before"] = new(ArgKind.Token, Optional: true),
            },
            Refuses: [Code.NoSuchBeat, Code.BeatNotAhead]),
        ["attack"] = new(
            Args: NoArgs,
            Refuses: [Code.OutOfReach, Code.AlreadyDestroyed, Code.InsufficientManipulation, Code.TooBigForGap],
            CarryAlternatives: Carry.Alternatives,
            AttackModes: AttackVerb.Modes),
        ["close"] = new(
            Args: NoArgs,
            Refuses: [Code.NotOpenable, Code.OutOfReach, Code.AlreadyClosed, Code.Closing, Code.Disconnected, Code.Unpowered]),
        ["consume"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["amount"] = new(ArgKind.Int),
            },
            Refuses: [Code.NotConsumable, Code.InsufficientLiquid, Code.ContainerClosed, Code.OutOfReach, Code.MouthFull]),
        ["douse"] = new(
            Args: NoArgs,
            Refuses: [Code.TargetAttached, Code.NotALight, Code.ContainerClosed, Code.OutOfReach, Code.NotBurning, Code.InsufficientManipulation]),
        ["drop"] = new(
            Args: NoArgs,
            Refuses: [Code.NotCarried, Code.NotInHand]),
        ["edit"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["edit"] = new(ArgKind.WorldEdit),
            },
            Refuses: [Code.DerivedField, Code.FieldNotEditable, Code.RoomPlaced, Code.ConflictingPlacement, Code.RoomSupportWithoutPos, Code.PosWithoutRoomSupport, Code.AnchorNotRoomSupported, Code.CircularPlacement, Code.OccupiedRoom, Code.UnknownPart, Code.NotARefinement, Code.TooLarge, Code.NotASurface, Code.LiquidExceedsCapacity, Code.IntegrityOutOfRange, Code.DetachedPartWithoutEntity, Code.PartAtDefault, Code.PartUnderDetached, Code.CoverageNotComputable, Code.DoesNotFit, Code.LocationMismatch, Code.DanglingReference, Code.IdNotBelowNextSeq, Code.SupportOrContainmentCycle, Code.SupportAndContainedIn, Code.DoorSideNotRoom, Code.OpensTargetNotOpenable, Code.ConcealedByAbstract, Code.ConcealedByNotSameRoom, Code.ConcealedByCycle, Code.PowerLoop, Code.ControlLoop, Code.InPartHolderMismatch, Code.InPartUnknownPart, Code.InPartUnavailable, Code.GripOccupied, Code.ClosingWithoutClose, Code.CameraWithoutFacing, Code.PartContentsTooLarge, Code.ContainerContentsTooLarge, Code.InvalidTrait, Code.BeatInPast, Code.DuplicateBeat, Code.TooManyBeats, Code.NoSuchBeat, Code.InvalidBeat, Code.UndeclaredProp, Code.WrongPropType, Code.UnmetRequires, Code.NoRun, Code.RunNotRegistering, Code.RunNotRunning, Code.NoSuchSlot, Code.SlotTaken, Code.HandleTaken, Code.RoleForbidden, Code.NoSuchPoolBeat, Code.NotSteerable, Code.OutOfRange, Code.UnknownCapacity]),
        ["extract"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["part"] = new(ArgKind.Token),
            },
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.NothingInstalled, Code.InsufficientManipulation]),
        ["give"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["destination"] = new(ArgKind.Address),
                ["part"] = new(ArgKind.Address),
            },
            Refuses: [Code.NotCarried, Code.NotInHand, Code.CannotGiveToSelf, Code.NotAnActor, Code.CircularPlacement, Code.OutOfReach, Code.TooBigForGap, Code.InsufficientManipulation, Code.TwoHandsRequired, Code.TooHeavy, Code.MouthFull, Code.HandsFull, Code.UnknownPart],
            CarryAlternatives: Carry.Alternatives),
        ["install"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["part"] = new(ArgKind.Token),
                ["item"] = new(ArgKind.Address),
            },
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.NotCarried, Code.SocketOccupied, Code.DoesNotFit, Code.InsufficientManipulation]),
        ["light"] = new(
            Args: NoArgs,
            Refuses: [Code.TargetAttached, Code.NotALight, Code.ContainerClosed, Code.OutOfReach, Code.AlreadyBurning, Code.NoFuel, Code.InsufficientManipulation]),
        ["cut"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["part"] = new(ArgKind.Token),
            },
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.NoCuttingTool, Code.PartUnavailable, Code.AlreadyIncised, Code.InsufficientManipulation]),
        ["staunch"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["part"] = new(ArgKind.Token),
            },
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.NotBleeding, Code.InsufficientManipulation]),
        ["suture"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["part"] = new(ArgKind.Token),
            },
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.NotIncised, Code.InsufficientManipulation]),
        ["lock"] = new(
            Args: NoArgs,
            Refuses: [Code.NotOpenable, Code.OutOfReach, Code.AlreadyLocked, Code.Closing, Code.NoKey, Code.InsufficientManipulation, Code.Disconnected, Code.Unpowered]),
        ["move"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["to"] = new(ArgKind.Pos),
                ["location"] = new(ArgKind.Room),
                ["through"] = new(ArgKind.Address),
                ["toward"] = new(ArgKind.Address),
            },
            Refuses: [Code.BeingCarried, Code.InsufficientMoving, Code.NoOpenDoor, Code.AlreadyThere, Code.Blocked, Code.OutOfBounds]),
        ["open"] = new(
            Args: NoArgs,
            Refuses: [Code.NotOpenable, Code.OutOfReach, Code.AlreadyOpen, Code.Locked, Code.Disconnected, Code.Unpowered]),
        ["pour"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["destination"] = new(ArgKind.Address),
                ["amount"] = new(ArgKind.Int),
            },
            Refuses: [Code.NotCarried, Code.NotInHand, Code.NoLiquid, Code.NothingToPour, Code.InsufficientLiquid, Code.InsufficientManipulation, Code.NotADestination, Code.CannotPourIntoSelf, Code.OutOfReach, Code.ContainerClosed, Code.IncompatibleLiquid, Code.ContainerFull]),
        ["pull"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["distance_cm"] = new(ArgKind.Int),
                ["dir"] = ArgSpec.OneOf(PushVerbs.Directions),
            },
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.InsufficientMoving, Code.TargetCarried, Code.NotOnFloor, Code.TooHeavy, Code.Blocked]),
        ["push"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["distance_cm"] = new(ArgKind.Int),
                ["dir"] = ArgSpec.OneOf(PushVerbs.Directions),
            },
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.InsufficientMoving, Code.TargetCarried, Code.NotOnFloor, Code.TooHeavy, Code.Blocked]),
        ["put"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["relation"] = ArgSpec.OneOf("on", "in"),
                ["destination"] = new(ArgKind.Address),
            },
            Refuses: [Code.NotCarried, Code.CircularPlacement, Code.OutOfReach, Code.TooBigForGap, Code.NotASurface, Code.ContainerClosed, Code.TooLarge, Code.NotAContainer, Code.InsufficientManipulation]),
        ["say"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["utterance"] = new(ArgKind.Token),
                ["volume"] = ArgSpec.OneOf(SayVerb.Volumes) with { Optional = true },
            },
            Refuses: [Code.InsufficientSpeech]),
        ["search"] = new(
            Args: NoArgs,
            Refuses: [Code.TargetAttached, Code.ContainerClosed, Code.OutOfReach, Code.InsufficientManipulation]),
        ["switch_off"] = new(
            Args: NoArgs,
            Refuses: [Code.NotSwitchable, Code.OutOfReach, Code.Disconnected, Code.Unpowered, Code.InsufficientManipulation, Code.AlreadyOff]),
        ["switch_on"] = new(
            Args: NoArgs,
            Refuses: [Code.NotSwitchable, Code.OutOfReach, Code.Disconnected, Code.Unpowered, Code.InsufficientManipulation, Code.AlreadyOn]),
        ["take"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["part"] = new(ArgKind.Address),
            },
            Refuses: [Code.TargetAttached, Code.CircularPlacement, Code.OutOfReach, Code.TooBigForGap, Code.InsufficientManipulation, Code.ContainerClosed, Code.HeldByAnother, Code.AlreadyHeld, Code.Resists, Code.TwoHandsRequired, Code.TooHeavy, Code.MouthFull, Code.HandsFull, Code.UnknownPart],
            CarryAlternatives: Carry.Alternatives),
        ["unlock"] = new(
            Args: NoArgs,
            Refuses: [Code.NotOpenable, Code.OutOfReach, Code.AlreadyUnlocked, Code.NoKey, Code.InsufficientManipulation, Code.Disconnected, Code.Unpowered]),
        ["wait"] = new(
            Args: new Dictionary<string, ArgSpec>(StringComparer.Ordinal)
            {
                ["ticks"] = new(ArgKind.Int),
                ["until"] = ArgSpec.OneOf("sensed") with { Optional = true },
            },
            Refuses: []),
    };
}
