(function () {
    "use strict";

    if (window.__sirkPlatformPortalManagementLoaded) return;
    window.__sirkPlatformPortalManagementLoaded = true;

    var core = window.SirkPlatformCore;
    var COLLAPSE_STORAGE_KEY = "sirkPlatform.portal.management.primaryCollapsed.v1";
    var TEXT = {
        pl: { collapse: "Zwiń", expand: "Rozwiń", favorites: "Ulubione", edit: "Tryb edycji", refresh: "Odśwież", search: "Szukaj", searchPlaceholder: "Szukaj skryptów...", results: "Wyniki", all: "Wszystkie", pending: "Oczekujące", approved: "Zatwierdzone", executingStatus: "Wykonywane", completed: "Zakończone", failed: "Nieudane", rejected: "Odrzucone", scriptResults: "Wyniki skryptów", noScriptResults: "Brak wyników skryptów dla wybranego statusu.", waitingApproval: "Oczekiwanie na akceptację.", noOutput: "Brak danych wyjściowych.", emptyFavorites: "Brak ulubionych skryptów.", emptyScripts: "Brak skryptów.", credentials: "Poświadczenia", favorite: "Ulubione", copyLink: "Kopiuj link", run: "Uruchom", request: "Wyślij wniosek", executing: "Uruchamianie skryptu...", executionFailed: "Uruchomienie nie powiodło się", required: "jest wymagane.", validation: "Walidacja", management: "Zarządzanie", selectScript: "Wybierz skrypt do uruchomienia.", confirmPrefix: "Uruchomić teraz skrypt", result: "Wynik" },
        en: { collapse: "Collapse", expand: "Expand", favorites: "Favorites", edit: "Edit mode", refresh: "Refresh", search: "Search", searchPlaceholder: "Search scripts...", results: "Results", all: "All", pending: "Pending", approved: "Approved", executingStatus: "Executing", completed: "Completed", failed: "Failed", rejected: "Rejected", scriptResults: "Script results", noScriptResults: "No script results match the selected status.", waitingApproval: "Waiting for approval.", noOutput: "No output.", emptyFavorites: "No favorite scripts.", emptyScripts: "No scripts.", credentials: "Credentials", favorite: "Favorite", copyLink: "Copy link", run: "Run", request: "Request", executing: "Executing script...", executionFailed: "Execution failed", required: "is required.", validation: "Validation", management: "Management", selectScript: "Select a script to run.", confirmPrefix: "Run script", result: "Result" }
    };
    var tools = window.SharedScriptTools.create({
        storageKey: "sirkPlatform.management.preferences",
        deepLinkParameter: "script"
    });
    var state = {
        tree: null,
        root: "",
        script: "",
        search: "",
        results: false,
        status: "",
        collapsed: loadCollapsedState(),
        editMode: false,
        host: null,
        output: Object.create(null),
        mountGeneration: 0
    };

    function loadCollapsedState() {
        try { return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true"; }
        catch (error) { return false; }
    }

    function saveCollapsedState() {
        try { window.localStorage.setItem(COLLAPSE_STORAGE_KEY, state.collapsed ? "true" : "false"); }
        catch (error) {}
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function svg(path) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
    }

    var icons = {
        collapse: svg('<path d="m15 18-6-6 6-6"/>'),
        expand: svg('<path d="m9 18 6-6-6-6"/>'),
        star: svg('<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>'),
        link: svg('<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>'),
        edit: svg('<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
        refresh: svg('<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 8A7 7 0 0 1 18 6l2 5M4 13l2 5a7 7 0 0 0 11.9-2"/>'),
        search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
        folder: svg('<path d="M3 6h6l2 2h10v11H3V6Z"/>'),
        script: svg('<path d="M6 3h9l3 3v15H6V3Z"/><path d="M9 11h6M9 15h6"/>'),
        approval: svg('<g transform="rotate(-12 12 12)"><path d="M7 3h10M7 21h10M8 3c0 4.2 1.3 6.6 4 9-2.7 2.4-4 4.8-4 9M16 3c0 4.2-1.3 6.6-4 9 2.7 2.4 4 4.8 4 9"/><path d="M9.5 7h5M9.5 17h5"/></g>'),
        result: svg('<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8"/>'),
        key: svg('<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15 12v2"/>'),
        pending: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
        approved: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/>'),
        executing: svg('<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/>'),
        completed: svg('<path d="M4 5h16v14H4z"/><path d="m8 12 2.5 2.5L16 9"/>'),
        failed: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
        rejected: svg('<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>')
    };

    function api(asset, parameters) {
        return core.api("management", asset, null, parameters || {});
    }

    function post(asset, values) {
        return core.post("management", asset, values || {});
    }

    function bootstrap() {
        return window.SirkPlatformRuntime && window.SirkPlatformRuntime.state && window.SirkPlatformRuntime.state.bootstrap || {};
    }

    function isAdmin() {
        return !!(bootstrap().access && bootstrap().access.siteAdmin);
    }

    function roots() {
        if (window.SharedDirectoryTree && typeof window.SharedDirectoryTree.roots === "function") {
            return window.SharedDirectoryTree.roots(state.tree);
        }
        return state.tree && state.tree.children || [];
    }

    function find(path) {
        if (window.SharedDirectoryTree && typeof window.SharedDirectoryTree.find === "function") {
            return window.SharedDirectoryTree.find(state.tree, path);
        }
        var found = null;
        function walk(node) {
            if (!node || found) return;
            if (node.path === path) { found = node; return; }
            (node.children || []).forEach(walk);
        }
        walk(state.tree);
        return found;
    }

    function language() {
        return String(document.documentElement.lang || "pl").toLowerCase().indexOf("en") === 0 ? "en" : "pl";
    }

    function t(key) { return (TEXT[language()] && TEXT[language()][key]) || TEXT.en[key] || key; }

    function localized(item, field) {
        var locale = item && item.locales && item.locales[language()];
        return locale && locale[field] || item && item[field] || "";
    }

    function localizedVariable(item, field) {
        var values = item && item[field + "s"];
        return values && values[language()] || item && item[field] || "";
    }

    function consumeDeepLink() {
        try {
            var url = new URL(window.location.href);
            var path = url.searchParams.get("script") || "";
            if (!path) return "";
            url.searchParams.delete("script");
            window.history.replaceState(window.history.state, document.title, url.href);
            return path;
        } catch (error) {
            return "";
        }
    }

    function visibleScript(script) {
        if (!script || script.type !== "script") return false;
        if (tools.state.favoritesOnly && !tools.isFavorite(script.path)) return false;
        if (!state.search) return true;
        return [script.name, script.label, script.description, script.path,
            script.locales && script.locales.pl && script.locales.pl.label,
            script.locales && script.locales.pl && script.locales.pl.description,
            script.locales && script.locales.en && script.locales.en.label,
            script.locales && script.locales.en && script.locales.en.description
        ].join(" ").toLowerCase().indexOf(state.search.toLowerCase()) >= 0;
    }

    function containsVisibleScript(node) {
        if (!node) return false;
        if (node.type === "script") return visibleScript(node);
        return (node.children || []).some(containsVisibleScript);
    }

    function toolButton(action, title, icon) {
        var button = el("button", "sirk-toolbar-button");
        button.type = "button";
        button.title = title;
        button.setAttribute("data-portal-management-tool", action);
        button.innerHTML = icon;
        return button;
    }

    function buildShell(host) {
        host.innerHTML = "";

        var shell = el("div", "sirk-view-shell");
        var toolbar = el("div", "sirk-toolbar-host");
        toolbar.appendChild(toolButton("collapse", t("collapse"), icons.collapse));
        toolbar.appendChild(toolButton("favorites", t("favorites"), icons.star));
        toolbar.appendChild(toolButton("edit", t("edit"), icons.edit));
        toolbar.appendChild(toolButton("refresh", t("refresh"), icons.refresh));
        toolbar.appendChild(toolButton("search", t("search"), icons.search));
        var search = el("input", "sirk-filter");
        search.id = "sirkPlatformPortalManagementSearch";
        search.type = "search";
        search.placeholder = t("searchPlaceholder");
        search.value = state.search;
        toolbar.appendChild(search);
        toolbar.appendChild(el("span", "sirk-toolbar-status"));

        var workspace = el("div", "sirk-layout-host");
        var categories = el("aside", "sirk-column-primary");
        categories.appendChild(el("div", "sirk-list"));
        var scripts = el("aside", "sirk-column-secondary");
        scripts.appendChild(el("div", "sirk-list"));
        var details = el("div", "sirk-column-details");
        details.appendChild(el("div", "sirk-content"));
        workspace.appendChild(categories);
        workspace.appendChild(scripts);
        workspace.appendChild(details);
        shell.appendChild(toolbar);
        shell.appendChild(workspace);
        host.appendChild(shell);

        state.host = host;
        bind(shell);
        renderAll();
    }

    function categoryButton(item, active) {
        var button = el("button", "sirk-nav-item" + (active ? " is-active" : ""));
        button.type = "button";
        button.setAttribute("data-management-root", item.path || "");
        button.innerHTML = '<span class="sirk-nav-icon">' + (item.icon || icons.folder) + '</span><span></span>';
        button.lastChild.textContent = localized(item, "label") || item.name || item.path;
        var description = localized(item, "description");
        if (description) button.title = description;
        return button;
    }

    function renderCategories() {
        var host = state.host.querySelector(".sirk-layout-host > .sirk-column-primary .sirk-list");
        host.innerHTML = "";
        var visibleRoots = roots().filter(function (root) {
            return !tools.state.favoritesOnly || containsVisibleScript(root);
        });
        if (tools.state.favoritesOnly) {
            state.results = false;
            if (state.script && !tools.isFavorite(state.script)) state.script = "";
            if (!visibleRoots.some(function (root) { return root.path === state.root; })) {
                state.root = visibleRoots.length ? visibleRoots[0].path : "";
                state.script = "";
            }
        } else {
            var results = categoryButton({ path: "@results", label: t("results"), icon: icons.result }, state.results);
            host.appendChild(results);
        }
        visibleRoots.forEach(function (root) {
            host.appendChild(categoryButton(root, !state.results && state.root === root.path));
        });
        state.host.classList.toggle("is-collapsed", state.collapsed);
    }

    function actionButton(action, title, icon, disabled, active) {
        var button = el("button", "sirk-script-action" + (active ? " is-active" : ""));
        button.type = "button";
        button.title = title;
        button.setAttribute("data-script-action", action);
        button.innerHTML = icon;
        button.disabled = disabled === true;
        return button;
    }

    function scriptRow(script, depth) {
        var row = el("div", "sirk-script-row" + (state.script === script.path ? " is-active" : ""));
        row.style.setProperty("--sirk-depth", String(depth || 0));
        var open = el("button", "sirk-nav-item sirk-script-open");
        open.type = "button";
        open.setAttribute("data-script-path", script.path);
        open.innerHTML = '<span class="sirk-nav-icon' + (script.requiresApproval ? ' sirk-script-approval-icon' : '') + '">' + (script.requiresApproval ? icons.approval : icons.script) + '</span><span class="sirk-script-label"></span>';
        open.querySelector(".sirk-script-label").textContent = localized(script, "label") || script.name || script.path;
        var scriptDescription = localized(script, "description");
        if (scriptDescription) open.title = scriptDescription;
        row.appendChild(open);
        if (state.editMode) {
            var actions = el("span", "sirk-script-actions");
            var hasSecrets = Array.isArray(script.secretVariables) && script.secretVariables.length > 0;
            var credentials = actionButton("credentials", t("credentials"), icons.key, !hasSecrets, hasSecrets);
            var favorite = actionButton("favorite", t("favorite"), icons.star, false, tools.isFavorite(script.path));
            var link = actionButton("copy", t("copyLink"), icons.link);
            var edit = actionButton("edit", t("edit"), icons.edit, !isAdmin());
            [credentials, favorite, link, edit].forEach(function (button) {
                button.setAttribute("data-script-path", script.path);
                actions.appendChild(button);
            });
            row.appendChild(actions);
        }
        return row;
    }

    function appendNode(host, node, depth) {
        if (!node) return;
        if (node.type === "script") {
            if (visibleScript(node)) host.appendChild(scriptRow(node, depth));
            return;
        }
        if (!containsVisibleScript(node)) return;
        var matching = (node.children || []).filter(containsVisibleScript);
        if (node.path !== state.root) {
            var heading = el("div", "sirk-folder-heading");
            heading.setAttribute("data-folder-path", node.path || "");
            heading.style.setProperty("--sirk-depth", String(depth || 0));
            heading.innerHTML = '<span class="sirk-nav-icon">' + icons.folder + '</span><span></span>';
            heading.lastChild.textContent = localized(node, "label") || node.name || node.path;
            var folderDescription = localized(node, "description");
            if (folderDescription) heading.title = folderDescription;
            host.appendChild(heading);
        }
        matching.forEach(function (child) { appendNode(host, child, (depth || 0) + 1); });
    }

    function renderScripts() {
        var host = state.host.querySelector(".sirk-layout-host > .sirk-column-secondary .sirk-list");
        host.innerHTML = "";
        if (state.results) {
            [
                { value: "", label: "all", icon: icons.result },
                { value: "pending", label: "pending", icon: icons.pending },
                { value: "approved", label: "approved", icon: icons.approved },
                { value: "executing", label: "executingStatus", icon: icons.executing },
                { value: "completed", label: "completed", icon: icons.completed },
                { value: "failed", label: "failed", icon: icons.failed },
                { value: "rejected", label: "rejected", icon: icons.rejected }
            ].forEach(function (item) {
                var status = item.value;
                var button = el("button", "sirk-nav-item sirk-result-status sirk-result-status-" + (status || "all") + (state.status === status ? " is-active" : ""));
                button.type = "button";
                button.setAttribute("data-result-status", status);
                button.innerHTML = '<span class="sirk-nav-icon sirk-result-status-icon">' + item.icon + '</span><span></span>';
                button.lastChild.textContent = t(item.label);
                host.appendChild(button);
            });
            return;
        }
        var root = find(state.root) || (tools.state.favoritesOnly ? null : roots()[0]);
        if (!root) {
            host.appendChild(el("div", "sirk-empty", tools.state.favoritesOnly ? t("emptyFavorites") : t("emptyScripts")));
            return;
        }
        appendNode(host, root, 0);
    }

    function detailsHost() {
        return state.host.querySelector(".sirk-content");
    }

    function shellAdapter() {
        return {
            state: { page: { details: detailsHost() }, bootstrap: bootstrap() },
            api: api,
            post: post,
            card: function (title, description) {
                var card = el("div", "sirk-card");
                card.appendChild(el("h3", "", title));
                if (description) card.appendChild(el("p", "sirk-muted", description));
                return card;
            },
            element: el,
            error: function (host, error) {
                host.innerHTML = "";
                var card = el("div", "sirk-card sirk-error");
                card.textContent = error && error.message || String(error);
                host.appendChild(card);
            }
        };
    }

    function showMessage(title, message, error) {
        var host = detailsHost();
        host.innerHTML = "";
        var card = el("div", "sirk-card" + (error ? " sirk-error" : ""));
        card.appendChild(el("h2", "", title));
        card.appendChild(el("p", "sirk-muted", message));
        host.appendChild(card);
    }

    function variableForm(script) {
        var form = el("div", "sirk-script-variable-form");
        var controls = [];
        (script.variables || []).forEach(function (variable) {
            var row = el("label", "sirk-form-row");
            row.appendChild(el("span", "sirk-form-label", (localizedVariable(variable, "label") || variable.name) + (variable.required ? " *" : "")));
            var variableDescription = localizedVariable(variable, "description");
            if (variableDescription) row.title = variableDescription;
            var control;
            if (variable.control === "select") {
                control = el("select", "sirk-input");
                (variable.options || []).forEach(function (choice) {
                    var optionLabels = choice && choice.labels;
                    var option = el("option", "", optionLabels && optionLabels[language()] || choice.label || choice.value || choice);
                    option.value = String(choice.value == null ? choice : choice.value);
                    control.appendChild(option);
                });
            } else {
                control = el("input", "sirk-input");
                control.type = variable.control === "switch" ? "checkbox" : "text";
            }
            if (control.type === "checkbox") control.checked = /^(1|true|yes|tak)$/i.test(String(variable.defaultValue || ""));
            else control.value = String(variable.defaultValue == null ? "" : variable.defaultValue);
            row.appendChild(control);
            form.appendChild(row);
            controls.push({ variable: variable, control: control });
        });
        return {
            element: form,
            values: function () {
                var values = {};
                controls.forEach(function (item) {
                    values[item.variable.name] = item.control.type === "checkbox" ? item.control.checked : item.control.value;
                });
                return values;
            },
            validate: function () {
                controls.forEach(function (item) {
                    var value = item.control.type === "checkbox" ? item.control.checked : item.control.value;
                    if (item.variable.required && !String(value == null ? "" : value).trim()) throw new Error((localizedVariable(item.variable, "label") || item.variable.name) + " " + t("required"));
                });
            }
        };
    }

    function requestOutput(request) {
        var result = request && request.result || {};
        return result.output || result.rawOutput || result.message || (request && request.status === "pending" ? t("waitingApproval") : t("noOutput"));
    }

    function renderRequest(script, request) {
        var host = detailsHost();
        host.innerHTML = "";
        if (window.SharedResultsView && typeof window.SharedResultsView.mountResult === "function") {
            window.SharedResultsView.mountResult(host, requestOutput(request), { title: localized(script, "label") || script.name || t("result") });
        } else {
            var pre = el("pre", "sirk-output", requestOutput(request));
            host.appendChild(pre);
        }
    }

    function execute(script, values) {
        if (script.confirmExecution === true && !window.confirm(t("confirmPrefix") + ' "' + (localized(script, "label") || script.name || script.path) + '"?')) return;
        showMessage(localized(script, "label") || script.name, t("executing"));
        post("execute", {
            scriptPath: script.path,
            variableValues: values || {},
            confirmedExecution: script.confirmExecution === true,
            language: language(),
            note: ""
        }).then(function (response) {
            state.output[script.path] = response.request || {};
            renderRequest(script, response.request || {});
        }).catch(function (error) {
            showMessage(t("executionFailed"), error.message || String(error), true);
        });
    }

    function openScript(path, executeOnSelect) {
        state.script = path;
        renderScripts();
        api("script", { path: path }).then(function (response) {
            var script = response.script;
            var previous = state.output[path];
            if (previous && executeOnSelect !== true) {
                renderRequest(script, previous);
                return;
            }
            var hasVariables = Array.isArray(script.variables) && script.variables.length > 0;
            if (executeOnSelect && !hasVariables) {
                execute(script, {});
                return;
            }
            var host = detailsHost();
            host.innerHTML = "";
            var card = el("div", "sirk-card sirk-script-run-card");
            card.appendChild(el("h2", "", localized(script, "label") || script.name));
            var description = localized(script, "description");
            if (description) card.appendChild(el("p", "sirk-muted", description));
            var variables = variableForm(script);
            if (hasVariables) card.appendChild(variables.element);
            var run = el("button", "sirk-primary-button", script.requiresApproval ? t("request") : t("run"));
            run.type = "button";
            run.onclick = function () {
                try { variables.validate(); execute(script, variables.values()); }
                catch (error) { showMessage(t("validation"), error.message || String(error), true); }
            };
            card.appendChild(run);
            host.appendChild(card);
        }).catch(function (error) { showMessage("Script error", error.message || String(error), true); });
    }

    function renderResults() {
        var host = detailsHost();
        host.innerHTML = "";
        api("results", { status: state.status, q: state.search, page: 1, perPage: 200 }).then(function (response) {
            if (window.SharedResultsView) {
                window.SharedResultsView.mountTable(host, {
                    title: t("scriptResults"),
                    kind: "scripts",
                    rows: response.rows || [],
                    emptyText: t("noScriptResults")
                });
            }
        }).catch(function (error) { showMessage("Results error", error.message || String(error), true); });
    }

    function renderDetails() {
        if (state.results) { renderResults(); return; }
        if (state.script) { openScript(state.script, false); return; }
        showMessage(t("management"), t("selectScript"));
    }

    function renderAll() {
        if (!state.host) return;
        state.host.classList.toggle("is-management-edit-mode", state.editMode);
        renderCategories();
        renderScripts();
        renderDetails();
        var favorite = state.host.querySelector('[data-portal-management-tool="favorites"]');
        if (favorite) favorite.classList.toggle("is-active", tools.state.favoritesOnly);
        var collapse = state.host.querySelector('[data-portal-management-tool="collapse"]');
        if (collapse) {
            collapse.innerHTML = state.collapsed ? icons.expand : icons.collapse;
            collapse.title = state.collapsed ? t("expand") : t("collapse");
            collapse.setAttribute("aria-label", collapse.title);
        }
        var edit = state.host.querySelector('[data-portal-management-tool="edit"]');
        if (edit) edit.classList.toggle("is-active", state.editMode);
    }

    function editScript(path) {
        var script = find(path);
        if (!script) return;
        tools.openDefinitionEditor(shellAdapter(), script, function (result) {
            if (result && result.tree) state.tree = result.tree;
            renderAll();
        });
    }

    function credentials(path) {
        var script = find(path);
        if (!script) return;
        tools.openCredentialsEditor(shellAdapter(), script, function () { renderAll(); });
    }

    function copyScriptLink(path) {
        if (!path) return;
        tools.copyText((function () {
            var url = new URL(window.location.href);
            url.searchParams.set("script", path);
            return url.href;
        }())).then(function () { showMessage("Copy link", "Link skopiowany."); });
    }

    function bind(shell) {
        shell.addEventListener("click", function (event) {
            var tool = event.target.closest("[data-portal-management-tool]");
            if (tool) {
                var action = tool.getAttribute("data-portal-management-tool");
                if (action === "collapse") {
                    state.collapsed = !state.collapsed;
                    saveCollapsedState();
                }
                if (action === "favorites") {
                    tools.toggleFavorites(null, renderAll);
                    return;
                }
                if (action === "edit" && isAdmin()) state.editMode = !state.editMode;
                if (action === "refresh") {
                    api("tree").then(function (response) { state.tree = response.tree || state.tree; renderAll(); });
                }
                if (action === "search") {
                    var search = state.host.querySelector(".sirk-filter");
                    search.classList.toggle("is-visible");
                    if (search.classList.contains("is-visible")) search.focus();
                }
                renderAll();
                return;
            }
            var root = event.target.closest("[data-management-root]");
            if (root) {
                var path = root.getAttribute("data-management-root");
                state.results = path === "@results";
                state.root = state.results ? "" : path;
                state.script = "";
                renderAll();
                return;
            }
            var status = event.target.closest("[data-result-status]");
            if (status) { state.status = status.getAttribute("data-result-status") || ""; renderAll(); return; }
            var open = event.target.closest("[data-script-path].sirk-script-open");
            if (open) { openScript(open.getAttribute("data-script-path"), true); return; }
            var actionButton = event.target.closest("[data-script-action]");
            if (actionButton) {
                var actionName = actionButton.getAttribute("data-script-action");
                var scriptPath = actionButton.getAttribute("data-script-path");
                if (actionName === "favorite") { tools.toggleFavorite(scriptPath); renderAll(); }
                if (actionName === "copy") copyScriptLink(scriptPath);
                if (actionName === "edit") editScript(scriptPath);
                if (actionName === "credentials" && !actionButton.disabled) credentials(scriptPath);
            }
        });
        shell.addEventListener("input", function (event) {
            if (!event.target.classList.contains("sirk-filter")) return;
            state.search = event.target.value || "";
            renderScripts();
            if (state.results) renderResults();
        });
    }

    function unmount() {
        state.mountGeneration += 1;
        if (state.host) state.host.replaceChildren();
        state.host = null;
        state.tree = null;
        state.root = "";
        state.script = "";
        state.search = "";
        state.results = false;
        state.status = "";
        state.output = Object.create(null);
    }

    function mount(host) {
        unmount();
        var generation = ++state.mountGeneration;
        state.host = host;
        return api("tree").then(function (response) {
            if (generation !== state.mountGeneration || state.host !== host || !host.isConnected) return;
            state.tree = response.tree;
            var available = roots();
            var linkedPath = consumeDeepLink();
            var linkedScript = linkedPath && find(linkedPath);
            if (linkedScript && linkedScript.type === "script") {
                host.setAttribute("data-management-open-path", linkedPath);
                available.some(function (root) {
                    var rootPath = String(root.path || "");
                    if (linkedPath !== rootPath && linkedPath.indexOf(rootPath + "/") !== 0) return false;
                    state.root = rootPath;
                    return true;
                });
            }
            else host.removeAttribute("data-management-open-path");
            if (!state.root && available.length) state.root = available[0].path;
            buildShell(host);
            if (linkedScript && linkedScript.type === "script") openScript(linkedPath, true);
            else if (linkedPath) showMessage("Script link", "Nie znaleziono skryptu wskazanego w linku.", true);
        }).catch(function (error) {
            if (generation !== state.mountGeneration || state.host !== host || !host.isConnected) return;
            host.innerHTML = "";
            host.appendChild(el("div", "sirk-card sirk-error", error.message || String(error)));
        });
    }

    window.SirkPlatformPortalManagement = {
        mount: mount,
        unmount: unmount,
        refresh: function () {
            if (!state.host) return;
            api("tree").then(function (response) {
                state.tree = response.tree || state.tree;
                renderAll();
            });
        }
    };
    window.addEventListener("sirkportal:languagechange", function () {
        if (state.host && document.documentElement.contains(state.host)) renderAll();
    });
}());
