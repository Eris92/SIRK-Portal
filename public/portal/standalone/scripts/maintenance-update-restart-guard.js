(function () {
    "use strict";

    if (window.__sirkMaintenanceUpdateRestartGuard === true ||
        typeof window.fetch !== "function") return;

    var storageKey = "sirkPortal.maintenanceUpdateRestart";
    var maximumWaitMilliseconds = 5 * 60 * 1000;
    var originalFetch = window.fetch.bind(window);
    var state = readState();
    var statusRequestRunning = false;
    var reloadScheduled = false;

    function readState() {
        try {
            var value = JSON.parse(sessionStorage.getItem(storageKey) || "null");
            if (!value || value.active !== true || !Number(value.startedAt)) return null;
            return value;
        } catch (error) {
            return null;
        }
    }

    function writeState() {
        try {
            if (state) sessionStorage.setItem(storageKey, JSON.stringify(state));
            else sessionStorage.removeItem(storageKey);
        } catch (error) {}
    }

    function endpoint(input) {
        try {
            var value = input instanceof Request ? input.url : String(input == null ? "" : input);
            return new URL(value, window.location.href);
        } catch (error) {
            return null;
        }
    }

    function method(input, init) {
        if (init && init.method) return String(init.method).toUpperCase();
        if (input instanceof Request) return String(input.method || "GET").toUpperCase();
        return "GET";
    }

    function apiBase() {
        return String(window.__SIRK_PLATFORM_API_BASE__ || "/api/v1").replace(/\/+$/, "");
    }

    function statusUrl() {
        return apiBase() + "/admin/maintenance/status";
    }

    function isUpdateRequest(url, requestMethod) {
        return requestMethod === "POST" &&
            /\/(?:connect\/[^/]+\/)?api\/v1\/admin\/maintenance\/update$/i.test(url.pathname);
    }

    function isReadyRequest(url, requestMethod) {
        return requestMethod === "GET" && /\/readyz\/?$/i.test(url.pathname);
    }

    function validCommit(value) {
        return /^[0-9a-f]{40}$/i.test(String(value || "").trim());
    }

    function sameCommit(left, right) {
        return validCommit(left) && validCommit(right) &&
            String(left).toLowerCase() === String(right).toLowerCase();
    }

    function beginUpdate(response) {
        state = {
            active: true,
            startedAt: Date.now(),
            sawUnavailable: false,
            initialCommit: "",
            targetCommit: "",
            logPath: "",
            lastStatusError: ""
        };
        writeState();
        try {
            response.clone().json().then(function (payload) {
                var value = payload && payload.value || {};
                if (!state || state.active !== true) return;
                state.logPath = String(value.logPath || "");
                if (validCommit(value.installedCommit)) state.initialCommit = String(value.installedCommit).toLowerCase();
                if (validCommit(value.targetCommit)) state.targetCommit = String(value.targetCommit).toLowerCase();
                writeState();
                renderStatus();
            }).catch(function () {});
        } catch (error) {}
        captureUpdateSnapshot();
        renderStatus();
    }

    function markUnavailable() {
        if (!state || state.active !== true) return;
        state.sawUnavailable = true;
        writeState();
        renderStatus();
    }

    function finishUpdate(reload) {
        state = null;
        writeState();
        removeStatus();
        if (reload && !reloadScheduled) {
            reloadScheduled = true;
            setTimeout(function () { window.location.reload(); }, 250);
        }
    }

    function failWait(message) {
        if (!state) return;
        var logPath = String(state.logPath || "");
        state = null;
        writeState();
        removeStatus();
        var host = document.querySelector(".sirk-column-details") ||
            document.getElementById("sirkStandaloneContent");
        if (!host) return;
        var node = document.createElement("section");
        node.className = "sirk-card sirk-maintenance-update-wait";
        node.setAttribute("data-sirk-maintenance-update-wait", "1");
        var title = document.createElement("h2");
        title.textContent = "Aktualizacja SIRK Portal";
        var text = document.createElement("p");
        text.className = "sirk-error";
        text.textContent = message;
        node.appendChild(title);
        node.appendChild(text);
        if (logPath) {
            var log = document.createElement("p");
            log.className = "sirk-muted";
            log.textContent = "Log: " + logPath;
            node.appendChild(log);
        }
        host.appendChild(node);
    }

    function syntheticStartingResponse() {
        return new Response(JSON.stringify({
            status: "updating",
            detail: "Waiting for the SIRK Portal binary update to complete."
        }), {
            status: 503,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
                "X-SIRK-Update-Wait": "commit-change"
            }
        });
    }

    function removeStatus() {
        var node = document.querySelector("[data-sirk-maintenance-update-wait]");
        if (node) node.remove();
    }

    function renderStatus() {
        if (!state || state.active !== true) return;
        var host = document.querySelector(".sirk-column-details") ||
            document.getElementById("sirkStandaloneContent");
        if (!host) return;
        var node = host.querySelector("[data-sirk-maintenance-update-wait]");
        if (!node) {
            node = document.createElement("section");
            node.className = "sirk-card sirk-maintenance-update-wait";
            node.setAttribute("data-sirk-maintenance-update-wait", "1");
            host.appendChild(node);
        }
        var seconds = Math.max(0, Math.round((Date.now() - Number(state.startedAt || Date.now())) / 1000));
        var phase = state.sawUnavailable
            ? "Usługa została zrestartowana. Weryfikacja nowej wersji…"
            : "Aktualizacja działa w tle. Oczekiwanie na potwierdzenie nowego commita…";
        node.innerHTML = "";
        var title = document.createElement("h2");
        title.textContent = "Aktualizacja SIRK Portal";
        var text = document.createElement("p");
        text.textContent = phase;
        var elapsed = document.createElement("p");
        elapsed.className = "sirk-muted";
        elapsed.textContent = "Czas: " + seconds + " s. Nie klikaj ponownie przycisku aktualizacji.";
        node.appendChild(title);
        node.appendChild(text);
        node.appendChild(elapsed);
        if (validCommit(state.targetCommit)) {
            var target = document.createElement("p");
            target.className = "sirk-muted";
            target.textContent = "Docelowy build: " + state.targetCommit.slice(0, 12);
            node.appendChild(target);
        }
        if (state.logPath) {
            var log = document.createElement("p");
            log.className = "sirk-muted";
            log.textContent = "Log: " + state.logPath;
            node.appendChild(log);
        }
    }

    function applySnapshot(payload, captureOnly) {
        if (!state || state.active !== true) return false;
        var snapshot = payload && payload.value || {};
        var current = snapshot.current || {};
        var remote = snapshot.remote || {};
        var currentCommit = String(current.commit || "").trim().toLowerCase();
        var remoteCommit = String(remote.commit || remote.remoteCommit || "").trim().toLowerCase();

        if (!state.initialCommit && validCommit(currentCommit)) state.initialCommit = currentCommit;
        if (!state.targetCommit && validCommit(remoteCommit)) state.targetCommit = remoteCommit;
        state.lastStatusError = String(remote.error || "");
        writeState();

        if (captureOnly) return false;
        if (validCommit(state.targetCommit) && sameCommit(currentCommit, state.targetCommit)) return true;
        if (!remote.error && remote.updateAvailable === false && validCommit(currentCommit) &&
            (!validCommit(remoteCommit) || sameCommit(currentCommit, remoteCommit))) return true;
        return false;
    }

    function requestStatus(captureOnly) {
        if (!state || state.active !== true || statusRequestRunning) return Promise.resolve(false);
        statusRequestRunning = true;
        return originalFetch(statusUrl(), {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" }
        }).then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        }).then(function (payload) {
            return applySnapshot(payload, captureOnly === true);
        }).catch(function () {
            markUnavailable();
            return false;
        }).then(function (completed) {
            statusRequestRunning = false;
            return completed;
        });
    }

    function captureUpdateSnapshot() {
        requestStatus(true).then(renderStatus);
    }

    function pollCompletion() {
        if (!state || state.active !== true) return;
        var elapsed = Date.now() - Number(state.startedAt || 0);
        if (elapsed >= maximumWaitMilliseconds) {
            failWait("Aktualizacja nie została potwierdzona w ciągu 5 minut. Portal nie jest blokowany — sprawdź log aktualizacji.");
            return;
        }
        requestStatus(false).then(function (completed) {
            if (completed) finishUpdate(true);
            else renderStatus();
        });
    }

    window.fetch = function (input, init) {
        var url = endpoint(input);
        var requestMethod = method(input, init);
        if (!url) return originalFetch(input, init);

        if (isUpdateRequest(url, requestMethod)) {
            return originalFetch(input, init).then(function (response) {
                if (response.ok) beginUpdate(response);
                return response;
            });
        }

        if (!state || state.active !== true || !isReadyRequest(url, requestMethod))
            return originalFetch(input, init);

        return originalFetch(input, init).then(function (response) {
            if (!response.ok) {
                markUnavailable();
                return response;
            }
            return requestStatus(false).then(function (completed) {
                if (completed) {
                    finishUpdate(false);
                    return response;
                }
                renderStatus();
                return syntheticStartingResponse();
            });
        }).catch(function (error) {
            markUnavailable();
            throw error;
        });
    };

    window.setInterval(renderStatus, 1000);
    window.setInterval(pollCompletion, 1500);
    window.__sirkMaintenanceUpdateRestartGuard = true;
    renderStatus();
    if (state && state.active === true) pollCompletion();
}());