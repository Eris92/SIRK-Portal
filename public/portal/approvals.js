(function () {
    "use strict";

    if (window.__sirkPlatformPortalApprovalLoaded) return;
    window.__sirkPlatformPortalApprovalLoaded = true;

    var core = window.SirkPlatformCore;
    var state = {
        host: null,
        providers: [],
        provider: "",
        status: "pending",
        search: "",
        rows: [],
        loading: false
    };

    var providerOrder = ["move-requests", "commands", "management"];
    var providerTitles = {
        "move-requests": "Move Requests",
        commands: "Commands",
        management: "Management"
    };
    var providerIcons = {
        "move-requests": "swap",
        commands: "terminal",
        management: "script"
    };
    var statuses = ["", "pending", "approved", "executing", "completed", "failed", "rejected"];

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function icon(name) {
        var paths = {
            overview: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
            swap: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
            terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
            script: '<path d="M6 3h9l3 3v15H6V3Z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>',
            all: '<path d="M5 6h14M5 12h14M5 18h14"/>',
            pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
            approved: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
            executing: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/>',
            completed: '<path d="M4 12 9 17 20 6"/>',
            failed: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
            rejected: '<path d="M6 6l12 12M18 6 6 18"/>',
            refresh: '<path d="M20 6v5h-5M4 18v-5h5"/><path d="M18 8a7 7 0 0 0-12-2M6 16a7 7 0 0 0 12 2"/>',
            search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'
        };
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.all) + '</svg>';
    }

    function api(asset, params) {
        return core.api("approvals", asset, {}, params || {});
    }

    function post(asset, value) {
        return core.post("approvals", asset, value || {});
    }

    function titleForProvider(value) {
        return providerTitles[value] || value || "Overview";
    }

    function requester(row) {
        return row && row.requester && row.requester.name || "—";
    }

    function approver(row) {
        if (row && row.approver && row.approver.name) return row.approver.name;
        var decisions = Array.isArray(row && row.approvalDecisions) ? row.approvalDecisions : [];
        for (var index = decisions.length - 1; index >= 0; index--) {
            if (decisions[index].user && decisions[index].user.name) return decisions[index].user.name;
        }
        return "—";
    }

    function approval(row) {
        var progress = row && row.approvalProgress || {};
        return progress.text || ((progress.approved || 0) + "/" + (progress.total || 0));
    }

    function showDetails(row) {
        var overlay = el("div", "sirk-approval-modal-overlay");
        var dialog = el("section", "sirk-approval-modal");
        var head = el("div", "sirk-approval-modal-head");
        head.appendChild(el("h3", "", row.title || row.summary || titleForProvider(row.type)));
        var close = el("button", "sirk-button", "Close");
        close.type = "button";
        close.onclick = function () { overlay.remove(); };
        head.appendChild(close);
        dialog.appendChild(head);

        var grid = el("div", "sirk-approval-detail-grid");
        [
            ["Provider", titleForProvider(row.type)],
            ["Status", row.status || "—"],
            ["Requester", requester(row)],
            ["Approver", approver(row)],
            ["Approval", approval(row)],
            ["Created", row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"]
        ].forEach(function (item) {
            var card = el("div", "sirk-approval-detail-item");
            card.appendChild(el("span", "", item[0]));
            card.appendChild(el("strong", "", item[1]));
            grid.appendChild(card);
        });
        dialog.appendChild(grid);
        if (row.summary) dialog.appendChild(el("p", "sirk-approval-summary", row.summary));
        var raw = el("details", "sirk-approval-debug");
        raw.appendChild(el("summary", "", "Debug / raw request"));
        var pre = el("pre");
        try { pre.textContent = JSON.stringify(row, null, 2); } catch (error) { pre.textContent = String(row); }
        raw.appendChild(pre);
        dialog.appendChild(raw);
        overlay.appendChild(dialog);
        overlay.onclick = function (event) { if (event.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }

    function decide(row, approved, button) {
        var label = approved ? "Approve" : "Reject";
        var note = window.prompt(label + " request. Optional note:", "");
        if (note === null) return;
        button.disabled = true;
        post("decide", { id: row.id, approved: approved, note: note }).then(loadRows).catch(function (error) {
            window.alert(error.message || String(error));
            button.disabled = false;
        });
    }

    function renderToolbar(shell) {
        var toolbar = el("div", "sirk-approval-toolbar");
        var refresh = el("button", "sirk-toolbar-button");
        refresh.type = "button";
        refresh.title = "Refresh";
        refresh.innerHTML = icon("refresh");
        refresh.onclick = loadRows;
        toolbar.appendChild(refresh);
        var search = el("input", "sirk-approval-search");
        search.type = "search";
        search.placeholder = "Filter requests...";
        search.value = state.search;
        search.oninput = function () { state.search = search.value || ""; renderRows(); };
        toolbar.appendChild(search);
        shell.appendChild(toolbar);
    }

    function providerButton(value, title, iconName) {
        var button = el("button", "sirk-nav-item");
        button.type = "button";
        button.classList.toggle("is-active", state.provider === value);
        var iconHost = el("span", "sirk-nav-icon");
        iconHost.innerHTML = icon(iconName);
        button.appendChild(iconHost);
        button.appendChild(el("span", "", title));
        button.onclick = function () {
            state.provider = value;
            state.status = value ? "pending" : "pending";
            loadRows();
        };
        return button;
    }

    function renderProviders(host) {
        host.innerHTML = "";
        var list = el("div", "sirk-list");
        list.appendChild(providerButton("", "Overview", "overview"));
        state.providers.forEach(function (provider) {
            list.appendChild(providerButton(provider.type, titleForProvider(provider.type), providerIcons[provider.type] || "all"));
        });
        host.appendChild(list);
    }

    function statusTitle(value) {
        if (!value) return "All";
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    function renderStatuses(host) {
        host.innerHTML = "";
        var list = el("div", "sirk-list");
        statuses.forEach(function (value) {
            var button = el("button", "sirk-nav-item");
            button.type = "button";
            button.classList.toggle("is-active", state.status === value);
            var iconHost = el("span", "sirk-nav-icon");
            iconHost.innerHTML = icon(value || "all");
            button.appendChild(iconHost);
            button.appendChild(el("span", "", statusTitle(value)));
            button.onclick = function () { state.status = value; loadRows(); };
            list.appendChild(button);
        });
        host.appendChild(list);
    }

    function filteredRows() {
        var query = String(state.search || "").trim().toLowerCase();
        if (!query) return state.rows.slice();
        return state.rows.filter(function (row) {
            var value;
            try { value = JSON.stringify(row); } catch (error) { value = String(row.summary || row.title || ""); }
            return value.toLowerCase().indexOf(query) >= 0;
        });
    }

    function actionButton(text, className, handler) {
        var button = el("button", className, text);
        button.type = "button";
        button.onclick = handler;
        return button;
    }

    function renderRows() {
        if (!state.host) return;
        var details = state.host.querySelector(".sirk-approval-content");
        if (!details) return;
        details.innerHTML = "";
        details.appendChild(el("h2", "", state.provider ? titleForProvider(state.provider) : "Approval Center"));
        details.appendChild(el("p", "sirk-muted", state.provider ? "Requests for the selected provider." : "Requests from all SirkPlatform approval providers."));

        var rows = filteredRows();
        if (!rows.length) {
            details.appendChild(el("div", "sirk-card", state.loading ? "Loading..." : "No requests match the selected filters."));
            return;
        }

        var wrap = el("div", "sirk-approval-table-wrap");
        var table = el("table", "sirk-approval-table");
        var head = table.createTHead().insertRow();
        ["DateTime", "Request", "Provider", "Requester", "Approver", "Approval", "Status", "Actions"].forEach(function (title) {
            head.appendChild(el("th", "", title));
        });
        var body = table.createTBody();
        rows.forEach(function (row) {
            var tr = body.insertRow();
            [
                row.createdAt ? new Date(row.createdAt).toLocaleString() : "—",
                row.title || row.summary || row.type || "—",
                titleForProvider(row.type),
                requester(row),
                approver(row),
                approval(row),
                row.status || "—"
            ].forEach(function (value, index) {
                var cell = tr.insertCell();
                cell.textContent = value;
                if (index === 6) cell.className = "sirk-approval-status sirk-approval-status-" + String(row.status || "unknown").toLowerCase();
            });
            var actions = tr.insertCell();
            actions.className = "sirk-approval-actions";
            actions.appendChild(actionButton("View", "sirk-button", function () { showDetails(row); }));
            if (row.canDecide) {
                actions.appendChild(actionButton("Approve", "sirk-primary-button", function (event) { decide(row, true, event.currentTarget); }));
                actions.appendChild(actionButton("Reject", "sirk-button sirk-danger-button", function (event) { decide(row, false, event.currentTarget); }));
            }
        });
        wrap.appendChild(table);
        details.appendChild(wrap);
    }

    function loadRows() {
        if (!state.host || state.loading) return Promise.resolve();
        state.loading = true;
        renderRows();
        return api("requests", {
            type: state.provider || "",
            status: state.status || "",
            q: state.search || "",
            page: 1,
            perPage: 500
        }).then(function (response) {
            state.rows = response.rows || [];
        }).catch(function (error) {
            state.rows = [];
            window.alert(error.message || String(error));
        }).then(function () {
            state.loading = false;
            renderRows();
        });
    }

    function build(host) {
        host.innerHTML = "";
        var shell = el("section", "sirk-approval-shell");
        renderToolbar(shell);
        var workspace = el("div", "sirk-approval-workspace");
        var providers = el("aside", "sirk-column sirk-approval-providers");
        var status = el("aside", "sirk-column sirk-approval-statuses");
        var content = el("main", "sirk-approval-content");
        workspace.appendChild(providers);
        workspace.appendChild(status);
        workspace.appendChild(content);
        shell.appendChild(workspace);
        host.appendChild(shell);
        renderProviders(providers);
        renderStatuses(status);
        renderRows();
    }

    function mount(host) {
        state.host = host;
        return api("providers").then(function (response) {
            var map = Object.create(null);
            (response.providers || []).forEach(function (provider) { map[provider.type] = provider; });
            state.providers = providerOrder.map(function (key) { return map[key]; }).filter(Boolean);
            build(host);
            return loadRows();
        }).catch(function (error) {
            host.innerHTML = "";
            host.appendChild(el("div", "sirk-card", error.message || String(error)));
        });
    }

    window.SirkPlatformPortalApproval = {
        mount: mount,
        refresh: loadRows
    };
}());
