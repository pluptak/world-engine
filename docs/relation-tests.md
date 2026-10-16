# Relation tests

The tests that pin each row of [relations.md](relations.md), by its T label. Each replays
TypeScript's recorded answers.

T0 `SnapshotValidationTests`: one variant of a valid world per rule, wrong in exactly that way.
T1 T0 (`support_and_contained_in`, `support_or_containment_cycle`, `room_placed`); the `remove`
and `place` rows of `EditTests`; the `loss` rows of `VerbGoldenTests` (support lost under a rider).
T2 T0 (`container_contents_too_large`); the `put`, `take` and `drop` rows of `VerbGoldenTests`.
T3 T0 (`location_mismatch`); the refused spawns and places of `EditTests`.
T4 T0 (`detached_part_without_entity`, `part_under_detached`); the `set_part` rows of `EditTests`.
T5 T0 (`door_side_not_room`, `dangling_reference`).
T6 T0 (`opens_target_not_openable`).
T7 T0 (`concealed_by_not_same_room`); `place_concealed` in `EditTests`, and `EngineQueryTests` (a
rag concealed under the doorstop).
T8 T0 (`in_part_holder_mismatch`, `in_part_unknown_part`); `CarryTests` and the `give` and `take`
rows of `VerbGoldenTests`.
T9 T0 (`power_loop`, `dangling_powered_by`).
