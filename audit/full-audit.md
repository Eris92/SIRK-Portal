# Full product audit

Repository: `Eris92/SIRK-Portal`
Commit: `08131a83cb2cc33352d8c12ad1facf1be5b78aa6`

## Summary

```json
{
  "files": 244,
  "textFiles": 181,
  "lines": 33603,
  "extensions": {
    ".1-trigger": 1,
    ".2-pr-trigger": 1,
    ".cs": 44,
    ".csproj": 2,
    ".css": 18,
    ".html": 3,
    ".js": 53,
    ".json": 7,
    ".md": 12,
    ".menu": 22,
    ".props": 1,
    ".ps1": 33,
    ".py": 7,
    ".pyc": 1,
    ".sh": 1,
    ".svg": 25,
    ".yaml": 5,
    ".yml": 1,
    "<none>": 7
  },
  "projects": 2,
  "nodeArtifacts": 0,
  "legacyPaths": 0,
  "findingsBySeverity": {
    "critical": 0,
    "high": 1,
    "medium": 213,
    "low": 0,
    "info": 1
  }
}
```

## Highest severity findings

- **HIGH** `hardcoded-secret-like-value` — `src/Sirk.Portal/Agent/AgentStore.cs:397` — $EnrollmentToken = '{{enrollmentToken.Replace("'", "''", StringComparison.Ordinal)}}'
- **MEDIUM** `plaintext-http-url` — `Dockerfile:13` — ENV ASPNETCORE_URLS=http://+:8080 \
- **MEDIUM** `dynamic-innerhtml` — `public/modules/approvals/index.js:63` — icon.innerHTML = options.icon || icons.all;
- **MEDIUM** `dynamic-innerhtml` — `public/modules/approvals/index.js:94` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/approvals/index.js:119` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/approvals/index.js:140` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/approvals/index.js:185` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/approvals/index.js:227` — host.innerHTML = "";
- **MEDIUM** `local-storage` — `public/modules/commands/index.js:51` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `plaintext-http-url` — `public/modules/commands/index.js:56` — function svgData(svg) { return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ')); }
- **MEDIUM** `dynamic-innerhtml` — `public/modules/commands/index.js:61` — function note(shell, title, message, error) { var host = shell.state.page.details; host.innerHTML = ""; var card = shell.card(title, message); if (error) card.classList.add("sirk-error"); host.appendChild(card); sync(shell); }
- **MEDIUM** `dynamic-innerhtml` — `public/modules/commands/index.js:104` — function renderOutput(host, value) { host.innerHTML = ""; if (window.SharedResultsView && typeof window.SharedResultsView.mountResult === "function") { window.SharedResultsView.mountResult(host, value || msg("Brak wyniku.", "No output.")); return; } var pre = document.createElement("pre"); pre.class
- **MEDIUM** `dynamic-innerhtml` — `public/modules/commands/index.js:105` — function renderWaiting(host, value) { host.innerHTML = ""; var pre = document.createElement("pre"); pre.className = "sirk-output"; pre.textContent = value; host.appendChild(pre); }
- **MEDIUM** `dynamic-innerhtml` — `public/modules/commands/index.js:132` — var host = shell.state.page.details; host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/jira/index.js:35` — shell.state.page.secondary.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/move-requests/index.js:15` — shell.state.page.details.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/security/index.js:15` — if (active === "incidents") return shell.api("incidents").then(function (result) { shell.state.page.details.innerHTML = ""; (result.incidents || []).forEach(function (incident) { shell.state.page.details.appendChild(shell.card(incident.displayName || incident.incidentName || ("Incident " + incident.
- **MEDIUM** `dynamic-innerhtml` — `public/modules/security/index.js:45` — table.innerHTML = "<thead><tr><th>Parametr</th><th>Odczyt</th></tr></thead>";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/security/index.js:52` — section.appendChild(element("h3", "", "Urządzenia zgłoszone przez SIRK Agent")); table.innerHTML = "<thead><tr><th>Urządzenie</th><th>Tenant / Device ID</th><th>Wersja</th><th>Stan</th><th>Ostatni check-in</th></tr></thead>";
- **MEDIUM** `dynamic-innerhtml` — `public/modules/security/index.js:72` — shell.nav(shell.state.page.primary, [{ key: "agent", title: "SIRK Agent", icon: "S" }], "agent", function () {}); shell.state.page.secondary.innerHTML = ""; shell.state.page.details.innerHTML = ""; shell.state.page.details.appendChild(shell.card("SIRK Agent", "Ładowanie pełnego katalogu możliwości…"
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals-hook.js:33` — target.innerHTML = '<div class="sirk-card"><h3>Akceptacje</h3><p>Renderer Approval Center nie został załadowany.</p></div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals-hook.js:37` — target.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals.js:141` — refresh.innerHTML = icon("refresh");
- **MEDIUM** `incomplete-implementation` — `public/portal/approvals.js:146` — search.placeholder = "Filter requests...";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals.js:158` — iconHost.innerHTML = icon(iconName);
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals.js:170` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals.js:185` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals.js:192` — iconHost.innerHTML = icon(value || "all");
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals.js:222` — details.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals.js:288` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/approvals.js:314` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/fixes.js:118` — host.innerHTML = '<div class="sirk-card"><h3>Zarządzanie</h3><p>Renderer Management nie został załadowany.</p></div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/fixes.js:122` — host.innerHTML = "";
- **MEDIUM** `local-storage` — `public/portal/fixes.js:136` — try { return window.localStorage.getItem(collapsedKey) === "1"; }
- **MEDIUM** `local-storage` — `public/portal/fixes.js:152` — try { window.localStorage.setItem(collapsedKey, value ? "1" : "0"); }
- **MEDIUM** `local-storage` — `public/portal/folder-collapse.js:274` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `incomplete-implementation` — `public/portal/folder-collapse.js:331` — ["placeholder", "title", "aria-label"].forEach(function (attribute) {
- **MEDIUM** `incomplete-implementation` — `public/portal/folder-collapse.js:369` — }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["title", "aria-label", "placeholder"] });
- **MEDIUM** `local-storage` — `public/portal/management.js:31` — try { return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true"; }
- **MEDIUM** `local-storage` — `public/portal/management.js:36` — try { window.localStorage.setItem(COLLAPSE_STORAGE_KEY, state.collapsed ? "true" : "false"); }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:161` — button.innerHTML = icon;
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:166` — host.innerHTML = "";
- **MEDIUM** `incomplete-implementation` — `public/portal/management.js:178` — search.placeholder = t("searchPlaceholder");
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:206` — button.innerHTML = '<span class="sirk-nav-icon">' + (item.icon || icons.folder) + '</span><span></span>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:215` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:241` — button.innerHTML = icon;
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:252` — open.innerHTML = '<span class="sirk-nav-icon' + (script.requiresApproval ? ' sirk-script-approval-icon' : '') + '">' + (script.requiresApproval ? icons.approval : icons.script) + '</span><span class="sirk-script-label"></span>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:285` — heading.innerHTML = '<span class="sirk-nav-icon">' + icons.folder + '</span><span></span>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:296` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:311` — button.innerHTML = '<span class="sirk-nav-icon sirk-result-status-icon">' + item.icon + '</span><span></span>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:342` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:352` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:411` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:453` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:473` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:502` — collapse.innerHTML = state.collapsed ? icons.expand : icons.collapse;
- **MEDIUM** `dynamic-innerhtml` — `public/portal/management.js:612` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/settings.js:68` — host.innerHTML = '<div class="sirk-restart-screen" role="status" aria-live="polite"><div class="sirk-restart-spinner" aria-hidden="true"></div><h2>Ładowanie usługi…</h2><p>Portal czeka na powrót usługi.</p></div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/settings.js:81` — host.innerHTML = '<div class="sirk-card" data-error="1">Nie udało się potwierdzić powrotu usługi. Odśwież stronę, aby spróbować ponownie.</div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/settings.js:687` — userTable.innerHTML = "<thead><tr><th>Użytkownik</th><th>Role</th><th>Grupy</th><th>Stan</th><th>Akcje</th></tr></thead>";
- **MEDIUM** `incomplete-implementation` — `public/portal/settings.js:721` — password.placeholder = "Nowe hasło (opcjonalnie, min. 10 znaków)";
- **MEDIUM** `incomplete-implementation` — `public/portal/settings.js:763` — var username = el("input"); username.placeholder = "Nazwa użytkownika";
- **MEDIUM** `incomplete-implementation` — `public/portal/settings.js:764` — var displayName = el("input"); displayName.placeholder = "Nazwa wyświetlana";
- **MEDIUM** `incomplete-implementation` — `public/portal/settings.js:765` — var password = el("input"); password.type = "password"; password.placeholder = "Hasło (min. 10 znaków)";
- **MEDIUM** `incomplete-implementation` — `public/portal/settings.js:811` — var groupName = el("input"); groupName.placeholder = "Nazwa nowej grupy";
- **MEDIUM** `incomplete-implementation` — `public/portal/settings.js:812` — var groupDescription = el("input"); groupDescription.placeholder = "Opis";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/settings.js:848` — host.innerHTML = '<section class="sirk-view-shell" data-portal-settings>' +
- **MEDIUM** `incomplete-implementation` — `public/portal/settings.js:852` — '<input type="search" data-settings-search placeholder="Szukaj…" aria-label="Szukaj"></div></div>' +
- **MEDIUM** `dynamic-innerhtml` — `public/portal/settings.js:868` — details.innerHTML = '<div class="sirk-card">Odświeżanie…</div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/settings.js:873` — details.innerHTML = "";
- **MEDIUM** `local-storage` — `public/portal/standalone/index.html:28` — if (localStorage.getItem("sirkPortal.standaloneCollapsed") === "1") {
- **MEDIUM** `local-storage` — `public/portal/standalone/index.html:82` — function text(pl,en){try{return localStorage.getItem("sirkPortal.language")==="en"?en:pl;}catch(error){return pl;}}
- **MEDIUM** `local-storage` — `public/portal/standalone/index.html:97` — function text(pl,en){try{return localStorage.getItem("sirkPortal.language")==="en"?en:pl;}catch(error){return pl;}}
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/index.html:104` — function enhance(){var actions=document.querySelector("#sirkDeviceTabBody .sirk-device-general-actions");if(!actions)return;var old=actions.querySelector("a");if(!enabled()){actions.innerHTML="";actions.hidden=true;return;}actions.hidden=false;if(actions.querySelector("[data-device-transfer-action]"
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/app.js:101` — try { return window.localStorage.getItem(STORAGE_LANGUAGE) === "en" ? "en" : "pl"; }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:179` — content.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:191` — content.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:224` — button.innerHTML = dark ? THEME_ICONS.sun : THEME_ICONS.moon;
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/app.js:280` — try { window.localStorage.setItem(STORAGE_LANGUAGE, next); } catch (error) {}
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:311` — overlay.innerHTML = '<span></span><p>' + escapeHtml(message || t("loading")) + '</p>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:315` — content.innerHTML = '<div class="sirk-standalone-loading"><span></span><p>' + escapeHtml(message || t("loading")) + '</p></div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:319` — content.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:396` — page.details.innerHTML = '<div class="sirk-standalone-grid">' + cards.join("") + '</div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:432` — issues.innerHTML = healthItems.map(function (item) {
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:551` — page.toolbar.innerHTML = '<button type="button" class="sirk-device-back" data-device-back="1">← ' + escapeHtml(t("backToDevices")) + '</button>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:552` — page.details.innerHTML =
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:585` — host.innerHTML = '<div class="sirk-device-status">' + escapeHtml(t("noDevices")) + '</div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:589` — host.innerHTML = '<div class="sirk-device-status">' + escapeHtml(t("noFilteredDevices")) + '</div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:600` — host.innerHTML = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, language()); }).map(function (group) {
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:612` — page.toolbar.innerHTML = '<div class="sirk-device-summary"><span><strong id="sirkDeviceTotal">0</strong>' + escapeHtml(t("total")) + '</span><span><strong id="sirkDeviceOnline">0</strong>' + escapeHtml(t("online")) + '</span><span><strong id="sirkDeviceOffline">0</strong>' + escapeHtml(t("offline"))
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/scripts/app.js:612` — page.toolbar.innerHTML = '<div class="sirk-device-summary"><span><strong id="sirkDeviceTotal">0</strong>' + escapeHtml(t("total")) + '</span><span><strong id="sirkDeviceOnline">0</strong>' + escapeHtml(t("online")) + '</span><span><strong id="sirkDeviceOffline">0</strong>' + escapeHtml(t("offline"))
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:613` — page.details.innerHTML = '<div id="sirkDevicesHost" class="sirk-device-groups"><div class="sirk-device-status">' + escapeHtml(t("waitingDevices")) + '</div></div>';
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/scripts/app.js:639` — function placeholder(view, description) {
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:641` — page.details.innerHTML = '<div class="sirk-content"><h2>' + escapeHtml(viewName(view)) + '</h2><p class="sirk-muted">' + escapeHtml(description) + '</p></div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/app.js:647` — page.details.innerHTML = '<div class="sirk-content"><h2>' + escapeHtml(viewName("automation")) + '</h2><div class="sirk-card"><h3>Harmonogram serwera</h3><p class="sirk-muted">Automatyzacje zarządzają zadaniami serwera w katalogu harmonogramu <strong>SIRK</strong>. Polecenia urządzeń są dostępne w w
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/scripts/app.js:669` — else if (view === "monitoring") placeholder(view, t("monitoringPlaceholder"));
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/scripts/app.js:670` — else if (view === "reports") placeholder(view, t("reportsPlaceholder"));
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/scripts/app.js:671` — else placeholder(view, t("genericPlaceholder"));
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/app.js:680` — try { localStorage.setItem("sirkPortal.theme", dark ? "dark" : "light"); } catch (ignored) {}
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/app.js:720` — try { localStorage.setItem("sirkPortal.standaloneCollapsed", value ? "1" : "0"); } catch (ignored) {}
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/app.js:750` — if (localStorage.getItem("sirkPortal.standaloneCollapsed") === "1") root.classList.add("is-collapsed");
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/app.js:751` — setTheme(localStorage.getItem("sirkPortal.theme") === "dark");
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/branding.js:26` — try { return localStorage.getItem(LANGUAGE_STORAGE) === "en" ? "en" : "pl"; }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/branding.js:31` — try { return localStorage.getItem(THEME_STORAGE) === "dark"; }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/branding.js:50` — var value = JSON.parse(localStorage.getItem(DEVICE_TAB_STORAGE) || "{}");
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/branding.js:60` — try { localStorage.setItem(DEVICE_TAB_STORAGE, JSON.stringify(state)); }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/branding.js:225` — try { if (localStorage.getItem(key) === "1") return; }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/branding.js:258` — try { localStorage.setItem(key, "1"); }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/cleanup.js:354` — details.innerHTML = '<div class="sirk-card">Ładowanie polityk akceptacji…</div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/cleanup.js:357` — details.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/cleanup.js:431` — details.innerHTML = '<div class="sirk-card" data-error="1"></div>';
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/core.js:28` — var saved = JSON.parse(localStorage.getItem("sirkPortal.deviceTabs") || "{}");
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/core.js:71` — var value = JSON.parse(localStorage.getItem("sirkPortal.deviceActiveTabs") || "{}");
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/core.js:277` — host.innerHTML = "";
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/device-tabs.js:15` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/device-tabs.js:81` — var value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/device-tabs.js:92` — localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: state.active, tabs: tabs }));
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/device-workspace.js:44` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:188` — host.innerHTML = '<div class="sirk-agent-operation"><header><strong>Terminal SIRK Agent</strong><small>PowerShell uruchamiany przez usługę na urządzeniu</small></header><textarea data-agent-terminal-command spellcheck="false" placeholder="Get-ComputerInfo | Select-Object WindowsProductName, OsVersio
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/scripts/device-workspace.js:188` — host.innerHTML = '<div class="sirk-agent-operation"><header><strong>Terminal SIRK Agent</strong><small>PowerShell uruchamiany przez usługę na urządzeniu</small></header><textarea data-agent-terminal-command spellcheck="false" placeholder="Get-ComputerInfo | Select-Object WindowsProductName, OsVersio
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:207` — host.innerHTML = '<div class="sirk-agent-operation"><header><strong>Pliki SIRK Agent</strong><small>Lista jest ograniczona do 1000 pozycji, transfer do 1 MiB</small></header><div class="sirk-agent-path"><input data-agent-files-path value="C:\\\\" spellcheck="false"><button type="button" data-agent-f
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:220` — list.innerHTML = entries.map(function (entry) {
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:284` — host.innerHTML = '<div class="sirk-agent-operation sirk-agent-desktop"><header><strong>Pulpit SIRK Agent Live</strong><small>Natychmiastowa pomoc zdalna w wybranej sesji użytkownika</small></header><div class="sirk-agent-desktop-controls"><label>Sesja<select data-agent-desktop-session disabled></sel
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/scripts/device-workspace.js:284` — host.innerHTML = '<div class="sirk-agent-operation sirk-agent-desktop"><header><strong>Pulpit SIRK Agent Live</strong><small>Natychmiastowa pomoc zdalna w wybranej sesji użytkownika</small></header><div class="sirk-agent-desktop-controls"><label>Sesja<select data-agent-desktop-session disabled></sel
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:447` — monitor.innerHTML = '<option value="-1">Wszystkie monitory</option>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:462` — session.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:1010` — host.innerHTML = '<div class="sirk-device-general"><div class="sirk-device-detail-grid">' +
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:1021` — host.innerHTML = '<div class="sirk-device-command-error">' + esc(t("noCommands")) + '</div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:1024` — host.innerHTML = '<div class="sirk-device-commands-host"></div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:1123` — panel.innerHTML = '<header><strong>' + esc(t("quickCommands")) + '</strong><button type="button" data-quick-command-close="1" title="' + esc(t("close")) + '">×</button></header><input class="sirk-quick-command-search" type="search" placeholder="' + esc(t("searchCommands")) + '" value="' + esc(quickC
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/scripts/device-workspace.js:1123` — panel.innerHTML = '<header><strong>' + esc(t("quickCommands")) + '</strong><button type="button" data-quick-command-close="1" title="' + esc(t("close")) + '">×</button></header><input class="sirk-quick-command-search" type="search" placeholder="' + esc(t("searchCommands")) + '" value="' + esc(quickC
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:1132` — runHost.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/device-workspace.js:1165` — content.innerHTML = '<div class="sirk-device-workspace"><header class="sirk-device-compact-header"><button type="button" class="sirk-device-compact-back" data-device-back="1" title="' + esc(t("back")) + '">‹</button><span class="sirk-device-compact-icon" aria-hidden="true">' + DEVICE_ICON + '</span>
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/navigation.js:56` — if (host) host.innerHTML = window.SirkIcons.svg(map[view], "sirk-nav-svg");
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/navigation.js:59` — if (sidebar) sidebar.innerHTML = window.SirkIcons.svg("chevron-left", "sirk-control-svg");
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/navigation.js:61` — if (nativeLink) nativeLink.innerHTML = window.SirkIcons.svg("external-link", "sirk-nav-svg");
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/navigation.js:126` — details.innerHTML = '<div data-central-status><div class="sirk-card"><strong>Ładowanie konfiguracji Central…</strong></div></div>' +
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/navigation.js:156` — details.querySelector("[data-central-status]").innerHTML = centralStatusMarkup(result.value);
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/navigation.js:168` — if (host) host.innerHTML = centralStatusMarkup(result.value);
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/navigation.js:171` — if (host) host.innerHTML = '<div class="sirk-card" data-error="1">' + String(error.message || error) + '</div>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/settings-native-v2.js:425` — table.innerHTML = "<thead><tr><th>Użytkownik</th><th>Rola</th><th>Aktywny</th><th>Akcje</th></tr></thead>";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/settings-native-v2.js:813` — state.page.details.innerHTML = "";
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/terminal-connect.js:24` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/view-mode-base.js:23` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/view-mode-base.js:63` — try { localStorage.setItem("sirkPortal.focusMode", enabled ? "1" : "0"); }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/view-mode-base.js:84` — try { setFocusMode(localStorage.getItem("sirkPortal.focusMode") === "1"); }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/view-mode-base.js:101` — toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/view-mode-base.js:112` — button.innerHTML = "<span>" + icon + "</span><span>" + text(pl, en) + "</span>";
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/view-mode.js:23` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/view-mode.js:63` — try { localStorage.setItem("sirkPortal.focusMode", enabled ? "1" : "0"); }
- **MEDIUM** `local-storage` — `public/portal/standalone/scripts/view-mode.js:84` — try { setFocusMode(localStorage.getItem("sirkPortal.focusMode") === "1"); }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/view-mode.js:101` — toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
- **MEDIUM** `dynamic-innerhtml` — `public/portal/standalone/scripts/view-mode.js:112` — button.innerHTML = "<span>" + icon + "</span><span>" + text(pl, en) + "</span>";
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/styles/base.css:439` — .sirk-standalone-placeholder,
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/styles/base.css:454` — .sirk-standalone-placeholder h2{
- **MEDIUM** `incomplete-implementation` — `public/portal/standalone/styles/base.css:460` — .sirk-standalone-placeholder p{
- **MEDIUM** `dynamic-innerhtml` — `public/portal/subfolder-icons.js:55` — iconHost.innerHTML = iconFor(label);
- **MEDIUM** `incomplete-implementation` — `public/portal/subfolder-icons.js:85` — if (/^(title|aria-label|placeholder)$/i.test(String(name)) && this.getAttribute(name) === textValue) return;
- **MEDIUM** `local-storage` — `public/portal/subfolder-icons.js:108` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/subfolder-icons.js:205` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/subfolder-icons.js:383` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/subfolder-icons.js:391` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/portal/subfolder-icons.js:422` — if (secondary) { secondary.innerHTML = ""; secondary.hidden = true; }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/subfolder-icons.js:423` — details.innerHTML = "";
- **MEDIUM** `local-storage` — `public/portal/ui-fixes.js:23` — try { window.localStorage.setItem("sirkPortal.enabled", "1"); }
- **MEDIUM** `dynamic-innerhtml` — `public/portal/ui-fixes.js:44` — host.innerHTML = markup;
- **MEDIUM** `local-storage` — `public/portal/vendor/portal-ui-contract.js:35` — try { return localStorage.getItem(THEME_STORAGE) === "dark"; }
- **MEDIUM** `local-storage` — `public/portal/vendor/settings-structure-stable.js:13` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `local-storage` — `public/portal/vendor/settings-structure.js:26` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `dynamic-innerhtml` — `public/shared/icon-registry.js:28` — wrapper.innerHTML = svg(name, className, title);
- **MEDIUM** `dynamic-innerhtml` — `public/shared/module-shell.js:14` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/module-shell.js:27` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/module-shell.js:34` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/module-shell.js:159` — host.innerHTML = "";
- **MEDIUM** `local-storage` — `public/shared/runtime.js:109` — try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
- **MEDIUM** `local-storage` — `public/shared/runtime.js:114` — try { return JSON.parse(localStorage.getItem(STORAGE) || "{}"); }
- **MEDIUM** `local-storage` — `public/shared/runtime.js:117` — function savePreferences(value) { try { localStorage.setItem(STORAGE, JSON.stringify(value)); } catch (error) {} }
- **MEDIUM** `dynamic-innerhtml` — `public/shared/runtime.js:147` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/runtime.js:177` — .then(function (response) { card.innerHTML = ""; card.appendChild(document.createTextNode((language() === "pl" ? "Wysłano: " : "Submitted: ") + (response.submitted || 0) + ", " + (language() === "pl" ? "błędy: " : "failed: ") + (response.failed || 0))); })
- **MEDIUM** `dynamic-innerhtml` — `public/shared/runtime.js:201` — if (icon && ICONS[command.id]) { icon.innerHTML = ICONS[command.id]; icon.classList.add("sirk-nav-icon"); }
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/catalog.js:13` — icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8"/></svg>';
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/catalog.js:34` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/layout.js:15` — root.innerHTML = "";
- **MEDIUM** `local-storage` — `public/shared/ui/layout.js:23` — try { collapsed = key && window.localStorage.getItem(key) === "collapsed"; } catch (error) {}
- **MEDIUM** `local-storage` — `public/shared/ui/layout.js:29` — try { if (key) window.localStorage.setItem(key, collapsed ? "collapsed" : "expanded"); } catch (error) {}
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/layout.js:46` — clear: function () { primary.innerHTML = ""; secondary.innerHTML = ""; details.innerHTML = ""; }
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/page.js:14` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/result-layout.js:31` — detailsHost.innerHTML = "";
- **MEDIUM** `incomplete-implementation` — `public/shared/ui/results.js:153` — var filter = document.createElement("input"); filter.type = "search"; filter.className = "sirk-results-filter"; filter.placeholder = "Filter result rows"; host.appendChild(filter);
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/results.js:156` — wrapper.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/results.js:240` — host.innerHTML = "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/results.js:251` — host.innerHTML = "";
- **MEDIUM** `incomplete-implementation` — `public/shared/ui/results.js:253` — var filter = document.createElement("input"); filter.type = "search"; filter.className = "sirk-results-filter"; filter.placeholder = options.filterPlaceholder || "Filter results"; filter.value = options.filterValue || "";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/results.js:257` — tableHost.innerHTML = "";
- **MEDIUM** `incomplete-implementation` — `public/shared/ui/script-definition-form.js:98` — name.placeholder = "ApiToken";
- **MEDIUM** `incomplete-implementation` — `public/shared/ui/script-definition-form.js:102` — pl.placeholder = "Polska nazwa | Polski opis";
- **MEDIUM** `incomplete-implementation` — `public/shared/ui/script-definition-form.js:106` — en.placeholder = "English name | English description";
- **MEDIUM** `dynamic-innerhtml` — `public/shared/ui/script-definition-form.js:232` — host.innerHTML = "";
- **MEDIUM** `local-storage` — `public/shared/ui/script-tools.js:152` — var stored = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
- **MEDIUM** `local-storage` — `public/shared/ui/script-tools.js:163` — window.localStorage.setItem(storageKey, JSON.stringify(current));
