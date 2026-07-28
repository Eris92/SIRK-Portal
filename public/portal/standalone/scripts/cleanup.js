(function () {
    "use strict";

    if (window.__sirkPlatformPortalCleanupLoaded) return;
    window.__sirkPlatformPortalCleanupLoaded = true;

    var root = document.getElementById("sirkPortalRoot");
    if (!root) return;

    var permissionState = { snapshot: null, loading: null, saving: false };
    var approvalState = { settings: null, loading: null, saving: false };
    var PERMISSION_TARGETS = {
        "Urządzenia": { view: "devices" },
        "Commands": { module: "mycommands" },
        "Przenoszenie urządzeń": { module: "moverequests" },
        "Automatyzacja": { module: "myscripts", view: "automation" },
        "Monitoring": { view: "monitoring" },
        "Zasoby": { module: "myjira", view: "assets" },
        "Zarządzanie": { view: "management" },
        "Raporty": { view: "reports" },
        "Bezpieczeństwo": { module: "defendertools", view: "security" }
    };
    var APPROVAL_PROVIDERS = {
        "Commands": { type: "mycommands" },
        "Przenoszenie urządzeń": { type: "moverequests" },
        "Automatyzacja": { type: "myscripts" }
    };

    function core() { return window.SirkPlatformCore || null; }
    function clone(value) { return JSON.parse(JSON.stringify(value == null ? {} : value)); }

    function addPortalClasses(scope) {
        if (!scope || !scope.querySelectorAll) return;
        Array.prototype.forEach.call(scope.querySelectorAll(".sirk-standalone-view-scroll,.mc-admin-management-shell"), function (shell) {
            shell.classList.add("sirk-standalone-view-scroll");
        });
        Array.prototype.forEach.call(scope.querySelectorAll(".sirk-layout,.mc-admin-management-layout"), function (layout) {
            layout.classList.add("sirk-layout-host", "sirk-layout");
            if (layout.children[0]) layout.children[0].classList.add("sirk-column-primary");
            if (layout.children[1]) layout.children[1].classList.add("sirk-column-secondary");
            if (layout.children[2]) layout.children[2].classList.add("sirk-column-details");
        });
    }

    function apiUrl(action) {
        return new URL(action === "portal-admin-snapshot" ? "/api/admin/settings" : "/api", window.location.href).href;
    }

    function parseResponse(response) {
        return response.text().then(function (body) {
            var value;
            try { value = JSON.parse(body || "{}"); }
            catch (error) { throw new Error("Endpoint ustawień zwrócił HTML lub inną odpowiedź zamiast JSON (HTTP " + response.status + ")."); }
            if (!response.ok || value.ok === false) {
                var message = value && value.error;
                if (message && typeof message === "object") message = message.message;
                throw new Error(String(message || ("HTTP " + response.status)));
            }
            return value.value || value.snapshot || value;
        });
    }

    function loadPermissionSnapshot(force) {
        if (permissionState.snapshot && force !== true) return Promise.resolve(permissionState.snapshot);
        if (permissionState.loading) return permissionState.loading;
        permissionState.loading = fetch(apiUrl("portal-admin-snapshot"), {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json", "Cache-Control": "no-store" }
        }).then(parseResponse).then(function (snapshot) {
            permissionState.snapshot = snapshot;
            permissionState.loading = null;
            return snapshot;
        }, function (error) {
            permissionState.loading = null;
            throw error;
        });
        return permissionState.loading;
    }

    function settingsContext(workspace) {
        var secondary = workspace && workspace.querySelector(":scope > .sirk-column-secondary");
        var active = secondary && secondary.querySelector(".sirk-settings-nav-leaf.active,.sirk-settings-nav-leaf.is-active");
        var group = active && active.closest("details.sirk-settings-nav-group");
        var summary = group && group.querySelector(":scope > summary");
        return {
            section: String(active && active.textContent || "").trim(),
            module: String(summary && summary.textContent || "").replace(/^\s*[▸▼]?\s*/, "").trim()
        };
    }

    function detailsHost(workspace) { return workspace && workspace.querySelector(":scope > .sirk-column-details"); }
    function isCustomSettings(workspace) {
        var details = detailsHost(workspace);
        return !!(details && details.getAttribute("data-custom-settings-key"));
    }

    function activePermissionTarget(workspace) {
        var context = settingsContext(workspace);
        if (context.section !== "Permissions" || context.module === "Akceptacje") return null;
        var target = PERMISSION_TARGETS[context.module];
        if (!target) return null;
        return {
            id: target.module ? "module:" + target.module : "view:" + target.view,
            module: target.module || "",
            view: target.view || ""
        };
    }

    function normalizedIds(value) {
        return (Array.isArray(value) ? value : []).map(String).filter(function (id, index, all) {
            return id && all.indexOf(id) === index;
        });
    }

    function currentGroupIds(snapshot, target) {
        var settings = snapshot && snapshot.moduleSettings || {};
        var moduleIds = target.module && settings[target.module] && normalizedIds(settings[target.module].accessGroupIds);
        if (moduleIds && moduleIds.length) return moduleIds;
        var views = settings.portal && settings.portal.views || {};
        var view = target.view && views[target.view] || {};
        return normalizedIds(view.groupIds || view.accessGroupIds);
    }

    function removeLegacyPermissionContent(form) {
        Array.prototype.forEach.call(form.querySelectorAll(".sirk-card"), function (node) {
            var value = String(node.textContent || "").trim();
            if (value === "Ten moduł nie ma osobnej konfiguracji Permissions." ||
                value === "Brak ustawień w tej sekcji." || /—\s*Permissions$/i.test(value)) node.remove();
        });
    }

    function selectedGroupIds(list) {
        return Array.prototype.filter.call(list.querySelectorAll('input[type="checkbox"]'), function (input) {
            return input.checked;
        }).map(function (input) { return String(input.value); });
    }

    function permissionCard(snapshot, target) {
        var selected = currentGroupIds(snapshot, target);
        var card = document.createElement("section");
        card.className = "sirk-card";
        card.setAttribute("data-group-permissions", target.id);
        card.setAttribute("data-search-item", "1");
        var title = document.createElement("strong");
        title.textContent = "Dostęp grup Portalu";
        card.appendChild(title);
        var info = document.createElement("small");
        info.textContent = "Wybrane grupy widzą tę zakładkę. Brak wyboru oznacza dostęp dla wszystkich. Site administrator ma dostęp zawsze.";
        card.appendChild(info);
        var list = document.createElement("div");
        list.style.cssText = "display:grid;gap:8px;margin-top:12px";
        list.setAttribute("data-group-list", "1");
        var groups = snapshot.userGroups || [];
        if (!groups.length) {
            var empty = document.createElement("div");
            empty.textContent = "Nie utworzono jeszcze grup użytkowników Portalu.";
            list.appendChild(empty);
        }
        groups.forEach(function (group) {
            var row = document.createElement("label");
            row.style.cssText = "display:flex;align-items:center;gap:9px";
            var input = document.createElement("input");
            input.type = "checkbox";
            input.value = String(group.id);
            input.checked = selected.indexOf(String(group.id)) >= 0;
            row.appendChild(input);
            var label = document.createElement("span");
            label.textContent = String(group.name || group.id) + (String(group.name || "") === String(group.id) ? "" : " (" + group.id + ")");
            row.appendChild(label);
            list.appendChild(row);
        });
        card.appendChild(list);
        return card;
    }

    function renderPermissionGroups(workspace) {
        if (isCustomSettings(workspace)) return;
        var target = activePermissionTarget(workspace);
        var form = workspace.querySelector("[data-settings-form]");
        if (!target || !form) return;
        removeLegacyPermissionContent(form);
        if (form.querySelector("[data-group-permissions]")) return;
        loadPermissionSnapshot().then(function (snapshot) {
            if (!form.isConnected || isCustomSettings(workspace)) return;
            removeLegacyPermissionContent(form);
            if (!form.querySelector("[data-group-permissions]")) form.insertBefore(permissionCard(snapshot, target), form.firstChild);
        }).catch(function (error) {
            if (!form.isConnected || form.querySelector("[data-group-permission-error]")) return;
            var card = document.createElement("div");
            card.className = "sirk-card";
            card.setAttribute("data-error", "1");
            card.setAttribute("data-group-permission-error", "1");
            card.textContent = error.message || String(error);
            form.insertBefore(card, form.firstChild);
        });
    }

    function savePermissionPatch(target, groupIds) {
        return loadPermissionSnapshot(true).then(function (snapshot) {
            var moduleOptions = clone(snapshot.moduleSettings || {});
            var modules = {};
            (snapshot.modules || []).forEach(function (module) { modules[module.key] = module.enabled === true; });
            if (target.module) {
                moduleOptions[target.module] = moduleOptions[target.module] || {};
                moduleOptions[target.module].accessGroupIds = groupIds.slice();
            }
            if (target.view) {
                moduleOptions.portal = moduleOptions.portal || {};
                moduleOptions.portal.views = moduleOptions.portal.views || {};
                var view = moduleOptions.portal.views[target.view] = moduleOptions.portal.views[target.view] || {};
                view.groupIds = groupIds.slice();
                view.allowAll = groupIds.length === 0;
                delete view.accessGroupIds;
            }
            var integrations = snapshot.integrations && snapshot.integrations.values || {};
            var body = new URLSearchParams();
            body.set("payload", JSON.stringify({ modules: modules, moduleOptions: moduleOptions, portal: moduleOptions.portal || {}, integrations: integrations, secrets: {} }));
            return fetch("/api/admin/settings", {
                method: "POST", credentials: "same-origin", cache: "no-store",
                headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
                body: body.toString()
            }).then(parseResponse);
        }).then(function (result) {
            permissionState.snapshot = result && (result.snapshot || result.value || result);
            return permissionState.snapshot;
        });
    }

    function bindPermissionSave(workspace) {
        if (workspace.getAttribute("data-group-permission-save-bound") === "1") return;
        workspace.setAttribute("data-group-permission-save-bound", "1");
        workspace.addEventListener("click", function (event) {
            var button = event.target && event.target.closest("button");
            var target = activePermissionTarget(workspace);
            if (!button || !target || isCustomSettings(workspace) || String(button.textContent || "").trim() !== "Zapisz") return;
            var list = workspace.querySelector("[data-group-list]");
            if (!list || permissionState.saving) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            permissionState.saving = true;
            button.disabled = true;
            var message = button.parentNode && button.parentNode.querySelector("span");
            if (message) { message.textContent = "Zapisywanie…"; message.removeAttribute("data-error"); }
            savePermissionPatch(target, selectedGroupIds(list)).then(function () {
                if (message) message.textContent = "Zapisano.";
            }).catch(function (error) {
                if (message) { message.textContent = error.message || String(error); message.setAttribute("data-error", "1"); }
                else window.alert(error.message || String(error));
            }).then(function () {
                permissionState.saving = false;
                button.disabled = false;
            });
        }, true);
    }

    function loadApprovalSettings(force) {
        if (approvalState.settings && force !== true) return Promise.resolve(approvalState.settings);
        if (approvalState.loading) return approvalState.loading;
        var api = core();
        if (!api || typeof api.api !== "function") return Promise.reject(new Error("API modułu Akceptacje nie jest jeszcze dostępne."));
        approvalState.loading = api.api("approvalcenter", "settings").then(function (result) {
            approvalState.settings = result.settings || result;
            approvalState.loading = null;
            return approvalState.settings;
        }, function (error) { approvalState.loading = null; throw error; });
        return approvalState.loading;
    }

    function providerByType(settings, type) {
        return (settings.providers || []).find(function (provider) { return provider.type === type; }) || { type: type, enabled: true, showTab: true, showOverview: true, allowNoApproval: false, levels: { 1: [], 2: [], 3: [] } };
    }

    function saveProvider(provider) {
        var api = core();
        if (!api || typeof api.post !== "function") return Promise.reject(new Error("API modułu Akceptacje nie jest jeszcze dostępne."));
        return api.post("approvalcenter", "provider-settings", {
            type: provider.type,
            enabled: provider.enabled !== false,
            showTab: provider.showTab !== false,
            showOverview: provider.showOverview !== false,
            allowNoApproval: provider.allowNoApproval === true,
            levels: provider.levels || { 1: [], 2: [], 3: [] }
        }).then(function () { approvalState.settings = null; return loadApprovalSettings(true); });
    }

    function booleanField(label, checked, description) {
        var row = document.createElement("label");
        row.className = "sirk-card";
        row.setAttribute("data-settings-field", "boolean");
        var copy = document.createElement("span");
        copy.setAttribute("data-settings-field-copy", "1");
        var strong = document.createElement("strong");
        strong.textContent = label;
        copy.appendChild(strong);
        if (description) { var small = document.createElement("small"); small.textContent = description; copy.appendChild(small); }
        var input = document.createElement("input");
        input.type = "checkbox";
        input.checked = checked === true;
        row.appendChild(copy);
        row.appendChild(input);
        row.input = input;
        return row;
    }

    function injectApprovalToggle(workspace) {
        if (isCustomSettings(workspace)) return;
        var context = settingsContext(workspace);
        var mapping = APPROVAL_PROVIDERS[context.module];
        var form = workspace.querySelector("[data-settings-form]");
        if (context.section !== "Ogólne" || !mapping || !form || form.querySelector("[data-approval-provider-toggle]")) return;
        loadApprovalSettings().then(function (settings) {
            if (!form.isConnected || isCustomSettings(workspace)) return;
            var provider = providerByType(settings, mapping.type);
            var row = booleanField("Włącz akceptacje", provider.enabled !== false, "Wnioski tego modułu będą obsługiwane przez moduł Akceptacje.");
            row.setAttribute("data-approval-provider-toggle", mapping.type);
            row.input.onchange = function () {
                row.input.disabled = true;
                provider.enabled = row.input.checked;
                saveProvider(provider).catch(function (error) {
                    provider.enabled = !provider.enabled;
                    row.input.checked = provider.enabled;
                    window.alert(error.message || String(error));
                }).then(function () { row.input.disabled = false; });
            };
            var first = form.querySelector("[data-settings-field]");
            if (first && first.nextSibling) form.insertBefore(row, first.nextSibling); else form.appendChild(row);
        }).catch(function () {});
    }

    function multiSelect(groups, selected) {
        var select = document.createElement("select");
        select.multiple = true;
        select.size = Math.min(8, Math.max(3, groups.length));
        select.style.cssText = "width:100%;min-height:96px";
        groups.forEach(function (group) {
            var option = document.createElement("option");
            option.value = String(group.id);
            option.textContent = String(group.name || group.id);
            option.selected = normalizedIds(selected).indexOf(String(group.id)) >= 0;
            select.appendChild(option);
        });
        return select;
    }

    function renderApprovalPermissions(workspace) {
        if (isCustomSettings(workspace)) return false;
        var context = settingsContext(workspace);
        if (context.module !== "Akceptacje" || context.section !== "Permissions") return false;
        var details = detailsHost(workspace);
        if (!details || details.getAttribute("data-approval-policy-editor") === "1") return true;
        details.setAttribute("data-approval-policy-editor", "1");
        details.innerHTML = '<div class="sirk-card">Ładowanie polityk akceptacji…</div>';
        loadApprovalSettings(true).then(function (settings) {
            if (!details.isConnected) return;
            details.innerHTML = "";
            var form = document.createElement("div");
            form.setAttribute("data-settings-form", "1");
            var editors = [];
            (settings.providers || []).filter(function (provider) { return provider.enabled !== false; }).forEach(function (provider) {
                var section = document.createElement("section");
                section.className = "sirk-card";
                section.style.cssText = "display:grid;gap:12px";
                var title = document.createElement("h3");
                title.textContent = provider.title || provider.type;
                section.appendChild(title);
                var noApproval = booleanField("Pozwól wykonać bez akceptacji", provider.allowNoApproval === true, "Gdy operacja nie wymaga żadnego poziomu, może zostać wykonana od razu.");
                var showTab = booleanField("Pokaż w Akceptacjach", provider.showTab !== false, "Pokazuje wnioski tego modułu w widoku Akceptacje.");
                var showOverview = booleanField("Pokaż na Overview", provider.showOverview !== false, "Uwzględnia ten typ wniosków na stronie głównej.");
                section.appendChild(noApproval);
                section.appendChild(showTab);
                section.appendChild(showOverview);
                var selects = {};
                [1, 2, 3].forEach(function (level) {
                    var label = document.createElement("label");
                    label.style.cssText = "display:grid;gap:6px";
                    var strong = document.createElement("strong");
                    strong.textContent = "Poziom " + level + " — grupy zatwierdzające";
                    label.appendChild(strong);
                    selects[level] = multiSelect(settings.groups || [], provider.levels && (provider.levels[level] || provider.levels[String(level)]) || []);
                    label.appendChild(selects[level]);
                    section.appendChild(label);
                });
                editors.push({ provider: provider, noApproval: noApproval.input, showTab: showTab.input, showOverview: showOverview.input, selects: selects });
                form.appendChild(section);
            });
            if (!editors.length) {
                var empty = document.createElement("div");
                empty.className = "sirk-card";
                empty.textContent = "Żaden moduł nie ma włączonej obsługi akceptacji.";
                form.appendChild(empty);
            }
            var actions = document.createElement("div");
            actions.className = "sirk-toolbar-group sirk-toolbar-left";
            var save = document.createElement("button");
            save.type = "button";
            save.className = "sirk-button";
            save.textContent = "Zapisz";
            var message = document.createElement("span");
            save.onclick = function () {
                if (approvalState.saving) return;
                approvalState.saving = true;
                save.disabled = true;
                message.textContent = "Zapisywanie…";
                message.removeAttribute("data-error");
                Promise.all(editors.map(function (editor) {
                    editor.provider.allowNoApproval = editor.noApproval.checked;
                    editor.provider.showTab = editor.showTab.checked;
                    editor.provider.showOverview = editor.showOverview.checked;
                    editor.provider.levels = editor.provider.levels || {};
                    [1, 2, 3].forEach(function (level) {
                        editor.provider.levels[level] = Array.prototype.filter.call(editor.selects[level].options, function (option) { return option.selected; }).map(function (option) { return String(option.value); });
                    });
                    return saveProvider(editor.provider);
                })).then(function () {
                    message.textContent = "Zapisano.";
                }).catch(function (error) {
                    message.textContent = error.message || String(error);
                    message.setAttribute("data-error", "1");
                }).then(function () {
                    approvalState.saving = false;
                    save.disabled = false;
                });
            };
            actions.appendChild(save);
            actions.appendChild(message);
            details.appendChild(form);
            details.appendChild(actions);
        }).catch(function (error) {
            details.innerHTML = '<div class="sirk-card" data-error="1"></div>';
            details.firstChild.textContent = error.message || String(error);
        });
        return true;
    }

    function removeEmptyNotices(workspace) {
        Array.prototype.forEach.call(workspace.querySelectorAll(".sirk-card"), function (node) {
            var value = String(node.textContent || "").trim();
            if (value === "Ten moduł nie ma osobnej konfiguracji Permissions." || value === "Brak ustawień w tej sekcji." || value === "Brak ustawień ogólnych dla tego modułu.") node.remove();
        });
    }

    function injectSettingsContract(frame) {
        if (!frame) return;
        try {
            var doc = frame.contentDocument;
            if (!doc || !doc.head || !doc.body) return;
            var admin = doc.getElementById("sirk-platform-admin");
            if (!admin) return;
            doc.documentElement.classList.add("mc-portal-settings-document");
            doc.documentElement.style.width = "100%";
            doc.documentElement.style.height = "100%";
            doc.documentElement.style.minWidth = "0";
            doc.documentElement.style.overflow = "hidden";
            doc.body.id = doc.body.id || "sirkPortalRoot";
            doc.body.classList.add("mc-portal-settings-body");
            admin.classList.add("mc-admin-portal-embedded");
            if (!doc.getElementById("sirk-platform-portal-settings-cleanup-style")) {
                var style = doc.createElement("style");
                style.id = "sirk-platform-portal-settings-cleanup-style";
                style.textContent = [
                    "html,body{width:100%!important;height:100%!important;min-width:0!important;margin:0!important;overflow:hidden!important;background:var(--sirk-panel,#fff)!important;}",
                    "body{display:block!important;}",
                    "#sirk-platform-admin{width:100%!important;max-width:none!important;height:100%!important;min-width:0!important;margin:0!important;padding:0!important;overflow:hidden!important;}",
                    ".mc-admin-shell{display:grid!important;grid-template-columns:184px minmax(0,1fr)!important;width:100%!important;max-width:none!important;height:100%!important;min-width:0!important;min-height:0!important;gap:0!important;overflow:hidden!important;}",
                    ".mc-admin-shell.has-middle{grid-template-columns:184px 236px minmax(0,1fr)!important;}",
                    ".mc-admin-tabs,.mc-admin-middle,#sirk-platform-admin-content{min-width:0!important;min-height:0!important;height:100%!important;overflow:auto!important;box-sizing:border-box!important;}",
                    ".mc-admin-tabs,.mc-admin-middle{padding:12px!important;border:0!important;border-right:1px solid var(--sirk-border,#dce3ec)!important;border-radius:0!important;background:var(--sirk-panel,#fff)!important;}",
                    "#sirk-platform-admin-content{padding:18px!important;background:var(--sirk-panel,#fff)!important;}",
                    ".mc-admin-grid{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))!important;gap:12px!important;}",
                    ".mc-admin-card{margin:0 0 12px!important;padding:14px!important;border:1px solid var(--sirk-border,#dce3ec)!important;border-radius:8px!important;background:var(--sirk-panel,#fff)!important;}",
                    ".mc-admin-settings-layout{grid-template-columns:220px minmax(0,1fr)!important;width:100%!important;min-width:0!important;gap:14px!important;}",
                    ".mc-admin-portal-view{grid-template-columns:minmax(140px,.7fr) minmax(180px,1fr) minmax(180px,1fr) minmax(220px,1.2fr)!important;}",
                    "@media(max-width:900px){.mc-admin-shell,.mc-admin-shell.has-middle{grid-template-columns:1fr!important;overflow:auto!important}.mc-admin-tabs,.mc-admin-middle{height:auto!important;border-right:0!important;border-bottom:1px solid var(--sirk-border,#dce3ec)!important}.mc-admin-settings-layout{grid-template-columns:1fr!important}}"
                ].join("");
                doc.head.appendChild(style);
            }
            var dark = root.classList.contains("sirk-theme-dark");
            doc.documentElement.classList.toggle("sirk-theme-dark", dark);
            doc.documentElement.classList.toggle("sirk-theme-light", !dark);
            doc.body.classList.toggle("sirk-theme-dark", dark);
            doc.body.classList.toggle("sirk-theme-light", !dark);
            var computed = window.getComputedStyle(root);
            ["--sirk-panel", "--sirk-input", "--sirk-text", "--sirk-muted", "--sirk-border", "--sirk-active-accent"].forEach(function (name) {
                var value = computed.getPropertyValue(name);
                if (value) doc.body.style.setProperty(name, value.trim());
            });
            addPortalClasses(doc.body);
        } catch (error) {
            if (window.console && console.warn) console.warn("Settings cleanup failed", error);
        }
    }

    function refresh() {
        addPortalClasses(root);
        var workspace = root.querySelector("[data-portal-settings] .sirk-layout");
        if (workspace) {
            removeEmptyNotices(workspace);
            bindPermissionSave(workspace);
            if (!renderApprovalPermissions(workspace)) {
                renderPermissionGroups(workspace);
                injectApprovalToggle(workspace);
            }
        }
        Array.prototype.forEach.call(root.querySelectorAll(".sirk-standalone-settings-frame"), function (frame) {
            if (frame.getAttribute("data-cleanup-bound") !== "1") {
                frame.setAttribute("data-cleanup-bound", "1");
                frame.addEventListener("load", function () {
                    window.setTimeout(function () { injectSettingsContract(frame); }, 0);
                    window.setTimeout(function () { injectSettingsContract(frame); }, 250);
                });
            }
            injectSettingsContract(frame);
        });
    }

    var scheduled = false;
    var observer = new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(function () { scheduled = false; refresh(); });
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "open"] });
    window.addEventListener("sirkportal:languagechange", refresh);
    window.addEventListener("sirkportal:themechange", refresh);
    refresh();
}());
