(function () {
    "use strict";
    var active = "agent";
    var agentState = { snapshot: null, category: "overview" };
    var module = window.SirkPlatformModuleShell.create({
        key: "defendertools",
        title: "Bezpieczeństwo",
        menuTitle: "Bezpieczeństwo",
        order: 140,
        preset: "standard",
        tabs: [
            { key: "agent", title: "SIRK Agent" },
            { key: "incidents", title: "Incidents" },
            { key: "email", title: "Email Explorer" },
            { key: "trusted", title: "Tenant Allow/Block" },
            { key: "hunting", title: "Advanced Hunting" },
            { key: "settings", title: "Settings" }
        ],
        defaultTab: "agent",
        render: function (shell) {
            active = shell.state.tab;
            if (active === "agent") return renderAgent(shell);
            if (active === "settings") return shell.api("settings").then(function (result) { shell.json(shell.state.page.details, result); });
            shell.nav(shell.state.page.primary, [
                { key: "incidents", title: "Incidents", icon: "!" },
                { key: "email", title: "Email Explorer", icon: "✉" },
                { key: "trusted", title: "Tenant Allow/Block", icon: "✓" },
                { key: "hunting", title: "Advanced Hunting", icon: "⌕" }
            ], active, function (item) { shell.state.tab = item.key; shell.state.page.tabs.select(item.key, true); });
            shell.state.page.secondary.appendChild(shell.card(active, "Microsoft Defender XDR"));
            if (active === "incidents") {
                return shell.api("incidents").then(function (result) {
                    shell.state.page.details.innerHTML = "";
                    (result.incidents || []).forEach(function (incident) {
                        shell.state.page.details.appendChild(shell.card(incident.displayName || incident.incidentName || ("Incident " + incident.id), (incident.status || "") + " · " + (incident.severity || "")));
                    });
                });
            }
            if (active === "hunting") {
                var form = window.SharedSettings.form("Advanced Hunting");
                var label = shell.element("label", "", "KQL query");
                var input = shell.element("textarea", "", ""); input.rows = 10;
                var run = shell.element("button", "btn btn-primary", "Run"); run.type = "button";
                run.onclick = function () { shell.post("hunt", { query: input.value }).then(function (result) { shell.json(shell.state.page.details, result.result); }).catch(function (error) { shell.error(shell.state.page.details, error); }); };
                label.appendChild(input); form.appendChild(label); form.appendChild(run); shell.state.page.details.appendChild(form); return;
            }
            return shell.api(active).then(function (result) { shell.json(shell.state.page.details, result); });
        }
    });

    function text(value) { return value == null || value === "" ? "—" : String(value); }
    function clear(host) { while (host.firstChild) host.removeChild(host.firstChild); }
    function element(tag, className, value) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (value != null) node.textContent = value;
        return node;
    }
    function addList(host, title, values) {
        if (!Array.isArray(values) || !values.length) return;
        var section = element("section", "sirk-card");
        section.appendChild(element("h3", "", title));
        var list = element("ul", "sirk-agent-capability-list");
        values.forEach(function (value) { list.appendChild(element("li", "", value)); });
        section.appendChild(list); host.appendChild(section);
    }
    function renderDeviceTable(host, devices) {
        var section = element("section", "sirk-card");
        section.appendChild(element("h3", "", "Urządzenia zgłoszone przez SIRK Agent"));
        var table = element("table", "sirk-settings-table");
        table.innerHTML = "<thead><tr><th>Urządzenie</th><th>Tenant / Device ID</th><th>Wersja</th><th>Stan</th><th>Ostatni check-in</th></tr></thead>";
        var body = element("tbody");
        (devices || []).forEach(function (device) {
            var row = element("tr");
            row.appendChild(element("td", "", text(device.machineName)));
            row.appendChild(element("td", "", text(device.tenantId) + " / " + text(device.deviceId)));
            row.appendChild(element("td", "", text(device.agentVersion)));
            row.appendChild(element("td", device.online ? "is-online" : "is-offline", device.online ? "Online" : "Offline"));
            row.appendChild(element("td", "", device.lastSeenUtc ? new Date(device.lastSeenUtc).toLocaleString() : "—"));
            body.appendChild(row);
        });
        table.appendChild(body); section.appendChild(table); host.appendChild(section);
    }
    function renderCategory(shell, category) {
        var details = shell.state.page.details;
        clear(details);
        if (!category) return;
        var heading = element("section", "sirk-card sirk-agent-capability-header");
        heading.appendChild(element("h2", "", category.title));
        heading.appendChild(element("p", "", category.description || ""));
        details.appendChild(heading);
        addList(details, "Ustawienia i możliwości", category.settings);
        addList(details, "Pola danych dostępne w Portalu", category.fields);
        addList(details, "Źródła danych", category.sources);
        addList(details, "Ograniczenia i wymagania bezpieczeństwa", category.constraints || category.security);
        if (category.key === "overview") {
            var summary = agentState.snapshot.summary || {};
            var cards = element("div", "sirk-standalone-grid");
            [["Wszystkie urządzenia", summary.total], ["Online", summary.online], ["Offline", summary.offline], ["Wersje", (summary.versions || []).join(", ") || "—"]].forEach(function (item) {
                cards.appendChild(shell.card(item[0], text(item[1])));
            });
            details.appendChild(cards);
            renderDeviceTable(details, agentState.snapshot.devices || []);
            return;
        }
        var liveFields = category.fields || [];
        if (liveFields.length) {
            var live = element("section", "sirk-card");
            live.appendChild(element("h3", "", "Aktualne dane urządzeń"));
            var pre = element("pre", "sirk-output");
            pre.textContent = JSON.stringify((agentState.snapshot.devices || []).map(function (device) {
                var value = { machineName: device.machineName, deviceId: device.deviceId };
                liveFields.forEach(function (field) { value[field] = device[field]; });
                return value;
            }), null, 2);
            live.appendChild(pre); details.appendChild(live);
        }
    }
    function renderAgent(shell) {
        shell.nav(shell.state.page.primary, [{ key: "agent", title: "SIRK Agent", icon: "S" }], "agent", function () {});
        shell.state.page.secondary.innerHTML = "";
        shell.state.page.details.innerHTML = "";
        shell.state.page.details.appendChild(shell.card("SIRK Agent", "Ładowanie pełnego katalogu możliwości…"));
        return shell.api("agent-overview").then(function (result) {
            agentState.snapshot = result;
            var categories = result.categories || [];
            if (!categories.some(function (item) { return item.key === agentState.category; })) agentState.category = categories.length ? categories[0].key : "overview";
            shell.nav(shell.state.page.secondary, categories.map(function (item) { return { key: item.key, title: item.title }; }), agentState.category, function (item) {
                agentState.category = item.key;
                shell.nav(shell.state.page.secondary, categories.map(function (entry) { return { key: entry.key, title: entry.title }; }), agentState.category, arguments.callee);
                renderCategory(shell, categories.find(function (entry) { return entry.key === agentState.category; }));
            });
            renderCategory(shell, categories.find(function (item) { return item.key === agentState.category; }));
        }).catch(function (error) { shell.error(shell.state.page.details, error); });
    }

    window.SirkPlatformModules.defendertools = module;
}());