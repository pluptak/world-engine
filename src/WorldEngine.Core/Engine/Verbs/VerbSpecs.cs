using System;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The declared shape of one verb (src/engine/verbs/*.ts `args`, `duration`, `refuses`, `carry_alternatives`, `attack_modes`).
// Each is held as the JSON text the catalog returns, so the catalog reads exactly what TypeScript declares. The table is
// generated from TypeScript's verb catalog, and catalog-golden checks it against that catalog.
public sealed record VerbSpec(
    string Args,
    string Duration,
    IReadOnlyList<Code> Refuses,
    string CarryAlternatives,
    string AttackModes);

public static class VerbSpecs
{
    public static readonly IReadOnlyDictionary<string, VerbSpec> ByVerb = new Dictionary<string, VerbSpec>(StringComparer.Ordinal)
    {
        ["advance"] = new VerbSpec(
            Args: """{"ticks":{"kind":"int"},"stop_on_perceived":{"kind":"address_list","optional":true},"stop_before":{"kind":"token","optional":true}}""",
            Duration: """{"arg":"ticks"}""",
            Refuses: [Code.NoSuchBeat, Code.BeatNotAhead],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["attack"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.OutOfReach, Code.AlreadyDestroyed, Code.InsufficientManipulation, Code.TooBigForGap],
            CarryAlternatives: """[{"capacity":"manipulation","per_hand":50,"mass_limit_prop":"hand_carry_limit_g"},{"capacity":"mouth_carry","at_least":1,"max_hands":1,"mass_limit_prop":"carry_limit_g","holds":1}]""",
            AttackModes: """[{"capacity":"manipulation","at_least":1,"damage_prop":"attack_damage","crosses_gap":"limb"},{"capacity":"mouth_carry","at_least":1,"damage_prop":"bite_damage","crosses_gap":"body"}]"""),
        ["close"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotOpenable, Code.OutOfReach, Code.AlreadyClosed, Code.Closing, Code.Disconnected, Code.Unpowered],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["consume"] = new VerbSpec(
            Args: """{"amount":{"kind":"int"}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotConsumable, Code.InsufficientLiquid, Code.ContainerClosed, Code.OutOfReach, Code.MouthFull],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["douse"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.TargetAttached, Code.NotALight, Code.ContainerClosed, Code.OutOfReach, Code.NotBurning, Code.InsufficientManipulation],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["drop"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotCarried, Code.NotInHand],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["edit"] = new VerbSpec(
            Args: """{"edit":{"kind":"world_edit"}}""",
            Duration: """{"ticks":0}""",
            Refuses: [Code.DerivedField, Code.FieldNotEditable, Code.RoomPlaced, Code.ConflictingPlacement, Code.RoomSupportWithoutPos, Code.PosWithoutRoomSupport, Code.AnchorNotRoomSupported, Code.CircularPlacement, Code.OccupiedRoom, Code.UnknownPart, Code.NotARefinement, Code.TooLarge, Code.NotASurface, Code.LiquidExceedsCapacity, Code.IntegrityOutOfRange, Code.DetachedPartWithoutEntity, Code.PartAtDefault, Code.PartUnderDetached, Code.CoverageNotComputable, Code.LocationMismatch, Code.DanglingReference, Code.IdNotBelowNextSeq, Code.SupportOrContainmentCycle, Code.SupportAndContainedIn, Code.DoorSideNotRoom, Code.OpensTargetNotOpenable, Code.ConcealedByAbstract, Code.ConcealedByNotSameRoom, Code.ConcealedByCycle, Code.PowerLoop, Code.ControlLoop, Code.InPartHolderMismatch, Code.InPartUnknownPart, Code.InPartUnavailable, Code.GripOccupied, Code.ClosingWithoutClose, Code.CameraWithoutFacing, Code.PartContentsTooLarge, Code.ContainerContentsTooLarge, Code.InvalidTrait, Code.BeatInPast, Code.DuplicateBeat, Code.TooManyBeats, Code.NoSuchBeat, Code.InvalidBeat, Code.UndeclaredProp, Code.WrongPropType, Code.UnmetRequires, Code.NoRun, Code.RunNotRegistering, Code.RunNotRunning, Code.NoSuchSlot, Code.SlotTaken, Code.HandleTaken, Code.RoleForbidden, Code.NoSuchPoolBeat, Code.NotSteerable, Code.OutOfRange],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["give"] = new VerbSpec(
            Args: """{"destination":{"kind":"address"},"part":{"kind":"address"}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotCarried, Code.NotInHand, Code.CannotGiveToSelf, Code.NotAnActor, Code.CircularPlacement, Code.OutOfReach, Code.TooBigForGap, Code.InsufficientManipulation, Code.TwoHandsRequired, Code.TooHeavy, Code.MouthFull, Code.HandsFull, Code.UnknownPart],
            CarryAlternatives: """[{"capacity":"manipulation","per_hand":50,"mass_limit_prop":"hand_carry_limit_g"},{"capacity":"mouth_carry","at_least":1,"max_hands":1,"mass_limit_prop":"carry_limit_g","holds":1}]""",
            AttackModes: """[]"""),
        ["light"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.TargetAttached, Code.NotALight, Code.ContainerClosed, Code.OutOfReach, Code.AlreadyBurning, Code.NoFuel, Code.InsufficientManipulation],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["lock"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotOpenable, Code.OutOfReach, Code.AlreadyLocked, Code.Closing, Code.NoKey, Code.InsufficientManipulation, Code.Disconnected, Code.Unpowered],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["move"] = new VerbSpec(
            Args: """{"to":{"kind":"pos"},"location":{"kind":"room"},"through":{"kind":"address"}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.BeingCarried, Code.InsufficientMoving, Code.NoOpenDoor, Code.Blocked, Code.OutOfBounds],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["open"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotOpenable, Code.OutOfReach, Code.AlreadyOpen, Code.Locked, Code.Disconnected, Code.Unpowered],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["pour"] = new VerbSpec(
            Args: """{"destination":{"kind":"address"},"amount":{"kind":"int"}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotCarried, Code.NotInHand, Code.NoLiquid, Code.NothingToPour, Code.InsufficientLiquid, Code.InsufficientManipulation, Code.NotADestination, Code.CannotPourIntoSelf, Code.OutOfReach, Code.ContainerClosed, Code.IncompatibleLiquid, Code.ContainerFull],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["pull"] = new VerbSpec(
            Args: """{"distance_cm":{"kind":"int"},"dir":{"kind":"enum","values":["+x","-x","+y","-y"]}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.InsufficientMoving, Code.TargetCarried, Code.NotOnFloor, Code.TooHeavy, Code.Blocked],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["push"] = new VerbSpec(
            Args: """{"distance_cm":{"kind":"int"},"dir":{"kind":"enum","values":["+x","-x","+y","-y"]}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.TargetAttached, Code.OutOfReach, Code.InsufficientMoving, Code.TargetCarried, Code.NotOnFloor, Code.TooHeavy, Code.Blocked],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["put"] = new VerbSpec(
            Args: """{"relation":{"kind":"enum","values":["on","in"]},"destination":{"kind":"address"}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotCarried, Code.CircularPlacement, Code.OutOfReach, Code.TooBigForGap, Code.NotASurface, Code.ContainerClosed, Code.TooLarge, Code.NotAContainer, Code.InsufficientManipulation],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["say"] = new VerbSpec(
            Args: """{"utterance":{"kind":"token"},"volume":{"kind":"enum","values":["whisper","normal","shout"],"optional":true}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.InsufficientSpeech],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["search"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.TargetAttached, Code.ContainerClosed, Code.OutOfReach, Code.InsufficientManipulation],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["switch_off"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotSwitchable, Code.OutOfReach, Code.Disconnected, Code.Unpowered, Code.InsufficientManipulation, Code.AlreadyOff],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["switch_on"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotSwitchable, Code.OutOfReach, Code.Disconnected, Code.Unpowered, Code.InsufficientManipulation, Code.AlreadyOn],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["take"] = new VerbSpec(
            Args: """{"part":{"kind":"address"}}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.TargetAttached, Code.CircularPlacement, Code.OutOfReach, Code.TooBigForGap, Code.InsufficientManipulation, Code.ContainerClosed, Code.HeldByAnother, Code.AlreadyHeld, Code.TwoHandsRequired, Code.TooHeavy, Code.MouthFull, Code.HandsFull, Code.UnknownPart],
            CarryAlternatives: """[{"capacity":"manipulation","per_hand":50,"mass_limit_prop":"hand_carry_limit_g"},{"capacity":"mouth_carry","at_least":1,"max_hands":1,"mass_limit_prop":"carry_limit_g","holds":1}]""",
            AttackModes: """[]"""),
        ["unlock"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: [Code.NotOpenable, Code.OutOfReach, Code.AlreadyUnlocked, Code.NoKey, Code.InsufficientManipulation, Code.Disconnected, Code.Unpowered],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["wait"] = new VerbSpec(
            Args: """{"ticks":{"kind":"int"},"until":{"kind":"enum","values":["sensed"],"optional":true}}""",
            Duration: """{"arg":"ticks"}""",
            Refuses: [],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
    };
}
