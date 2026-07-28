(function () {
    "use strict";

    var state = { snapshot: null, timer: 0, section: "updates" };
    var RESTART_KEY = "sirkPortal.restartState";

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>\"]/g, function (character) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
        });
    }

    function updateBase() {
        var path = String(window.location.pathname || "/");
        var portal = path.match(/^(.*?\/sirkportal)(?:\/.*)?$/i);
        return portal ? portal[1] + "/api/system/updates/" : "/api/system/updates/";
    }

    function api(action, method, body) {
        var requestMethod = method || "GET";
        var endpoint = updateBase() + action;
        if (requestMethod === "GET") endpoint += (endpoint.indexOf("?") >= 0 ? "&" : "?") + "sirk_refresh=" + Date.now() + "_" + Math.random().toString(16).slice(2);
        return fetch(endpoint, {
            method: requestMethod,
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store, max-age=0", Pragma: "no-cache" },
            body: body ? JSON.stringify(body) : undefined
        }).then(function (response) {
            return response.json().catch(function () { throw new Error("Update API returned an invalid response."); });
        }).then(function (payload) {
            if (!payload.ok) throw new Error(payload.error || "Update operation failed.");
            return payload.value;
        });
    }

    function busy(snapshot) {
        return Object.keys(snapshot && snapshot.jobs || {}).some(function (id) {
            var job = snapshot.jobs[id];
            return job && (job.status === "queued" || job.status === "running");
        });
    }

    function latestJob(snapshot) {
        return Object.keys(snapshot && snapshot.jobs || {}).map(function (id) { return snapshot.jobs[id]; }).sort(function (a, b) {
            return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
        })[0] || null;
    }

    function saveRestartState(value) {
        try { sessionStorage.setItem(RESTART_KEY, JSON.stringify(value)); } catch (error) {}
    }

    function clearRestartState() {
        try { sessionStorage.removeItem(RESTART_KEY); } catch (error) {}
    }

    function ensureOverlay() {
        var overlay = document.getElementById("sirkUpdateFullscreen");
        if (overlay) return overlay;
        overlay = document.createElement("div");
        overlay.id = "sirkUpdateFullscreen";
        overlay.setAttribute("role", "status");
        overlay.setAttribute("aria-live", "polite");
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:28px;background:var(--sirk-bg,#f3f6fb);color:var(--sirk-text,#172033);box-sizing:border-box";
        document.body.appendChild(overlay);
        return overlay;
    }

    function fullScreen(message, detail, progress, logs, failed) {
        var overlay = ensureOverlay();
        var value = Math.max(0, Math.min(100, Number(progress || 0)));
        overlay.innerHTML = '<div style="width:min(760px,100%);padding:28px;border:1px solid var(--sirk-border,#dce3ec);border-radius:14px;background:var(--sirk-panel,#fff);box-shadow:0 24px 70px rgba(15,23,42,.2)">' +
            '<div class="sirk-restart-spinner" aria-hidden="true"' + (failed ? ' style="display:none"' : '') + '></div>' +
            '<h1 style="margin:14px 0 8px;font-size:28px">' + escapeHtml(message) + '</h1>' +
            '<p style="margin:0 0 20px;color:var(--sirk-muted,#657187)">' + escapeHtml(detail || "") + '</p>' +
            '<progress max="100" value="' + value + '" style="width:100%;height:18px"></progress>' +
            '<div style="margin-top:8px;text-align:right;font-weight:700">' + value + '%</div>' +
            (logs ? '<pre style="max-height:260px;overflow:auto;margin:20px 0 0;padding:14px;border:1px solid var(--sirk-border,#dce3ec);border-radius:8px;white-space:pre-wrap;background:var(--sirk-bg,#f3f6fb)">' + escapeHtml(logs) + '</pre>' : '') +
            (failed ? '<button type="button" class="sirk-button" data-update-close style="margin-top:18px">Wróć do ustawień</button>' : '') + '</div>';
        var close = overlay.querySelector("[data-update-close]");
        if (close) close.onclick = function () { overlay.remove(); };
    }

    function confirmUpdate() {
        return new Promise(function (resolve) {
            var overlay = ensureOverlay();
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            overlay.setAttribute("aria-labelledby", "sirkUpdateConfirmTitle");
            overlay.innerHTML = '<div style="width:min(620px,100%);padding:28px;border:1px solid var(--sirk-border,#dce3ec);border-radius:14px;background:var(--sirk-panel,#fff);box-shadow:0 24px 70px rgba(15,23,42,.2)">' +
                '<h1 id="sirkUpdateConfirmTitle" style="margin:0 0 12px;font-size:26px">Czy na pewno chcesz zaktualizować system?</h1>' +
                '<p style="margin:0 0 12px;line-height:1.55">Przed aktualizacją zostanie utworzony backup bezpieczeństwa.</p>' +
                '<p style="margin:0 0 22px;line-height:1.55;font-weight:700">Po zakończeniu aktualizacji usługa SIRK Portal zostanie automatycznie zrestartowana. Użytkownicy mogą zostać chwilowo rozłączeni.</p>' +
                '<div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">' +
                '<button type="button" class="sirk-button" data-update-confirm-cancel>Anuluj</button>' +
                '<button type="button" class="sirk-button" data-update-confirm-accept>Tak, aktualizuj system</button>' +
                '</div></div>';
            function finish(value) {
                overlay.remove();
                resolve(value);
            }
            overlay.querySelector("[data-update-confirm-cancel]").onclick = function () { finish(false); };
            overlay.querySelector("[data-update-confirm-accept]").onclick = function () { finish(true); };
            overlay.querySelector("[data-update-confirm-accept]").focus();
        });
    }

    function loginRedirect() {
        clearRestartState();
        try { sessionStorage.removeItem("sirkPortal.updateStartedAt"); } catch (error) {}
        window.location.replace(String(window.__SIRK_PLATFORM_LOGOUT_URL__ || "/logout"));
    }

    function waitForRestart() {
        clearTimeout(state.timer);
        fullScreen("Ponowne uruchamianie SIRK Portal…", "Usługa jest restartowana. Portal czeka na jej powrót, a następnie otworzy panel logowania.", 100, "Aktualizacja zakończona.\nRestart usługi SIRK Portal…", false);
        var started = Date.now();
        function poll() {
            if (Date.now() - started < 4500) { state.timer = setTimeout(poll, 800); return; }
            api("status").then(function (snapshot) {
                if (!snapshot || !snapshot.current) throw new Error("Usługa nie jest jeszcze gotowa.");
                loginRedirect();
            }).catch(function () {
                if (Date.now() - started > 120000) {
                    fullScreen("Nie udało się potwierdzić powrotu usługi", "Sprawdź stan SIRK Portal i odśwież stronę.", 100, "Przekroczono czas oczekiwania na usługę.", true);
                    return;
                }
                state.timer = setTimeout(poll, 1200);
            });
        }
        poll();
    }

    function runUpdate() {
        try { sessionStorage.setItem("sirkPortal.updateStartedAt", String(Date.now())); } catch (error) {}
        var channel = state.snapshot && state.snapshot.current && state.snapshot.current.channel || "stable";
        fullScreen("Przygotowanie aktualizacji…", "Tworzenie backupu i przygotowanie plików aktualizacji.", 2, "Rozpoczynanie zadania aktualizacji…", false);
        api("update", "POST", { channel: channel }).then(function () {
            function monitor() {
                api("status").then(function (snapshot) {
                    state.snapshot = snapshot;
                    var job = latestJob(snapshot);
                    if (!job) { state.timer = setTimeout(monitor, 1000); return; }
                    var message = job.status === "queued" ? "Aktualizacja oczekuje…" : job.status === "running" ? "Aktualizowanie systemu…" : job.status === "failed" ? "Aktualizacja nie powiodła się" : "Aktualizacja przygotowana";
                    var log = ["Typ: " + (job.type || "update"), "Status: " + (job.status || "—"), job.message || "", job.error || ""].filter(Boolean).join("\n");
                    fullScreen(message, job.message || "", job.progress || (job.status === "completed" ? 100 : 0), log, job.status === "failed");
                    if (job.status === "failed") return;
                    if (job.status === "completed") {
                        saveRestartState({ pending: true, section: "updates", startedAt: Date.now() });
                        api("restart", "POST", {}).then(waitForRestart).catch(function (error) {
                            clearRestartState();
                            fullScreen("Nie udało się zrestartować usługi", error.message, 100, log, true);
                        });
                        return;
                    }
                    state.timer = setTimeout(monitor, 1000);
                }).catch(function (error) {
                    fullScreen("Utracono połączenie z usługą", "Portal ponawia sprawdzanie stanu aktualizacji.", 50, error.message, false);
                    state.timer = setTimeout(monitor, 1400);
                });
            }
            monitor();
        }).catch(function (error) {
            fullScreen("Nie udało się rozpocząć aktualizacji", error.message, 0, error.message, true);
        });
    }

    function stateMarkup(remote, current) {
        if (remote.error) return '<div class="sirk-card"><strong>Nie udało się sprawdzić aktualizacji</strong><p>' + escapeHtml(remote.error) + '</p></div>';
        if (remote.updateAvailable) return '<div class="sirk-card"><strong>Dostępna jest aktualizacja systemu</strong><p>Możesz zaktualizować system z wersji <strong>' + escapeHtml(current.version || "—") + '</strong> do <strong>' + escapeHtml(remote.availableVersion || "—") + '</strong>.</p></div>';
        return '<div class="sirk-card"><strong>System jest aktualny</strong><p>Zainstalowana jest najnowsza dostępna wersja dla wybranego kanału.</p></div>';
    }

    function renderUpdates(host, snapshot) {
        var remote = snapshot.remote || {};
        var current = snapshot.current || {};
        host.innerHTML = '<div class="sirk-update-section"><div class="sirk-update-actions"><button type="button" class="sirk-button" data-update-action="check">Sprawdź aktualizacje</button><button type="button" class="sirk-button" data-update-action="install"' + (busy(snapshot) || !remote.updateAvailable ? ' disabled' : '') + '>Aktualizuj system</button></div><div class="sirk-update-summary"><p>Aktualna wersja: <strong>' + escapeHtml(current.version || "—") + '</strong></p><p>Dostępna wersja: <strong>' + escapeHtml(remote.availableVersion || remote.error || "—") + '</strong></p><p>Aktywny kanał: <strong>' + escapeHtml(current.channel || "—") + '</strong> · <code>' + escapeHtml(current.branch || "—") + '</code></p></div>' + stateMarkup(remote, current) + '</div>';
    }

    function renderBackups(host, snapshot) {
        var items = snapshot.backups || [];
        var disabled = busy(snapshot) ? " disabled" : "";
        host.innerHTML = '<div class="sirk-update-section"><div class="sirk-update-actions"><button type="button" class="sirk-button" data-update-action="backup"' + disabled + '>Utwórz backup</button></div><div class="sirk-update-list">' +
            (items.length ? items.map(function (backup) {
                return '<article><div><strong>' + escapeHtml(backup.version || backup.id) + '</strong><small>' + escapeHtml(backup.createdAt || "") + '</small><small>' + escapeHtml(backup.reason || "") + '</small></div><div class="sirk-update-backup-actions"><button type="button" class="sirk-button" data-restore-id="' + escapeHtml(backup.id) + '"' + disabled + '>Przywróć</button><button type="button" class="sirk-button sirk-button-danger" data-delete-backup-id="' + escapeHtml(backup.id) + '"' + disabled + '>Usuń</button></div></article>';
            }).join("") : '<p>Brak backupów.</p>') + '</div></div>';
    }

    function renderHistory(host, snapshot) {
        var rows = (snapshot.history || []).map(function (entry) { return { type: entry.type || "operacja", at: entry.at, version: entry.to || entry.version || "—", status: entry.error ? "Nieudana" : "Zakończona", message: entry.error || "" }; });
        host.innerHTML = '<div class="sirk-update-section"><h3>Historia aktualizacji</h3>' + (rows.length ? '<div class="sirk-update-history-table-wrap"><table class="sirk-update-history-table"><thead><tr><th>Operacja</th><th>Data</th><th>Wersja</th><th>Status</th><th>Informacja</th></tr></thead><tbody>' + rows.map(function (row) { return '<tr><td>' + escapeHtml(row.type) + '</td><td>' + escapeHtml(row.at || "—") + '</td><td>' + escapeHtml(row.version) + '</td><td>' + escapeHtml(row.status) + '</td><td>' + escapeHtml(row.message || "—") + '</td></tr>'; }).join("") + '</tbody></table></div>' : '<p>Brak operacji.</p>') + '</div>';
    }

    function renderChannel(host, snapshot) {
        var current = snapshot.current || {};
        host.innerHTML = '<div class="sirk-update-section"><label class="sirk-update-channel-label"><span>Kanał aktualizacji</span><select data-update-channel><option value="stable">Stable</option><option value="beta">Beta</option><option value="dev">Dev</option></select></label><button type="button" class="sirk-button" data-update-action="channel">Zapisz kanał</button></div>';
        host.querySelector("[data-update-channel]").value = current.channel || "stable";
    }

    function bind(host) {
        Array.prototype.forEach.call(host.querySelectorAll("[data-update-action]"), function (button) {
            button.onclick = function () {
                var action = button.getAttribute("data-update-action");
                if (action === "install") {
                    confirmUpdate().then(function (accepted) { if (accepted) runUpdate(); });
                    return;
                }
                button.disabled = true;
                var promise = action === "check" ? api("check", "POST", {})
                    : action === "backup" ? api("backup", "POST", {})
                        : action === "channel" ? api("channel", "POST", { channel: host.querySelector("[data-update-channel]").value }) : Promise.resolve();
                promise.then(function () { return api("status"); }).then(function (snapshot) { state.snapshot = snapshot; render(host); }).catch(function (error) { window.alert(error.message); button.disabled = false; });
            };
        });
        Array.prototype.forEach.call(host.querySelectorAll("[data-restore-id]"), function (button) {
            button.onclick = function () {
                if (!window.confirm("Przywrócić wybrany backup? Usługa SIRK Portal zostanie zrestartowana.")) return;
                fullScreen("Przywracanie backupu…", "Przywracanie plików i przygotowanie restartu usługi.", 10, "Rozpoczynanie przywracania backupu…", false);
                api("restore", "POST", { id: button.getAttribute("data-restore-id") }).then(waitForRestart).catch(function (error) { fullScreen("Nie udało się przywrócić backupu", error.message, 0, error.message, true); });
            };
        });
        Array.prototype.forEach.call(host.querySelectorAll("[data-delete-backup-id]"), function (button) {
            button.onclick = function () {
                if (!window.confirm("Usunąć wybrany backup? Tej operacji nie można cofnąć.")) return;
                button.disabled = true;
                api("delete-backup", "POST", { id: button.getAttribute("data-delete-backup-id") }).then(function () { return api("status"); }).then(function (snapshot) { state.snapshot = snapshot; render(host); }).catch(function (error) { window.alert(error.message); button.disabled = false; });
            };
        });
    }

    function render(host) {
        if (state.section === "backups") renderBackups(host, state.snapshot || {});
        else if (state.section === "history") renderHistory(host, state.snapshot || {});
        else if (state.section === "channel") renderChannel(host, state.snapshot || {});
        else renderUpdates(host, state.snapshot || {});
        bind(host);
    }

    function mount(host, section) {
        state.section = section || "updates";
        host.innerHTML = '<div class="sirk-card">Ładowanie…</div>';
        api("status").then(function (snapshot) {
            state.snapshot = snapshot;
            render(host);
            var marker;
            try { marker = JSON.parse(sessionStorage.getItem(RESTART_KEY) || "null"); } catch (error) { marker = null; }
            if (marker && marker.pending) waitForRestart();
        }).catch(function (error) { host.innerHTML = '<div class="sirk-card" data-error="1">' + escapeHtml(error.message) + '</div>'; });
    }

    window.SirkSystemUpdates = { mount: mount };
}());
