using System.Collections.Immutable;

namespace WorldEngine.Core.Model;

// A value the engine holds where its shape is open: a prop, an arg, an event's data. Immutable and compared by content.
// There is no null: an absent field and a null one are the same, so a map never holds one. Numbers are whole (`long`).
public abstract record Value
{
    private Value()
    {
    }

    public sealed record Bool(bool Flag) : Value;

    public sealed record Int(long Number) : Value;

    public sealed record Text(string Content) : Value;

    public sealed record List(ImmutableArray<Value> Items) : Value
    {
        public bool Equals(List? other) => other is not null && Items.SequenceEqual(other.Items);

        public override int GetHashCode()
        {
            var hash = new HashCode();
            foreach (var item in Items)
            {
                hash.Add(item);
            }
            return hash.ToHashCode();
        }
    }

    // Keys in ordinal order, so walking a map is deterministic and writing one needs no sort.
    public sealed record Map(ImmutableSortedDictionary<string, Value> Fields) : Value
    {
        public static readonly Map Empty = new(ImmutableSortedDictionary.Create<string, Value>(StringComparer.Ordinal));

        public Value? this[string key] => Fields.GetValueOrDefault(key);

        public bool Equals(Map? other) =>
            other is not null
            && Fields.Count == other.Fields.Count
            && Fields.All(pair => other.Fields.TryGetValue(pair.Key, out var value) && pair.Value.Equals(value));

        public override int GetHashCode()
        {
            var hash = new HashCode();
            foreach (var (key, value) in Fields)
            {
                hash.Add(key);
                hash.Add(value);
            }
            return hash.ToHashCode();
        }
    }

    public static implicit operator Value(bool flag) => new Bool(flag);

    public static implicit operator Value(long number) => new Int(number);

    public static implicit operator Value(string content) => new Text(content);

    public static List Of(IEnumerable<Value> items) => new([.. items]);

    // A map of the given fields; a null value leaves its key out.
    public static Map Of(IEnumerable<KeyValuePair<string, Value?>> fields) =>
        new(fields
            .Where(pair => pair.Value is not null)
            .ToImmutableSortedDictionary(pair => pair.Key, pair => pair.Value!, StringComparer.Ordinal));
}
