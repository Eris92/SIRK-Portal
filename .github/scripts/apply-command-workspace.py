from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def split_selector_list(value: str) -> list[str]:
    result: list[str] = []
    start = 0
    depth = 0
    quote = ""
    escape = False
    for index, char in enumerate(value):
        if quote:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = ""
            continue
        if char in "\"'":
            quote = char
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth = max(0, depth - 1)
        elif char == "," and depth == 0:
            result.append(value[start:index])
            start = index + 1
    result.append(value[start:])
    return result


def find_open_brace(text: str, start: int) -> int:
    quote = ""
    escape = False
    in_comment = False
    index = start
    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if in_comment:
            if char == "*" and nxt == "/":
                in_comment = False
                index += 2
                continue
        elif quote:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = ""
        elif char == "/" and nxt == "*":
            in_comment = True
            index += 2
            continue
        elif char in "\"'":
            quote = char
        elif char == "{":
            return index
        index += 1
    return -1


def find_close_brace(text: str, open_index: int) -> int:
    depth = 1
    quote = ""
    escape = False
    in_comment = False
    index = open_index + 1
    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if in_comment:
            if char == "*" and nxt == "/":
                in_comment = False
                index += 2
                continue
        elif quote:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = ""
        elif char == "/" and nxt == "*":
            in_comment = True
            index += 2
            continue
        elif char in "\"'":
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise RuntimeError("Unbalanced CSS block")


def strip_quick_rules(css: str) -> str:
    tokens = (".sirk-quick-command", ".sirk-quick-commands")

    def process(fragment: str) -> str:
        output: list[str] = []
        cursor = 0
        while True:
            open_index = find_open_brace(fragment, cursor)
            if open_index < 0:
                output.append(fragment[cursor:])
                break
            close_index = find_close_brace(fragment, open_index)
            prelude = fragment[cursor:open_index]
            body = fragment[open_index + 1:close_index]
            stripped = prelude.lstrip()
            leading = prelude[:len(prelude) - len(stripped)]
            if stripped.startswith("@media") or stripped.startswith("@supports") or stripped.startswith("@layer"):
                nested = process(body)
                if nested.strip():
                    output.append(prelude + "{" + nested + "}")
            else:
                selectors = split_selector_list(stripped)
                kept = [selector for selector in selectors if not any(token in selector for token in tokens)]
                if kept:
                    output.append(leading + ",".join(kept) + "{" + body + "}")
            cursor = close_index + 1
        return "".join(output)

    result = process(css)
    if any(token in result for token in tokens):
        raise RuntimeError("Quick Commands selectors remain in device-workspace.css")
    return result


