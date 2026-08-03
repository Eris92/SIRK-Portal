(function () {
    "use strict";

    window.SirkPlatformCore = window.SirkPlatformCore || {};
    window.SirkPlatformModules = window.SirkPlatformModules || {};
    var core = window.SirkPlatformCore;
    var csrfState = { headerName: "X-SIRK-CSRF", requestToken: "", pending: null };

    (function prepareInitialView() {
        var root = document.getElementById("sirkStandaloneRoot");
        var content = document.getElementById("sirkStandaloneContent");
        var child = false;
        var savedActive = "all";
        var finished = false;
        var readinessTimer = 0;
        var fallbackTimer = 0;

        if (root) {
            document.documentElement.classList.add("sirk-portal-boot-pending");
            root.setAttribute("aria-busy", "true");
        }

        try {
            child = new URL(window.location.href).searchParams.get("sirkWorkspaceChild") === "1";
        } catch (error) {}

        try {
            var saved = JSON.parse(localStorage.getItem("sirkPortal.deviceTabs") || "{}");
            savedActive = String(saved && saved.active || "all");
        } catch (error) {}

        if (child && window.location.hash !== "#devices") {
            try {
                var url = new URL(window.location.href);
                url.hash = "devices";
                history.replaceState(history.state, "", url.href);
            } catch (error) {
                window.location.hash = "devices";
            }
        }

        var requested = String(window.location.hash || "#overview").replace(/^#/, "") || "overview";
        var restoreHost = child || (requested === "devices" && savedActive !== "all");
        var buttons = document.querySelectorAll(".sirk-standalone-nav [data-view]");
        Array.prototype.forEach.call(buttons, function (button) {
            var active = button.getAttribute("data-view") === requested;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-current", active ? "page" : "false");
        });

        var requestedButton = document.querySelector('.sirk-standalone-nav [data-view="' + requested.replace(/"/g, "\\\"") + '"] b');
        var title = document.getElementById("sirkStandaloneTitle");
        if (title && requestedButton) title.textContent = requestedButton.textContent;

        function bootstrapReady() {
            var runtime = window.SirkPlatformRuntime;
            return !!(runtime && runtime.state && runtime.state.bootstrap && runtime.state.bootstrap.modules);
        }

        function menuReady() {
            var menuButtons = document.querySelectorAll(".sirk-standalone-nav [data-view]");
            if (!menuButtons.length) return false;
            for (var index = 0; index < menuButtons.length; index += 1) {
                if (!menuButtons[index].hasAttribute("aria-hidden")) return false;
            }
            return true;
        }

        function desiredChildTab() {
            try {
                var value = JSON.parse(localStorage.getItem("sirkPortal.deviceActiveTabs") || "{}");
                return String(value && value.__last__ || "general");
            } catch (error) {
                return "general";
            }
        }

        function childWorkspaceReady() {
            if (!bootstrapReady() || !content) return false;
            if (String(content.getAttribute("data-active-view") || "") !== "devices") return false;
            var workspace = content.querySelector(".sirk-device-workspace");
            if (!workspace) return false;
            var desired = desiredChildTab();
            var desiredButton = workspace.querySelector('[data-device-tab="' + desired.replace(/"/g, '\\"') + '"]');
            if (!desiredButton) desired = "general";
            var active = workspace.querySelector("[data-device-tab].is-active");
            return !!(active && active.getAttribute("data-device-tab") === desired);
        }

        function parentWorkspaceReady() {
            if (!bootstrapReady() || !menuReady() || !content) return false;
            var currentView = String(content.getAttribute("data-active-view") || "");
            if (!currentView || !content.childNodes.length) return false;
            if (!restoreHost) return true;

            var activeTab = document.querySelector(".sirk-device-tabs-standalone .sirk-device-tab.is-active[data-device-workspace-key]");
            var activeKey = activeTab && String(activeTab.getAttribute("data-device-workspace-key") || "");
            var frame = document.querySelector(".sirk-device-session-layer.is-active .sirk-device-isolated-frame");
            if (!activeKey || activeKey === "all" || !frame) return false;

            try {
                var childDocument = frame.contentDocument;
                var childRoot = childDocument && childDocument.getElementById("sirkStandaloneRoot");
                return !!(childRoot && childRoot.style.visibility !== "hidden" &&
                    !childDocument.documentElement.classList.contains("sirk-portal-boot-pending"));
            } catch (error) {
                return false;
            }
        }

        function ready() {
            return child ? childWorkspaceReady() : parentWorkspaceReady();
        }

        function reveal() {
            if (finished) return;
            finished = true;
            if (readinessTimer) window.clearInterval(readinessTimer);
            if (fallbackTimer) window.clearTimeout(fallbackTimer);
            document.documentElement.classList.remove("sirk-portal-boot-pending", "sirk-device-restore-pending");
            if (root) {
                root.style.visibility = "";
                root.style.pointerEvents = "";
                root.removeAttribute("aria-busy");
            }
            window.dispatchEvent(new Event("resize"));
        }

        function checkReady() {
            if (ready()) reveal();
        }

        core.revealPortal = function (force) {
            if (force === true) reveal();
            else checkReady();
            return finished;
        };

        readinessTimer = window.setInterval(checkReady, 50);
        fallbackTimer = window.setTimeout(reveal, 3000);
        checkReady();
    }());

    core.assetVersion = String(window.__SIRK_PLATFORM_PORTAL_VERSION__ || "1.5.0");

    (function loadBranding() {
        var base = String(window.__SIRK_PLATFORM_ASSET_BASE__ || "").replace(/\/$/, "");
        if (!base || document.getElementById("sirk-platform-portal-branding")) return;
        var script = document.createElement("script");
        script.id = "sirk-platform-portal-branding";
        script.src = base + "/portal-branding.js?v=" + encodeURIComponent(core.assetVersion);
        script.async = false;
        (document.head || document.documentElement).appendChild(script);
    }());

    core.redirectToLogin = function () {
        if (core.loginRedirectPending) return;
        core.loginRedirectPending = true;
        try {
            window.sessionStorage.setItem("sirkPortalReturnHash", window.location.hash || "#overview");
        } catch (error) {}
        var login = new URL("login?return=portal", window.location.href);
        window.location.replace(login.href);
    };

    function authenticationError() {
        var error = new Error("Authentication required.");
        error.name = "AuthenticationError";
        error.status = 401;
        return error;
    }

    function parseResponse(response) {
        return response.text().then(function (text) {
            if (response.status === 401) {
                core.redirectToLogin();
                throw authenticationError();
            }
            var result = {};
            try { result = text ? JSON.parse(text) : {}; }
            catch (error) {
                var invalid = new Error("HTTP " + response.status + ": invalid JSON response.");
                invalid.status = response.status;
                throw invalid;
            }
            if (!response.ok || result.ok === false) {
                var failure = new Error(result.error || "HTTP " + response.status);
                failure.status = response.status;
                failure.code = result.code || "";
                throw failure;
            }
            return result;
        });
    }

    function issueCsrfToken() {
        if (csrfState.requestToken) return Promise.resolve(csrfState);
        if (csrfState.pending) return csrfState.pending;
        csrfState.pending = window.fetch("/api/v1/auth/csrf", {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Accept": "application/json" }
        }).then(parseResponse).then(function (value) {
            csrfState.headerName = String(value.headerName || "X-SIRK-CSRF");
            csrfState.requestToken = String(value.requestToken || "");
            if (!csrfState.requestToken) throw new Error("CSRF token could not be issued.");
            return csrfState;
        }).finally(function () { csrfState.pending = null; });
        return csrfState.pending;
    }

    core.csrf = issueCsrfToken;
    core.assetUrl = function (moduleName, assetName, parameters) {
        var base = String(window.__SIRK_PLATFORM_API_BASE__ || "/api/v1").replace(/\/$/, "");
        var endpoint = !moduleName && assetName === "bootstrap"
            ? new URL(base + "/bootstrap", window.location.href)
            : new URL(base + "/modules/" + encodeURIComponent(moduleName || "_runtime") + "/" + encodeURIComponent(assetName || "index"), window.location.href);
        endpoint.searchParams.set("v", core.assetVersion);
        Object.keys(parameters || {}).forEach(function (key) {
            if (parameters[key] != null) endpoint.searchParams.set(key, parameters[key]);
        });
        return endpoint.href;
    };

    core.api = function (moduleName, assetName, options, parameters) {
        var input = options || {};
        var method = String(input.method || "GET").toUpperCase();
        var send = function () {
            var request = Object.assign({}, input);
            request.method = method;
            request.credentials = "same-origin";
            request.cache = "no-store";
            request.headers = new Headers(input.headers || {});
            request.headers.set("Accept", "application/json");
            if (!/^(GET|HEAD|OPTIONS)$/.test(method)) {
                request.headers.set(csrfState.headerName, csrfState.requestToken);
            }
            return window.fetch(core.assetUrl(moduleName, assetName, parameters), request).then(parseResponse);
        };
        return /^(GET|HEAD|OPTIONS)$/.test(method) ? send() : issueCsrfToken().then(send);
    };

    core.post = function (moduleName, assetName, values) {
        return core.api(moduleName, assetName, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify(values && typeof values === "object" ? values : {})
        });
    };

    core.loadScript = function (id, source) {
        return new Promise(function (resolve, reject) {
            var existing = document.getElementById(id);
            if (existing) {
                if (existing.getAttribute("data-loaded") === "1") resolve();
                else {
                    existing.addEventListener("load", resolve, { once: true });
                    existing.addEventListener("error", reject, { once: true });
                }
                return;
            }
            var script = document.createElement("script");
            script.id = id;
            script.src = source;
            script.async = false;
            script.onload = function () { script.setAttribute("data-loaded", "1"); resolve(); };
            script.onerror = function () { reject(new Error("Unable to load " + source)); };
            (document.head || document.documentElement).appendChild(script);
        });
    };

    core.ensureMenu = function () { return false; };
    core.showWorkspace = function (title, viewMode, render) {
        var host = document.getElementById("sirkStandaloneContent");
        if (!host) return false;
        host.innerHTML = "";
        render(host);
        return false;
    };
    core.restoreWorkspace = function () {};

    core.element = function (tag, className, text) {
        var value = document.createElement(tag);
        if (className) value.className = className;
        if (text != null) value.textContent = text;
        return value;
    };

    core.card = function (title, description) {
        var card = core.element("div", "sirk-card");
        card.appendChild(core.element("strong", "", title));
        if (description) card.appendChild(core.element("div", "sirk-shared-muted", description));
        return card;
    };

    core.flattenScripts = function (node, target) {
        target = target || [];
        if (!node) return target;
        if (node.type === "script") target.push(node);
        (node.children || []).forEach(function (child) { core.flattenScripts(child, target); });
        return target;
    };
}());
