using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Sirk.Portal.Infrastructure;

namespace Sirk.Portal.Automation;

internal sealed record ScriptVariableOption(string Value, string Label);

internal sealed record ScriptVariableDefinition(
    string Name,
    string Label,
    bool Required,
    string Control,
    string DefaultValue,
    IReadOnlyList<ScriptVariableOption> Options);

internal sealed record ScriptDefinition(
    string Path,
    string Name,
    string Label,
    string Description,
    string Shell,
    string Body,
    int RunAsUser,
    bool ConfirmExecution,
    IReadOnlyList<int> ApprovalLevels,
    IReadOnlyList<ScriptVariableDefinition> Variables,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    string Hash);

internal sealed record ScriptDocument(
    int SchemaVersion,
    IReadOnlyList<ScriptDefinition> Scripts,
    DateTimeOffset UpdatedAtUtc);

internal sealed record ScriptSaveRequest(
    string? OriginalPath,
    string Path,
    string Name,
    string? Label,
    string? Description,
    string Shell,
    string Body,
    int? RunAsUser,
    bool? ConfirmExecution,
    IReadOnlyList<int>? ApprovalLevels,
    IReadOnlyList<ScriptVariableDefinition>? Variables);

internal sealed class ScriptStore
{
    private const int SchemaVersion = 1;
    private const int MaximumScripts = 10_000;
    private static readonly Regex VariableNamePattern = new(
        "^[A-Za-z_][A-Za-z0-9_]{0,63}$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private readonly object _sync = new();
    private readonly string _path;
    private ScriptDocument _document;

    public ScriptStore(PortalPaths paths)
    {
        _path = Path.Combine(paths.DataRoot, "automation-scripts.json");
        _document = File.Exists(_path)
            ? Validate(AtomicJsonFile.Read<ScriptDocument>(_path))
            : new ScriptDocument(SchemaVersion, [], DateTimeOffset.UtcNow);
    }

    public ScriptDefinition Save(ScriptSaveRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var path = NormalizePath(request.Path);
        var original = string.IsNullOrWhiteSpace(request.OriginalPath)
            ? path
            : NormalizePath(request.OriginalPath);
        var name = NormalizeText(request.Name, "Script name", 128);
        var label = NormalizeOptionalText(request.Label, "Script label", 128);
        if (string.IsNullOrEmpty(label)) label = name;
        var description = NormalizeOptionalText(request.Description, "Script description", 2048);
        var shell = NormalizeShell(request.Shell);
        var body = request.Body ?? string.Empty;
        if (body.Length is < 1 or > 1024 * 1024 || body.Contains('\0'))
            throw new InvalidDataException("Script body is invalid.");
        var runAsUser = Math.Clamp(request.RunAsUser ?? 0, 0, 2);
        var levels = NormalizeLevels(request.ApprovalLevels);
        var variables = NormalizeVariables(request.Variables);

        lock (_sync)
        {
            var scripts = _document.Scripts.ToList();
            var index = scripts.FindIndex(value => value.Path == original);
            if (original != path && scripts.Any(value => value.Path == path))
                throw new InvalidOperationException("A script with the target path already exists.");
            var now = DateTimeOffset.UtcNow;
            var created = index >= 0 ? scripts[index].CreatedAtUtc : now;
            var value = new ScriptDefinition(
                path,
                name,
                label,
                description,
                shell,
                body,
                runAsUser,
                request.ConfirmExecution == true,
                levels,
                variables,
                created,
                now,
                HashDefinition(path, shell, body, variables));
            if (index >= 0) scripts[index] = value;
            else scripts.Add(value);
            if (scripts.Count > MaximumScripts)
                throw new InvalidOperationException("Maximum script count was reached.");
            Save(new ScriptDocument(SchemaVersion, scripts, now));
            return value;
        }
    }

    public void Delete(string path)
    {
        var normalized = NormalizePath(path);
        lock (_sync)
        {
            if (!_document.Scripts.Any(value => value.Path == normalized))
                throw new KeyNotFoundException("Script was not found.");
            Save(new ScriptDocument(
                SchemaVersion,
                _document.Scripts.Where(value => value.Path != normalized).ToArray(),
                DateTimeOffset.UtcNow));
        }
    }

    public ScriptDefinition? Get(string path)
    {
        var normalized = NormalizePath(path);
        lock (_sync)
        {
            return _document.Scripts.FirstOrDefault(value => value.Path == normalized);
        }
    }

    public IReadOnlyList<ScriptDefinition> List()
    {
        lock (_sync)
        {
            return _document.Scripts
                .OrderBy(value => value.Path, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
    }

    public object Tree()
    {
        lock (_sync)
        {
            var root = new TreeDirectory(string.Empty, string.Empty);
            foreach (var script in _document.Scripts.OrderBy(value => value.Path, StringComparer.OrdinalIgnoreCase))
            {
                var segments = script.Path.Split('/', StringSplitOptions.RemoveEmptyEntries);
                var directory = root;
                for (var index = 0; index < segments.Length - 1; index++)
                {
                    directory = directory.Directories.GetOrAdd(
                        segments[index],
                        static (name, state) => new TreeDirectory(state.Path, name),
                        directory);
                }
                directory.Scripts.Add(script);
            }
            return ToTree(root, isRoot: true);
        }
    }

    public static IReadOnlyDictionary<string, string> ValidateValues(
        ScriptDefinition script,
        IReadOnlyDictionary<string, string>? supplied)
    {
        var input = supplied ?? new Dictionary<string, string>();
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var variable in script.Variables)
        {
            var value = input.TryGetValue(variable.Name, out var suppliedValue)
                ? suppliedValue
                : variable.DefaultValue;
            value ??= string.Empty;
            if (value.Length > 16 * 1024 || value.Contains('\0'))
                throw new InvalidDataException($"Variable {variable.Name} is invalid.");
            if (variable.Required && string.IsNullOrWhiteSpace(value))
                throw new InvalidDataException($"Variable {variable.Label} is required.");
            if (variable.Control == "select" &&
                variable.Options.Count > 0 &&
                !variable.Options.Any(option => option.Value == value))
            {
                throw new InvalidDataException($"Variable {variable.Label} has an invalid value.");
            }
            if (variable.Control == "switch")
                value = value.Equals("true", StringComparison.OrdinalIgnoreCase) ? "true" : "false";
            result[variable.Name] = value;
        }
        return result;
    }

    private void Save(ScriptDocument value)
    {
        _document = Validate(value);
        AtomicJsonFile.Write(_path, _document);
    }

    private static ScriptDocument Validate(ScriptDocument value)
    {
        if (value.SchemaVersion != SchemaVersion)
            throw new InvalidDataException("Script schema is unsupported.");
        if (value.Scripts.GroupBy(script => script.Path, StringComparer.Ordinal).Any(group => group.Count() > 1))
            throw new InvalidDataException("Script store contains duplicate paths.");
        return value;
    }

    private static string NormalizePath(string? value)
    {
        var normalized = (value ?? string.Empty)
            .Replace('\\', '/')
            .Trim()
            .Trim('/');
        if (normalized.Length is < 1 or > 512 ||
            normalized.Split('/').Any(segment =>
                segment.Length is < 1 or > 128 ||
                segment is "." or ".." ||
                segment.Any(character => char.IsControl(character) || character is ':' or '*' or '?' or '"' or '<' or '>' or '|')))
        {
            throw new InvalidDataException("Script path is invalid.");
        }
        return normalized;
    }

    private static string NormalizeShell(string? value)
    {
        var shell = (value ?? string.Empty).Trim().ToLowerInvariant();
        return shell switch
        {
            "powershell" or "pwsh" => "powershell",
            "cmd" or "batch" => "cmd",
            "bash" => "bash",
            _ => throw new InvalidDataException("Script shell is invalid.")
        };
    }

    private static IReadOnlyList<ScriptVariableDefinition> NormalizeVariables(
        IReadOnlyList<ScriptVariableDefinition>? values)
    {
        if ((values?.Count ?? 0) > 128)
            throw new InvalidDataException("Script contains too many variables.");
        var result = new List<ScriptVariableDefinition>();
        foreach (var value in values ?? [])
        {
            var name = (value.Name ?? string.Empty).Trim();
            if (!VariableNamePattern.IsMatch(name))
                throw new InvalidDataException("Script variable name is invalid.");
            if (result.Any(item => item.Name == name))
                throw new InvalidDataException("Script variable names must be unique.");
            var control = (value.Control ?? "text").Trim().ToLowerInvariant();
            if (control is not ("text" or "password" or "select" or "switch"))
                throw new InvalidDataException("Script variable control is invalid.");
            var options = (value.Options ?? [])
                .Select(option => new ScriptVariableOption(
                    NormalizeText(option.Value, "Variable option value", 1024),
                    NormalizeText(option.Label, "Variable option label", 1024)))
                .Take(256)
                .ToArray();
            result.Add(new ScriptVariableDefinition(
                name,
                NormalizeText(value.Label, "Variable label", 128),
                value.Required,
                control,
                NormalizeOptionalText(value.DefaultValue, "Variable default", 16 * 1024),
                options));
        }
        return result;
    }

    private static int[] NormalizeLevels(IReadOnlyList<int>? values) =>
        (values ?? [])
        .Where(level => level is >= 1 and <= 3)
        .Distinct()
        .OrderBy(level => level)
        .ToArray();

    private static string NormalizeText(string? value, string field, int maximum)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length is < 1 || normalized.Length > maximum || normalized.Any(char.IsControl))
            throw new InvalidDataException($"{field} is invalid.");
        return normalized;
    }

