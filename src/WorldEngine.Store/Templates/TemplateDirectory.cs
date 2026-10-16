using WorldEngine.Core.Json;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store.Templates;

// Reads a templates directory (src/templates.ts loadTemplates): every *.json file, in file-name order, one
// template each, named by its file in the messages. Resolution is the core's job; this only does the reading.
public static class TemplateDirectory
{
    public static DeclaredSet ReadDeclarations(string directory) =>
        ReadDeclarations(Directory.GetFiles(directory, "*.json")
            .Select(Path.GetFileName)
            .OfType<string>()
            .Select(file => (file, WorldIO.ReadAllText(Path.Combine(directory, file)))));

    // The same reading of texts already in hand, each named by its file name.
    public static DeclaredSet ReadDeclarations(IEnumerable<(string File, string Text)> texts)
    {
        var decls = new Dictionary<string, TemplateDecl>();
        var sources = new Dictionary<string, string>();
        foreach (var (file, text) in texts.OrderBy(entry => entry.File, StringComparer.Ordinal))
        {
            var value = TemplateValue(text, file);
            TemplateShape.Check(value, file);
            var decl = ValueJson.Read<TemplateDecl>(value!);
            if (decls.ContainsKey(decl.Id))
            {
                throw new FormatException($"Duplicate template id {decl.Id}");
            }
            decls[decl.Id] = decl;
            sources[decl.Id] = file;
        }
        return new DeclaredSet(decls, sources);
    }

    // A declaration as a value: a null in a list, or a number that is not whole, is refused with the source that holds it.
    public static WorldEngine.Core.Model.Value? TemplateValue(string text, string source)
    {
        try
        {
            return ValueJson.Parse(text);
        }
        catch (FormatException error)
        {
            throw new FormatException($"{source}: {error.Message}");
        }
    }
}
