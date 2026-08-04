from pathlib import Path

root = Path(__file__).resolve().parents[2]
settings_path = root / "public/portal/standalone/scripts/settings-native-v2.js"
ui_path = root / "src/Sirk.Portal/Ui/PortalUiEndpoints.cs"
legacy_path = root / "public/portal/standalone/scripts/agent-installer-ui.js"

settings = settings_path.read_text(encoding="utf-8")
ui = ui_path.read_text(encoding="utf-8")

helper_marker = "    function load() {\n"
if "function renderAgentInstaller(host)" not in settings:
    helper = r'''    function portalApiPath(path) {
        var base = String(window.__SIRK_PLATFORM_API_BASE__ || "/api/v1").replace(/\/+$/, "");
        return base + "/" + String(path || "").replace(/^\/+/, "");
    }

    function installerFileName(response, fallback) {
        var disposition = response.headers.get("Content-Disposition") || "";
        var match = /filename\*?=(?:UTF-8''|\")?([^\";]+)/i.exec(disposition);
        return match
            ? decodeURIComponent(match[1].replace(/^\"|\"$/g, ""))
            : fallback;
    }

    function downloadAgentInstaller(groupId, channel, validMinutes, status, control) {
        control.disabled = true;
        status.textContent = "Generowanie jednorazowego instalatora EXE…";
        issueCsrf().then(function (token) {
            return fetch(
                portalApiPath("admin/agent-groups/" + encodeURIComponent(groupId) + "/installer"),
                {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: {
                        Accept: "application/vnd.microsoft.portable-executable, application/json",
                        "Content-Type": "application/json; charset=UTF-8",
                        "X-SIRK-CSRF": token
                    },
                    body: JSON.stringify({ channel: channel, validMinutes: validMinutes })
                });
        }).then(function (response) {
            if (!response.ok) {
                return response.text().then(function (text) {
                    var payload = {};
                    try { payload = text ? JSON.parse(text) : {}; } catch (_) {}
                    throw new Error(payload.error || payload.title || ("HTTP " + response.status));
                });
            }
            var expires = response.headers.get("X-SIRK-Installer-Expires-At");
            var name = installerFileName(response, "SIRK-Agent-" + groupId + "-Installer.exe");
            return response.blob().then(function (blob) {
                if (blob.size < 4096) throw new Error("Wygenerowany instalator jest nieprawidłowo mały.");
                return { blob: blob, name: name, expires: expires };
            });
        }).then(function (download) {
            var url = URL.createObjectURL(download.blob);
            var link = el("a");
            link.href = url;
            link.download = download.name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            status.textContent = "Pobrano " + download.name + ". Bilet jest jednorazowy" +
                (download.expires ? " i ważny do " + new Date(download.expires).toLocaleString() : "") + ".";
        }).catch(function (error) {
            status.textContent = error && error.message || "Nie udało się wygenerować instalatora.";
            status.classList.add("sirk-error");
        }).then(function () {
            control.disabled = false;
        });
    }

    function renderAgentInstaller(host) {
        var snapshot = state.computerGroups || { groups: [] };
        var groups = (snapshot.groups || []).filter(function (item) { return item.enabled !== false; });
        var cardNode = el("section", "sirk-card sirk-agent-installer-panel");
        cardNode.setAttribute("data-sirk-agent-installer-panel", "1");
        cardNode.appendChild(el("h2", "", "Instalator SIRK Agent EXE"));
        cardNode.appendChild(el(
            "p",
            "sirk-muted",
            "Pobierz gotowy instalator przypisany do grupy. EXE zawiera krótkotrwały, jednorazowy bilet zamiast stałego tokenu grupy."));

        if (!groups.length) {
            cardNode.appendChild(el("p", "sirk-muted", "Najpierw utwórz aktywną grupę komputerów."));
            host.appendChild(cardNode);
            return;
        }

        var group = field("Grupa komputerów", groups[0].id, "select", groups.map(function (item) {
            return [item.id, item.name + " (" + item.id + ")"];
        }));
        var channel = field("Kanał Agenta", "dev", "select", [["stable", "Stable"], ["dev", "Dev"]]);
        var lifetime = field("Ważność przed pierwszym użyciem", "1440", "select", [
            ["60", "1 godzina"], ["480", "8 godzin"], ["1440", "24 godziny"], ["10080", "7 dni"]
        ]);
        cardNode.appendChild(group.wrapper);
        cardNode.appendChild(channel.wrapper);
        cardNode.appendChild(lifetime.wrapper);

        var actions = actionRow();
        var status = el("span", "sirk-muted", "Każdy wygenerowany plik rejestruje tylko jedno urządzenie.");
        var download = button("Pobierz instalator EXE", function () {
            status.classList.remove("sirk-error");
            downloadAgentInstaller(
                group.input.value,
                channel.input.value,
                Number(lifetime.input.value),
                status,
                download);
        });
        actions.appendChild(download);
        actions.appendChild(status);
        cardNode.appendChild(actions);
        host.appendChild(cardNode);
    }

'''
    if helper_marker not in settings:
        raise SystemExit("settings helper marker not found")
    settings = settings.replace(helper_marker, helper + helper_marker, 1)

settings = settings.replace(
    'return fetch("/api/v1/auth/csrf", {',
    'return fetch(portalApiPath("auth/csrf"), {',
    1)

computer_group_marker = '        var node = card("Grupy komputerów", "Grupy urządzeń SIRK Agent. Token rejestracyjny jest wyświetlany tylko po utworzeniu grupy lub jego rotacji.");\n'
if "        renderAgentInstaller(node);\n" not in settings:
    if computer_group_marker not in settings:
        raise SystemExit("computer group marker not found")
    settings = settings.replace(
        computer_group_marker,
        computer_group_marker + "        renderAgentInstaller(node);\n",
        1)

ui = ui.replace(
    'private const string AssetRevision = "group-bound-agent-installer-20260803-1";',
    'private const string AssetRevision = "native-agent-installer-20260804-1";',
    1)

inject = '''        html = html.Replace(\n            "</body>",\n            $"<script src=\\"{assetBase}/agent-installer-ui.js?v={Uri.EscapeDataString(assetVersion)}\\"></script></body>",\n            StringComparison.Ordinal);\n'''
if inject in ui:
    ui = ui.replace(inject, "", 1)

asset_line = '            ["agent-installer-ui.js"] = "portal/standalone/scripts/agent-installer-ui.js",\n'
ui = ui.replace(asset_line, "", 1)

settings_path.write_text(settings, encoding="utf-8", newline="\n")
ui_path.write_text(ui, encoding="utf-8", newline="\n")
if legacy_path.exists():
    legacy_path.unlink()
