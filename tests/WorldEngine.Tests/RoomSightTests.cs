using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Rooms are sensed as things in them are: a lit room by sight from inside it or through an open door into it, the room a body
// stands in by touch. A projection lists them, so a location it names is named there (docs/projection.md).
public class RoomSightTests
{
    private const string Scene = """
        [
          { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } },
          { "id": "corridor", "template": "room", "overrides": { "name": "corridor", "props": { "lit": true } } },
          { "id": "store", "template": "room", "overrides": { "name": "store", "props": { "lit": true } } },
          { "id": "cellar", "template": "room", "overrides": { "name": "cellar" } },
          { "id": "hall_door", "template": "door", "overrides": { "name": "hall door", "props": { "open": true, "from": "hall", "to": "corridor" } } },
          { "id": "store_door", "template": "door", "overrides": { "name": "store door", "props": { "open": false, "from": "hall", "to": "store" } } },
          { "id": "cellar_door", "template": "door", "overrides": { "name": "cellar door", "props": { "open": true, "from": "hall", "to": "cellar" } } },
          { "id": "ann", "template": "human", "overrides": { "name": "ann", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 0 } } },
          { "id": "crate", "template": "crate", "overrides": { "name": "crate", "location": "corridor", "support": "corridor", "pos": { "x": 0, "y": 0 } } },
          { "id": "bea", "template": "human", "overrides": { "name": "bea", "location": "cellar", "support": "cellar", "pos": { "x": 0, "y": 0 } } }
        ]
        """;

    private const string Hall = "e1";
    private const string Corridor = "e2";
    private const string Store = "e3";
    private const string Cellar = "e4";
    private const string Ann = "e8";
    private const string Crate = "e9";
    private const string Bea = "e10";

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "templates")));

    private static readonly Coverage Touched = new(
        WorldBuilder.DefaultCoverage.Relations,
        [Sense.Sight, Sense.Hearing, Sense.Smell, Sense.Touch],
        WorldBuilder.DefaultCoverage.Properties);

    private static Snapshot World() => WorldBuilder.Snapshot(ValueJson.Parse(Scene)!, Registry, Touched).Snapshot;

    private static Projection.ObservedEntity? Listed(string observer, string id) =>
        Projection.ObserveEntities(World(), Registry, [], observer).FirstOrDefault(entity => entity.Id == id);

    [Fact]
    public void A_lit_room_is_seen_from_inside_and_felt_underfoot()
    {
        var hall = Listed(Ann, Hall);

        Assert.NotNull(hall);
        Assert.Equal("hall", hall.Name);
        Assert.Equal(TemplateIds.Room, hall.Template);
        Assert.Equal([Sense.Sight, Sense.Touch], hall.Senses);
        Assert.Equal(Code.SameLocationLit, Perception.Perceive(World(), Registry, Ann, Hall, Sense.Sight).BasisCode);
    }

    [Fact]
    public void A_lit_room_is_seen_through_an_open_door_and_names_what_stands_in_it()
    {
        var corridor = Listed(Ann, Corridor);
        var crate = Listed(Ann, Crate);

        Assert.NotNull(corridor);
        Assert.Equal([Sense.Sight], corridor.Senses);
        Assert.Equal(Code.AdjacentOpenDoorLit, Perception.Perceive(World(), Registry, Ann, Corridor, Sense.Sight).BasisCode);
        Assert.Equal(Corridor, crate!.Facts!.Location);
        Assert.Null(crate.Facts.Hidden);
    }

    [Fact]
    public void A_room_behind_a_shut_door_or_in_the_dark_is_not_seen()
    {
        Assert.Null(Listed(Ann, Store));
        Assert.Null(Listed(Ann, Cellar));
        Assert.Equal(Code.LocationUnlit, Perception.Perceive(World(), Registry, Ann, Cellar, Sense.Sight).BasisCode);
    }

    [Fact]
    public void In_the_dark_a_body_feels_its_own_room_and_sees_no_other()
    {
        var cellar = Listed(Bea, Cellar);

        Assert.NotNull(cellar);
        Assert.Equal([Sense.Touch], cellar.Senses);
        Assert.Equal(Code.SameLocation, Perception.Perceive(World(), Registry, Bea, Cellar, Sense.Touch).BasisCode);
        Assert.Null(Listed(Bea, Hall));
    }
}