commands_css = r'''/* Canonical Commands and Quick Commands workspace.
   Both command surfaces intentionally share this single stylesheet. */

#sirkPortalRoot .sirk-device-commands-host,
#sirkPortalRoot .sirk-quick-commands-panel{
    --sirk-command-primary:205px;
    --sirk-command-secondary:340px;
    --sirk-command-details:300px;
    --sirk-command-collapsed:64px;
    --sirk-command-border:var(--sirk-border,#dce3ec);
    --sirk-command-panel:var(--sirk-panel,#fff);
    --sirk-command-text:var(--sirk-text,#172033);
    --sirk-command-muted:var(--sirk-muted,#64748b);
    --sirk-command-hover:var(--sirk-hover,#eef3f9);
    --sirk-command-accent:#3867d6;
    color:var(--sirk-command-text);
}

#sirkPortalRoot .sirk-device-commands-host{
    min-width:0;
    height:100%;
}

#sirkPortalRoot .sirk-device-commands-host .sirk-view-shell{
    display:grid;
    grid-template-rows:auto minmax(0,1fr);
    min-height:520px;
    height:calc(100vh - 235px);
    overflow:hidden;
    border:1px solid var(--sirk-command-border);
    border-radius:9px;
    background:var(--sirk-command-panel);
}

#sirkPortalRoot .sirk-device-commands-host .sirk-tabs-host:empty{display:none}

#sirkPortalRoot .sirk-device-commands-host .sirk-layout-host,
#sirkPortalRoot .sirk-quick-command-browser{
    display:grid;
    grid-template-columns:minmax(165px,var(--sirk-command-primary)) minmax(285px,var(--sirk-command-secondary)) minmax(240px,1fr);
    min-width:0;
    min-height:0;
    height:100%;
    overflow:hidden;
    background:var(--sirk-command-panel);
}

#sirkPortalRoot .sirk-device-commands-host .sirk-layout-host.is-collapsed,
#sirkPortalRoot .sirk-quick-command-browser.is-collapsed{
    grid-template-columns:var(--sirk-command-collapsed) minmax(285px,var(--sirk-command-secondary)) minmax(240px,1fr);
}

#sirkPortalRoot .sirk-quick-command-browser.is-details-collapsed{
    grid-template-columns:minmax(165px,var(--sirk-command-primary)) minmax(285px,var(--sirk-command-secondary)) 0;
}

#sirkPortalRoot .sirk-quick-command-browser.is-collapsed.is-details-collapsed{
    grid-template-columns:var(--sirk-command-collapsed) minmax(285px,var(--sirk-command-secondary)) 0;
}

#sirkPortalRoot .sirk-device-commands-host :is(.sirk-column-primary,.sirk-column-secondary,.sirk-column-details),
#sirkPortalRoot .sirk-quick-command-browser :is(.sirk-command-primary,.sirk-command-secondary,.sirk-command-details){
    min-width:0;
    min-height:0;
    overflow:auto;
    padding:10px 8px;
    box-sizing:border-box;
    background:var(--sirk-command-panel);
}

#sirkPortalRoot .sirk-device-commands-host :is(.sirk-column-primary,.sirk-column-secondary),
#sirkPortalRoot .sirk-quick-command-browser :is(.sirk-command-primary,.sirk-command-secondary){
    border-right:1px solid var(--sirk-command-border);
}

#sirkPortalRoot .sirk-device-commands-host .sirk-layout-host.is-collapsed .sirk-column-primary,
#sirkPortalRoot .sirk-quick-command-browser.is-collapsed .sirk-command-primary{
    padding:8px 5px;
}

#sirkPortalRoot .sirk-quick-command-browser.is-details-collapsed .sirk-command-details{
    display:none;
}

#sirkPortalRoot .sirk-device-commands-host :is(.sirk-nav-item,.sirk-tree-folder-header,.sirk-tree-script),
#sirkPortalRoot .sirk-quick-command-browser :is([data-quick-command-category],[data-quick-command-item]){
    display:flex;
    align-items:center;
    gap:8px;
    width:100%;
    min-width:0;
    min-height:38px;
    margin:0 0 3px;
    padding:8px 9px;
    border:1px solid transparent;
    border-radius:7px;
    background:transparent;
    color:inherit;
    text-align:left;
    cursor:pointer;
    box-sizing:border-box;
}

#sirkPortalRoot .sirk-device-commands-host :is(.sirk-nav-item,.sirk-tree-folder-header,.sirk-tree-script):hover,
#sirkPortalRoot .sirk-quick-command-browser :is([data-quick-command-category],[data-quick-command-item]):hover{
    background:var(--sirk-command-hover);
}

#sirkPortalRoot .sirk-device-commands-host :is(.sirk-nav-item,.sirk-tree-script).active,
#sirkPortalRoot .sirk-quick-command-browser :is([data-quick-command-category],[data-quick-command-item]).is-active{
    border-color:#9bbcff;
    background:#edf3ff;
    color:#214fbd;
    box-shadow:inset 3px 0 0 var(--sirk-command-accent);
}

#sirkPortalRoot .sirk-device-commands-host :is(.sirk-tree-label,.sirk-nav-item span),
#sirkPortalRoot .sirk-quick-command-browser :is([data-quick-command-category],[data-quick-command-item]) strong{
    min-width:0;
    overflow-wrap:anywhere;
    white-space:normal;
    line-height:1.25;
}

#sirkPortalRoot .sirk-quick-command-browser [data-quick-command-item]{align-items:flex-start}
#sirkPortalRoot .sirk-quick-command-browser [data-quick-command-item] > span{display:grid;gap:3px;min-width:0;flex:1 1 auto}
#sirkPortalRoot .sirk-quick-command-browser [data-quick-command-item] small{
    display:block;
    color:var(--sirk-command-muted);
    font-size:12px;
    line-height:1.3;
    overflow-wrap:anywhere;
}
#sirkPortalRoot .sirk-command-favorite-mark{flex:0 0 auto;color:#d69e00;font-size:15px;line-height:1}

#sirkPortalRoot .sirk-command-toolbar,
#sirkPortalRoot .sirk-device-commands-host .sirk-toolbar-host{
    display:flex;
    align-items:center;
    gap:7px;
    min-height:50px;
    padding:7px 10px;
    border-bottom:1px solid var(--sirk-command-border);
    background:var(--sirk-command-panel);
    box-sizing:border-box;
}

#sirkPortalRoot .sirk-command-toolbar-left,
#sirkPortalRoot .sirk-command-toolbar-right{
    display:flex;
    align-items:center;
    gap:6px;
    min-width:0;
    flex-wrap:nowrap;
}
#sirkPortalRoot .sirk-command-toolbar-left{flex:1 1 auto}
#sirkPortalRoot .sirk-command-toolbar-right{flex:0 0 auto;margin-left:auto}

#sirkPortalRoot .sirk-command-icon-button,
#sirkPortalRoot .sirk-device-commands-host .sirk-toolbar-button{
    appearance:none;
    display:inline-grid;
    place-items:center;
    width:36px;
    min-width:36px;
    height:36px;
    min-height:36px;
    padding:0;
    border:1px solid var(--sirk-command-border);
    border-radius:8px;
    background:var(--sirk-command-panel);
    color:var(--sirk-command-text);
    box-shadow:none;
    cursor:pointer;
    line-height:1;
}

#sirkPortalRoot .sirk-command-icon-button:hover,
#sirkPortalRoot .sirk-command-icon-button.is-active,
#sirkPortalRoot .sirk-device-commands-host .sirk-toolbar-button:hover,
#sirkPortalRoot .sirk-device-commands-host .sirk-toolbar-button.is-active{
    border-color:#75a7ff;
    background:#edf3ff;
    color:#214fbd;
}

#sirkPortalRoot .sirk-command-icon-button.has-attention{
    border-color:#e8a3a3;
    background:#fff0f0;
    color:#b42318;
}

#sirkPortalRoot .sirk-command-icon-button svg,
#sirkPortalRoot .sirk-device-commands-host .sirk-toolbar-button svg{
    display:block;
    width:20px;
    height:20px;
    fill:none;
    stroke:currentColor;
    stroke-width:1.8;
    stroke-linecap:round;
    stroke-linejoin:round;
    overflow:visible;
}

#sirkPortalRoot .sirk-command-search{
    display:flex;
    align-items:center;
    gap:7px;
    flex:1 1 150px;
    min-width:80px;
    max-width:320px;
    height:36px;
    padding:0 9px;
    border:1px solid var(--sirk-command-border);
    border-radius:8px;
    background:var(--sirk-command-panel);
    box-sizing:border-box;
}
#sirkPortalRoot .sirk-command-search:focus-within{border-color:#75a7ff;box-shadow:0 0 0 2px rgba(56,103,214,.12)}
#sirkPortalRoot .sirk-command-search svg{width:17px;height:17px;flex:0 0 17px;fill:none;stroke:currentColor;stroke-width:1.8}
#sirkPortalRoot .sirk-command-search input{
    width:100%;
    min-width:0;
    height:32px;
    padding:0;
    border:0;
    outline:0;
    background:transparent;
    color:inherit;
    font:inherit;
}

#sirkPortalRoot .sirk-quick-commands-toggle{
    position:absolute;
    z-index:24;
    top:8px;
    right:8px;
    display:inline-flex;
    align-items:center;
    gap:7px;
    width:auto;
    min-width:0;
    padding:0 11px;
    font-size:13px;
    font-weight:700;
}
#sirkPortalRoot .sirk-quick-commands-toggle svg{width:18px;height:18px}

#sirkPortalRoot .sirk-agent-desktop{position:relative}
#sirkPortalRoot .sirk-quick-commands-panel{
    position:absolute;
    z-index:23;
    top:52px;
    right:8px;
    bottom:8px;
    display:grid;
    grid-template-rows:auto minmax(0,1fr);
    width:min(845px,calc(100% - 16px));
    min-width:0;
    min-height:320px;
    overflow:hidden;
    border:1px solid var(--sirk-command-border);
    border-radius:10px;
    background:var(--sirk-command-panel);
    box-shadow:0 18px 44px rgba(15,23,42,.24);
}
#sirkPortalRoot .sirk-quick-commands-panel[hidden]{display:none}
#sirkPortalRoot .sirk-quick-commands-panel:has(.sirk-quick-command-browser.is-collapsed){width:min(704px,calc(100% - 16px))}
#sirkPortalRoot .sirk-quick-commands-panel:has(.sirk-quick-command-browser.is-details-collapsed){width:min(545px,calc(100% - 16px))}
#sirkPortalRoot .sirk-quick-commands-panel:has(.sirk-quick-command-browser.is-collapsed.is-details-collapsed){width:min(404px,calc(100% - 16px))}

#sirkPortalRoot .sirk-command-details,
#sirkPortalRoot .sirk-device-commands-host .sirk-column-details{
    display:flex;
    flex-direction:column;
    gap:10px;
}
#sirkPortalRoot .sirk-command-details-empty{margin:auto;color:var(--sirk-command-muted);text-align:center;line-height:1.45}
#sirkPortalRoot .sirk-quick-command-run{display:flex;flex-direction:column;gap:9px;flex:0 0 auto}
#sirkPortalRoot .sirk-quick-command-run h3{margin:0;font-size:17px;line-height:1.3;overflow-wrap:anywhere}
#sirkPortalRoot .sirk-quick-command-run p{margin:0;color:var(--sirk-command-muted);line-height:1.4;overflow-wrap:anywhere}
#sirkPortalRoot .sirk-quick-command-field{display:grid;gap:5px;margin:0}
#sirkPortalRoot .sirk-quick-command-field > span{font-size:12px;font-weight:700;color:var(--sirk-command-muted)}
#sirkPortalRoot .sirk-quick-command-field :is(input,select),
#sirkPortalRoot .sirk-device-commands-host :is(input,select,textarea){
    width:100%;
    min-width:0;
    min-height:36px;
    padding:7px 9px;
    border:1px solid var(--sirk-command-border);
    border-radius:7px;
    background:var(--sirk-command-panel);
    color:inherit;
    box-sizing:border-box;
}
#sirkPortalRoot .sirk-quick-command-submit{
    min-height:38px;
    padding:8px 13px;
    border:1px solid #2d5fc8;
    border-radius:7px;
    background:#3867d6;
    color:#fff;
    font-weight:700;
    cursor:pointer;
}
#sirkPortalRoot .sirk-quick-command-submit:disabled{opacity:.55;cursor:wait}
#sirkPortalRoot .sirk-quick-command-status{
    display:block;
    flex:1 1 auto;
    min-height:72px;
    max-width:none;
    margin:0;
    padding:10px;
    overflow:auto;
    border:1px solid var(--sirk-command-border);
    border-radius:7px;
    background:rgba(100,116,139,.07);
    color:inherit;
    white-space:pre-wrap;
    overflow-wrap:anywhere;
    font:12px/1.45 Consolas,"Cascadia Mono",monospace;
}
#sirkPortalRoot .sirk-quick-command-status:empty{display:none}
#sirkPortalRoot .sirk-quick-command-status.is-error{color:#b42318;border-color:#efb4b4;background:#fff4f4}
#sirkPortalRoot .sirk-command-loading,
#sirkPortalRoot .sirk-command-error{padding:20px;text-align:center;color:var(--sirk-command-muted)}
#sirkPortalRoot .sirk-command-error{color:#b42318}

@media(max-width:1100px){
    #sirkPortalRoot .sirk-device-commands-host .sirk-layout-host,
    #sirkPortalRoot .sirk-quick-command-browser{
        grid-template-columns:minmax(145px,185px) minmax(250px,320px) minmax(220px,1fr);
    }
    #sirkPortalRoot .sirk-quick-commands-panel{width:min(765px,calc(100% - 16px))}
    #sirkPortalRoot .sirk-quick-commands-panel:has(.sirk-quick-command-browser.is-collapsed){width:min(644px,calc(100% - 16px))}
    #sirkPortalRoot .sirk-quick-commands-panel:has(.sirk-quick-command-browser.is-details-collapsed){width:min(485px,calc(100% - 16px))}
    #sirkPortalRoot .sirk-quick-commands-panel:has(.sirk-quick-command-browser.is-collapsed.is-details-collapsed){width:min(364px,calc(100% - 16px))}
}

@media(max-width:760px){
    #sirkPortalRoot .sirk-quick-commands-panel{top:48px;left:6px;right:6px;bottom:6px;width:auto!important}
    #sirkPortalRoot .sirk-quick-command-browser,
    #sirkPortalRoot .sirk-quick-command-browser.is-collapsed,
    #sirkPortalRoot .sirk-quick-command-browser.is-details-collapsed,
    #sirkPortalRoot .sirk-quick-command-browser.is-collapsed.is-details-collapsed{
        grid-template-columns:110px minmax(0,1fr);
        grid-template-rows:minmax(180px,1fr) minmax(160px,.8fr);
    }
    #sirkPortalRoot .sirk-quick-command-browser .sirk-command-details{grid-column:1 / -1;display:flex}
    #sirkPortalRoot .sirk-quick-command-browser.is-details-collapsed .sirk-command-details{display:none}
    #sirkPortalRoot .sirk-command-toolbar{padding:6px;gap:4px}
    #sirkPortalRoot .sirk-command-toolbar-left,#sirkPortalRoot .sirk-command-toolbar-right{gap:3px}
    #sirkPortalRoot .sirk-command-icon-button{width:34px;min-width:34px;height:34px;min-height:34px}
    #sirkPortalRoot .sirk-command-search{max-width:none}
    #sirkPortalRoot .sirk-quick-commands-toggle span{display:none}
    #sirkPortalRoot .sirk-quick-commands-toggle{width:36px;padding:0;justify-content:center}
    #sirkPortalRoot .sirk-device-commands-host .sirk-view-shell{height:auto;min-height:560px}
    #sirkPortalRoot .sirk-device-commands-host .sirk-layout-host,
    #sirkPortalRoot .sirk-device-commands-host .sirk-layout-host.is-collapsed{
        grid-template-columns:110px minmax(0,1fr);
        grid-template-rows:minmax(220px,1fr) minmax(220px,1fr);
    }
    #sirkPortalRoot .sirk-device-commands-host .sirk-column-details{grid-column:1 / -1}
}
'''

