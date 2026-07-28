(function () {
    "use strict";

    function text(value) { return String(value == null ? "" : value); }

    function copyText(value) {
        value = text(value);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function" && window.isSecureContext) {
            return navigator.clipboard.writeText(value);
        }
        return new Promise(function (resolve, reject) {
            var field = document.createElement("textarea");
            field.value = value;
            field.readOnly = true;
            field.style.position = "fixed";
            field.style.left = "-10000px";
            document.body.appendChild(field);
            field.focus(); field.select();
            try {
                if (!document.execCommand("copy")) throw new Error("Copy failed.");
                resolve();
            } catch (error) { reject(error); }
            finally { field.remove(); }
        });
    }

    function uniqueStrings(values) {
        var seen = Object.create(null);
        return (Array.isArray(values) ? values : []).map(text).filter(function (item) {
            if (!item || seen[item]) return false;
            seen[item] = true; return true;
        });
    }

    function findRootAndParents(tree, scriptPath) {
        var result = { root: "", parents: [] };
        var roots = window.SharedDirectoryTree.roots(tree);
        function walk(node, parents) {
            if (!node) return false;
            if (node.type === "script") return node.path === scriptPath;
            var next = parents.slice();
            if (node.path && node.path !== "__root__") next.push(node.path);
            var children = node.children || [];
            for (var i = 0; i < children.length; i++) {
                if (walk(children[i], next)) { result.parents = next; return true; }
            }
            return false;
        }
        for (var i = 0; i < roots.length; i++) {
            if (walk(roots[i], [])) { result.root = roots[i].path; break; }
        }
        return result;
    }

    function formRow(labelText, control) {
        var row = document.createElement("label");
        row.className = "sirk-script-form-row";
        var label = document.createElement("span");
        label.className = "sirk-script-form-label";
        label.textContent = labelText;
        row.appendChild(label); row.appendChild(control);
        return row;
    }

    function directivesText(rows) {
        return (rows || []).map(function (item) {
            return text(item.directive) + ": " + text(item.value);
        }).join("\n");
    }

    function parseDirectives(value) {
        return text(value).split(/\r?\n/).map(function (line) {
            var index = line.indexOf(":");
            if (index < 1) return null;
            return {
                directive: line.slice(0, index).trim(),
                value: line.slice(index + 1).trim()
            };
        }).filter(function (item) { return item && item.directive && item.value; });
    }

    function nodeName(id) {
        var stores = [window.nodes, window.meshes, window.devices];
        for (var i = 0; i < stores.length; i++) {
            var item = stores[i] && stores[i][id];
            if (item && (item.name || item.rname || item.host)) return item.name || item.rname || item.host;
        }
        return id;
    }

    function selectedDevices(currentNodeId) {
        var result = [], seen = Object.create(null);
        function add(id, name) {
            id = text(id).trim();
            if (!id || seen[id]) return;
            if (id.indexOf("node/") < 0 && id.indexOf("node//") < 0) return;
            seen[id] = true;
            result.push({ id: id, name: text(name || nodeName(id)) });
        }
        function scan(value) {
            if (!value) return;
            if (typeof value === "string") { add(value); return; }
            if (Array.isArray(value)) { value.forEach(scan); return; }
            if (typeof value !== "object") return;
            var id = value.nodeId || value.nodeid || value._id || value.id;
            if (id) add(id, value.name || value.rname || value.host);
            Object.keys(value).forEach(function (key) {
                if (key.indexOf("node/") >= 0) add(key, value[key] && value[key].name);
            });
        }
        [
            "selectedNodes", "selectedNodeIds", "selectedDevices",
            "multiSelectedNodes", "checkedNodes", "deviceSelection",
            "selectedDeviceIds", "multiSelectedDevices"
        ].forEach(function (name) { try { scan(window[name]); } catch (error) {} });

        var selector = [
            'input[type="checkbox"]:checked[data-nodeid]',
            'input[type="checkbox"]:checked[data-node-id]',
            'input[type="checkbox"]:checked[value*="node/"]',
            '[aria-selected="true"][data-nodeid]',
            '[aria-selected="true"][data-node-id]',
            '.selected[data-nodeid]', '.selected[data-node-id]'
        ].join(",");
        Array.prototype.forEach.call(document.querySelectorAll(selector), function (element) {
            var row = element.closest && element.closest("[data-nodeid],[data-node-id]");
            var id = element.getAttribute("data-nodeid") || element.getAttribute("data-node-id") ||
                (row && (row.getAttribute("data-nodeid") || row.getAttribute("data-node-id"))) ||
                element.value;
            var name = element.getAttribute("data-nodename") || element.getAttribute("data-node-name") ||
                (row && (row.getAttribute("data-nodename") || row.getAttribute("data-node-name")));
            add(id, name);
        });
        if (!result.length && currentNodeId) add(currentNodeId);
        return result;
    }

    window.SharedScriptTools = {
        copyText: copyText,
        selectedDevices: selectedDevices,
        create: function (options) {
            options = options || {};
            var storageKey = options.storageKey || "sirkPlatform.scripts.preferences";
            var deepLinkParameter = options.deepLinkParameter || "script";
            var state = {
                favorites: [], favoritesOnly: false, editMode: false,
                linkPickMode: false, multiPickMode: false, deepLinkApplied: false
            };

            function readPreferences() {
                try {
                    var stored = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
                    if (Array.isArray(stored)) return { favorites: stored };
                    return stored && typeof stored === "object" ? stored : {};
                } catch (error) { return {}; }
            }
            function savePreferences(extra) {
                try {
                    var current = readPreferences();
                    current.favorites = uniqueStrings(state.favorites);
                    current.favoritesOnly = state.favoritesOnly === true;
                    Object.keys(extra || {}).forEach(function (key) { current[key] = extra[key]; });
                    window.localStorage.setItem(storageKey, JSON.stringify(current));
                } catch (error) {}
            }
            var preferences = readPreferences();
            state.favorites = uniqueStrings(preferences.favorites);
            state.favoritesOnly = preferences.favoritesOnly === true;

            function isFavorite(path) { return state.favorites.indexOf(text(path)) >= 0; }
            function toggleFavorite(path) {
                path = text(path); if (!path) return false;
                var index = state.favorites.indexOf(path);
                if (index >= 0) state.favorites.splice(index, 1); else state.favorites.push(path);
                savePreferences(); return isFavorite(path);
            }
            function selectedLink(path) {
                var url = new URL(window.location.href);
                if (typeof window.xxcurrentView !== "undefined") url.searchParams.set("viewmode", String(window.xxcurrentView));
                url.searchParams.set(deepLinkParameter, text(path));
                return url.href;
            }
            function copyScriptLink(path) {
                if (!path) return Promise.resolve(false);
                var url = selectedLink(path);
                try { window.history.replaceState(window.history.state, document.title, url); } catch (error) {}
                return copyText(url).catch(function () { window.prompt("Copy the script link:", url); }).then(function () { return true; });
            }
            function updateTitle(toolbar, key, title) {
                if (toolbar && typeof toolbar.setTitle === "function") toolbar.setTitle(key, title);
                else if (toolbar && toolbar.buttons && toolbar.buttons[key]) {
                    toolbar.buttons[key].title = title;
                    toolbar.buttons[key].setAttribute("aria-label", title);
                }
            }
            function stopPickModes(except) {
                if (except !== "link") state.linkPickMode = false;
                if (except !== "multi") state.multiPickMode = false;
            }

            function openDefinitionEditor(shell, script, onSaved) {
                shell.api("definition", { path: script.path }).then(function (response) {
                    var value = response.definition || {}, host = shell.state.page.details;
                    host.innerHTML = "";
                    var card = shell.card("Edit script definition", value.path || script.path);
                    card.classList.add("sirk-script-definition-card");
                    var label = document.createElement("input"); label.type = "text"; label.value = value.label || script.label || script.name;
                    var description = document.createElement("textarea"); description.rows = 3; description.value = value.description || "";
                    var approvals = document.createElement("div"); approvals.className = "sirk-script-approval-levels";
                    [1, 2, 3].forEach(function (level) {
                        var item = document.createElement("label"), box = document.createElement("input");
                        box.type = "checkbox"; box.value = String(level); box.checked = (value.approvalLevels || []).indexOf(level) >= 0;
                        item.appendChild(box); item.appendChild(document.createTextNode(" Level " + level)); approvals.appendChild(item);
                    });
                    var variables = document.createElement("textarea"); variables.rows = 8; variables.value = directivesText(value.variables);
                    var secrets = document.createElement("textarea"); secrets.rows = 5; secrets.value = directivesText(value.secretVariables);
                    var runAs = document.createElement("select");
                    [[0,"Default"],[1,"Logged-on user"],[2,"SYSTEM"]].forEach(function (pair) { var option = document.createElement("option"); option.value = pair[0]; option.textContent = pair[1]; runAs.appendChild(option); });
                    runAs.value = String(value.runAsUser || 0);
                    var multi = document.createElement("input"); multi.type = "checkbox"; multi.checked = value.multiHost === true;
                    card.appendChild(formRow("Label", label));
                    card.appendChild(formRow("Description", description));
                    card.appendChild(formRow("Approval levels", approvals));
                    card.appendChild(formRow("Variables (Directive: value)", variables));
                    card.appendChild(formRow("Credential directives (SaveSecret: value)", secrets));
                    card.appendChild(formRow("Run as", runAs));
                    card.appendChild(formRow("Allow multi-device execution", multi));
                    var actions = document.createElement("div"); actions.className = "sirk-script-manage-actions";
                    var save = shell.element("button", "btn btn-primary btn-sm", "Save");
                    var cancel = shell.element("button", "btn btn-secondary btn-sm", "Cancel");
                    save.type = cancel.type = "button";
                    save.onclick = function () {
                        save.disabled = true;
                        shell.post("definition", {
                            path: script.path,
                            definition: {
                                label: label.value, description: description.value,
                                approvalLevels: Array.prototype.map.call(approvals.querySelectorAll('input:checked'), function (box) { return Number(box.value); }),
                                variables: parseDirectives(variables.value), secretVariables: parseDirectives(secrets.value),
                                runAsUser: Number(runAs.value) || 0, multiHost: multi.checked
                            }
                        }).then(function (result) {
                            state.editMode = false;
                            if (typeof onSaved === "function") onSaved(result);
                        }).catch(function (error) { save.disabled = false; var note = document.createElement("div"); note.className = "sirk-error"; note.textContent = error.message || String(error); card.appendChild(note); });
                    };
                    cancel.onclick = function () { state.editMode = false; if (typeof onSaved === "function") onSaved(null); };
                    actions.appendChild(save); actions.appendChild(cancel); card.appendChild(actions); host.appendChild(card); label.focus();
                }).catch(function (error) { shell.error(shell.state.page.details, error); });
            }

            function openCredentialsEditor(shell, script, onSaved) {
                shell.api("script-secrets", { path: script.path }).then(function (response) {
                    var value = response.secrets || {}, host = shell.state.page.details;
                    host.innerHTML = "";
                    var card = shell.card("Script credentials", script.label || script.name);
                    card.classList.add("sirk-script-credentials-card");
                    var controls = [];
                    (value.variables || []).forEach(function (variable) {
                        var group = document.createElement("div"); group.className = "sirk-script-secret-row";
                        var input = document.createElement("input"); input.type = "password"; input.autocomplete = "new-password";
                        input.placeholder = variable.configured ? "Configured — leave empty to keep" : "Enter secret";
                        var clear = document.createElement("input"); clear.type = "checkbox";
                        var clearLabel = document.createElement("label"); clearLabel.appendChild(clear); clearLabel.appendChild(document.createTextNode(" Clear saved value"));
                        var status = document.createElement("span"); status.className = variable.configured ? "sirk-secret-configured" : "sirk-secret-missing";
                        status.textContent = variable.configured ? "Configured" : (variable.required ? "Required" : "Not configured");
                        group.appendChild(formRow(variable.label + (variable.required ? " *" : ""), input)); group.appendChild(status); group.appendChild(clearLabel);
                        card.appendChild(group); controls.push({ variable: variable, input: input, clear: clear });
                    });
                    if (!controls.length) card.appendChild(document.createTextNode("This script has no SaveSecret directives."));
                    var save = shell.element("button", "btn btn-primary btn-sm", "Save credentials"); save.type = "button";
                    save.onclick = function () {
                        var values = {}, clearNames = [];
                        controls.forEach(function (item) { if (item.input.value) values[item.variable.name] = item.input.value; if (item.clear.checked) clearNames.push(item.variable.name); });
                        save.disabled = true;
                        shell.post("script-secrets", { path: script.path, values: values, clearNames: clearNames }).then(function (result) { if (typeof onSaved === "function") onSaved(result); }).catch(function (error) { save.disabled = false; shell.error(host, error); });
                    };
                    card.appendChild(save); host.appendChild(card);
                }).catch(function (error) { shell.error(shell.state.page.details, error); });
            }

            function openMultiExecution(shell, script, currentNodeId, submit) {
                var devices = selectedDevices(currentNodeId), host = shell.state.page.details;
                host.innerHTML = "";
                var card = shell.card("Multi-device execution", script.label || script.name);
                card.classList.add("sirk-multi-editor-card");
                if (!devices.length) {
                    card.appendChild(document.createTextNode("Select devices in SIRK Portal before using this action.")); host.appendChild(card); return;
                }
                var list = document.createElement("div"); list.className = "sirk-multi-device-list";
                devices.forEach(function (device) {
                    var row = document.createElement("label"), box = document.createElement("input"); box.type = "checkbox"; box.checked = true; box.value = device.id;
                    row.appendChild(box); row.appendChild(document.createTextNode(" " + device.name)); row.title = device.id; list.appendChild(row);
                });
                card.appendChild(list);
                var run = shell.element("button", "btn btn-primary btn-sm", "Run on selected devices"); run.type = "button";
                run.onclick = function () {
                    var ids = Array.prototype.map.call(list.querySelectorAll('input:checked'), function (box) { return box.value; });
                    if (!ids.length) return;
                    if (!window.confirm("Run '" + (script.label || script.name) + "' on " + ids.length + " selected device(s)?")) return;
                    run.disabled = true;
                    Promise.resolve(submit(ids)).catch(function (error) { run.disabled = false; shell.error(host, error); });
                };
                card.appendChild(run); host.appendChild(card);
            }

            return {
                state: state, isFavorite: isFavorite, toggleFavorite: toggleFavorite, copyText: copyText,
                selectedDevices: selectedDevices,
                filterScript: function (script) { return !state.favoritesOnly || isFavorite(script.path); },
                saveTreeState: function (treeState) { savePreferences({ selectedRoot: text(treeState && treeState.selectedRoot) }); },
                restoreTreeState: function (treeState) { var stored = readPreferences(); if (stored.selectedRoot) treeState.selectedRoot = text(stored.selectedRoot); },
                applyDeepLink: function (tree, treeState) {
                    if (state.deepLinkApplied || !tree) return; state.deepLinkApplied = true;
                    try {
                        var path = new URL(window.location.href).searchParams.get(deepLinkParameter);
                        if (!path || !window.SharedDirectoryTree.find(tree, path)) return;
                        var location = findRootAndParents(tree, path); treeState.selectedScript = path;
                        if (location.root) treeState.selectedRoot = location.root;
                        (location.parents || []).forEach(function (folder) { treeState.expanded[folder] = true; });
                    } catch (error) {}
                },
                syncToolbar: function (toolbar, mode, selectedScript, config) {
                    if (!toolbar) return; config = config || {}; var scriptsMode = mode !== "results";
                    toolbar.setActive("favorites", state.favoritesOnly && scriptsMode);
                    toolbar.setActive("manage", state.editMode && scriptsMode);
                    toolbar.setActive("link", state.linkPickMode && scriptsMode);
                    toolbar.setActive("multi", state.multiPickMode && scriptsMode);
                    toolbar.setEnabled("favorites", scriptsMode); toolbar.setEnabled("manage", scriptsMode && config.canEdit === true);
                    toolbar.setEnabled("link", scriptsMode); toolbar.setEnabled("multi", scriptsMode && config.enableMulti === true);
                    toolbar.setVisible("manage", config.canEdit === true); toolbar.setVisible("multi", config.enableMulti === true);
                    updateTitle(toolbar, "favorites", state.favoritesOnly ? "Show all scripts" : "Show favorites");
                    updateTitle(toolbar, "manage", state.editMode ? "Close edit mode" : "Edit script definitions");
                    updateTitle(toolbar, "link", state.linkPickMode ? "Close link mode" : selectedScript ? "Copy link to selected script" : "Show link icons beside scripts");
                    updateTitle(toolbar, "multi", state.multiPickMode ? "Close multi-device mode" : "Show multi-device icons beside scripts");
                },
                toggleFavorites: function (toolbar, onChange) { state.favoritesOnly = !state.favoritesOnly; savePreferences(); if (toolbar) toolbar.setActive("favorites", state.favoritesOnly); if (onChange) onChange(); },
                toggleEdit: function (toolbar, onChange) { state.editMode = !state.editMode; stopPickModes("edit"); if (toolbar) { toolbar.setActive("manage", state.editMode); toolbar.setActive("link", false); toolbar.setActive("multi", false); } if (onChange) onChange(); },
                toggleLink: function (toolbar, selectedScript, onChange, onCopied) {
                    if (selectedScript) return copyScriptLink(selectedScript).then(function () { if (toolbar) toolbar.setActive("link", true); setTimeout(function () { if (toolbar) toolbar.setActive("link", false); }, 900); if (onCopied) onCopied(selectedScript); return true; });
                    state.linkPickMode = !state.linkPickMode; stopPickModes(state.linkPickMode ? "link" : "");
                    if (toolbar) { toolbar.setActive("link", state.linkPickMode); toolbar.setActive("multi", false); }
                    if (onChange) onChange(); return Promise.resolve(false);
                },
                toggleMulti: function (toolbar, onChange) { state.multiPickMode = !state.multiPickMode; stopPickModes(state.multiPickMode ? "multi" : ""); if (toolbar) { toolbar.setActive("multi", state.multiPickMode); toolbar.setActive("link", false); } if (onChange) onChange(); },
                openDefinitionEditor: openDefinitionEditor,
                openCredentialsEditor: openCredentialsEditor,
                openMultiExecution: openMultiExecution,
                scriptActions: function (script, config) {
                    config = config || {}; var actions = [];
                    if (state.linkPickMode) actions.push({ key: "link", icon: "🔗", title: "Copy bookmarkable link for this script", onClick: function () { copyScriptLink(script.path).then(function () { if (config.onLinkCopied) config.onLinkCopied(script); }); } });
                    if (config.canEdit === true && script.secretVariables && script.secretVariables.length) actions.push({ key: "credentials", icon: "🔑", className: "sirk-tree-credential-action", title: "Configure script credentials", onClick: function () { if (config.onCredentials) config.onCredentials(script); } });
                    if (state.editMode) {
                        actions.push({ key: "favorite", icon: "★", active: isFavorite(script.path), className: "sirk-tree-favorite-action", title: isFavorite(script.path) ? "Remove from favorites" : "Add to favorites", onClick: function () { toggleFavorite(script.path); if (config.onFavoriteChanged) config.onFavoriteChanged(script); } });
                        if (config.canEdit === true) actions.push({ key: "edit", icon: "✎", title: "Edit script definition and approval levels", onClick: function () { if (config.onEdit) config.onEdit(script); } });
                    }
                    if (state.multiPickMode && config.enableMulti === true) actions.push({ key: "multi", icon: "⟳", title: "Run this script on selected devices", onClick: function () { if (config.onMulti) config.onMulti(script); } });
                    return actions;
                }
            };
        }
    };
}());
