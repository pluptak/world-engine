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

    // Keys in ordinal order, so walking a map is deterministic and writing one needs no sort. A map reads as a dictionary, and
    // `With`, `Without` and `Only` give a changed copy.
    public sealed record Map(ImmutableSortedDictionary<string, Value> Fields) : Value, IReadOnlyDictionary<string, Value>
    {
        public static readonly Map Empty = new(ImmutableSortedDictionary.Create<string, Value>(StringComparer.Ordinal));

        public Value this[string key] => Fields[key];

        public IEnumerable<string> Keys => Fields.Keys;

        public IEnumerable<Value> Values => Fields.Values;

        public int Count => Fields.Count;

        public bool ContainsKey(string key) => Fields.ContainsKey(key);

        public bool TryGetValue(string key, [System.Diagnostics.CodeAnalysis.MaybeNullWhen(false)] out Value value) =>
            Fields.TryGetValue(key, out value);

        public IEnumerator<KeyValuePair<string, Value>> GetEnumerator() => Fields.GetEnumerator();

        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();

        // A copy with the key set; a null value takes it away, since a map holds no null.
        public Map With(string key, Value? value) => value is null ? Without(key) : new(Fields.SetItem(key, value));

        public Map Without(string key) => Fields.ContainsKey(key) ? new(Fields.Remove(key)) : this;

        // A copy with only the keys `keep` holds to.
        public Map Only(Func<string, bool> keep) => new(Fields.RemoveRange(Fields.Keys.Where(key => !keep(key)).ToList()));

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

    // A value from what code holds: a string, a whole number (a double too, when it is whole), a flag, a list of strings, or a
    // value already; null is none.
    public static Value? From(object? value) => value switch
    {
        null => null,
        Value already => already,
        string text => text,
        bool flag => flag,
        long number => number,
        int number => (long)number,
        double number when Math.Floor(number) == number && Math.Abs(number) < 9_223_372_036_854_775_807.0 => (long)number,
        IEnumerable<string> texts => Of(texts.Select(text => (Value)text)),
        _ => throw new ArgumentException($"No value for a {value.GetType().Name}", nameof(value)),
    };

    // A map of the given fields; a null value leaves its key out.
    public static Map Of(IEnumerable<KeyValuePair<string, Value?>> fields) =>
        new(fields
            .Where(pair => pair.Value is not null)
            .ToImmutableSortedDictionary(pair => pair.Key, pair => pair.Value!, StringComparer.Ordinal));
}

// Typed reads of a value that may be absent: null (or false) when it is absent or another kind.
public static class ValueReads
{
    public static string? AsText(this Value? value) => value is Value.Text text ? text.Content : null;

    public static long? AsInt(this Value? value) => value is Value.Int number ? number.Number : null;

    public static bool IsTrue(this Value? value) => value is Value.Bool { Flag: true };
}
