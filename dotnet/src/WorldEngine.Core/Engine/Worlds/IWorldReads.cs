using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What the view reads (`WorldReads`) need of a world: its current snapshot, its template set, the deltas and events since a version, and
// whether an observer sensed an event by a sense. A memory world and a stored world each answer these from what they keep.
public interface IWorldReads
{
    Snapshot CurrentSnapshot();

    IReadOnlyDictionary<string, Template> Registry { get; }

    (List<Delta> Deltas, List<WorldEvent> Events) Since(long version);

    Perception.Answer PerceiveAtEvent(string observer, string sense, string eventId);
}
