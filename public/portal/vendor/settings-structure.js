(function () {
    "use strict";

    if (window.__sirkStableSettingsLoaded) return;
    window.__sirkStableSettingsLoaded = true;

    var activePrimary = "modules";
    var mountedHost = null;
    var navigationBusy = false;
    var remountTimer = 0;

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return "pl"; }
    }
    function t(pl, en) { return language() === "en" ? en : pl; }
    function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function clone(value) { return JSON.parse(JSON.stringify(value == null ? {} : value)); }

    function waitFor(callback, attempts) {
        attempts = attempts || 0;
        var value = callback();
        if (value || attempts > 80) return Promise.resolve(value || null);
        return new Promise(function (resolve) { setTimeout(function () { resolve(waitFor(callback, attempts + 1)); }, 30); });
    }

    function injectStyle() {
        if (document.getElementById("sirk-settings-stable-style")) return;
        var style = document.createElement("style");
        style.id = "sirk-settings-stable-style";
        style.textContent = [
            ".sirk-settings-stable-primary{display:grid;gap:6px;width:100%}",
            ".sirk-settings-stable-primary>.sirk-nav-item{width:100%;min-height:42px;padding:10px 12px;text-align:left}",
            ".sirk-settings-stable-primary>.sirk-nav-item.active{background:var(--sirk-active-bg,#e7eefc);border-color:var(--sirk-accent,#4d6bd8)}",
            ".sirk-settings-native-hidden{display:none!important}",
            ".sirk-settings-stable-root>summary{display:none!important}",
            ".sirk-settings-stable-root>.sirk-settings-nav-group-body{display:block!important;padding:0!important}",
            ".sirk-settings-stable-form{display:grid;gap:10px}",
            ".sirk-settings-stable-actions{display:flex;align-items:center;gap:10px;margin-top:12px}",
            ".sirk-settings-stable-status[data-error='1']{color:#b42318}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function nativeButtons(primary) {
        var result = {};
        Array.prototype.forEach.call(primary.querySelectorAll(":scope > .sirk-nav-item"), function (button) {
            if (button.closest(".sirk-settings-stable-primary")) return;
            var label = String(button.textContent || "").trim().toLowerCase();
            if (label === "ustawienia" || label === "settings") result.settings = button;
            else if (label.indexOf("użytkownicy") >= 0 || label.indexOf("users") >= 0) result.identity = button;
            else if (label === "system" || label === "server") result.server = button;
            button.classList.add("sirk-settings-native-hidden");
        });
        return result;
    }

    function findGroup(secondary, names) {
        return Array.prototype.find.call(secondary.querySelectorAll(":scope > details.sirk-settings-nav-group"), function (group) {
            var summary = group.querySelector(":scope > summary");
            return names.indexOf(String(summary && summary.textContent || "").trim().toLowerCase()) >= 0;
        });
    }

    function csrf() { var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state; return String(runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || ""); }
    function parse(response) {
        return response.text().then(function (body) {
            var value;
            try { value = JSON.parse(body || "{}"); } catch (error) { throw new Error(body || ("HTTP " + response.status)); }
            if (!response.ok || value.ok === false) throw new Error(String(value.error && value.error.message || value.error || ("HTTP " + response.status)));
            return value.value || value.snapshot || value;
        });
    }
    function loadSnapshot() { return fetch("/api/admin/settings", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }).then(parse); }
    function saveSnapshot(value) {
        var payload = { modules: {}, moduleOptions: clone(value.moduleSettings || {}), integrations: clone(value.integrations && value.integrations.values || {}), secrets: {} };
        (value.modules || []).forEach(function (module) { payload.modules[module.key] = module.enabled === true; });
        payload.portal = clone(payload.moduleOptions.portal || {});
        var body = new URLSearchParams(); body.set("payload", JSON.stringify(payload));
        return fetch("/api/admin/settings", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-SIRK-CSRF": csrf() }, body: body.toString() }).then(parse);
    }

    function field(host, label, value, update) {
        var row = el("label", "sirk-card"); row.appendChild(el("strong", "", label));
        var input;
        if (typeof value === "boolean") { input = el("input"); input.type = "checkbox"; input.checked = value; input.onchange = function () { update(input.checked); }; }
        else { input = el("input"); input.type = typeof value === "number" ? "number" : "text"; input.value = Array.isArray(value) ? value.join(", ") : (value == null ? "" : value); input.oninput = function () { if (Array.isArray(value)) update(input.value.split(",").map(function (item) { return item.trim(); }).filter(Boolean)); else update(input.type === "number" ? Number(input.value) : input.value); }; }
        row.appendChild(input); host.appendChild(row);
    }
    function editor(host, object, depth) {
        Object.keys(object || {}).sort().forEach(function (key) {
            var value = object[key]; var label = key.replace(/([A-Z])/g, " $1").replace(/^./, function (c) { return c.toUpperCase(); });
            if (value && typeof value === "object" && !Array.isArray(value)) { var details = el("details", "sirk-card"); details.open = depth === 0; details.appendChild(el("summary", "", label)); var body = el("div", "sirk-settings-stable-form"); editor(body, value, depth + 1); details.appendChild(body); host.appendChild(details); }
            else field(host, label, value, function (next) { object[key] = next; });
        });
    }

    function defaults(section) {
        if (section === "banner") return { enabled: false, showInPortal: true, showOnLogin: false, activeTemplate: "info", templates: { info: { name: "Informacja", text: "System został zaktualizowany.", backgroundColor: "#198754", textColor: "#ffffff", fontSize: 16, durationMinutes: 0 }, warning: { name: "Ostrzeżenie", text: "W systemie występują drobne problemy.", backgroundColor: "#ffc107", textColor: "#111827", fontSize: 16, durationMinutes: 0 }, critical: { name: "Awaria", text: "Część systemu jest niedostępna.", backgroundColor: "#dc3545", textColor: "#ffffff", fontSize: 16, durationMinutes: 0 } } };
        if (section === "maintenance") return { enabled: false, title: "Przerwa serwisowa", message: "System jest chwilowo niedostępny.", backgroundColor: "#111827", textColor: "#ffffff", plannedEnd: "", allowedIps: ["127.0.0.1"], blockNative: false, showNoticeToAllowedIps: true };
        if (section === "release") return { enabled: true, showAfterUpdate: true, title: "Co nowego", maxCommits: 12 };
        if (section === "animations") return { enabled: false, showInPortal: true, showOnLogin: false, respectReducedMotion: true, items: { snow: { enabled: false, name: "Padający śnieg", type: "falling", symbol: "❄", colors: ["#ffffff", "#dbeafe"], intensity: 30, speed: 1, size: 18, opacity: 0.9, layer: "foreground" }, confetti: { enabled: false, name: "Confetti", type: "confetti", symbol: "■", colors: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"], intensity: 40, speed: 1, size: 12, opacity: 0.9, layer: "foreground" }, walker: { enabled: false, name: "Postać przechodząca przez stronę", type: "walker", symbol: "🚶", colors: ["#ffffff"], intensity: 1, speed: 1, size: 36, opacity: 1, layer: "foreground" }, christmas: { enabled: false, name: "Motyw świąteczny", type: "floating", symbol: "🎄,⭐,🎁", colors: ["#16a34a", "#dc2626", "#facc15"], intensity: 18, speed: 1, size: 24, opacity: 0.95, layer: "foreground" } } };
        return {};
    }

    function customForm(layout, section, title) {
        var details = layout.querySelector(":scope > .sirk-column-details"); if (!details) return;
        clear(details); details.appendChild(el("div", "sirk-card", t("Ładowanie…", "Loading…")));
        loadSnapshot().then(function (snapshot) {
            clear(details); snapshot.moduleSettings = snapshot.moduleSettings || {}; snapshot.moduleSettings.portal = snapshot.moduleSettings.portal || {};
            if (!snapshot.moduleSettings.portal[section] || typeof snapshot.moduleSettings.portal[section] !== "object") snapshot.moduleSettings.portal[section] = defaults(section);
            var current = snapshot.moduleSettings.portal[section]; details.appendChild(el("h2", "", title)); var form = el("div", "sirk-settings-stable-form"); editor(form, current, 0); details.appendChild(form);
            var actions = el("div", "sirk-settings-stable-actions"); var save = el("button", "sirk-button", t("Zapisz", "Save")); var status = el("span", "sirk-settings-stable-status"); save.type = "button";
            save.onclick = function () { save.disabled = true; status.textContent = t("Zapisywanie…", "Saving…"); status.removeAttribute("data-error"); saveSnapshot(snapshot).then(function () { status.textContent = t("Zapisano.", "Saved."); save.disabled = false; if (section === "animations" && window.SirkPortalAnimations) window.SirkPortalAnimations.render(current); }).catch(function (error) { status.textContent = error.message; status.setAttribute("data-error", "1"); save.disabled = false; }); };
            actions.appendChild(save); actions.appendChild(status); details.appendChild(actions);
        }).catch(function (error) { clear(details); details.appendChild(el("div", "sirk-card", error.message)); });
    }

    function addPortalEntries(layout, portal) {
        var body = portal && portal.querySelector(":scope > .sirk-settings-nav-group-body"); if (!body || body.querySelector("[data-sirk-stable-extra]")) return;
        [["banner", "Baner", "Banner"], ["maintenance", "Zaślepka serwisowa", "Maintenance page"], ["release", "Release / Co nowego", "Release / What's new"], ["animations", "Animacje", "Animations"]].forEach(function (entry) {
            var button = el("button", "sirk-nav-item sirk-settings-nav-leaf", t(entry[1], entry[2])); button.type = "button"; button.setAttribute("data-sirk-stable-extra", entry[0]);
            button.onclick = function () { Array.prototype.forEach.call(body.querySelectorAll(".active,.is-active"), function (node) { node.classList.remove("active", "is-active"); }); button.classList.add("active"); customForm(layout, entry[0], t(entry[1], entry[2])); };
            body.appendChild(button);
        });
    }

    function showGroup(layout, kind) {
        var secondary = layout.querySelector(":scope > .sirk-column-secondary"); if (!secondary) return false;
        var modules = findGroup(secondary, ["moduły", "modules"]); var portal = findGroup(secondary, ["portal"]); if (!modules || !portal) return false;
        [modules, portal].forEach(function (group) { group.classList.add("sirk-settings-native-hidden"); group.classList.remove("sirk-settings-stable-root"); });
        var target = kind === "portal" ? portal : modules; target.classList.remove("sirk-settings-native-hidden"); target.classList.add("sirk-settings-stable-root"); target.open = true; if (kind === "portal") addPortalEntries(layout, portal); return true;
    }

    function updateActive(primary) { var promoted = primary.querySelector(".sirk-settings-stable-primary"); if (!promoted) return; Array.prototype.forEach.call(promoted.querySelectorAll("[data-settings-primary]"), function (button) { button.classList.toggle("active", button.getAttribute("data-settings-primary") === activePrimary); }); }

    function navigate(kind) {
        if (!mountedHost || navigationBusy) return; navigationBusy = true; activePrimary = kind;
        var layout = mountedHost.querySelector("[data-portal-settings] .sirk-layout"); var primary = layout && layout.querySelector(":scope > .sirk-column-primary"); if (!layout || !primary) { navigationBusy = false; return; }
        var native = nativeButtons(primary); updateActive(primary); var target = kind === "identity" ? native.identity : kind === "server" ? native.server : native.settings; if (target) target.click();
        if (kind === "modules" || kind === "portal") waitFor(function () { var currentLayout = mountedHost.querySelector("[data-portal-settings] .sirk-layout"); return currentLayout && showGroup(currentLayout, kind) ? currentLayout : null; }).then(function () { navigationBusy = false; });
        else setTimeout(function () { navigationBusy = false; reconcile(); }, 50);
    }

    function addPrimary(primary) {
        var promoted = primary.querySelector(".sirk-settings-stable-primary"); if (promoted) return promoted;
        promoted = el("div", "sirk-settings-stable-primary");
        [["modules", "Moduły", "Modules"], ["portal", "Portal", "Portal"], ["identity", "Użytkownicy i grupy", "Users and groups"], ["server", "Serwer", "Server"]].forEach(function (entry) { var button = el("button", "sirk-nav-item", t(entry[1], entry[2])); button.type = "button"; button.setAttribute("data-settings-primary", entry[0]); button.onclick = function () { navigate(entry[0]); }; promoted.appendChild(button); });
        primary.insertBefore(promoted, primary.firstChild); return promoted;
    }

    function reconcile() {
        if (!mountedHost || navigationBusy) return;
        var layout = mountedHost.querySelector("[data-portal-settings] .sirk-layout"); var primary = layout && layout.querySelector(":scope > .sirk-column-primary"); if (!layout || !primary) return;
        nativeButtons(primary); addPrimary(primary); updateActive(primary); if (activePrimary === "modules" || activePrimary === "portal") showGroup(layout, activePrimary);
    }

    function mount(host) {
        mountedHost = host; reconcile();
        var observer = new MutationObserver(function (records) { var structural = records.some(function (record) { return record.type === "childList" && (record.addedNodes.length || record.removedNodes.length); }); if (!structural || navigationBusy) return; clearTimeout(remountTimer); remountTimer = setTimeout(reconcile, 40); });
        observer.observe(host, { childList: true, subtree: true }); setTimeout(function () { navigate(activePrimary); }, 0);
    }

    function install() {
        if (!window.SirkPortalSettings || typeof window.SirkPortalSettings.mount !== "function") return false;
        if (window.SirkPortalSettings.mount.__sirkStableWrapped) return true;
        var original = window.SirkPortalSettings.mount; var wrapped = function (host) { original(host); mount(host); }; wrapped.__sirkStableWrapped = true; window.SirkPortalSettings.mount = wrapped; return true;
    }

    injectStyle();
    var timer = setInterval(function () { if (install()) clearInterval(timer); }, 50);
}());