quick_block = r'''    function quickReadBoolean(key, fallback) {
        try {
            var value = localStorage.getItem(key);
            return value == null ? fallback : value === "1";
        } catch (error) { return fallback; }
    }

    function quickWriteBoolean(key, value) {
        try { localStorage.setItem(key, value ? "1" : "0"); } catch (error) {}
    }

    function quickItemKey(item) {
        if (!item) return "";
        return String(item.path || (item.kind === "command" ? "@command/" + item.commandId : ""));
    }

    function quickFavoritePaths() {
        try {
            var value = JSON.parse(localStorage.getItem("sirkPlatform.commands.preferences") || "{}");
            return Array.isArray(value.favorites) ? value.favorites.map(String) : [];
        } catch (error) { return []; }
    }

    function quickIsFavorite(item) {
        return quickFavoritePaths().indexOf(quickItemKey(item)) >= 0;
    }

    function quickIcon(name) {
        var icons = {
            bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/></svg>',
            collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6-6 6 6 6M21 6l-6 6 6 6"/></svg>',
            expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6 6-6 6M15 6l6 6-6 6"/></svg>',
            star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
            details: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 8h2M17 12h2M17 16h2"/></svg>',
            search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>',
            refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v6h-6M4 18v-6h6"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/></svg>',
            close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
        };
        return icons[name] || "";
    }

    function quickSetOutput(value, error, completed) {
        quickCommands.output = String(value == null ? "" : value);
        quickCommands.outputError = error === true;
        if (completed && quickCommands.detailsCollapsed) quickCommands.outputAttention = true;
        var status = document.querySelector("#sirkQuickCommandsPanel .sirk-quick-command-status");
        if (status) {
            status.textContent = quickCommands.output;
            status.classList.toggle("is-error", quickCommands.outputError);
        }
        var details = document.querySelector("#sirkQuickCommandsPanel [data-quick-command-details]");
        if (details) details.classList.toggle("has-attention", quickCommands.outputAttention);
    }

    function loadCompactCommands(force) {
        if (quickCommands.data && !force) return Promise.resolve(quickCommands.data);
        var panel = document.getElementById("sirkQuickCommandsPanel");
        if (panel) panel.innerHTML = '<div class="sirk-command-loading">' + esc(t("loadingCommands")) + '</div>';
        return core.api("commands", "scripts").then(function (response) {
            quickCommands.data = { tree: response.tree || { children: [] }, catalog: response.catalog || [] };
            return quickCommands.data;
        });
    }

    function ensureCompactCommands(host) {
        var operation = host.querySelector(".sirk-agent-desktop") || host;
        if (operation.querySelector("#sirkQuickCommandsPanel")) return;
        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.id = "sirkQuickCommandsToggle";
        toggle.className = "sirk-quick-commands-toggle sirk-command-icon-button";
        toggle.setAttribute("aria-expanded", "false");
        toggle.title = t("quickCommands");
        toggle.innerHTML = quickIcon("bolt") + '<span>' + esc(t("quickCommands")) + '</span>';
        var panel = document.createElement("aside");
        panel.id = "sirkQuickCommandsPanel";
        panel.className = "sirk-quick-commands-panel";
        panel.hidden = true;
        operation.appendChild(toggle);
        operation.appendChild(panel);
        toggle.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            var opening = panel.hidden;
            panel.hidden = !opening;
            toggle.setAttribute("aria-expanded", opening ? "true" : "false");
            if (!opening) return;
            loadCompactCommands(false).then(renderCompactCommands).catch(function (error) {
                panel.innerHTML = '<div class="sirk-command-error">' + esc(error.message || String(error)) + '</div>';
            });
        });
    }

    function flattenCommandScripts(node, prefix, output) {
        (node && node.children || []).forEach(function (child) {
            if (child.type === "script") {
                output.push({ kind: "script", path: child.path, label: localized(child, "label") || child.name || child.path, description: localized(child, "description") || "", requiresApproval: child.requiresApproval === true, confirmExecution: child.confirmExecution === true, variables: child.variables || [] });
                return;
            }
            flattenCommandScripts(child, prefix ? prefix + " / " + (localized(child, "label") || child.name) : (localized(child, "label") || child.name), output);
        });
        return output;
    }

    function compactCategories(data) {
        var categories = [];
        (data.tree && data.tree.children || []).forEach(function (root) {
            categories.push({ key: "script:" + root.path, label: localized(root, "label") || root.name || root.path, items: flattenCommandScripts(root, "", []) });
        });
        (data.catalog || []).forEach(function (category) {
            categories.push({
                key: "catalog:" + category.key,
                label: category.title || category.key,
                items: (category.commands || []).map(function (command) {
                    return { kind: "command", commandId: command.id, path: "@command/" + category.key + "/" + command.id, label: command.label || command.id, description: command.description || "", requiresApproval: command.requiresApproval === true, confirmExecution: command.confirmExecution === true, variables: command.variables || [] };
                })
            });
        });
        return categories.filter(function (category) { return category.items.length > 0; });
    }

    function compactVariableForm(host, item) {
        var controls = [];
        if (!(item.variables || []).length) return function () { return {}; };
        host.appendChild((function () { var heading = document.createElement("h4"); heading.textContent = t("variables"); return heading; }()));
        (item.variables || []).forEach(function (variable) {
            var row = document.createElement("label");
            row.className = "sirk-quick-command-field";
            var caption = document.createElement("span");
            var labels = variable.labels || {};
            caption.textContent = (labels[language()] || variable.label || variable.name) + (variable.required ? " *" : "");
            row.appendChild(caption);
            var input;
            if (variable.control === "select") {
                input = document.createElement("select");
                (variable.options || []).forEach(function (choice) {
                    var option = document.createElement("option");
                    option.value = String(choice.value == null ? choice : choice.value);
                    option.textContent = choice.labels && choice.labels[language()] || choice.label || option.value;
                    input.appendChild(option);
                });
            } else {
                input = document.createElement("input");
                input.type = variable.control === "switch" ? "checkbox" : "text";
            }
            if (input.type === "checkbox") input.checked = /^(1|true|yes|tak)$/i.test(String(variable.defaultValue || ""));
            else input.value = String(variable.defaultValue == null ? "" : variable.defaultValue);
            row.appendChild(input);
            host.appendChild(row);
            controls.push({ variable: variable, input: input });
        });
        return function () {
            var values = {};
            controls.forEach(function (entry) { values[entry.variable.name] = entry.input.type === "checkbox" ? entry.input.checked : entry.input.value; });
            return values;
        };
    }

    function pollCompactOutput(item, id, token, attempt) {
        if (token !== quickCommands.pollToken || quickItemKey(item) !== quickItemKey(quickCommands.selected)) return;
        core.api("commands", "output", null, { id: id }).then(function (response) {
            if (token !== quickCommands.pollToken || quickItemKey(item) !== quickItemKey(quickCommands.selected)) return;
            if (response.ready) {
                quickSetOutput(response.output || (response.status ? t("commandCompleted") + " " + response.status : t("commandCompleted")), false, true);
                return;
            }
            if (attempt >= 300) {
                quickSetOutput(t("commandTimeout"), true, true);
                return;
            }
            quickSetOutput(t("waitingOutput"), false, false);
            window.setTimeout(function () { pollCompactOutput(item, id, token, attempt + 1); }, 1000);
        }).catch(function (error) { if (token === quickCommands.pollToken) quickSetOutput(error.message || String(error), true, true); });
    }

    function submitCompactCommand(item, values, button) {
        if (item.confirmExecution === true && !window.confirm(t("confirmCommand") + ' "' + item.label + '"?')) return;
        button.disabled = true;
        quickCommands.pollToken += 1;
        var token = quickCommands.pollToken;
        quickSetOutput(t("submittingCommand"), false, false);
        var payload = { nodeId: String(selectedNode && (selectedNode.id || selectedNode._id) || ""), nodeName: selectedNode && selectedNode.name || "", variableValues: values || {}, confirmedExecution: item.confirmExecution === true, note: "" };
        if (item.kind === "command") payload.commandId = item.commandId;
        else payload.scriptPath = item.path;
        core.post("commands", "execute", payload).then(function (response) {
            var request = response.request || {}, result = request.result || {};
            if (request.status === "pending") {
                quickSetOutput(t("commandPending"), false, true);
                return;
            }
            if (result.id) {
                quickSetOutput(result.output || result.message || t("waitingOutput"), false, false);
                pollCompactOutput(item, result.id, token, 0);
                return;
            }
            quickSetOutput(result.output || result.message || request.status || t("commandSent"), false, true);
        }).catch(function (error) {
            quickSetOutput(t("commandFailed") + " " + (error.message || String(error)), true, true);
        }).then(function () { button.disabled = false; });
    }

    function renderCompactCommands() {
        var panel = document.getElementById("sirkQuickCommandsPanel");
        if (!panel || !quickCommands.data) return;
        var categories = compactCategories(quickCommands.data);
        if (!categories.some(function (category) { return category.key === quickCommands.category; })) quickCommands.category = categories[0] && categories[0].key || "";
        var selectedCategory = categories.find(function (category) { return category.key === quickCommands.category; });
        var query = String(quickCommands.search || "").toLowerCase();
        var items = (selectedCategory && selectedCategory.items || []).filter(function (item) {
            if (quickCommands.favoritesOnly && !quickIsFavorite(item)) return false;
            return !query || (item.label + " " + item.description).toLowerCase().indexOf(query) >= 0;
        });
        var selectedKey = quickItemKey(quickCommands.selected);
        if (selectedKey && !items.some(function (item) { return quickItemKey(item) === selectedKey; })) quickCommands.selected = null;
        var browserClass = "sirk-quick-command-browser sirk-command-layout" + (quickCommands.collapsed ? " is-collapsed" : "") + (quickCommands.detailsCollapsed ? " is-details-collapsed" : "");
        panel.innerHTML = '<header class="sirk-command-toolbar"><div class="sirk-command-toolbar-left">' +
            '<button type="button" class="sirk-command-icon-button" data-quick-command-collapse title="' + esc(quickCommands.collapsed ? t("expandCategories") : t("collapseCategories")) + '">' + quickIcon(quickCommands.collapsed ? "expand" : "collapse") + '</button>' +
            '<button type="button" class="sirk-command-icon-button' + (quickCommands.favoritesOnly ? " is-active" : "") + '" data-quick-command-favorites title="' + esc(t("favorites")) + '">' + quickIcon("star") + '</button>' +
            '<button type="button" class="sirk-command-icon-button' + (quickCommands.detailsCollapsed ? "" : " is-active") + (quickCommands.outputAttention ? " has-attention" : "") + '" data-quick-command-details title="' + esc(quickCommands.detailsCollapsed ? t("showOutput") : t("hideOutput")) + '">' + quickIcon("details") + '</button>' +
            '<label class="sirk-command-search">' + quickIcon("search") + '<input class="sirk-quick-command-search" type="search" placeholder="' + esc(t("searchCommands")) + '" value="' + esc(quickCommands.search) + '"></label></div>' +
            '<div class="sirk-command-toolbar-right"><button type="button" class="sirk-command-icon-button" data-quick-command-refresh title="' + esc(t("refresh")) + '">' + quickIcon("refresh") + '</button>' +
            '<button type="button" class="sirk-command-icon-button" data-quick-command-close title="' + esc(t("close")) + '">' + quickIcon("close") + '</button></div></header>' +
            '<div class="' + browserClass + '"><nav class="sirk-command-primary">' + categories.map(function (category) {
                return '<button type="button" data-quick-command-category="' + esc(category.key) + '" class="' + (category.key === quickCommands.category ? "is-active" : "") + '"><strong>' + esc(category.label) + '</strong></button>';
            }).join("") + '</nav><section class="sirk-command-secondary">' + (items.length ? items.map(function (item, index) {
                return '<button type="button" data-quick-command-item="' + index + '" class="' + (quickItemKey(item) === selectedKey ? "is-active" : "") + '">' + (quickIsFavorite(item) ? '<i class="sirk-command-favorite-mark">★</i>' : '') + '<span><strong>' + esc(item.label) + '</strong>' + (item.description ? '<small>' + esc(item.description) + '</small>' : '') + '</span></button>';
            }).join("") : '<p class="sirk-command-details-empty">' + esc(quickCommands.favoritesOnly ? t("noFavoriteCommands") : t("noCommands")) + '</p>') + '</section>' +
            '<section class="sirk-quick-command-details sirk-command-details"><div class="sirk-quick-command-run"><p class="sirk-command-details-empty">' + esc(t("selectCommand")) + '</p></div><pre class="sirk-quick-command-status" aria-live="polite"></pre></section></div>';
        panel.__items = items;
        if (quickCommands.selected) selectCompactCommand(quickCommands.selected, true);
        else quickSetOutput(quickCommands.output, quickCommands.outputError, false);
    }

    function selectCompactCommand(item, preserveOutput) {
        var panel = document.getElementById("sirkQuickCommandsPanel");
        var runHost = panel && panel.querySelector(".sirk-quick-command-run");
        if (!runHost) return;
        quickCommands.selected = item;
        if (!preserveOutput) {
            quickCommands.output = "";
            quickCommands.outputError = false;
            quickCommands.outputAttention = false;
        }
        Array.prototype.forEach.call(panel.querySelectorAll("[data-quick-command-item]"), function (button) {
            var index = Number(button.getAttribute("data-quick-command-item"));
            button.classList.toggle("is-active", panel.__items && quickItemKey(panel.__items[index]) === quickItemKey(item));
        });
        function show(value) {
            if (quickItemKey(value) !== quickItemKey(quickCommands.selected)) return;
            quickCommands.selected = value;
            runHost.innerHTML = "";
            var heading = document.createElement("h3"); heading.textContent = value.label; runHost.appendChild(heading);
            if (value.description) { var description = document.createElement("p"); description.textContent = value.description; runHost.appendChild(description); }
            var collect = compactVariableForm(runHost, value);
            var run = document.createElement("button"); run.type = "button"; run.className = "sirk-quick-command-submit"; run.textContent = value.requiresApproval ? t("requestCommand") : t("runCommand");
            run.addEventListener("click", function () { submitCompactCommand(value, collect(), run); });
            runHost.appendChild(run);
            quickSetOutput(quickCommands.output, quickCommands.outputError, false);
        }
        if (item.kind !== "script") { show(item); return; }
        core.api("commands", "script", null, { path: item.path }).then(function (response) {
            var script = response.script || item;
            show({ kind: "script", path: script.path, label: localized(script, "label") || script.label || script.name, description: localized(script, "description") || script.description || "", variables: script.variables || [], requiresApproval: script.requiresApproval === true, confirmExecution: script.confirmExecution === true });
        }).catch(function (error) { quickSetOutput(error.message || String(error), true, true); });
    }

'''

