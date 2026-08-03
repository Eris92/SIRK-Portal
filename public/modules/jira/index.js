(function () {
    "use strict";
    var view = "my";
    var module = window.SirkPlatformModuleShell.create({
        key: "jira",
        title: "Jira",
        menuTitle: "Jira",
        order: 130,
        preset: "standard",
        tabs: [
            { key: "tickets", title: "Tickets" },
            { key: "assets", title: "Assets" },
            { key: "settings", title: "Settings" }
        ],
        defaultTab: "tickets",
        render: function (shell) {
            if (shell.state.tab === "settings") return shell.api("settings").then(function (result) { shell.json(shell.state.page.details, result); });
            if (shell.state.tab === "assets") {
                shell.nav(shell.state.page.primary, [{ key: "assets", title: "Jira Assets", icon: "◆" }], "assets", function () {});
                shell.state.page.secondary.appendChild(shell.card("AQL", "Assets are searched through the configured Jira workspace."));
                return shell.api("assets", { q: shell.state.search }).then(function (result) { shell.json(shell.state.page.details, result.assets || result); });
            }
            var navigation = [
                { key: "my", title: "Assigned to me", icon: "●" },
                { key: "all", title: "All Tickets", icon: "▤" },
                { key: "new", title: "New Ticket", icon: "+" }
            ];
            shell.nav(shell.state.page.primary, navigation, view, function (item) { view = item.key; shell.render(); });
            if (view === "new") {
                shell.state.page.details.appendChild(shell.card("New ticket", "Ticket creation uses the configured Jira project and REST API."));
                return;
            }
            var jql = view === "all" ? "ORDER BY updated DESC" : "assignee = currentUser() ORDER BY updated DESC";
            return shell.api("issues", { jql: jql, maxResults: 100 }).then(function (result) {
                shell.state.page.secondary.innerHTML = "";
                (result.issues || []).forEach(function (issue) {
                    var button = shell.element("button", "sirk-nav-item", issue.key + " · " + (issue.fields && issue.fields.summary || ""));
                    button.onclick = function () { shell.api("issue", { key: issue.key }).then(function (details) { shell.json(shell.state.page.details, details.issue); }); };
                    shell.state.page.secondary.appendChild(button);
                });
                shell.state.page.details.appendChild(shell.card("Tickets", "Select an issue to display details."));
            });
        }
    });
    window.SirkPlatformModules.jira = module;
}());
