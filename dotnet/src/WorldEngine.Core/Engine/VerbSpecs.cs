using System;

namespace WorldEngine.Core.Engine;

// The declared shape of one verb (src/engine/verbs/*.ts `args`, `duration`, `refuses`, `carry_alternatives`, `attack_modes`).
// Each is held as the JSON text the catalog returns, so the catalog reads exactly what TypeScript declares. The table is
// generated from TypeScript's verb catalog, and catalog-golden checks it against that catalog.
public sealed record VerbSpec(
    string Args,
    string Duration,
    IReadOnlyList<string> Refuses,
    string CarryAlternatives,
    string AttackModes);

public static class VerbSpecs
{
    public static readonly IReadOnlyDictionary<string, VerbSpec> ByVerb = new Dictionary<string, VerbSpec>(StringComparer.Ordinal)
    {
        ["advance"] = new VerbSpec(
            Args: """{"ticks":{"kind":"int"},"stop_on_perceived":{"kind":"address_list","optional":true},"stop_before":{"kind":"token","optional":true}}""",
            Duration: """{"arg":"ticks"}""",
            Refuses: ["no_such_beat", "beat_not_ahead"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["attack"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["out_of_reach", "already_destroyed", "insufficient_manipulation", "too_big_for_gap"],
            CarryAlternatives: """[{"capacity":"manipulation","per_hand":50,"mass_limit_prop":"hand_carry_limit_g"},{"capacity":"mouth_carry","at_least":1,"max_hands":1,"mass_limit_prop":"carry_limit_g","holds":1}]""",
            AttackModes: """[{"capacity":"manipulation","at_least":1,"damage_prop":"attack_damage","crosses_gap":"limb"},{"capacity":"mouth_carry","at_least":1,"damage_prop":"bite_damage","crosses_gap":"body"}]"""),
        ["close"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_openable", "out_of_reach", "already_closed", "closing", "disconnected", "unpowered"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["consume"] = new VerbSpec(
            Args: """{"amount":{"kind":"int"}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_consumable", "insufficient_liquid", "container_closed", "out_of_reach", "mouth_full"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["douse"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["target_attached", "not_a_light", "container_closed", "out_of_reach", "not_burning", "insufficient_manipulation"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["drop"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_carried", "not_in_hand"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["edit"] = new VerbSpec(
            Args: """{"edit":{"kind":"world_edit"}}""",
            Duration: """{"ticks":0}""",
            Refuses: ["derived_field", "field_not_editable", "room_placed", "conflicting_placement", "room_support_without_pos", "pos_without_room_support", "anchor_not_room_supported", "circular_placement", "occupied_room", "unknown_part", "not_a_refinement", "too_large", "not_a_surface", "liquid_exceeds_capacity", "integrity_out_of_range", "detached_part_without_entity", "part_at_default", "part_under_detached", "coverage_not_computable", "location_mismatch", "dangling_reference", "id_not_below_next_seq", "support_or_containment_cycle", "support_and_contained_in", "door_side_not_room", "opens_target_not_openable", "concealed_by_abstract", "concealed_by_not_same_room", "concealed_by_cycle", "power_loop", "control_loop", "in_part_holder_mismatch", "in_part_unknown_part", "in_part_unavailable", "grip_occupied", "closing_without_close", "camera_without_facing", "part_contents_too_large", "container_contents_too_large", "invalid_trait", "beat_in_past", "duplicate_beat", "too_many_beats", "no_such_beat", "invalid_beat", "undeclared_prop", "wrong_prop_type", "unmet_requires", "no_run", "run_not_registering", "run_not_running", "no_such_slot", "slot_taken", "handle_taken", "role_forbidden", "no_such_pool_beat", "not_steerable", "out_of_range"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["give"] = new VerbSpec(
            Args: """{"destination":{"kind":"address"},"part":{"kind":"address"}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_carried", "not_in_hand", "cannot_give_to_self", "not_an_actor", "circular_placement", "out_of_reach", "too_big_for_gap", "insufficient_manipulation", "two_hands_required", "too_heavy", "mouth_full", "hands_full", "unknown_part"],
            CarryAlternatives: """[{"capacity":"manipulation","per_hand":50,"mass_limit_prop":"hand_carry_limit_g"},{"capacity":"mouth_carry","at_least":1,"max_hands":1,"mass_limit_prop":"carry_limit_g","holds":1}]""",
            AttackModes: """[]"""),
        ["light"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["target_attached", "not_a_light", "container_closed", "out_of_reach", "already_burning", "no_fuel", "insufficient_manipulation"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["lock"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_openable", "out_of_reach", "already_locked", "closing", "no_key", "insufficient_manipulation", "disconnected", "unpowered"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["move"] = new VerbSpec(
            Args: """{"to":{"kind":"pos"},"location":{"kind":"room"},"through":{"kind":"address"}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["being_carried", "insufficient_moving", "no_open_door", "blocked", "out_of_bounds"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["open"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_openable", "out_of_reach", "already_open", "locked", "disconnected", "unpowered"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["pour"] = new VerbSpec(
            Args: """{"destination":{"kind":"address"},"amount":{"kind":"int"}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_carried", "not_in_hand", "no_liquid", "nothing_to_pour", "insufficient_liquid", "insufficient_manipulation", "not_a_destination", "cannot_pour_into_self", "out_of_reach", "container_closed", "incompatible_liquid", "container_full"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["pull"] = new VerbSpec(
            Args: """{"distance_cm":{"kind":"int"},"dir":{"kind":"enum","values":["+x","-x","+y","-y"]}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["target_attached", "out_of_reach", "insufficient_moving", "target_carried", "not_on_floor", "too_heavy", "blocked"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["push"] = new VerbSpec(
            Args: """{"distance_cm":{"kind":"int"},"dir":{"kind":"enum","values":["+x","-x","+y","-y"]}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["target_attached", "out_of_reach", "insufficient_moving", "target_carried", "not_on_floor", "too_heavy", "blocked"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["put"] = new VerbSpec(
            Args: """{"relation":{"kind":"enum","values":["on","in"]},"destination":{"kind":"address"}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_carried", "circular_placement", "out_of_reach", "too_big_for_gap", "not_a_surface", "container_closed", "too_large", "not_a_container", "insufficient_manipulation"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["say"] = new VerbSpec(
            Args: """{"utterance":{"kind":"token"},"volume":{"kind":"enum","values":["whisper","normal","shout"],"optional":true}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["insufficient_speech"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["search"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["target_attached", "container_closed", "out_of_reach", "insufficient_manipulation"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["switch_off"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_switchable", "out_of_reach", "disconnected", "unpowered", "insufficient_manipulation", "already_off"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["switch_on"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_switchable", "out_of_reach", "disconnected", "unpowered", "insufficient_manipulation", "already_on"],
            CarryAlternatives: """[]""",
            AttackModes: """[]"""),
        ["take"] = new VerbSpec(
            Args: """{"part":{"kind":"address"}}""",
            Duration: """{"ticks":1}""",
            Refuses: ["target_attached", "circular_placement", "out_of_reach", "too_big_for_gap", "insufficient_manipulation", "container_closed", "held_by_another", "already_held", "two_hands_required", "too_heavy", "mouth_full", "hands_full", "unknown_part"],
            CarryAlternatives: """[{"capacity":"manipulation","per_hand":50,"mass_limit_prop":"hand_carry_limit_g"},{"capacity":"mouth_carry","at_least":1,"max_hands":1,"mass_limit_prop":"carry_limit_g","holds":1}]""",
            AttackModes: """[]"""),
        ["unlock"] = new VerbSpec(
            Args: """{}""",
            Duration: """{"ticks":1}""",
            Refuses: ["not_openable", "out_of_reach", "already_unlocked", "no_key", "insufficient_manipulation", "disconnected", "unpowered"],
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