workspace_path = ROOT / "public/portal/standalone/scripts/device-workspace.js"
workspace = workspace_path.read_text(encoding="utf-8")
workspace = replace_once(
    workspace,
    '    var quickCommands = { data: null, category: "", selected: null, search: "" };',
    '    var quickCommands = { data: null, category: "", selected: null, search: "", favoritesOnly: false, collapsed: quickReadBoolean("sirkPortal.quickCommands.categoriesCollapsed", false), detailsCollapsed: quickReadBoolean("sirkPortal.quickCommands.detailsCollapsed", false), outputAttention: false, output: "", outputError: false, pollToken: 0 };',
    "Quick Commands state")
workspace = replace_once(
    workspace,
    '            commandSent: "Polecenie zostało wysłane.", commandPending: "Polecenie oczekuje na akceptację.", commandFailed: "Nie udało się wysłać polecenia.", confirmCommand: "Uruchomić polecenie"',
    '            commandSent: "Polecenie zostało wysłane.", commandPending: "Polecenie oczekuje na akceptację.", commandFailed: "Nie udało się wysłać polecenia.", confirmCommand: "Uruchomić polecenie",\n            collapseCategories: "Zwiń kategorie", expandCategories: "Rozwiń kategorie", favorites: "Pokaż ulubione", hideOutput: "Ukryj wyniki", showOutput: "Pokaż wyniki", refresh: "Odśwież", noFavoriteCommands: "Brak ulubionych poleceń.", selectCommand: "Wybierz polecenie, aby zobaczyć parametry i wynik.", submittingCommand: "Wysyłanie polecenia…", waitingOutput: "Oczekiwanie na wynik agenta…", commandCompleted: "Polecenie zakończone.", commandTimeout: "Przekroczono czas oczekiwania na wynik."',
    "Polish Quick Commands labels")
