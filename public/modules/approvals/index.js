(function () {
    "use strict";

    var selectedProvider = "";
    var selectedStatus = "";
    var overviewFilter = "";
    var providers = [];
    var requests = [];

    var order = ["move-requests", "commands", "management"];
    var titles = {
        "move-requests": "Move Requests",
        commands: "Commands",
        management: "Management"
    };

    function isStandalone(shell) {
        return !!(shell && shell.state && shell.state.page && shell.state.page.frontend === "sirkportal");
    }

    function svg(paths) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
    }

    var icons = {
        overview: svg('<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
        "move-requests": svg('<path d="M7 7h11l-3-3M18 7l-3 3"/><path d="M17 17H6l3 3M6 17l3-3"/>'),
        commands: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 10 3 2-3 2M12 15h5"/>'),
        management: svg('<path d="M6 3h9l3 3v15H6V3Z"/><path d="M9 11h6M9 15h6"/>'),
        all: svg('<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8"/>'),
        pending: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
        executing: svg('<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/>'),
        approved: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/>'),
        completed: svg('<path d="M4 5h16v14H4z"/><path d="m8 12 2.5 2.5L16 9"/>'),
        failed: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
        rejected: svg('<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>')
    };

    function ordered(rows) {
        var map = Object.create(null);
        (rows || []).forEach(function (item) { map[item.type] = item; });
        return order.map(function (key) { return map[key]; }).filter(Boolean);
    }

    function skin(shell) {
        var page = shell.state.page;
        if (!page || !page.root || !isStandalone(shell)) return;
        page.root.classList.add("sirk-module-approvals");
    }

    function nav(host, options, shell) {
        var portal = isStandalone(shell);
        var button = document.createElement("button");
        button.type = "button";
        button.className = (portal ? "sirk-nav-item " : "sirk-nav-item ") + (options.className || "");
        button.classList.toggle("is-active", options.active === true);
        button.classList.toggle("active", options.active === true);
        button.title = options.title;

        var icon = document.createElement("span");
        icon.className = portal ? "sirk-nav-icon" : "sirk-nav-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = options.icon || icons.all;

        var label = document.createElement("span");
        label.className = "sirk-approval-label";
        label.textContent = options.title + (options.count == null ? "" : " - " + options.count);

        button.appendChild(icon);
        button.appendChild(label);
        button.onclick = options.onClick;
        host.appendChild(button);
        return button;
    }

    function providerButtons(host, shell) {
        providers.forEach(function (provider) {
            nav(host, {
                title: titles[provider.type] || provider.tabTitle || provider.title,
                icon: icons[provider.type] || icons.all,
                className: "sirk-approval-provider",
                active: selectedProvider === provider.type,
                onClick: function () {
                    selectedProvider = provider.type;
                    selectedStatus = "";
                    shell.render();
                }
            }, shell);
        });
    }

    function primary(shell) {
        var host = shell.state.page.primary;
        host.innerHTML = "";
        nav(host, {
            title: "Overview",
            icon: icons.overview,
            active: !selectedProvider,
            onClick: function () {
                selectedProvider = "";
                selectedStatus = "";
                shell.render();
            }
        }, shell);
        providerButtons(host, shell);
    }

    function counts(rows) {
        var result = { all: rows.length, "move-requests": 0, commands: 0, management: 0 };
        rows.forEach(function (row) {
            if (Object.prototype.hasOwnProperty.call(result, row.type)) result[row.type]++;
        });
        return result;
    }

    function overviewFilters(shell, rows) {
        var host = shell.state.page.secondary;
        var count = counts(rows);
        host.innerHTML = "";
        nav(host, {
            title: "All",
            icon: icons.all,
            count: count.all,
            active: !overviewFilter,
            onClick: function () { overviewFilter = ""; shell.render(); }
        }, shell);
        providers.forEach(function (provider) {
            nav(host, {
                title: titles[provider.type] || provider.title,
                icon: icons[provider.type] || icons.all,
                count: count[provider.type] || 0,
                active: overviewFilter === provider.type,
                onClick: function () { overviewFilter = provider.type; shell.render(); }
            }, shell);
        });
    }

    function statuses(shell) {
        var host = shell.state.page.secondary;
        host.innerHTML = "";
        window.SharedStatusNav.list().forEach(function (status) {
            nav(host, {
                title: status.title,
                icon: icons[status.key] || icons.all,
                className: "sirk-approval-status",
                active: selectedStatus === status.key,
                onClick: function () { selectedStatus = status.key; shell.render(); }
            }, shell);
        });
    }

    function decisions(shell, request, host) {
        if (!request.canDecide) return;
        var portal = isStandalone(shell);
        var actions = document.createElement("div");
        actions.className = portal ? "sirk-actions" : "sirk-approval-request-actions";

        [
            { title: "Approve", approved: true, danger: false },
            { title: "Reject", approved: false, danger: true }
        ].forEach(function (definition) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = portal
                ? "sirk-button" + (definition.danger ? " sirk-button-danger" : "")
                : (definition.danger ? "btn btn-secondary" : "btn");
            button.textContent = definition.title;
            button.onclick = function () {
                button.disabled = true;
                shell.post("decide", { id: request.id, approved: definition.approved, note: "" })
                    .then(shell.render)
                    .catch(function (error) {
                        button.disabled = false;
                        shell.error(host, error);
                    });
            };
            actions.appendChild(button);
        });
        host.appendChild(actions);
    }

    function cards(shell, title, empty, rows) {
        var host = shell.state.page.details;
        var portal = isStandalone(shell);
        host.innerHTML = "";
        rows = rows || requests;

        if (title) host.appendChild(shell.element("h2", "sirk-approval-details-title", title));
        if (!rows.length) {
            host.appendChild(shell.card("No requests", empty || "No requests match the selected provider and status."));
            return;
        }

        var grid = document.createElement("div");
        grid.className = portal ? "sirk-card-grid" : "sirk-approval-card-grid";
        host.appendChild(grid);

        rows.forEach(function (request) {
            var card = shell.card(request.title || request.type, "");
            card.classList.add(portal ? "sirk-card" : "sirk-approval-request-card");

            var meta = shell.element("div", "sirk-shared-muted sirk-approval-request-meta");
            meta.textContent = (request.requester && request.requester.name || "—") + " · " + (request.status || "—");
            card.appendChild(meta);

            card.appendChild(shell.element("div", "sirk-shared-muted", new Date(request.createdAt).toLocaleString()));
            if (request.summary) card.appendChild(shell.element("p", "sirk-approval-request-summary", request.summary));

            var provider = shell.element("span", "sirk-approval-request-provider", titles[request.type] || request.type);
            card.appendChild(provider);
            decisions(shell, request, card);
            grid.appendChild(card);
        });
    }

    function approver(request) {
        if (request.approver && request.approver.name) return request.approver.name;
        var decisionsList = Array.isArray(request.approvalDecisions) ? request.approvalDecisions : [];
        for (var index = decisionsList.length - 1; index >= 0; index--) {
            if (decisionsList[index].user && decisionsList[index].user.name) return decisionsList[index].user.name;
        }
        return "—";
    }

    function table(shell, title, empty, rows) {
        var host = shell.state.page.details;
        host.innerHTML = "";
        window.SharedResultsView.mountTable(host, {
            title: title,
            rows: rows || [],
            filter: true,
            filterPlaceholder: "Filter requests",
            showView: true,
            dialogTitle: "Request details",
            resultValue: function (request) {
                try { return JSON.stringify(request, null, 2); }
                catch (error) { return request.summary || ""; }
            },
            columns: [
                { title: "DateTime", value: function (request) { return request.createdAt ? new Date(request.createdAt).toLocaleString() : "—"; } },
                { title: "Request", value: function (request) { return request.title || request.summary || request.type || "—"; } },
                { title: "Requester", value: function (request) { return request.requester && request.requester.name || "—"; } },
                { title: "Approver", value: approver },
                { title: "Approval", value: function (request) {
                    var progress = request.approvalProgress || {};
                    return progress.text || ((progress.approved || 0) + "/" + (progress.total || 0));
                } },
                { title: "Status", value: function (request) { return request.status || "—"; }, className: function (request) {
                    return "sirk-results-status sirk-results-status-" + String(request.status || "unknown").toLowerCase();
                } },
                { title: "Summary", value: function (request) { return request.summary || "—"; } }
            ],
            actions: function (cell, request) { decisions(shell, request, cell); },
            emptyText: empty
        });
    }

    function load(shell, options) {
        options = options || {};
        return shell.api("requests", {
            type: options.type || "",
            status: options.status || "",
            q: shell.state.search,
            page: 1,
            perPage: 200
        }).then(function (response) {
            requests = response.rows || [];
            if (options.after) options.after(requests);
            else if (options.table) table(shell, options.title, options.empty, requests);
            else cards(shell, options.title, options.empty, requests);
        });
    }

    var module = window.SirkPlatformModuleShell.create({
        key: "approvals",
        title: "Approval Center",
        menuTitle: "Approval Center",
        order: 110,
        preset: "approvals",
        buttons: {
            collapse: { side: "left", order: 10 },
            link: false,
            refresh: { side: "left", order: 50 },
            search: { side: "left", order: 70 },
            clear: false,
            favorites: false,
            manage: false,
            settings: false
        },
        tabs: [],
        defaultTab: "",
        render: function (shell) {
            skin(shell);
            return shell.api("providers").then(function (response) {
                providers = ordered(response.providers || []);
                primary(shell);

                if (!selectedProvider) {
                    return load(shell, {
                        status: "pending",
                        after: function (rows) {
                            overviewFilters(shell, rows);
                            var filtered = overviewFilter
                                ? rows.filter(function (request) { return request.type === overviewFilter; })
                                : rows;
                            cards(
                                shell,
                                overviewFilter ? (titles[overviewFilter] || overviewFilter) + " awaiting approval" : "Requests awaiting approval",
                                "There are no pending requests for the selected filter.",
                                filtered
                            );
                        }
                    });
                }

                statuses(shell);
                return load(shell, {
                    type: selectedProvider,
                    status: selectedStatus,
                    title: titles[selectedProvider] || selectedProvider,
                    empty: "No requests match the selected provider and status.",
                    table: true
                });
            });
        }
    });

    window.SirkPlatformModules.approvals = module;
}());
