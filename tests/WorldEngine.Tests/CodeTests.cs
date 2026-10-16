using System.Text.RegularExpressions;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

public class CodeTests
{
    // A code crosses the boundary as lower snake_case, and no two members write the same name.
    [Fact]
    public void Every_code_is_written_as_a_distinct_snake_case_name()
    {
        var names = Enum.GetValues<Code>().Select(code => WorldJson.Name(code)).ToList();

        Assert.All(names, name => Assert.Matches(new Regex("^[a-z]+(_[a-z0-9]+)*$"), name));
        Assert.Equal(names.Count, names.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(Code.NoSuchEntity, WorldJson.Parse<Code>("no_such_entity"));
        Assert.Equal("\"no_such_entity\"", WorldJson.Write(Code.NoSuchEntity));
    }
}