workspace = replace_once(
    workspace,
    '            commandSent: "Command submitted.", commandPending: "Command is waiting for approval.", commandFailed: "Command could not be submitted.", confirmCommand: "Run command"',
    '            commandSent: "Command submitted.", commandPending: "Command is waiting for approval.", commandFailed: "Command could not be submitted.", confirmCommand: "Run command",\n            collapseCategories: "Collapse categories", expandCategories: "Expand categories", favorites: "Show favorites", hideOutput: "Hide output", showOutput: "Show output", refresh: "Refresh", noFavoriteCommands: "No favorite commands.", selectCommand: "Select a command to view parameters and output.", submittingCommand: "Submitting command…", waitingOutput: "Waiting for agent output…", commandCompleted: "Command completed.", commandTimeout: "Command output timeout reached."',
    "English Quick Commands labels")
workspace = replace_once(
    workspace,
    '        var image = host.querySelector("[data-agent-desktop-image]");',
    '        ensureCompactCommands(host);\n        var image = host.querySelector("[data-agent-desktop-image]");',
    "Quick Commands desktop mount")
start = workspace.index("    function flattenCommandScripts(")
end = workspace.index("    function renderTab(", start)
workspace = workspace[:start] + quick_block + workspace[end:]
click_start = workspace.index('        var quickClose = event.target && event.target.closest && event.target.closest("[data-quick-command-close]");')
click_end = workspace.index('    }, true);\n\n    document.addEventListener("input"', click_start)
quick_clicks = r'''        var quickClose = event.target && event.target.closest && event.target.closest("[data-quick-command-close]");
        if (quickClose) {
            var quickPanel = document.getElementById("sirkQuickCommandsPanel");
            var quickToggle = document.getElementById("sirkQuickCommandsToggle");
            if (quickPanel) quickPanel.hidden = true;
            if (quickToggle) quickToggle.setAttribute("aria-expanded", "false");
            return;
        }
        var quickCollapse = event.target && event.target.closest && event.target.closest("[data-quick-command-collapse]");
        if (quickCollapse) {
            quickCommands.collapsed = !quickCommands.collapsed;
            quickWriteBoolean("sirkPortal.quickCommands.categoriesCollapsed", quickCommands.collapsed);
            renderCompactCommands();
            return;
        }
        var quickFavorites = event.target && event.target.closest && event.target.closest("[data-quick-command-favorites]");
        if (quickFavorites) {
            quickCommands.favoritesOnly = !quickCommands.favoritesOnly;
            quickCommands.selected = null;
            renderCompactCommands();
            return;
        }
        var quickDetails = event.target && event.target.closest && event.target.closest("[data-quick-command-details]");
        if (quickDetails) {
            quickCommands.detailsCollapsed = !quickCommands.detailsCollapsed;
            if (!quickCommands.detailsCollapsed) quickCommands.outputAttention = false;
            quickWriteBoolean("sirkPortal.quickCommands.detailsCollapsed", quickCommands.detailsCollapsed);
            renderCompactCommands();
            return;
        }
        var quickRefresh = event.target && event.target.closest && event.target.closest("[data-quick-command-refresh]");
        if (quickRefresh) {
            quickRefresh.disabled = true;
            loadCompactCommands(true).then(renderCompactCommands).catch(function (error) {
                quickSetOutput(error.message || String(error), true, true);
            }).then(function () { quickRefresh.disabled = false; });
            return;
        }
        var quickCategory = event.target && event.target.closest && event.target.closest("[data-quick-command-category]");
        if (quickCategory) {
            quickCommands.category = quickCategory.getAttribute("data-quick-command-category") || "";
            quickCommands.selected = null;
            quickCommands.output = "";
            quickCommands.outputAttention = false;
            renderCompactCommands();
            return;
        }
        var quickItem = event.target && event.target.closest && event.target.closest("[data-quick-command-item]");
        if (quickItem) {
            var panel = document.getElementById("sirkQuickCommandsPanel");
            var index = Number(quickItem.getAttribute("data-quick-command-item"));
            if (panel && panel.__items && panel.__items[index]) selectCompactCommand(panel.__items[index], false);
        }
'''
workspace = workspace[:click_start] + quick_clicks + workspace[click_end:]
for marker in (
    "sirkPortal.quickCommands.categoriesCollapsed",
    "sirkPortal.quickCommands.detailsCollapsed",
    "sirkPlatform.commands.preferences",
    "data-quick-command-collapse",
    "data-quick-command-favorites",
    "data-quick-command-details",
    "data-quick-command-refresh",
    "sirk-command-layout",
    "ensureCompactCommands(host)",
):
    if marker not in workspace:
        raise RuntimeError(f"Workspace marker missing: {marker}")
