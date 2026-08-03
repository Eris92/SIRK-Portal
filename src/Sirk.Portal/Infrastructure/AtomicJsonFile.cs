using System.Text.Json;

namespace Sirk.Portal.Infrastructure;

internal static class AtomicJsonFile
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public static T Read<T>(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return JsonSerializer.Deserialize<T>(stream, JsonOptions)
               ?? throw new InvalidDataException($"JSON document is empty: {path}");
    }

    public static T ReadOrCreate<T>(string path, Func<T> factory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ArgumentNullException.ThrowIfNull(factory);
        return File.Exists(path) ? Read<T>(path) : factory();
    }

    public static void Write<T>(string path, T value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ArgumentNullException.ThrowIfNull(value);

        var directory = Path.GetDirectoryName(path)
                        ?? throw new InvalidOperationException("The JSON path has no parent directory.");
        Directory.CreateDirectory(directory);
        SecureDirectory(directory);

        var temporary = $"{path}.tmp-{Environment.ProcessId}-{Guid.NewGuid():N}";
        try
        {
            using (var stream = new FileStream(
                       temporary,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None,
                       64 * 1024,
                       FileOptions.WriteThrough))
            {
                JsonSerializer.Serialize(stream, value, JsonOptions);
                stream.Flush(flushToDisk: true);
            }

            SecureFile(temporary);
            File.Move(temporary, path, overwrite: true);
            SecureFile(path);
        }
        finally
        {
            File.Delete(temporary);
        }
    }

    public static string ResolveDataRoot(IConfiguration configuration)
    {
        var configured = configuration["Sirk:DataRoot"]?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return Path.GetFullPath(Environment.ExpandEnvironmentVariables(configured));
        }

        if (OperatingSystem.IsWindows())
        {
            var common = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            return Path.Combine(common, "SIRK", "Portal");
        }

        return "/var/lib/sirk-portal";
    }

    public static void SecureFile(string path)
    {
        if (!OperatingSystem.IsWindows() && File.Exists(path))
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    public static void SecureDirectory(string path)
    {
        if (!OperatingSystem.IsWindows() && Directory.Exists(path))
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead |
                UnixFileMode.UserWrite |
                UnixFileMode.UserExecute);
        }
    }
}
