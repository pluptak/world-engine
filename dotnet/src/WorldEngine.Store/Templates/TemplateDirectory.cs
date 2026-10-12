using System.Text.Json;
using WorldEngine.Core.Json;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store.Templates;

// Reads a templates directory (src/templates.ts loadTemplates): every *.json file, in file-name order, one
// template each, named by its file in the messages. Resolution is the core's job; this only does the reading.
public static class TemplateDirectory
{
    public static DeclaredSet ReadDeclarations(string directory)
    {
        var decls = new Dictionary<string, TemplateDecl>();
        var sources = new Dictionary<string, string>();
        var files = Directory.GetFiles(directory, "*.json")
            .Select(Path.GetFileName)
            .OfType<string>()
            .OrderBy(name => name, StringComparer.Ordinal);
        foreach (var file in files)
        {
            var decl = WorldJson.Read<TemplateDecl>(WorldIO.ReadAllText(Path.Combine(directory, file)));
            if (decls.ContainsKey(decl.Id))
            {
                throw new FormatException($"Duplicate template id {decl.Id}");
            }
            decls[decl.Id] = decl;
            sources[decl.Id] = file;
        }
        return new DeclaredSet(decls, sources);
    }
}