workspace_path.write_text(workspace, encoding="utf-8", newline="\n")

css_path = ROOT / "public/portal/standalone/styles/device-workspace.css"
device_css = strip_quick_rules(css_path.read_text(encoding="utf-8"))
css_path.write_text(device_css, encoding="utf-8", newline="\n")

canonical_path = ROOT / "public/shared/ui/commands.css"
canonical_path.write_text(commands_css, encoding="utf-8", newline="\n")

index_path = ROOT / "public/portal/standalone/index.html"
index_text = index_path.read_text(encoding="utf-8")
index_text = replace_once(
    index_text,
    '  <link rel="stylesheet" href="__ASSET_BASE__/portal-module-shell.css?v=__VERSION__">',
    '  <link rel="stylesheet" href="__ASSET_BASE__/portal-module-shell.css?v=__VERSION__">\n  <link rel="stylesheet" href="__ASSET_BASE__/shared-ui/commands.css?v=__VERSION__">',
    "Commands stylesheet link")
index_path.write_text(index_text, encoding="utf-8", newline="\n")

contract = r'''namespace Sirk.Portal.ProtocolTests;

internal static class CommandWorkspaceStyleContract
{
    public static void Run()
    {
        var root = FindRepositoryRoot();
        var commandsCss = File.ReadAllText(Path.Combine(root, "public", "shared", "ui", "commands.css"));
        var deviceCss = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "styles", "device-workspace.css"));
        var workspace = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "scripts", "device-workspace.js"));
        var index = File.ReadAllText(Path.Combine(root, "public", "portal", "standalone", "index.html"));

        foreach (var marker in new[]
                 {
                     ".sirk-device-commands-host", ".sirk-quick-commands-panel",
                     ".sirk-quick-command-browser", ".sirk-command-toolbar",
                     "minmax(165px,var(--sirk-command-primary))",
                     "minmax(285px,var(--sirk-command-secondary))",
                     "minmax(240px,1fr)", "is-details-collapsed",
                     "width:min(845px,calc(100% - 16px))"
                 })
            Require(commandsCss.Contains(marker, StringComparison.Ordinal),
                "Canonical command workspace CSS marker is missing: " + marker);

        Require(!deviceCss.Contains(".sirk-quick-command", StringComparison.Ordinal) &&
                !deviceCss.Contains(".sirk-quick-commands", StringComparison.Ordinal),
            "Quick Commands must not retain a second style implementation in device-workspace.css.");

        foreach (var marker in new[]
                 {
                     "sirkPortal.quickCommands.categoriesCollapsed",
                     "sirkPortal.quickCommands.detailsCollapsed",
                     "sirkPlatform.commands.preferences",
                     "data-quick-command-collapse", "data-quick-command-favorites",
                     "data-quick-command-details", "data-quick-command-refresh",
                     "sirk-command-layout", "loadCompactCommands(true)"
                 })
            Require(workspace.Contains(marker, StringComparison.Ordinal),
                "Quick Commands shared configuration marker is missing: " + marker);

        var moduleShell = index.IndexOf("portal-module-shell.css", StringComparison.Ordinal);
        var commands = index.IndexOf("shared-ui/commands.css", StringComparison.Ordinal);
        Require(moduleShell >= 0 && commands > moduleShell,
            "Canonical commands.css must load last, after the general module shell.");
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "src", "Sirk.Portal", "Sirk.Portal.csproj")))
                return current.FullName;
            current = current.Parent;
        }
        throw new DirectoryNotFoundException("SIRK Portal repository root was not found.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
'''
contract_path = ROOT / "tests/Sirk.Portal.ProtocolTests/CommandWorkspaceStyleContract.cs"
contract_path.write_text(contract, encoding="utf-8", newline="\n")

program_path = ROOT / "tests/Sirk.Portal.ProtocolTests/Program.cs"
program = program_path.read_text(encoding="utf-8")
program = replace_once(
    program,
    "DesktopImageCodecUiContract.Run();",
    "DesktopImageCodecUiContract.Run();\nCommandWorkspaceStyleContract.Run();",
    "Command workspace contract registration")
program_path.write_text(program, encoding="utf-8", newline="\n")

print("COMMAND_WORKSPACE_MIGRATION_OK")
