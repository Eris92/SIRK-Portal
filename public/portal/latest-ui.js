(function () {
    "use strict";

    if (window.__sirkLatestUiLoaded) return;
    window.__sirkLatestUiLoaded = true;

    var activePrimary = "modules";
    var latestSnapshot = null;
    var settingsHost = null;

    function lang() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function text(pl, en) { return lang() === "en" ? en : pl; }
    function clone(value) { return JSON.parse(JSON.stringify(value == null ? {} : value)); }
    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function el(tag, className, value) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (value != null) node.textContent = value;
        return node;
    }

    function injectStyle() {
        if (document.getElementById("sirk-latest-ui-style")) return;
        var style = document.createElement("style");
        style.id = "sirk-latest-ui-style";
        style.textContent = [
            ".sirk-latest-primary{display:grid;gap:6px;width:100%}",
            ".sirk-latest-primary>.sirk-nav-item{width:100%;min-height:42px;padding:10px 12px;text-align:left;cursor:pointer}",
            ".sirk-latest-primary>.sirk-nav-item.active{background:var(--sirk-active-bg,#e7eefc);border-color:var(--sirk-accent,#4d6bd8)}",
            ".sirk-latest-hide{display:none!important}",
            ".sirk-latest-secondary-root>summary{display:none!important}",
            ".sirk-latest-secondary-root>.sirk-settings-nav-group-body{display:block!important;padding:0!important}",
            ".sirk-overview-link,.sirk-overview-system,.sirk-overview-health{cursor:pointer;transition:background-color .15s ease,border-color .15s ease}",
            ".sirk-overview-link:hover,.sirk-overview-system:hover,.sirk-overview-health:hover,.sirk-overview-link:focus-visible,.sirk-overview-system:focus-visible,.sirk-overview-health:focus-visible{background:var(--sirk-hover,#eef3f9);border-color:var(--sirk-accent,#4d6bd8);outline:none}",
            ".sirk-latest-form{display:grid;gap:10px}",
            ".sirk-latest-form .sirk-card{margin:0}",
            ".sirk-latest-actions{display:flex;align-items:center;gap:10px;margin-top:12px}",
            ".sirk-latest-details{display:grid;gap:10px}",
            ".sirk-latest-details>summary{cursor:pointer;font-weight:700}",
            ".sirk-latest-details-body{display:grid;gap:10px;padding-top:10px}",
            ".sirk-latest-status[data-error='1']{color:#b42318}",
            ".sirk-latest-status[data-error='0']{color:var(--sirk-muted,#64748b)}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function csrf() {
        var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
        return String(runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "");
    }

    function parse(response) {
        return response.text().then(function (body) {
            var value;
            try { value = JSON.parse(body || "{}"); }
            catch (error) { throw new Error(body || ("HTTP " + response.status)); }
            if (!response.ok || value.ok === false) throw new Error(value.error || ("HTTP " + response.status));
            return value.value || value.snapshot || value;
        });
    }

    function snapshot() {
        return fetch("/api/admin/settings", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
            .then(parse).then(function (value) { latestSnapshot = value; return value; });
    }

    function saveSnapshot(value) {
        var payload = {
            modules: {},
            moduleOptions: clone(value.moduleSettings || {}),
            integrations: clone(value.integrations && value.integrations.values || {}),
            secrets: {}
        };
        (value.modules || []).forEach(function (module) { payload.modules[module.key] = module.enabled === true; });
        payload.portal = clone(payload.moduleOptions.portal || {});
        var body = new URLSearchParams();
        body.set("payload", JSON.stringify(payload));
        return fetch("/api/admin/settings", {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-SIRK-CSRF": csrf() },
            body: body.toString()
        }).then(parse).then(function (result) { latestSnapshot = result; return result; });
    }

    function field(host, label, value, change, options) {
        options = options || {};
        var wrapper = el("label", "sirk-card");
        wrapper.setAttribute("data-settings-field", options.boolean ? "boolean" : "value");
        var copy = el("span");
        copy.setAttribute("data-settings-field-copy", "1");
        copy.appendChild(el("strong", "", label));
        if (options.description) copy.appendChild(el("small", "", options.description));
        wrapper.appendChild(copy);
        var input;
        if (options.boolean) {
            input = el("input"); input.type = "checkbox"; input.checked = value === true;
            input.onchange = function () { change(input.checked); };
        } else if (options.choices) {
            input = el("select");
            options.choices.forEach(function (choice) {
                var option = el("option", "", choice[1]); option.value = choice[0];
                option.selected = String(value == null ? "" : value) === String(choice[0]);
                input.appendChild(option);
            });
            input.onchange = function () { change(input.value); };
        } else {
            input = el(options.multiline ? "textarea" : "input");
            if (!options.multiline) input.type = typeof value === "number" ? "number" : "text";
            input.value = value == null ? "" : value;
            input.oninput = function () { change(input.type === "number" ? Number(input.value) : input.value); };
        }
        wrapper.appendChild(input); host.appendChild(wrapper); return input;
    }

    function objectEditor(host, object, depth) {
        object = object && typeof object === "object" && !Array.isArray(object) ? object : {};
        Object.keys(object).sort().forEach(function (key) {
            var value = object[key];
            var label = key.replace(/([A-Z])/g, " $1").replace(/^./, function (c) { return c.toUpperCase(); });
            if (value && typeof value === "object" && !Array.isArray(value)) {
                var details = el("details", "sirk-card sirk-latest-details");
                details.open = depth === 0;
                details.appendChild(el("summary", "", label));
                var body = el("div", "sirk-latest-details-body");
                objectEditor(body, value, depth + 1); details.appendChild(body); host.appendChild(details);
            } else if (Array.isArray(value)) {
                field(host, label, value.join(", "), function (next) {
                    object[key] = String(next || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean);
                }, { description: text("Wartości rozdzielone przecinkami.", "Comma-separated values.") });
            } else {
                field(host, label, value, function (next) { object[key] = next; }, { boolean: typeof value === "boolean" });
            }
        });
    }

    function defaults(section) {
        if (section === "banner") return {
            enabled: false, showInPortal: true, showOnLogin: false, activeTemplate: "info",
            templates: {
                info: { name: "Informacja", text: "System został zaktualizowany.", backgroundColor: "#198754", textColor: "#ffffff", fontSize: 16, durationMinutes: 0 },
                warning: { name: "Ostrzeżenie", text: "W systemie występują drobne problemy.", backgroundColor: "#ffc107", textColor: "#111827", fontSize: 16, durationMinutes: 0 },
                critical: { name: "Awaria", text: "Część systemu jest niedostępna.", backgroundColor: "#dc3545", textColor: "#ffffff", fontSize: 16, durationMinutes: 0 }
            }
        };
        if (section === "maintenance") return { enabled: false, title: "Przerwa serwisowa", message: "System jest chwilowo niedostępny.", backgroundColor: "#111827", textColor: "#ffffff", plannedEnd: "", allowedIps: ["127.0.0.1"], blockNative: false, showNoticeToAllowedIps: true };
        if (section === "release") return { enabled: true, showAfterUpdate: true, title: "Co nowego", maxCommits: 12 };
        if (section === "animations") return { enabled: false, showInPortal: true, showOnLogin: false, respectReducedMotion: true, items: {
            snow: { enabled: false, name: "Padający śnieg", type: "falling", symbol: "❄", colors: ["#ffffff", "#dbeafe"], intensity: 30, speed: 1, size: 18, opacity: 0.9 },
            confetti: { enabled: false, name: "Confetti", type: "confetti", symbol: "■", colors: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"], intensity: 40, speed: 1, size: 12, opacity: 0.9 },
            walker: { enabled: false, name: "Postać przechodząca przez stronę", type: "walker", symbol: "🚶", colors: ["#ffffff"], intensity: 1, speed: 1, size: 36, opacity: 1 },
            christmas: { enabled: false, name: "Motyw świąteczny", type: "floating", symbol: "🎄,⭐,🎁", colors: ["#16a34a", "#dc2626", "#facc15"], intensity: 18, speed: 1, size: 24, opacity: 0.95 }
        } };
        return {};
    }

    function renderCustomForm(details, title, readValue, writeValue) {
        clear(details);
        var loading = el("div", "sirk-card", text("Ładowanie…", "Loading…")); details.appendChild(loading);
        snapshot().then(function (value) {
            clear(details);
            var form = el("div", "sirk-latest-form");
            var current = readValue(value);
            objectEditor(form, current, 0);
            var actions = el("div", "sirk-latest-actions");
            var save = el("button", "sirk-button", text("Zapisz", "Save"));
            var message = el("span", "sirk-latest-status");
            save.type = "button";
            save.onclick = function () {
                save.disabled = true; message.textContent = text("Zapisywanie…", "Saving…"); message.setAttribute("data-error", "0");
                writeValue(value, current);
                saveSnapshot(value).then(function () {
                    message.textContent = text("Zapisano.", "Saved."); save.disabled = false;
                }).catch(function (error) {
                    message.textContent = error.message; message.setAttribute("data-error", "1"); save.disabled = false;
                });
            };
            actions.appendChild(save); actions.appendChild(message);
            details.appendChild(el("h2", "", title)); details.appendChild(form); details.appendChild(actions);
        }).catch(function (error) { loading.textContent = error.message; loading.setAttribute("data-error", "1"); });
    }

    function promotedButton(host, key, pl, en, select) {
        var button = el("button", "sirk-nav-item" + (activePrimary === key ? " active" : ""), text(pl, en));
        button.type = "button"; button.setAttribute("data-latest-primary", key);
        button.onclick = function () { activePrimary = key; select(); };
        host.appendChild(button); return button;
    }

    function originalButtons(primary) {
        var result = {};
        Array.prototype.forEach.call(primary.querySelectorAll(":scope > .sirk-nav-item"), function (button) {
            if (button.closest(".sirk-latest-primary")) return;
            var label = String(button.textContent || "").trim().toLowerCase();
            if (label === "ustawienia" || label === "settings") result.settings = button;
            else if (label.indexOf("użytkownicy") >= 0 || label.indexOf("users") >= 0) result.identity = button;
            else if (label === "system" || label === "server") result.server = button;
            button.classList.add("sirk-latest-hide");
        });
        return result;
    }

    function waitFor(condition, callback, attempts) {
        attempts = attempts || 0;
        var value = condition();
        if (value) { callback(value); return; }
        if (attempts > 80) return;
        setTimeout(function () { waitFor(condition, callback, attempts + 1); }, 25);
    }

    function findTopGroup(secondary, names) {
        return Array.prototype.find.call(secondary.querySelectorAll(":scope > details.sirk-settings-nav-group"), function (group) {
            var summary = group.querySelector(":scope > summary");
            return names.indexOf(String(summary && summary.textContent || "").trim().toLowerCase()) >= 0;
        });
    }

    function showNativeGroup(secondary, kind) {
        var modules = findTopGroup(secondary, ["moduły", "modules"]);
        var portal = findTopGroup(secondary, ["portal"]);
        [modules, portal].forEach(function (group) { if (group) group.classList.add("sirk-latest-hide"); });
        var target = kind === "modules" ? modules : portal;
        if (!target) return;
        target.classList.remove("sirk-latest-hide"); target.classList.add("sirk-latest-secondary-root"); target.open = true;
        if (kind === "portal") ensurePortalEntries(secondary, target);
    }

    function ensurePortalEntries(secondary, portalGroup) {
        var body = portalGroup.querySelector(":scope > .sirk-settings-nav-group-body");
        if (!body || body.querySelector("[data-latest-portal='banner']")) return;
        [
            ["banner", "Baner", "Banner"], ["maintenance", "Zaślepka", "Maintenance page"],
            ["release", "Release", "Release"], ["animations", "Animacje", "Animations"]
        ].forEach(function (entry) {
            var button = el("button", "sirk-nav-item sirk-settings-nav-leaf", text(entry[1], entry[2]));
            button.type = "button"; button.setAttribute("data-latest-portal", entry[0]);
            button.onclick = function () {
                body.querySelectorAll(".active,.is-active").forEach(function (node) { node.classList.remove("active", "is-active"); });
                button.classList.add("active");
                var details = settingsHost.querySelector("[data-settings-details]");
                renderCustomForm(details, text(entry[1], entry[2]), function (value) {
                    var portal = value.moduleSettings = value.moduleSettings || {};
                    portal.portal = portal.portal || {};
                    if (!portal.portal[entry[0]] || typeof portal.portal[entry[0]] !== "object") portal.portal[entry[0]] = defaults(entry[0]);
                    return portal.portal[entry[0]];
                }, function () {});
            };
            body.appendChild(button);
        });
    }

    function renderIntegrations(secondary, details) {
        clear(secondary);
        [
            ["ad", "AD"], ["defender", "Defender"], ["entra", "Entra"],
            ["jira", "Jira"], ["zabbix", "Zabbix"], ["sms", "SMS"]
        ].forEach(function (entry, index) {
            var button = el("button", "sirk-nav-item" + (index === 0 ? " active" : ""), entry[1]);
            button.type = "button";
            button.onclick = function () {
                secondary.querySelectorAll(".active").forEach(function (node) { node.classList.remove("active"); }); button.classList.add("active");
                renderCustomForm(details, entry[1], function (value) {
                    value.integrations = value.integrations || { values: {} };
                    value.integrations.values = value.integrations.values || {};
                    if (!value.integrations.values[entry[0]] || typeof value.integrations.values[entry[0]] !== "object") value.integrations.values[entry[0]] = {};
                    return value.integrations.values[entry[0]];
                }, function () {});
            };
            secondary.appendChild(button);
            if (index === 0) button.click();
        });
    }

    function selectPrimary(host, kind) {
        var layout = host.querySelector("[data-portal-settings] .sirk-layout");
        if (!layout) return;
        var primary = layout.querySelector(":scope > .sirk-column-primary");
        var secondary = layout.querySelector(":scope > .sirk-column-secondary");
        var details = layout.querySelector(":scope > .sirk-column-details");
        var originals = originalButtons(primary);
        var promoted = primary.querySelector(".sirk-latest-primary");
        if (promoted) promoted.querySelectorAll("[data-latest-primary]").forEach(function (button) { button.classList.toggle("active", button.getAttribute("data-latest-primary") === kind); });
        secondary.hidden = false;

        if (kind === "integrations") { renderIntegrations(secondary, details); return; }
        if (kind === "server") {
            if (originals.server) originals.server.click();
            waitFor(function () { return layout.querySelector(":scope > .sirk-column-secondary"); }, function (nextSecondary) {
                var identity = el("button", "sirk-nav-item", text("Użytkownicy i grupy", "Users and groups"));
                identity.type = "button";
                identity.onclick = function () { if (originals.identity) originals.identity.click(); };
                if (!nextSecondary.querySelector("[data-latest-identity]")) { identity.setAttribute("data-latest-identity", "1"); nextSecondary.appendChild(identity); }
            });
            return;
        }
        if (originals.settings) originals.settings.click();
        waitFor(function () {
            var next = layout.querySelector(":scope > .sirk-column-secondary");
            return next && findTopGroup(next, ["moduły", "modules"]) ? next : null;
        }, function (nextSecondary) { showNativeGroup(nextSecondary, kind); });
    }

    function upgradeSettings(host) {
        settingsHost = host;
        var layout = host.querySelector("[data-portal-settings] .sirk-layout");
        if (!layout) return;
        var primary = layout.querySelector(":scope > .sirk-column-primary");
        if (!primary) return;
        originalButtons(primary);
        var promoted = primary.querySelector(".sirk-latest-primary");
        if (!promoted) {
            promoted = el("div", "sirk-latest-primary"); primary.insertBefore(promoted, primary.firstChild);
            promotedButton(promoted, "modules", "Moduły", "Modules", function () { selectPrimary(host, "modules"); });
            promotedButton(promoted, "portal", "Portal", "Portal", function () { selectPrimary(host, "portal"); });
            promotedButton(promoted, "integrations", "Integracje", "Integrations", function () { selectPrimary(host, "integrations"); });
            promotedButton(promoted, "server", "Serwer", "Server", function () { selectPrimary(host, "server"); });
        }
        selectPrimary(host, activePrimary);
    }

    function installSettingsOverride() {
        if (!window.SirkPortalSettings || typeof window.SirkPortalSettings.mount !== "function") return false;
        if (window.SirkPortalSettings.mount.__sirkLatestWrapped) return true;
        var original = window.SirkPortalSettings.mount;
        var wrapped = function (host) {
            original(host);
            var scheduled = false;
            var observer = new MutationObserver(function () {
                if (scheduled) return; scheduled = true;
                requestAnimationFrame(function () { scheduled = false; upgradeSettings(host); });
            });
            observer.observe(host, { childList: true, subtree: true });
            setTimeout(function () { upgradeSettings(host); }, 0);
        };
        wrapped.__sirkLatestWrapped = true;
        window.SirkPortalSettings.mount = wrapped;
        return true;
    }

    function openSettings(target) {
        window.location.hash = "#settings";
        waitFor(function () { return document.querySelector("[data-portal-settings]"); }, function (host) {
            activePrimary = target;
            upgradeSettings(host.closest("#sirkStandaloneContent") || document.getElementById("sirkStandaloneContent"));
        });
    }

    function makeCardInteractive(card, target) {
        if (!card || card.getAttribute("data-latest-card") === "1") return;
        card.setAttribute("data-latest-card", "1"); card.setAttribute("role", "button"); card.tabIndex = 0;
        card.onclick = function () { openSettings(target); };
        card.onkeydown = function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); card.click(); } };
    }

    function overviewConfig() {
        var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
        var portal = runtime && runtime.bootstrap && runtime.bootstrap.modules && runtime.bootstrap.modules.portal;
        var config = portal && portal.config || {};
        return config.views && config.views.overview || {};
    }

    function upgradeOverview() {
        var content = document.getElementById("sirkStandaloneContent");
        if (!content || content.getAttribute("data-active-view") !== "overview") return;
        var system = content.querySelector(".sirk-overview-system");
        var integrations = content.querySelector(".sirk-overview-health");
        makeCardInteractive(system, "server"); makeCardInteractive(integrations, "integrations");
        var config = overviewConfig();
        var devices = content.querySelector("[data-open-view='devices']");
        var approvals = content.querySelector("[data-open-view='approvals']");
        if (devices) devices.hidden = config.showDevicesCard === false;
        if (system) system.hidden = config.showSystemStatusCard === false;
        if (integrations) integrations.hidden = config.showIntegrationsCard === false;
        if (approvals) approvals.hidden = config.showApprovalsCard === false;
        var systemTitle = system && system.querySelector("h2");
        if (systemTitle) systemTitle.textContent = text("Stan systemu", "System status");
    }

    injectStyle();
    var installTimer = setInterval(function () { if (installSettingsOverride()) clearInterval(installTimer); }, 50);
    var root = document.getElementById("sirkStandaloneContent");
    if (root) new MutationObserver(function () { requestAnimationFrame(upgradeOverview); }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-active-view"] });
    window.addEventListener("sirkportal:languagechange", function () { upgradeOverview(); if (settingsHost) upgradeSettings(settingsHost); });
    upgradeOverview();
}());
