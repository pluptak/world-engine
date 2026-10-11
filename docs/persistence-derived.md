# Checkpoints and deltas

**Checkpoints.** A read that wants history from some version on (`since`, an event-form `query`,
the snapshot a stale command was based on) starts from the newest checkpoint at or before that
point and replays only the log after it, not the log from the start. A checkpoint carries the
version, the template hash, the length, line count and SHA-256 of the log bytes that made it,
and the SHA-256 of `initial.json`; one that does not parse, names another template set, is ahead
of the log, or whose log prefix or initial snapshot is not the world's own is ignored, and with
none usable the read replays from `initial.json` as before, with the same answer byte for byte.
A new template set (`upgradeTemplates`, or a settled move) removes them, so the next ones are
made under it. An event-form `query` finds its event's checkpoint by number alone, since event
ids count the same sequence as the snapshot's `next_seq`, and the events it needs for cause chains
come from `events.jsonl`, which a handle parses once and then extends by the lines appended since
(checked against the bytes just before them, so a file that was rewritten is read again). Every
reader of the log, events and deltas takes only the bytes through the last newline, so a line a
writer is still appending waits for the next read. A store world keeps its last sixteen event
replays, so one observation asks the log once per event rather than once per sense. What a read
costs as the log grows is in [measurements.md](measurements.md).

**Deltas.** `submit` appends an accepted command's deltas after its events and before the
snapshot, so a snapshot at the log's version means the file is whole. `trace` of an event's chain
reads `events.jsonl` alone and `trace` of a field's history reads `deltas.jsonl` with it, each
parsed once per handle and extended by the lines appended since, with no replay. `load` trusts
the file when its size is the head's `deltas_bytes`; it rebuilds it from the log when it is missing,
shorter than the head says (appends only grow it, so no crash does that), or the head has no size
for it (a world made before the file existed, or whose head was lost). The file is derived from
the log, as the events are, so `schema_version` stays 5: an older world opens and gains it.
`upgradeTemplates` and a settled template move hold it to the replay as they hold the events.
`since` still replays, from a checkpoint.
