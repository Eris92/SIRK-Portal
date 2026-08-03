using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Sirk.Portal.Automation;

internal static partial class FileSystemScriptLibrary
{
    private static readonly string[] Extensions = [".ps1", ".cmd", ".bat", ".sh"];
    private static readonly Regex LocalizedHeader = new(
        @"^\s*(?:#|REM\s+)\s*(PL|EN)\s+([^|]+?)(?:\s*\|\s*(.*))?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private static readonly Regex VariableHeader = new(
        @"^\s*#\s*Variable(Required|Switch|Select)?(PL|EN)?\s*:\s*\$([A-Za-z_][A-Za-z0-9_]{0,63})(?:=([^,|]*))?\s*,\s*([^|]+?)(?:\s*\|\s*(.*))?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static IReadOnlyList<ScriptDefinition> Scan(string root)
    {
        Directory.CreateDirectory(root);
        var result = new List<ScriptDefinition>();
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
                     .Where(path => Extensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase))
                     .OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
        {
            result.Add(Parse(root, file));
        }
        return result;
    }

    public static void EnsureFiles(string root, IReadOnlyList<ScriptDefinition> scripts)
    {
        Directory.CreateDirectory(root);
        foreach (var script in scripts)
        {
            var target = Resolve(root, EnsureExtension(script.Path, script.Shell));
            if (!File.Exists(target)) Write(root, script);
        }
    }

    public static void Write(string root, ScriptDefinition script)
    {
        var target = Resolve(root, EnsureExtension(script.Path, script.Shell));
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.WriteAllText(target, script.Body, new UTF8Encoding(false));
    }

    public static void Delete(string root, string path)
    {
        foreach (var candidate in CandidatePaths(path))
        {
            var target = Resolve(root, candidate);
            if (File.Exists(target)) File.Delete(target);
        }
    }

    private static ScriptDefinition Parse(string root, string file)
    {
        var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
        var body = File.ReadAllText(file, Encoding.UTF8);
        var name = Path.GetFileNameWithoutExtension(file);
        var labels = new Dictionary<string, (string Label, string Description)>(StringComparer.OrdinalIgnoreCase);
        var variables = new Dictionary<string, ScriptVariableDefinition>(StringComparer.Ordinal);
        var approvalLevels = new SortedSet<int>();
        var runAsUser = 0;
        var confirmExecution = false;

        foreach (var line in body.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Take(120))
        {
            var localized = LocalizedHeader.Match(line);
            if (localized.Success)
            {
                labels[localized.Groups[1].Value] = (
                    localized.Groups[2].Value.Trim(),
                    localized.Groups[3].Value.Trim());
                continue;
            }

            var variable = VariableHeader.Match(line);
            if (variable.Success)
            {
                var language = variable.Groups[2].Value;
                var variableName = variable.Groups[3].Value;
                if (variables.ContainsKey(variableName) &&
                    !language.Equals("PL", StringComparison.OrdinalIgnoreCase)) continue;
                var kind = variable.Groups[1].Value.ToLowerInvariant();
                var control = kind switch
                {
                    "switch" => "switch",
                    "select" => "select",
                    _ => "text"
                };
                var defaultValue = variable.Groups[4].Value.Trim();
                var label = variable.Groups[5].Value.Trim();
                var options = control == "select"
                    ? defaultValue.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                        .Select(value => new ScriptVariableOption(value, value)).ToArray()
                    : [];
                variables[variableName] = new ScriptVariableDefinition(
                    variableName,
                    label,
                    kind == "required",
                    control,
                    control == "select" ? options.FirstOrDefault()?.Value ?? string.Empty : defaultValue,
                    options);
                continue;
            }

            if (TryHeader(line, "ApprovalLevels", out var levels))
            {
                foreach (var item in levels.Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries))
                    if (int.TryParse(item, NumberStyles.None, CultureInfo.InvariantCulture, out var level) && level is >= 1 and <= 3)
                        approvalLevels.Add(level);
            }
            else if (TryHeader(line, "RunAsUser", out var runAs) &&
                     int.TryParse(runAs, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedRunAs))
            {
                runAsUser = Math.Clamp(parsedRunAs, 0, 2);
            }
            else if (TryHeader(line, "ConfirmExecution", out var confirm))
            {
                confirmExecution = confirm.Equals("true", StringComparison.OrdinalIgnoreCase) || confirm == "1";
            }
        }

        var localizedValue = labels.TryGetValue("PL", out var polish)
            ? polish
            : labels.TryGetValue("EN", out var english)
                ? english
                : (name, string.Empty);
        var info = new FileInfo(file);
        var shell = Path.GetExtension(file).ToLowerInvariant() switch
        {
            ".cmd" or ".bat" => "cmd",
            ".sh" => "bash",
            _ => "powershell"
        };
        var normalizedVariables = variables.Values.OrderBy(value => value.Name, StringComparer.Ordinal).ToArray();
        return new ScriptDefinition(
            relative,
            name,
            localizedValue.Label,
            localizedValue.Description,
            shell,
            body,
            runAsUser,
            confirmExecution,
            approvalLevels.ToArray(),
            normalizedVariables,
            new DateTimeOffset(info.CreationTimeUtc, TimeSpan.Zero),
            new DateTimeOffset(info.LastWriteTimeUtc, TimeSpan.Zero),
            ScriptStore.HashDefinition(relative, shell, body, normalizedVariables));
    }

    private static bool TryHeader(string line, string name, out string value)
    {
        var prefix = "# " + name + ":";
        var trimmed = line.Trim();
        if (!trimmed.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            value = string.Empty;
            return false;
        }
        value = trimmed[prefix.Length..].Trim();
        return true;
    }

    private static IEnumerable<string> CandidatePaths(string path)
    {
        if (Extensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase)) return [path];
        return Extensions.Select(extension => path + extension);
    }

    private static string EnsureExtension(string path, string shell)
    {
        if (Extensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase)) return path;
        return path + (shell switch { "cmd" => ".cmd", "bash" => ".sh", _ => ".ps1" });
    }

    private static string Resolve(string root, string relative)
    {
        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(Path.Combine(normalizedRoot, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!target.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Script path escapes the configured library root.");
        return target;
    }
}
