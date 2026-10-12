using System.Text;

namespace WorldEngine.Store;

// Reads of a world's files that do not hold them against a writer. On Windows a file a plain read has open cannot be renamed over or deleted
// until the read ends, so a writer replacing a snapshot or releasing the turn could fail while a reader had the file. Every read the store
// makes goes through here, opened so that another process may replace or delete the file while it is read.
internal static class WorldIO
{
    public static byte[] ReadAllBytes(string path)
    {
        using var stream = Open(path);
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    public static string ReadAllText(string path)
    {
        using var stream = Open(path);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    private static FileStream Open(string path) => new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
}
