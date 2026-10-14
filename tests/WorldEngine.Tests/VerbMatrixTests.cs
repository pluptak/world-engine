using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// A matrix of commands over the fixture snapshots against TypeScript's pipeline (Fixtures/verb-matrix.expected.json.gz, from
// tools/golden-gen/verb-matrix.ts): for each of the 55 snapshots the verb goldens start from, the commands the world offers its agents
// and a seeded sample of every verb with every kind of actor, target and argument, well formed or not, about 27,000 in all. Each answer
// is one line (status, reason code, resolved target, reason data, and for an ok result a hash of the snapshot, events and deltas), so a
// refusal, an invalid request and an effect each have to be TypeScript's. A command that throws in TypeScript (a hand-built fixture whose
// ids run past next_seq) has to throw here.
public class VerbMatrixTests
{
    [Fact]
    public void Every_recorded_command_is_answered_as_TypeScript_answers_it()
    {
        JsonObject golden;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Fixtures", "verb-matrix.expected.json.gz")))
        using (var zip = new GZipStream(file, CompressionMode.Decompress))
        {
            golden = (JsonObject)JsonNode.Parse(zip)!;
        }

        // Every row is one command against a fixed snapshot, so the rows run in parallel; differences are reported in row order.
        var cases = ((JsonObject)golden["snapshots"]!)
            .SelectMany(pair =>
            {
                var snapshot = WorldJson.Read<Snapshot>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", pair.Key)));
                return ((JsonArray)pair.Value!).Select(row => (Name: pair.Key, Snapshot: snapshot, Row: (JsonArray)row!));
            })
            .ToList();
        var total = cases.Count;
        var answers = new string[total];
        Parallel.For(0, total, index => answers[index] = Answer(cases[index].Snapshot, WorldJson.Read<Command>(cases[index].Row[0])));

        var differing = new List<string>();
        for (var index = 0; index < total; index++)
        {
            var (name, _, row) = cases[index];
            var actual = answers[index];
            if (GoldenUpdate.Enabled)
            {
                row[1] = actual;
                continue;
            }
            var expected = row[1]!.GetValue<string>();
            if (actual != expected && !(expected.StartsWith("throw|") && actual.StartsWith("throw|")))
            {
                differing.Add($"{name} {row[0]!.ToJsonString()}: {actual}, TypeScript's {expected}");
            }
        }
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.WriteGzip("verb-matrix.expected.json.gz", golden);
            return;
        }
        Assert.True(total > 25000, $"only {total} commands were recorded");
        Assert.True(differing.Count == 0, $"{differing.Count} of {total} differ, first: {string.Join(" | ", differing.Take(6))}");
    }

    private static string Answer(Snapshot snapshot, Command command)
    {
        Pipeline.Result result;
        try
        {
            result = Pipeline.Apply(snapshot, TestTemplates.Registry, VerbRegistry.All, command);
        }
        catch (Exception error)
        {
            return $"throw|{error.Message}";
        }
        var reasonData = result.ReasonData is null ? "null" : WorldJson.Write(result.ReasonData);
        var line = string.Join('|', result.Status.ToString().ToLowerInvariant(), result.ReasonCode is { } code ? WorldJson.Name(code) : "", result.ResolvedTarget ?? "", reasonData);
        return result.Status == Status.Ok
            ? $"{line}|{Hash8(result.Snapshot)}|{Hash8(result.Events)}|{Hash8(result.Deltas)}"
            : line;
    }

    private static string Hash8<T>(T value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(WorldJson.Write(value)))).ToLowerInvariant()[..12];
}