    private static string NormalizeOptionalText(string? value, string field, int maximum)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length > maximum || normalized.Contains('\0'))
            throw new InvalidDataException($"{field} is invalid.");
        return normalized;
    }

    private static string HashDefinition(
        string path,
        string shell,
        string body,
        IReadOnlyList<ScriptVariableDefinition> variables)
    {
        var canonical = JsonSerializer.SerializeToUtf8Bytes(new { path, shell, body, variables });
        return Convert.ToHexString(SHA256.HashData(canonical)).ToLowerInvariant();
    }

    private static object ToTree(TreeDirectory directory, bool isRoot) =>
        new
        {
            type = "directory",
            name = isRoot ? "Scripts" : directory.Name,
            path = directory.Path,
            children = directory.Directories.Values
                .OrderBy(value => value.Name, StringComparer.OrdinalIgnoreCase)
                .Select(value => ToTree(value, isRoot: false))
                .Concat<object>(directory.Scripts
                    .OrderBy(value => value.Name, StringComparer.OrdinalIgnoreCase)
                    .Select(value => new
                    {
                        type = "script",
                        value.Name,
                        value.Label,
                        value.Description,
                        value.Path,
                        value.Shell,
                        value.RunAsUser,
                        value.ConfirmExecution,
                        value.ApprovalLevels,
                        value.Variables,
                        value.Hash
                    }))
                .ToArray()
        };

    private sealed class TreeDirectory(string parentPath, string name)
    {
        public string Name { get; } = name;
        public string Path { get; } = string.IsNullOrEmpty(parentPath)
            ? name
            : parentPath + "/" + name;
        public Dictionary<string, TreeDirectory> Directories { get; } = new(StringComparer.OrdinalIgnoreCase);
        public List<ScriptDefinition> Scripts { get; } = [];
    }
}

internal static class DictionaryExtensions
{
    public static TValue GetOrAdd<TKey, TValue, TState>(
        this IDictionary<TKey, TValue> source,
        TKey key,
        Func<TKey, TState, TValue> factory,
        TState state)
        where TKey : notnull
    {
        if (source.TryGetValue(key, out var value)) return value;
        value = factory(key, state);
        source.Add(key, value);
        return value;
    }
}
