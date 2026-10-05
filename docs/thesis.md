# Thesis

A deterministic world model for narrative and agent grounding. The engine keeps the facts of a
scene and answers what changed and who could sense it, in codes. Each rule below is a decision, not
a gap waiting to be closed; the limits files record what a scenario wanted that these rules cannot
say, and nothing in them is a plan.

**Discrete outcomes.** A command resolves to a finished outcome. A push travels a whole number of
centimetres and stops or collides; a fall lands or breaks; damage subtracts a fixed amount. There is
no trajectory, velocity, force or contact over time, and all arithmetic is on integers. Continuous
physics is out of scope.

**Determinism.** The same initial snapshot and the same ordered commands give the same snapshot,
events and log, byte for byte, under any number of reopens and replays. There is no randomness and
no wall clock: a caller who wants luck chooses a different command. Time is the integer `tick`, and
today only `wait` advances it.

**Provenance, not explanation.** Every event names the one event it came from (`cause_id`), back to
the command that started it, and `trace` walks that chain. The chain says where an event came from;
it does not claim to list every condition that made it happen, and there are no counterfactuals.

**Resolution follows relevance.** A template declares structure as fine as the world supports; an
entity stores state only where something changed it ([structure.md](structure.md)).

**World state, not knowledge.** The engine answers what is true and what could be sensed. What
anyone knows, believes, remembers or says belongs to the caller, and `"unknown"` means the world's
coverage does not model that category, never a guess ([perception.md](perception.md)).