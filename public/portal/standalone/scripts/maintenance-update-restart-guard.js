(function () {
    "use strict";

    if (window.__sirkMaintenanceUpdateRestartGuard === true ||
        typeof window.fetch !== "function") return;

    var storageKey = "sirkPortal.maintenanceUpdateRestart";
    var maximumWaitMilliseconds = 30 * 60 * 1000;
    var originalFetch = window.fetch.bind(window);
    var state = readState();

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

    function isUpdateRequest(url, requestMethod) {
        return requestMethod === "POST" &&
            /\/(?:connect\/[^/]+\/)?api\/v1\/admin\/maintenance\/update$/i.test(url.pathname);
    }

    function isReadyRequest(url, requestMethod) {
        return requestMethod === "GET" && /\/readyz\/?$/i.test(url.pathname);
    }

    function beginUpdate(response) {
        state = {
            active: true,
            startedAt: Date.now(),
            sawUnavailable: false,
            logPath: ""
        };
        writeState();
        try {
            response.clone().json().then(function (payload) {
                var value = payload && payload.value || {};
                if (!state || state.active !== true) return;
                state.logPath = String(value.logPath || "");
                writeState();
                renderStatus();
            }).catch(function () {});
        } catch (error) {}
        renderStatus();
    }

    function markUnavailable() {
        if (!state || state.active !== true) return;
        state.sawUnavailable = true;
        writeState();
        renderStatus();
    }

    function finishUpdate() {
        state = null;
        writeState();
        removeStatus();
    }

    function syntheticStartingResponse() {
        return new Response(JSON.stringify({
            status: "updating",
            detail: "Waiting for the old SIRK Portal service to stop."
        }), {
            status: 503,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
                "X-SIRK-Update-Wait": "service-stop"
            }
        });
    }

    function removeStatus() {
        var node = document.querySelector("[data-sirk-maintenance-update-wait]");
        if (node) node.remove();
    }

    function renderStatus() {
        if (!state || state.active !== true) {
            removeStatus();
            return;
        }
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
            ? "Usługa została zatrzymana. Oczekiwanie na uruchomienie nowej wersji…"
            : "Aktualizacja działa w tle. Oczekiwanie na zatrzymanie starej usługi…";
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
        if (state.logPath) {
            var log = document.createElement("p");
            log.className = "sirk-muted";
            log.textContent = "Log: " + state.logPath;
            node.appendChild(log);
        }
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
            if (state.sawUnavailable === true ||
                Date.now() - Number(state.startedAt || 0) >= maximumWaitMilliseconds) {
                finishUpdate();
                return response;
            }
            renderStatus();
            return syntheticStartingResponse();
        }).catch(function (error) {
            markUnavailable();
            throw error;
        });
    };

    window.setInterval(renderStatus, 1000);
    window.__sirkMaintenanceUpdateRestartGuard = true;
    renderStatus();
}());
