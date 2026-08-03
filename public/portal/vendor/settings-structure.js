(function () {
    "use strict";

    if (window.__sirkSettingsStructureLoadedV2) return;
    window.__sirkSettingsStructureLoadedV2 = true;

    var activeRoot = "modules";
    var mountedHost = null;
    var hostObserver = null;
    var scheduled = false;
    var navigationPending = false;

    var ROOTS = [
        ["modules", "Moduły", "Modules"],
        ["portal", "Portal", "Portal"],
        ["integrations", "Integracje", "Integrations"],
        ["identity", "Użytkownicy i grupy", "Users and groups"],
        ["server", "Serwer", "Server"]
    ];
    var INTEGRATIONS = [
        ["ad", "AD"], ["defender", "Defender"], ["entra", "Entra"],
        ["jira", "Jira"], ["zabbix", "Zabbix"], ["sms", "SMS"]
    ];

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }
    function t(pl, en) { return language() === "en" ? en : pl; }
    function normalized(value) {
        return String(value || "").replace(/^\s*[▸▼]?\s*/, "").trim().toLowerCase();
    }
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }
    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
    function clone(value) { return JSON.parse(JSON.stringify(value == null ? {} : value)); }
    function active(node) { return !!(node && (node.classList.contains("active") || node.classList.contains("is-active"))); }

    function injectStyle() {
        if (document.getElementById("sirk-settings-structure-v2-style")) return;
        var style = document.createElement("style");
        style.id = "sirk-settings-structure-v2-style";
        style.textContent = [
            ".sirk-settings-root-menu{display:grid;gap:6px;width:100%}",
            ".sirk-settings-root-menu>.sirk-settings-root-button{display:flex!important;align-items:center;width:100%!important;min-height:42px!important;padding:10px 14px!important;box-sizing:border-box!important;text-align:left!important;cursor:pointer!important;pointer-events:auto!important;border-radius:7px!important}",
            ".sirk-settings-root-button.sirk-settings-root-active{background:var(--sirk-active-bg,rgba(77,107,216,.14))!important;color:var(--sirk-text,#172033)!important;font-weight:700!important;box-shadow:inset 3px 0 0 var(--sirk-active-accent,#4d6bd8)!important}",
            ".sirk-settings-native-primary{display:none!important}",
            ".sirk-settings-primary-projected>summary{display:none!important}",
            ".sirk-settings-primary-projected>.sirk-settings-nav-group-body{display:block!important;padding:0!important}",
            ".sirk-settings-primary-projected{margin:0!important;padding:0!important;border:0!important;background:transparent!important}",
            ".sirk-settings-custom-form{display:grid;gap:10px}",
            ".sirk-settings-custom-actions{display:flex;align-items:center;gap:10px;margin-top:12px}",
            ".sirk-settings-custom-status[data-error='1']{color:#dc3545}",
            ".sirk-settings-custom-form>.sirk-card{margin:0}",
            ".sirk-settings-custom-form label.sirk-card{display:grid;grid-template-columns:minmax(180px,280px) minmax(220px,1fr);align-items:center;gap:14px}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function layout() {
        return mountedHost && mountedHost.querySelector("[data-portal-settings] .sirk-layout-host");
    }
    function directPrimaryButtons(primary) {
        return primary ? Array.prototype.slice.call(primary.querySelectorAll(":scope > .sirk-nav-item")) : [];
    }
    function nativeButtons(primary) {
        var result = { settings: null, identity: null, server: null };
        directPrimaryButtons(primary).forEach(function (button) {
            var name = normalized(button.textContent);
            if (name === "ustawienia" || name === "settings") result.settings = button;
            else if (name.indexOf("użytkownicy") >= 0 || name.indexOf("users") >= 0) result.identity = button;
            else if (name === "system" || name === "server" || name === "serwer") result.server = button;
            button.classList.add("sirk-settings-native-primary");
            button.setAttribute("aria-hidden", "true");
            button.setAttribute("tabindex", "-1");
        });
        return result;
    }

    function findGroup(secondary, keys) {
        return Array.prototype.find.call(secondary.querySelectorAll(":scope > details.sirk-settings-nav-group"), function (group) {
            var summary = group.querySelector(":scope > summary");
            return keys.indexOf(normalized(summary && summary.textContent)) >= 0;
        }) || null;
    }

    function parse(response) {
        return response.text().then(function (body) {
            var value;
            try { value = JSON.parse(body || "{}"); }
            catch (error) { throw new Error(body || ("HTTP " + response.status)); }
            if (!response.ok || value.ok === false) {
                var message = value && value.error;
                if (message && typeof message === "object") message = message.message;
                throw new Error(String(message || ("HTTP " + response.status)));
            }
            return value.value || value.snapshot || value;
        });
    }
    function csrf() {
        var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
        return String(runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "");
    }
    function loadSnapshot() {
        return fetch("/api/admin/settings", {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json", "Cache-Control": "no-store" }
        }).then(parse);
    }
    function saveSnapshot(snapshot) {
        var payload = {
            modules: {},
            moduleOptions: clone(snapshot.moduleSettings || {}),
            integrations: clone(snapshot.integrations && snapshot.integrations.values || {}),
            secrets: {}
        };
        (snapshot.modules || []).forEach(function (module) {
            payload.modules[module.key] = module.enabled === true;
        });
        payload.portal = clone(payload.moduleOptions.portal || {});
        var body = new URLSearchParams();
        body.set("payload", JSON.stringify(payload));
        return fetch("/api/admin/settings", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-SIRK-CSRF": csrf()
            },
            body: body.toString()
        }).then(parse);
    }

    function mergeDefaults(value, fallback) {
        value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
        Object.keys(fallback || {}).forEach(function (key) {
            var expected = fallback[key];
            if (value[key] == null) value[key] = clone(expected);
            else if (expected && typeof expected === "object" && !Array.isArray(expected) &&
                    value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) {
                mergeDefaults(value[key], expected);
            }
        });
        return value;
    }

    function portalDefaults(section) {
        if (section === "banner") return {
            enabled: false,
            showOnPortal: true,
            showOnLogin: false,
            activeTemplate: "success",
            templates: {
                success: { name: "Aktualizacja", text: "System został pomyślnie zaktualizowany.", backgroundColor: "#dcfce7", textColor: "#166534", fontSize: 16, durationMinutes: 60, noEnd: false },
                warning: { name: "Ostrzeżenie", text: "W systemie występują drobne problemy.", backgroundColor: "#fef3c7", textColor: "#92400e", fontSize: 16, durationMinutes: 60, noEnd: false },
                critical: { name: "Awaria", text: "Część funkcji systemu jest niedostępna.", backgroundColor: "#fee2e2", textColor: "#991b1b", fontSize: 16, durationMinutes: 60, noEnd: true }
            }
        };
        if (section === "maintenance") return {
            enabled: false,
            title: "Przerwa serwisowa",
            text: "System jest chwilowo niedostępny z powodu zaplanowanych prac serwisowych.",
            backgroundColor: "#0f172a",
            textColor: "#ffffff",
            estimatedEnd: "",
            allowedIps: ["127.0.0.1", "::1"],
            showNoticeToAllowed: true,
            blockNative: true
        };
        if (section === "release") return {
            enabled: false,
            showAfterUpdate: true,
            title: "Co nowego",
            maxCommits: 12
        };
        if (section === "animations") return {
            enabled: false,
            showOnPortal: true,
            showOnLogin: false,
            respectReducedMotion: true,
            effects: [
                { id: "snow", builtIn: true, name: "Padający śnieg", type: "snow", enabled: false, symbol: "❄", colors: ["#ffffff", "#dbeafe", "#bfdbfe"], intensity: 45, speed: 1, size: 18, opacity: 0.9, durationSeconds: 0, startAt: "", endAt: "", layer: "foreground" },
                { id: "confetti", builtIn: true, name: "Confetti", type: "confetti", enabled: false, symbol: "", colors: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"], intensity: 70, speed: 1.2, size: 12, opacity: 0.95, durationSeconds: 15, startAt: "", endAt: "", layer: "foreground" },
                { id: "walker", builtIn: true, name: "Postać przechodząca przez stronę", type: "walker", enabled: false, symbol: "🚶", colors: ["#2563eb"], intensity: 1, speed: 0.8, size: 44, opacity: 1, durationSeconds: 0, startAt: "", endAt: "", layer: "foreground" },
                { id: "christmas", builtIn: true, name: "Motyw świąteczny", type: "christmas", enabled: false, symbol: "❄ 🎄 ⭐ 🎁", colors: ["#ffffff", "#dc2626", "#16a34a", "#facc15"], intensity: 36, speed: 0.85, size: 22, opacity: 0.92, durationSeconds: 0, startAt: "", endAt: "", layer: "foreground" }
            ]
        };
        return {};
    }

    function field(host, label, value, update) {
        var row = el("label", "sirk-card");
        row.appendChild(el("strong", "", label));
        var input;
        if (typeof value === "boolean") {
            input = el("input");
            input.type = "checkbox";
            input.checked = value;
            input.onchange = function () { update(input.checked); };
        } else if (Array.isArray(value)) {
            input = el("textarea");
            input.rows = 3;
            input.value = value.join(", ");
            input.oninput = function () {
                update(input.value.split(/[,;\n]+/).map(function (item) { return item.trim(); }).filter(Boolean));
            };
        } else {
            input = el("input");
            input.type = typeof value === "number" ? "number" : "text";
            input.value = value == null ? "" : value;
            input.oninput = function () { update(input.type === "number" ? Number(input.value) : input.value); };
        }
        row.appendChild(input);
        host.appendChild(row);
    }

    function objectEditor(host, object, depth) {
        object = object && typeof object === "object" && !Array.isArray(object) ? object : {};
        Object.keys(object).sort().forEach(function (key) {
            var value = object[key];
            var title = key.replace(/([A-Z])/g, " $1").replace(/^./, function (character) { return character.toUpperCase(); });
            if (value && typeof value === "object" && !Array.isArray(value)) {
                var section = el("details", "sirk-card");
                section.open = depth === 0;
                section.appendChild(el("summary", "", title));
                var body = el("div", "sirk-settings-custom-form");
                objectEditor(body, value, depth + 1);
                section.appendChild(body);
                host.appendChild(section);
            } else if (Array.isArray(value) && value.some(function (item) { return item && typeof item === "object"; })) {
                var listSection = el("details", "sirk-card");
                listSection.open = depth === 0;
                listSection.appendChild(el("summary", "", title));
                var listBody = el("div", "sirk-settings-custom-form");
                value.forEach(function (item, index) {
                    var itemSection = el("details", "sirk-card");
                    itemSection.open = item && item.enabled === true;
                    itemSection.appendChild(el("summary", "", String(item && (item.name || item.id) || (title + " " + (index + 1)))));
                    var itemBody = el("div", "sirk-settings-custom-form");
                    objectEditor(itemBody, item, depth + 1);
                    itemSection.appendChild(itemBody);
                    listBody.appendChild(itemSection);
                });
                listSection.appendChild(listBody);
                host.appendChild(listSection);
            } else {
                field(host, title, value, function (next) { object[key] = next; });
            }
        });
    }

    function renderCustomForm(section, title, integrationKey) {
        var currentLayout = layout();
        var details = currentLayout && currentLayout.querySelector(":scope > .sirk-column-details");
        if (!details) return;
        clear(details);
        details.appendChild(el("div", "sirk-card", t("Ładowanie…", "Loading…")));
        loadSnapshot().then(function (snapshot) {
            clear(details);
            snapshot.moduleSettings = snapshot.moduleSettings || {};
            snapshot.moduleSettings.portal = snapshot.moduleSettings.portal || {};
            snapshot.integrations = snapshot.integrations || {};
            snapshot.integrations.values = snapshot.integrations.values || {};
            var current;
            if (integrationKey) {
                current = snapshot.integrations.values[integrationKey] = snapshot.integrations.values[integrationKey] || {};
            } else {
                current = snapshot.moduleSettings.portal[section] = mergeDefaults(snapshot.moduleSettings.portal[section], portalDefaults(section));
            }
            details.appendChild(el("h2", "", title));
            var form = el("div", "sirk-settings-custom-form");
            objectEditor(form, current, 0);
            details.appendChild(form);
            var actions = el("div", "sirk-settings-custom-actions");
            if (section === "animations") {
                var preview = el("button", "sirk-button", t("Podgląd animacji", "Preview animations"));
                preview.type = "button";
                preview.onclick = function () {
                    if (window.SirkPortalAnimations && typeof window.SirkPortalAnimations.preview === "function") {
                        window.SirkPortalAnimations.preview(current);
                    }
                };
                actions.appendChild(preview);
            }
            var save = el("button", "sirk-button", t("Zapisz", "Save"));
            var status = el("span", "sirk-settings-custom-status");
            save.type = "button";
            save.onclick = function () {
                save.disabled = true;
                status.textContent = t("Zapisywanie…", "Saving…");
                status.removeAttribute("data-error");
                if (section === "banner" && current.enabled === true) current.startedAt = new Date().toISOString();
                saveSnapshot(snapshot).then(function () {
                    status.textContent = t("Zapisano.", "Saved.");
                    save.disabled = false;
                    if (section === "animations" && window.SirkPortalAnimations) window.SirkPortalAnimations.render(current);
                }).catch(function (error) {
                    status.textContent = error.message;
                    status.setAttribute("data-error", "1");
                    save.disabled = false;
                });
            };
            actions.appendChild(save);
            actions.appendChild(status);
            details.appendChild(actions);
        }).catch(function (error) {
            clear(details);
            details.appendChild(el("div", "sirk-card", error.message));
        });
    }

    function customLeaf(body, label, marker, handler) {
        var existing = body.querySelector(':scope > [data-sirk-settings-extra="' + marker + '"]');
        if (existing) return existing;
        var button = el("button", "sirk-nav-item sirk-settings-nav-leaf", label);
        button.type = "button";
        button.setAttribute("data-sirk-settings-extra", marker);
        button.onclick = function (event) {
            event.preventDefault();
            event.stopPropagation();
            Array.prototype.forEach.call(body.querySelectorAll(".active,.is-active"), function (node) {
                node.classList.remove("active", "is-active");
            });
            button.classList.add("active");
            handler();
        };
        body.appendChild(button);
        return button;
    }

    function ensurePortalEntries(secondary) {
        var portal = findGroup(secondary, ["portal"]);
        var body = portal && portal.querySelector(":scope > .sirk-settings-nav-group-body");
        if (!body) return portal;
        customLeaf(body, t("Baner", "Banner"), "portal-banner", function () {
            renderCustomForm("banner", t("Baner", "Banner"));
        });
        customLeaf(body, t("Zaślepka serwisowa", "Maintenance page"), "portal-maintenance", function () {
            renderCustomForm("maintenance", t("Zaślepka serwisowa", "Maintenance page"));
        });
        customLeaf(body, t("Release / Co nowego", "Release / What's new"), "portal-release", function () {
            renderCustomForm("release", t("Release / Co nowego", "Release / What's new"));
        });
        customLeaf(body, t("Animacje", "Animations"), "portal-animations", function () {
            renderCustomForm("animations", t("Animacje", "Animations"));
        });
        return portal;
    }

    function ensureIntegrations(secondary) {
        var integrations = findGroup(secondary, ["integracje", "integrations"]);
        if (!integrations) {
            integrations = el("details", "sirk-settings-nav-group");
            integrations.setAttribute("data-source-settings-group", "integrations");
            integrations.appendChild(el("summary", "", t("Integracje", "Integrations")));
            integrations.appendChild(el("div", "sirk-settings-nav-group-body"));
            secondary.appendChild(integrations);
        }
        var body = integrations.querySelector(":scope > .sirk-settings-nav-group-body");
        INTEGRATIONS.forEach(function (item) {
            customLeaf(body, item[1], "integration-" + item[0], function () {
                renderCustomForm("integration", item[1], item[0]);
            });
        });
        return integrations;
    }

    function ensureRootMenu(primary) {
        var menu = primary.querySelector(":scope > [data-settings-root-menu]");
        if (!menu) {
            menu = el("div", "sirk-settings-root-menu");
            menu.setAttribute("data-settings-root-menu", "1");
            primary.insertBefore(menu, primary.firstChild);
        }
        ROOTS.forEach(function (item) {
            var button = menu.querySelector(':scope > [data-settings-root="' + item[0] + '"]');
            if (!button) {
                button = el("button", "sirk-nav-item sirk-settings-root-button", t(item[1], item[2]));
                button.type = "button";
                button.setAttribute("data-settings-root", item[0]);
                button.onclick = function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    navigate(item[0]);
                };
                menu.appendChild(button);
            } else {
                button.textContent = t(item[1], item[2]);
            }
        });
        return menu;
    }

    function updateRootState(primary) {
        var menu = primary.querySelector(":scope > [data-settings-root-menu]");
        if (!menu) return;
        Array.prototype.forEach.call(menu.querySelectorAll("[data-settings-root]"), function (button) {
            var selected = button.getAttribute("data-settings-root") === activeRoot;
            button.classList.toggle("sirk-settings-root-active", selected);
            button.setAttribute("aria-current", selected ? "page" : "false");
        });
    }

    function projectSettings(currentLayout, rootKey) {
        var secondary = currentLayout.querySelector(":scope > .sirk-column-secondary");
        if (!secondary) return;
        var modules = findGroup(secondary, ["moduły", "modules"]);
        var portal = ensurePortalEntries(secondary);
        var integrations = ensureIntegrations(secondary);
        var groups = [
            { key: "modules", node: modules },
            { key: "portal", node: portal },
            { key: "integrations", node: integrations }
        ];
        groups.forEach(function (entry) {
            if (!entry.node) return;
            var selected = entry.key === rootKey;
            entry.node.hidden = !selected;
            entry.node.classList.toggle("sirk-settings-primary-projected", selected);
            if (selected) entry.node.open = true;
        });
        secondary.setAttribute("data-settings-primary-section", rootKey);
        var target = groups.find(function (entry) { return entry.key === rootKey; });
        var selectedLeaf = target && target.node && target.node.querySelector(".sirk-nav-item.active,.sirk-nav-item.is-active");
        if (!selectedLeaf && target && target.node) {
            var first = target.node.querySelector(".sirk-settings-nav-leaf,.sirk-nav-item");
            if (first && !first.hasAttribute("data-settings-opening")) {
                first.setAttribute("data-settings-opening", "1");
                window.setTimeout(function () {
                    first.removeAttribute("data-settings-opening");
                    if (first.isConnected) first.click();
                }, 0);
            }
        }
    }

    function reconcile() {
        scheduled = false;
        var currentLayout = layout();
        if (!currentLayout) return;
        var primary = currentLayout.querySelector(":scope > .sirk-column-primary");
        if (!primary) return;
        var native = nativeButtons(primary);
        ensureRootMenu(primary);
        updateRootState(primary);
        if (["modules", "portal", "integrations"].indexOf(activeRoot) >= 0 && active(native.settings)) {
            projectSettings(currentLayout, activeRoot);
        }
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(reconcile);
    }

    function navigate(rootKey) {
        if (!mountedHost || navigationPending) return;
        activeRoot = rootKey;
        var currentLayout = layout();
        var primary = currentLayout && currentLayout.querySelector(":scope > .sirk-column-primary");
        if (!primary) return;
        var native = nativeButtons(primary);
        var target = rootKey === "identity" ? native.identity : rootKey === "server" ? native.server : native.settings;
        updateRootState(primary);
        navigationPending = true;
        if (target && !active(target)) target.click();
        window.setTimeout(function () { navigationPending = false; reconcile(); }, 0);
        window.setTimeout(reconcile, 60);
        window.setTimeout(reconcile, 180);
    }

    function mount(host) {
        mountedHost = host;
        if (hostObserver) hostObserver.disconnect();
        hostObserver = new MutationObserver(function (records) {
            var structural = records.some(function (record) {
                return record.type === "childList" && (record.addedNodes.length || record.removedNodes.length);
            });
            if (structural && !navigationPending) schedule();
        });
        hostObserver.observe(host, { childList: true, subtree: true });
        schedule();
        window.setTimeout(function () { navigate(activeRoot); }, 0);
    }

    function install() {
        if (!window.SirkPortalSettings || typeof window.SirkPortalSettings.mount !== "function") return false;
        if (window.SirkPortalSettings.mount.__sirkSettingsV2Wrapped) return true;
        var original = window.SirkPortalSettings.mount;
        var wrapped = function (host) {
            original(host);
            mount(host);
        };
        wrapped.__sirkSettingsV2Wrapped = true;
        window.SirkPortalSettings.mount = wrapped;
        return true;
    }

    injectStyle();
    window.addEventListener("sirkportal:languagechange", schedule);
    var timer = window.setInterval(function () {
        if (install()) window.clearInterval(timer);
    }, 50);
}());
