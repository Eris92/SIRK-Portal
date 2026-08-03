#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8", newline="\n")


def replace_once(value: str, old: str, new: str, path: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    return value.replace(old, new, 1)


# Canonical CSS route: the previous HTML URL did not match PortalUiEndpoints.BuildAssets().
path = "public/portal/standalone/index.html"
value = read(path)
value = replace_once(
    value,
    "__ASSET_BASE__/portal/vendor/sirk-portal.css",
    "__ASSET_BASE__/vendor/sirk-portal/sirk-portal.css",
    path,
)
write(path, value)

# Asset contract and cache revision. system-updates.* remain native bridges only; no Node runtime.
path = "src/Sirk.Portal/Ui/PortalUiEndpoints.cs"
value = read(path)
value = replace_once(
    value,
    'private const string AssetRevision = "admin-settings-central-groups-icons-20260803-2";',
    'private const string AssetRevision = "test-blockers-management-settings-breakglass-20260803-1";',
    path,
)
value = replace_once(
    value,
    '        endpoints.MapGet("/auth/logout", (Delegate)LogoutAsync).AllowAnonymous();\n        return endpoints;',
    '        endpoints.MapGet("/auth/logout", (Delegate)LogoutAsync).AllowAnonymous();\n'
    '        endpoints.MapGet("/maintenance.json", () => Results.Json(new\n'
    '        {\n'
    '            enabled = false,\n'
    '            native = true,\n'
    '            api = "/api/v1/admin/maintenance/status"\n'
    '        })).AllowAnonymous();\n'
    '        return endpoints;',
    path,
)
value = replace_once(
    value,
    '            ["settings.css"] = "portal/settings.css",\n',
    '            ["settings.css"] = "portal/settings.css",\n'
    '            ["system-updates.css"] = "portal/system-updates.css",\n'
    '            ["system-updates.js"] = "portal/system-updates.js",\n',
    path,
)
write(path, value)

write(
    "public/portal/system-updates.js",
    '''(function () {\n'
    '    "use strict";\n'
    '    window.SirkPortalSystemUpdates = Object.freeze({\n'
    '        native: true,\n'
    '        statusEndpoint: "/api/v1/admin/maintenance/status"\n'
    '    });\n'
    '}());\n'''.replace("'\n    '", ""),
)

# Native Break-Glass administration in the canonical Settings renderer.
path = "public/portal/standalone/scripts/settings-native-v2.js"
value = read(path)
value = replace_once(
    value,
    '        issuedEnrollment: null,\n        csrf: "",',
    '        issuedEnrollment: null,\n        issuedAccessCode: null,\n        csrf: "",',
    path,
)
value = replace_once(
    value,
    '        if (state.tab === "identity") return [\n            { key: "users", label: "Użytkownicy lokalni" },',
    '        if (state.tab === "identity") return [\n'
    '            { key: "break-glass", label: "Break-Glass" },\n'
    '            { key: "users", label: "Użytkownicy lokalni" },',
    path,
)
break_glass = r'''
    function renderBreakGlass(host) {
        var account = (state.identity.users || []).find(function (user) { return user.role === "Break-Glass"; });
        var node = card("Break-Glass", "Awaryjne logowanie lokalne jest dostępne wyłącznie przez prawidłowy Access URL. Kod nie jest przechowywany w postaci możliwej do odczytania.");
        var status = el("div", "sirk-status-grid");
        status.appendChild(el("span", "", "Konto: " + (account ? (account.userName + " · " + (account.enabled ? "aktywne" : "wyłączone")) : "brak")));
        status.appendChild(el("span", "", "Ścieżka logowania: /login#access=..."));
        status.appendChild(el("span", "", "Rotacja Access Code natychmiast unieważnia poprzedni adres."));
        node.appendChild(status);

        if (state.issuedAccessCode) {
            var issued = el("section", "sirk-card sirk-one-time-token");
            issued.appendChild(el("strong", "", "Nowy Access Code — wyświetlany tylko teraz"));
            issued.appendChild(el("code", "", state.issuedAccessCode));
            var accessUrl = location.origin + "/login#access=" + state.issuedAccessCode;
            issued.appendChild(el("code", "", accessUrl));
            var issuedActions = actionRow();
            issuedActions.appendChild(button("Kopiuj Access URL", function () { copyText(accessUrl); }));
            issuedActions.appendChild(button("Ukryj", function () { state.issuedAccessCode = null; renderAll(); }));
            issued.appendChild(issuedActions);
            node.appendChild(issued);
        }

        var passwordCard = el("section", "sirk-card");
        passwordCard.appendChild(el("h3", "", "Zmień hasło Break-Glass"));
        passwordCard.appendChild(el("p", "sirk-muted", "Po zmianie hasła bieżąca sesja zostanie zakończona."));
        var current = field("Aktualne hasło", "", "password");
        var next = field("Nowe hasło", "", "password");
        var confirm = field("Powtórz nowe hasło", "", "password");
        [current, next, confirm].forEach(function (item) { passwordCard.appendChild(item.wrapper); });
        var passwordActions = actionRow();
        passwordActions.appendChild(button("Zmień hasło", function () {
            if (next.input.value.length < 14) { showError(new Error("Nowe hasło musi mieć minimum 14 znaków.")); return; }
            if (next.input.value !== confirm.input.value) { showError(new Error("Nowe hasła nie są identyczne.")); return; }
            api("/api/v1/auth/password", "POST", {
                currentPassword: current.input.value,
                newPassword: next.input.value
            }).then(function () {
                window.alert("Hasło zostało zmienione. Zaloguj się ponownie.");
                location.replace("/login");
            }).catch(showError);
        }));
        passwordCard.appendChild(passwordActions);
        node.appendChild(passwordCard);

        var rotateCard = el("section", "sirk-card");
        rotateCard.appendChild(el("h3", "", "Rotuj Access Code"));
        rotateCard.appendChild(el("p", "sirk-muted", "Nowy kod zostanie pokazany tylko raz. Zapisz pełny Access URL w bezpiecznym miejscu."));
        var rotatePassword = field("Aktualne hasło", "", "password");
        rotateCard.appendChild(rotatePassword.wrapper);
        var rotateActions = actionRow();
        rotateActions.appendChild(button("Wygeneruj nowy Access Code", function () {
            if (!window.confirm("Unieważnić obecny Access Code i wygenerować nowy?")) return;
            api("/api/v1/auth/break-glass/access-code/rotate", "POST", {
                currentPassword: rotatePassword.input.value
            }).then(function (result) {
                state.issuedAccessCode = String(result.accessCode || "");
                if (!state.issuedAccessCode) throw new Error("Portal nie zwrócił nowego Access Code.");
                renderAll();
            }).catch(showError);
        }, true));
        rotateCard.appendChild(rotateActions);
        node.appendChild(rotateCard);
        host.appendChild(node);
    }

'''
value = replace_once(value, "    function renderUsers(host) {\n", break_glass + "    function renderUsers(host) {\n", path)
value = replace_once(
    value,
    '        } else if (state.tab === "identity") {\n            if (state.section === "groups") renderGroups(state.page.details);',
    '        } else if (state.tab === "identity") {\n'
    '            if (state.section === "break-glass") renderBreakGlass(state.page.details);\n'
    '            else if (state.section === "groups") renderGroups(state.page.details);',
    path,
)
value = replace_once(
    value,
    '        var left = el("div", "sirk-group sirk-left");\n        left.appendChild(el("strong", "", "Ustawienia"));',
    '        var left = el("div", "sirk-group sirk-left");\n'
    '        left.appendChild(el("strong", "", "Ustawienia"));\n'
    '        tabDefinitions().forEach(function (item) {\n'
    '            var tab = button(item.label, function () { state.tab = item.key; state.section = ""; renderAll(); });\n'
    '            tab.classList.add("sirk-settings-toolbar-tab");\n'
    '            tab.setAttribute("data-settings-toolbar-tab", item.key);\n'
    '            left.appendChild(tab);\n'
    '        });',
    path,
)
value = replace_once(
    value,
    '    function renderNavigation() {\n        clear(state.page.primary);',
    '    function renderNavigation() {\n'
    '        state.page.toolbar.querySelectorAll("[data-settings-toolbar-tab]").forEach(function (node) {\n'
    '            node.classList.toggle("is-active", node.getAttribute("data-settings-toolbar-tab") === state.tab);\n'
    '        });\n'
    '        clear(state.page.primary);',
    path,
)
write(path, value)

# Disk-backed script library. Manual files under Files\\commands and Files\\management become canonical.
write(
    "src/Sirk.Portal/Automation/FileSystemScriptLibrary.cs",
    r'''using System.Globalization;
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
''',
)

path = "src/Sirk.Portal/Automation/ScriptStore.cs"
value = read(path)
value = replace_once(
    value,
    '            [ScriptLibraries.Commands] = Load(\n                ScriptLibraries.Commands,\n                Path.Combine(paths.CommandsDirectory, "scripts.json")),\n            [ScriptLibraries.Management] = Load(\n                ScriptLibraries.Management,\n                Path.Combine(paths.ManagementDirectory, "scripts.json"))\n        };',
    '            [ScriptLibraries.Commands] = Load(\n'
    '                ScriptLibraries.Commands,\n'
    '                paths.CommandsDirectory,\n'
    '                Path.Combine(paths.CommandsDirectory, "scripts.json")),\n'
    '            [ScriptLibraries.Management] = Load(\n'
    '                ScriptLibraries.Management,\n'
    '                paths.ManagementDirectory,\n'
    '                Path.Combine(paths.ManagementDirectory, "scripts.json"))\n'
    '        };\n'
    '        foreach (var state in _libraries.Values)\n'
    '        {\n'
    '            FileSystemScriptLibrary.EnsureFiles(state.Root, state.Document.Scripts);\n'
    '            Synchronize(state);\n'
    '        }',
    path,
)
value = replace_once(
    value,
    '            Save(state, new ScriptDocument(SchemaVersion, scripts, now));\n            return value;',
    '            FileSystemScriptLibrary.Write(state.Root, value);\n'
    '            Save(state, new ScriptDocument(SchemaVersion, scripts, now));\n'
    '            return value;',
    path,
)
value = replace_once(
    value,
    '            if (!state.Document.Scripts.Any(value => value.Path == normalized))\n                throw new KeyNotFoundException("Script was not found.");\n            Save(state, new ScriptDocument(',
    '            Synchronize(state);\n'
    '            if (!state.Document.Scripts.Any(value => value.Path == normalized))\n'
    '                throw new KeyNotFoundException("Script was not found.");\n'
    '            FileSystemScriptLibrary.Delete(state.Root, normalized);\n'
    '            Save(state, new ScriptDocument(',
    path,
)
value = replace_once(
    value,
    '        lock (_sync)\n        {\n            return state.Document.Scripts.FirstOrDefault(value => value.Path == normalized);\n        }',
    '        lock (_sync)\n        {\n            Synchronize(state);\n            return state.Document.Scripts.FirstOrDefault(value => value.Path == normalized);\n        }',
    path,
)
value = replace_once(
    value,
    '        lock (_sync)\n        {\n            return state.Document.Scripts\n                .OrderBy(value => value.Path, StringComparer.OrdinalIgnoreCase)\n                .ToArray();\n        }',
    '        lock (_sync)\n        {\n            Synchronize(state);\n            return state.Document.Scripts\n                .OrderBy(value => value.Path, StringComparer.OrdinalIgnoreCase)\n                .ToArray();\n        }',
    path,
)
value = replace_once(
    value,
    '        lock (_sync)\n        {\n            var root = new TreeDirectory(string.Empty, string.Empty);',
    '        lock (_sync)\n        {\n            Synchronize(state);\n            var root = new TreeDirectory(string.Empty, string.Empty);',
    path,
)
value = replace_once(
    value,
    '    private static LibraryState Load(string key, string path)\n    {\n        Directory.CreateDirectory(Path.GetDirectoryName(path)!);',
    '    private static LibraryState Load(string key, string root, string path)\n    {\n'
    '        Directory.CreateDirectory(root);\n'
    '        Directory.CreateDirectory(Path.GetDirectoryName(path)!);',
    path,
)
value = replace_once(
    value,
    '        return new LibraryState(key, path, document);\n    }',
    '        return new LibraryState(key, root, path, document);\n    }\n\n'
    '    private static void Synchronize(LibraryState state)\n'
    '    {\n'
    '        var scanned = FileSystemScriptLibrary.Scan(state.Root);\n'
    '        var current = state.Document.Scripts;\n'
    '        var unchanged = current.Count == scanned.Count && current\n'
    '            .OrderBy(value => value.Path, StringComparer.Ordinal)\n'
    '            .Zip(scanned.OrderBy(value => value.Path, StringComparer.Ordinal))\n'
    '            .All(pair => pair.First.Path == pair.Second.Path && pair.First.Hash == pair.Second.Hash);\n'
    '        if (!unchanged)\n'
    '            Save(state, new ScriptDocument(SchemaVersion, scanned, DateTimeOffset.UtcNow));\n'
    '    }',
    path,
)
value = replace_once(value, "    private static string HashDefinition(\n", "    internal static string HashDefinition(\n", path)
value = replace_once(
    value,
    '    private sealed class LibraryState(string key, string path, ScriptDocument document)\n    {\n        public string Key { get; } = key;\n        public string Path { get; } = path;',
    '    private sealed class LibraryState(string key, string root, string path, ScriptDocument document)\n'
    '    {\n'
    '        public string Key { get; } = key;\n'
    '        public string Root { get; } = root;\n'
    '        public string Path { get; } = path;',
    path,
)
write(path, value)

# Contract tests: direct disk files, canonical asset URLs and Break-Glass controls.
path = "tests/Sirk.Portal.ProtocolTests/Program.cs"
value = read(path)
value = replace_once(value, "using Sirk.Portal.Central;\n", "using Sirk.Portal.Central;\nusing Sirk.Portal.Automation;\nusing Microsoft.Extensions.Configuration;\n", path)
insert = r'''
var scriptsRoot = Path.Combine(Path.GetTempPath(), $"sirk-portal-script-files-{Guid.NewGuid():N}");
try
{
    var managementRoot = Path.Combine(scriptsRoot, "Files", "management", "Examples");
    Directory.CreateDirectory(managementRoot);
    File.WriteAllText(
        Path.Combine(managementRoot, "Filesystem test.ps1"),
        "#PL Test z dysku | Skrypt wykryty bez scripts.json.\n# VariableRequiredPL: $Message, Wiadomość | Test\n$Message",
        new UTF8Encoding(false));
    var configuration = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Sirk:DataRoot"] = scriptsRoot })
        .Build();
    var paths = new Sirk.Portal.Infrastructure.PortalPaths(configuration);
    var scriptStore = new ScriptStore(paths);
    var discovered = scriptStore.Get("management", "Examples/Filesystem test.ps1");
    Assert(discovered is not null, "Management must discover PowerShell files from Files/management.");
    Assert(discovered!.Label == "Test z dysku", "Localized filesystem script label was not parsed.");
    Assert(discovered.Variables.Count == 1 && discovered.Variables[0].Name == "Message",
        "Filesystem script variables were not parsed.");
    var treeJson = JsonSerializer.Serialize(scriptStore.Tree("management"));
    Assert(treeJson.Contains("Examples", StringComparison.Ordinal) &&
           treeJson.Contains("Filesystem test.ps1", StringComparison.Ordinal),
        "Management tree does not contain the filesystem directory/script.");
}
finally
{
    if (Directory.Exists(scriptsRoot)) Directory.Delete(scriptsRoot, recursive: true);
}

'''
value = replace_once(value, 'Console.WriteLine("SIRK Portal signed heartbeat and protected config contracts: OK");\n', insert + 'Console.WriteLine("SIRK Portal signed heartbeat, protected config and filesystem script contracts: OK");\n', path)
write(path, value)

path = ".github/scripts/validate-node-free-dotnet10.sh"
value = read(path)
value = replace_once(
    value,
    "for marker in ('sirk-column-primary', 'sirk-column-secondary', 'sirk-column-details', 'data-portal-settings-native\", \"3'):\n",
    "for marker in ('sirk-column-primary', 'sirk-column-secondary', 'sirk-column-details', 'data-portal-settings-native\", \"3', 'renderBreakGlass', 'break-glass/access-code/rotate', 'data-settings-toolbar-tab'):\n",
    path,
)
value = replace_once(
    value,
    "PY\n\nportal_dll='artifacts/linux-x64/Sirk.Portal.dll'",
    "\nindex_html = Path('public/portal/standalone/index.html').read_text(encoding='utf-8')\n"
    "if '/portal/vendor/sirk-portal.css' in index_html or '/vendor/sirk-portal/sirk-portal.css' not in index_html:\n"
    "    raise SystemExit('Canonical vendor stylesheet URL is invalid.')\n"
    "portal_ui = Path('src/Sirk.Portal/Ui/PortalUiEndpoints.cs').read_text(encoding='utf-8')\n"
    "for marker in ('system-updates.css', 'system-updates.js', '/maintenance.json'):\n"
    "    if marker not in portal_ui:\n"
    "        raise SystemExit('Native UI asset/maintenance bridge is missing: ' + marker)\n"
    "script_store = Path('src/Sirk.Portal/Automation/ScriptStore.cs').read_text(encoding='utf-8')\n"
    "filesystem_store = Path('src/Sirk.Portal/Automation/FileSystemScriptLibrary.cs').read_text(encoding='utf-8')\n"
    "for marker in ('FileSystemScriptLibrary.Scan', 'FileSystemScriptLibrary.Write', 'FileSystemScriptLibrary.Delete'):\n"
    "    if marker not in script_store:\n"
    "        raise SystemExit('Filesystem script synchronization is missing: ' + marker)\n"
    "for marker in ('VariableRequired', 'Files', 'ScriptStore.HashDefinition'):\n"
    "    if marker not in filesystem_store:\n"
    "        raise SystemExit('Filesystem script parser contract is missing: ' + marker)\n"
    "PY\n\nportal_dll='artifacts/linux-x64/Sirk.Portal.dll'",
    path,
)
write(path, value)

print("Test blocker repair applied.")
