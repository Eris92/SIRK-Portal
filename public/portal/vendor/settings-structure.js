(function () {
    "use strict";

    if (window.__sirkSettingsStructureLoaded) return;
    window.__sirkSettingsStructureLoaded = true;

    var activePrimary = "modules";
    var settingsHost = null;
    var hiddenGeneral = {
        enabled: true,
        accessgroupids: true,
        folderpermissions: true,
        providers: true,
        showinmenu: true,
        showondevice: true,
        hostbuttonenabled: true,
        menuenabled: true
    };

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

    function normalize(value) {
        return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    }

    function waitFor(condition, callback, attempts) {
        attempts = attempts || 0;
        var value = condition();
        if (value) { callback(value); return; }
        if (attempts > 100) return;
        setTimeout(function () { waitFor(condition, callback, attempts + 1); }, 30);
    }

    function injectStyle() {
        if (document.getElementById("sirk-settings-structure-style")) return;
        var style = document.createElement("style");
        style.id = "sirk-settings-structure-style";
        style.textContent = [
            ".sirk-settings-primary{display:grid;gap:6px;width:100%}",
            ".sirk-settings-primary>.sirk-nav-item{width:100%;min-height:42px;padding:10px 12px;text-align:left}",
            ".sirk-settings-primary>.sirk-nav-item.active{background:var(--sirk-active-bg,#e7eefc);border-color:var(--sirk-accent,#4d6bd8)}",
            ".sirk-settings-hidden{display:none!important}",
            ".sirk-settings-root-group>summary{display:none!important}",
            ".sirk-settings-root-group>.sirk-settings-nav-group-body{display:block!important;padding:0!important}",
            ".sirk-settings-note{margin:0 0 12px;padding:12px 14px;border:1px solid var(--sirk-border,#d7dee8);border-radius:10px;background:var(--sirk-surface,#fff)}",
            ".sirk-settings-custom-form{display:grid;gap:10px}",
            ".sirk-settings-custom-form .sirk-card{margin:0}",
            ".sirk-settings-custom-actions{display:flex;align-items:center;gap:10px;margin-top:12px}",
            ".sirk-settings-custom-status[data-error='1']{color:#b42318}",
            ".sirk-settings-custom-status[data-error='0']{color:var(--sirk-muted,#64748b)}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function csrf() {
        var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
        return String(runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "");
    }

    function parseResponse(response) {
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

    function loadSnapshot() {
        return fetch("/api/admin/settings", {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json", "Cache-Control": "no-store" }
        }).then(parseResponse);
    }

    function saveSnapshot(value) {
        var payload = {
            modules: {},
            moduleOptions: clone(value.moduleSettings || {}),
            integrations: clone(value.integrations && value.integrations.values || {}),
            secrets: {}
        };
        (value.modules || []).forEach(function (module) {
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
        }).then(parseResponse);
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
            input = el("input");
            input.type = "checkbox";
            input.checked = value === true;
            input.onchange = function () { change(input.checked); };
        } else if (options.choices) {
            input = el("select");
            options.choices.forEach(function (choice) {
                var option = el("option", "", choice[1]);
                option.value = choice[0];
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
        wrapper.appendChild(input);
        host.appendChild(wrapper);
        return input;
    }

    function objectEditor(host, object, depth) {
        object = object && typeof object === "object" && !Array.isArray(object) ? object : {};
        Object.keys(object).sort().forEach(function (key) {
            var value = object[key];
            var label = key.replace(/([A-Z])/g, " $1").replace(/^./, function (character) { return character.toUpperCase(); });
            if (value && typeof value === "object" && !Array.isArray(value)) {
                var details = el("details", "sirk-card");
                details.open = depth === 0;
                details.appendChild(el("summary", "", label));
                var body = el("div", "sirk-settings-custom-form");
                objectEditor(body, value, depth + 1);
                details.appendChild(body);
                host.appendChild(details);
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
            enabled: false,
            showInPortal: true,
            showOnLogin: false,
            activeTemplate: "info",
            templates: {
                info: { name: "Informacja", text: "System został zaktualizowany.", backgroundColor: "#198754", textColor: "#ffffff", fontSize: 16, durationMinutes: 0 },
                warning: { name: "Ostrzeżenie", text: "W systemie występują drobne problemy.", backgroundColor: "#ffc107", textColor: "#111827", fontSize: 16, durationMinutes: 0 },
                critical: { name: "Awaria", text: "Część systemu jest niedostępna.", backgroundColor: "#dc3545", textColor: "#ffffff", fontSize: 16, durationMinutes: 0 }
            }
        };
        if (section === "maintenance") return {
            enabled: false,
            title: "Przerwa serwisowa",
            message: "System jest chwilowo niedostępny.",
            backgroundColor: "#111827",
            textColor: "#ffffff",
            plannedEnd: "",
            allowedIps: ["127.0.0.1"],
            blockNative: false,
            showNoticeToAllowedIps: true
        };
        if (section === "release") return {
            enabled: true,
            showAfterUpdate: true,
            title: "Co nowego",
            maxCommits: 12
        };
        if (section === "animations") return {
            enabled: false,
            showInPortal: true,
            showOnLogin: false,
            respectReducedMotion: true,
            items: {
                snow: { enabled: false, name: "Padający śnieg", type: "falling", symbol: "❄", colors: ["#ffffff", "#dbeafe"], intensity: 30, speed: 1, size: 18, opacity: 0.9, layer: "foreground" },
                confetti: { enabled: false, name: "Confetti", type: "confetti", symbol: "■", colors: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"], intensity: 40, speed: 1, size: 12, opacity: 0.9, layer: "foreground" },
                walker: { enabled: false, name: "Postać przechodząca przez stronę", type: "walker", symbol: "🚶", colors: ["#ffffff"], intensity: 1, speed: 1, size: 36, opacity: 1, layer: "foreground" },
                christmas: { enabled: false, name: "Motyw świąteczny", type: "floating", symbol: "🎄,⭐,🎁", colors: ["#16a34a", "#dc2626", "#facc15"], intensity: 18, speed: 1, size: 24, opacity: 0.95, layer: "foreground" }
            }
        };
        return {};
    }

    function renderCustomForm(details, section, title) {
        clear(details);
        var loading = el("div", "sirk-card", text("Ładowanie…", "Loading…"));
        details.appendChild(loading);
        loadSnapshot().then(function (value) {
            clear(details);
            value.moduleSettings = value.moduleSettings || {};
            value.moduleSettings.portal = value.moduleSettings.portal || {};
            if (!value.moduleSettings.portal[section] || typeof value.moduleSettings.portal[section] !== "object") {
                value.moduleSettings.portal[section] = defaults(section);
            }
            var current = value.moduleSettings.portal[section];
            details.appendChild(el("h2", "", title));
            var form = el("div", "sirk-settings-custom-form");
            objectEditor(form, current, 0);
            details.appendChild(form);
            var actions = el("div", "sirk-settings-custom-actions");
            var save = el("button", "sirk-button", text("Zapisz", "Save"));
            var message = el("span", "sirk-settings-custom-status");
            save.type = "button";
            save.onclick = function () {
                save.disabled = true;
                message.textContent = text("Zapisywanie…", "Saving…");
                message.setAttribute("data-error", "0");
                saveSnapshot(value).then(function () {
                    message.textContent = text("Zapisano.", "Saved.");
                    save.disabled = false;
                    if (section === "animations" && window.SirkPortalAnimations) {
                        window.SirkPortalAnimations.render(current);
                    }
                }).catch(function (error) {
                    message.textContent = error.message;
                    message.setAttribute("data-error", "1");
                    save.disabled = false;
                });
            };
            actions.appendChild(save);
            actions.appendChild(message);
            details.appendChild(actions);
        }).catch(function (error) {
            loading.textContent = error.message;
            loading.setAttribute("data-error", "1");
        });
    }

    function originals(primary) {
        var result = {};
        Array.prototype.forEach.call(primary.querySelectorAll(":scope > .sirk-nav-item"), function (button) {
            if (button.closest(".sirk-settings-primary")) return;
            var label = String(button.textContent || "").trim().toLowerCase();
            if (label === "ustawienia" || label === "settings") result.settings = button;
            else if (label.indexOf("użytkownicy") >= 0 || label.indexOf("users") >= 0) result.identity = button;
            else if (label === "system" || label === "server") result.server = button;
            button.classList.add("sirk-settings-hidden");
        });
        return result;
    }

    function findGroup(secondary, names) {
        return Array.prototype.find.call(secondary.querySelectorAll(":scope > details.sirk-settings-nav-group"), function (group) {
            var summary = group.querySelector(":scope > summary");
            return names.indexOf(String(summary && summary.textContent || "").trim().toLowerCase()) >= 0;
        });
    }

    function ensurePortalEntries(layout, portal) {
        var body = portal && portal.querySelector(":scope > .sirk-settings-nav-group-body");
        if (!body || body.querySelector("[data-sirk-portal-extra]")) return;
        [
            ["banner", "Baner", "Banner"],
            ["maintenance", "Zaślepka serwisowa", "Maintenance page"],
            ["release", "Release / Co nowego", "Release / What's new"],
            ["animations", "Animacje", "Animations"]
        ].forEach(function (entry) {
            var button = el("button", "sirk-nav-item sirk-settings-nav-leaf", text(entry[1], entry[2]));
            button.type = "button";
            button.setAttribute("data-sirk-portal-extra", entry[0]);
            button.onclick = function () {
                Array.prototype.forEach.call(body.querySelectorAll(".active,.is-active"), function (node) {
                    node.classList.remove("active", "is-active");
                });
                button.classList.add("active");
                var details = layout.querySelector(":scope > .sirk-column-details");
                if (details) renderCustomForm(details, entry[0], text(entry[1], entry[2]));
            };
            body.appendChild(button);
        });
    }

    function showNativeGroup(layout, secondary, kind) {
        var modules = findGroup(secondary, ["moduły", "modules"]);
        var portal = findGroup(secondary, ["portal"]);
        [modules, portal].forEach(function (group) {
            if (!group) return;
            group.classList.add("sirk-settings-hidden");
            group.classList.remove("sirk-settings-root-group");
        });
        var target = kind === "portal" ? portal : modules;
        if (!target) return;
        target.classList.remove("sirk-settings-hidden");
        target.classList.add("sirk-settings-root-group");
        target.open = true;
        if (kind === "portal") ensurePortalEntries(layout, target);
    }

    function activeLeaf(secondary) {
        return secondary.querySelector(".sirk-settings-nav-leaf.active,.sirk-settings-nav-leaf.is-active,.sirk-nav-item.active,.sirk-nav-item.is-active");
    }

    function cleanDetails(layout) {
        var secondary = layout.querySelector(":scope > .sirk-column-secondary");
        var details = layout.querySelector(":scope > .sirk-column-details");
        if (!secondary || !details || activePrimary !== "modules") return;
        var leaf = activeLeaf(secondary);
        var label = String(leaf && leaf.textContent || "").trim().toLowerCase();
        var isGeneral = label === "ogólne" || label === "general";
        var isPermissions = label === "permissions" || label === "uprawnienia";

        Array.prototype.forEach.call(details.querySelectorAll("[data-settings-field]"), function (row) {
            row.classList.remove("sirk-settings-hidden");
            if (!isGeneral) return;
            var strong = row.querySelector("strong");
            if (hiddenGeneral[normalize(strong && strong.textContent)]) row.classList.add("sirk-settings-hidden");
        });

        var oldNote = details.querySelector("[data-settings-clean-note]");
        if (oldNote) oldNote.remove();
        if (isGeneral || isPermissions) {
            var note = el("div", "sirk-settings-note", isPermissions ?
                text("Uprawnienia dostępu do modułu. Ustawienia techniczne nie są wyświetlane w sekcji Ogólne.", "Module access permissions. Technical settings are not shown in General.") :
                text("Ustawienia działania i widoczności modułu. Uprawnienia znajdują się w osobnej sekcji.", "Module behavior and visibility. Permissions are configured separately."));
            note.setAttribute("data-settings-clean-note", "1");
            details.insertBefore(note, details.firstChild);
        }
    }

    function selectPrimary(host, kind) {
        activePrimary = kind;
        var layout = host.querySelector("[data-portal-settings] .sirk-layout");
        if (!layout) return;
        var primary = layout.querySelector(":scope > .sirk-column-primary");
        var secondary = layout.querySelector(":scope > .sirk-column-secondary");
        var original = originals(primary);
        var promoted = primary.querySelector(".sirk-settings-primary");
        if (promoted) promoted.querySelectorAll("[data-settings-primary]").forEach(function (button) {
            button.classList.toggle("active", button.getAttribute("data-settings-primary") === kind);
        });

        if (kind === "identity") {
            if (original.identity) original.identity.click();
            return;
        }
        if (kind === "server") {
            if (original.server) original.server.click();
            return;
        }
        if (original.settings) original.settings.click();
        waitFor(function () {
            var next = layout.querySelector(":scope > .sirk-column-secondary");
            return next && findGroup(next, ["moduły", "modules"]) ? next : null;
        }, function (next) {
            showNativeGroup(layout, next, kind);
            cleanDetails(layout);
        });
    }

    function primaryButton(host, key, pl, en) {
        var button = el("button", "sirk-nav-item" + (activePrimary === key ? " active" : ""), text(pl, en));
        button.type = "button";
        button.setAttribute("data-settings-primary", key);
        button.onclick = function () { selectPrimary(settingsHost, key); };
        host.appendChild(button);
    }

    function upgrade(host) {
        settingsHost = host;
        var layout = host.querySelector("[data-portal-settings] .sirk-layout");
        if (!layout) return;
        var primary = layout.querySelector(":scope > .sirk-column-primary");
        if (!primary) return;
        originals(primary);
        var promoted = primary.querySelector(".sirk-settings-primary");
        if (!promoted) {
            promoted = el("div", "sirk-settings-primary");
            primary.insertBefore(promoted, primary.firstChild);
            primaryButton(promoted, "modules", "Moduły", "Modules");
            primaryButton(promoted, "portal", "Portal", "Portal");
            primaryButton(promoted, "identity", "Użytkownicy i grupy", "Users and groups");
            primaryButton(promoted, "server", "Serwer", "Server");
        }
        selectPrimary(host, activePrimary);
        cleanDetails(layout);
    }

    function applyTheme(dark, doc) {
        doc = doc || document;
        var nodes = [doc.documentElement, doc.body, doc.getElementById("sirkStandaloneRoot"), doc.getElementById("sirkPortalRoot")];
        nodes.forEach(function (node) {
            if (!node) return;
            node.classList.toggle("sirk-theme-dark", dark);
            node.classList.toggle("sirk-theme-light", !dark);
        });
        doc.documentElement.style.colorScheme = dark ? "dark" : "light";
    }

    function synchronizeTheme() {
        var dark = false;
        try { dark = localStorage.getItem("sirkPortal.theme") === "dark"; } catch (error) {}
        applyTheme(dark, document);
        Array.prototype.forEach.call(document.querySelectorAll('iframe[src*="sirkWorkspaceChild=1"]'), function (frame) {
            try {
                applyTheme(dark, frame.contentDocument);
                frame.contentWindow.dispatchEvent(new CustomEvent("sirkportal:themechange", { detail: { dark: dark } }));
            } catch (error) {}
        });
    }

    function install() {
        if (!window.SirkPortalSettings || typeof window.SirkPortalSettings.mount !== "function") return false;
        if (window.SirkPortalSettings.mount.__sirkSettingsStructureWrapped) return true;
        var original = window.SirkPortalSettings.mount;
        var wrapped = function (host) {
            original(host);
            var scheduled = false;
            var observer = new MutationObserver(function () {
                if (scheduled) return;
                scheduled = true;
                requestAnimationFrame(function () {
                    scheduled = false;
                    upgrade(host);
                });
            });
            observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
            setTimeout(function () { upgrade(host); }, 0);
        };
        wrapped.__sirkSettingsStructureWrapped = true;
        window.SirkPortalSettings.mount = wrapped;
        return true;
    }

    injectStyle();
    synchronizeTheme();
    document.addEventListener("click", function (event) {
        if (event.target && event.target.closest && event.target.closest('[data-action="theme"]')) {
            setTimeout(synchronizeTheme, 0);
        }
    }, true);
    window.addEventListener("storage", function (event) {
        if (event.key === "sirkPortal.theme") synchronizeTheme();
    });
    window.addEventListener("sirkportal:themechange", synchronizeTheme);
    var timer = setInterval(function () { if (install()) clearInterval(timer); }, 50);
}());
