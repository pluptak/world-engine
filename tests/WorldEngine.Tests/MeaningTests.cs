namespace WorldEngine.Tests;

public class MeaningTests
{
    [Fact]
    public void Key_order_and_a_null_member_against_an_absent_one_do_not_count()
    {
        Assert.Null(Meaning.Difference("""{"b":1,"a":{"c":null,"d":[1,2]}}""", """{"a":{"d":[1,2]},"b":1.0}"""));
    }

    [Fact]
    public void A_difference_is_named_by_its_path()
    {
        Assert.Equal("$.a.d[1] is 3, expected 2", Meaning.Difference("""{"a":{"d":[1,2]}}""", """{"a":{"d":[1,3]}}"""));
        Assert.Equal("$.a is absent, expected 1", Meaning.Difference("""{"a":1}""", """{"a":null}"""));
        Assert.Equal("$ has 1 items, expected 2", Meaning.Difference("[1,2]", "[1]"));
        Assert.Equal("$ is \"1\", expected 1", Meaning.Difference("1", "\"1\""));
    }

    [Fact]
    public void A_digest_is_of_the_meaning()
    {
        Assert.Equal(Meaning.Digest("""{"b":1,"a":null}"""), Meaning.Digest("""{"b":1}"""));
        Assert.NotEqual(Meaning.Digest("""{"b":1}"""), Meaning.Digest("""{"b":2}"""));
    }
}
