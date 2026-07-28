(function () {
    "use strict";

    if (window.__sirkSettingsStructureLoaded) return;
    window.__sirkSettingsStructureLoaded = true;

    var activeCustom = "";
    var saving = false;
    var INTEGRATIONS = [
        { key: "ad", label: "AD" },
        { key: "defender", label: "Defender" },
        { key: "entra", label: "Entra" },
        { key: "jira", label: "Jira" },
        { key: "zabbix", label: "Zabbix" },
        { key: "sms", label: "SMS" }
    ];
    var BANNER_TEMPLATES = [
        { key: "success", label: "Zielony — aktualizacja" },
        { key: "warning", label: "Żółty — ostrzeżenie" },
        { key: "critical", label: "Czerwony — awaria" }
    ];
    var ANIMATION_TYPES = [
        ["snow", "Padający śnieg"],
        ["confetti", "Confetti"],
        ["walker", "Postać przechodząca"],
        ["christmas", "Motyw świąteczny"],
        ["fall", "Spadające symbole"],
        ["float", "Unoszące się symbole"]
    ];

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value == null ? {} : value));
    }

    function workspace() {
        var content = document.getElementById("sirkStandaloneContent");
        return content && (content.querySelector("[data-portal-settings] .sirk-layout") || content.querySelector(".sirk-settings-module-workspace"));
    }

    function settingsActive(root) {
        var primary = root && root.querySelector(":scope > .sirk-column-primary");
        var button = primary && primary.querySelector(":scope > .sirk-nav-item.active,:scope > .sirk-nav-item.is-active");
        return ["Settings", "Ustawienia"].indexOf(String(button && button.textContent || "").trim()) >= 0;
    }

    function group(host, label) {
        var found = null;
        if (!host) return found;
        Array.prototype.some.call(host.querySelectorAll(":scope > details.sirk-settings-nav-group"), function (candidate) {
            var summary = candidate.querySelector(":scope > summary");
            if (String(summary && summary.textContent || "").trim() !== label) return false;
            found = candidate;
            return true;
        });
        return found;
    }

    function leaf(groupNode, label) {
        var body = groupNode && groupNode.querySelector(":scope > .sirk-settings-nav-group-body");
        var found = null;
        if (!body) return found;
        Array.prototype.some.call(body.querySelectorAll(":scope > .sirk-nav-item"), function (button) {
            if (String(button.textContent || "").trim() !== label) return false;
            found = button;
            return true;
        });
        return found;
    }

    function apiUrl(action) {
        return new URL("/api/admin/settings", window.location.href).href;
    }

    function parse(response) {
        return response.text().then(function (body) {
            var value;
            try { value = JSON.parse(body || "{}"); }
            catch (error) { throw new Error("Endpoint ustawień zwrócił odpowiedź inną niż JSON (HTTP " + response.status + ")."); }
            if (!response.ok || value.ok === false) throw new Error(value.error && value.error.message || value.error || ("HTTP " + response.status));
            return value.value || value.snapshot || value;
        });
    }

    function load() {
        return fetch(apiUrl("portal-admin-snapshot"), {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" }
        }).then(parse);
    }

    function moduleStates(snapshot) {
        var result = {};
        (snapshot.modules || []).forEach(function (item) { result[item.key] = item.enabled === true; });
        return result;
    }

    function save(modules, options, integrations) {
        var body = new URLSearchParams();
        body.set("payload", JSON.stringify({
            modules: modules,
            moduleOptions: options,
            portal: options.portal || {},
            integrations: integrations,
            secrets: {}
        }));
        return fetch(apiUrl("save-settings"), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
            body: body.toString()
        }).then(parse).then(function () { return load(); });
    }

    function field(host, label, value, onChange, options) {
        options = options || {};
        var row = el("label", "sirk-card");
        var copyNode = el("span");
        row.setAttribute("data-settings-field", options.type === "boolean" ? "boolean" : "value");
        copyNode.setAttribute("data-settings-field-copy", "1");
        copyNode.appendChild(el("strong", "", label));
        if (options.description) copyNode.appendChild(el("small", "", options.description));
        var input;
        if (options.type === "boolean") {
            input = el("input");
            input.type = "checkbox";
            input.checked = value === true;
            input.onchange = function () { onChange(input.checked); };
        } else if (options.choices) {
            input = el("select");
            options.choices.forEach(function (choice) {
                var option = el("option", "", choice[1]);
                option.value = choice[0];
                option.selected = String(value) === String(choice[0]);
                input.appendChild(option);
            });
            input.onchange = function () { onChange(input.value); };
        } else {
            input = el(options.multiline ? "textarea" : "input");
            if (!options.multiline) input.type = options.type || (typeof value === "number" ? "number" : "text");
            input.value = value == null ? "" : String(value);
            if (options.multiline) input.rows = options.rows || 4;
            if (options.min != null) input.min = String(options.min);
            if (options.max != null) input.max = String(options.max);
            if (options.step != null) input.step = String(options.step);
            input.oninput = function () { onChange(input.type === "number" || input.type === "range" ? Number(input.value) : input.value); };
        }
        input.setAttribute("data-settings-input", "1");
        row.appendChild(copyNode);
        row.appendChild(input);
        host.appendChild(row);
        return input;
    }

    function objectForm(host, value) {
        value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
        Object.keys(value).sort().forEach(function (key) {
            var current = value[key];
            if (current && typeof current === "object" && !Array.isArray(current)) return;
            if (Array.isArray(current)) {
                field(host, key, current.join(", "), function (next) {
                    value[key] = String(next || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean);
                });
            } else {
                field(host, key, current, function (next) { value[key] = next; }, { type: typeof current === "boolean" ? "boolean" : undefined });
            }
        });
    }

    function selector(title, groups, selected) {
        var card = el("section", "sirk-card");
        card.appendChild(el("strong", "", title));
        card.appendChild(el("small", "", "Brak wyboru oznacza dostęp dla wszystkich. Site administrator ma dostęp zawsze."));
        var list = el("div");
        list.style.cssText = "display:grid;gap:8px;margin-top:12px";
        (groups || []).forEach(function (groupValue) {
            var row = el("label");
            var input = el("input");
            row.style.cssText = "display:flex;align-items:center;gap:9px";
            input.type = "checkbox";
            input.value = String(groupValue.id);
            input.checked = selected.indexOf(String(groupValue.id)) >= 0;
            row.appendChild(input);
            row.appendChild(el("span", "", String(groupValue.name || groupValue.id)));
            list.appendChild(row);
        });
        card.appendChild(list);
        return {
            card: card,
            values: function () {
                return Array.prototype.filter.call(list.querySelectorAll('input[type="checkbox"]'), function (input) {
                    return input.checked;
                }).map(function (input) { return String(input.value); });
            }
        };
    }

    function setActive(root, button, key) {
        var secondary = root.querySelector(":scope > .sirk-column-secondary");
        Array.prototype.forEach.call(secondary.querySelectorAll(".sirk-nav-item.active,.sirk-nav-item.is-active"), function (item) {
            item.classList.remove("active", "is-active");
        });
        button.classList.add("active");
        var groupNode = button.closest("details.sirk-settings-nav-group");
        if (groupNode) groupNode.open = true;
        activeCustom = key;
    }

    function actions(details, buttons, message) {
        var host = el("div", "sirk-toolbar-group sirk-toolbar-left");
        (Array.isArray(buttons) ? buttons : [buttons]).forEach(function (button) {
            if (button) host.appendChild(button);
        });
        host.appendChild(message);
        details.appendChild(host);
    }

    function saveHandler(button, message, modules, options, integrations, rerender) {
        return function () {
            if (saving) return;
            saving = true;
            button.disabled = true;
            message.textContent = "Zapisywanie…";
            message.removeAttribute("data-error");
            save(modules, options, integrations).then(function () {
                saving = false;
                message.textContent = "Zapisano.";
                rerender();
            }).catch(function (error) {
                saving = false;
                button.disabled = false;
                message.textContent = error.message || String(error);
                message.setAttribute("data-error", "1");
            });
        };
    }

    function loaded(root, key, button, callback) {
        setActive(root, button, key);
        var details = root.querySelector(":scope > .sirk-column-details");
        details.setAttribute("data-custom-settings-key", key);
        details.innerHTML = '<div class="sirk-card">Ładowanie…</div>';
        load().then(function (snapshot) {
            if (activeCustom !== key) return;
            details.innerHTML = "";
            callback(details, snapshot, moduleStates(snapshot), clone(snapshot.moduleSettings || {}), clone(snapshot.integrations && snapshot.integrations.values || {}));
        }).catch(function (error) {
            details.innerHTML = "";
            details.appendChild(el("div", "sirk-card", error.message || String(error)));
        });
    }

    function renderMove(root, mode, button) {
        loaded(root, "move:" + mode, button, function (details, snapshot, modules, options, integrations) {
            var move = options.moverequests = options.moverequests || {};
            var approval = options.approvalcenter = options.approvalcenter || {};
            approval.providers = approval.providers || {};
            var provider = approval.providers.moverequests = approval.providers.moverequests || {};
            var form = el("div");
            var saveButton = el("button", "sirk-button", "Zapisz");
            var message = el("span");
            form.setAttribute("data-settings-form", "1");
            saveButton.type = "button";
            if (mode === "general") {
                field(form, "Włącz i pokaż", modules.moverequests === true, function (value) {
                    modules.moverequests = value;
                    move.enabled = value;
                }, { type: "boolean", description: "Włącza przenoszenie urządzeń i pokazuje przycisk w widoku urządzenia." });
                field(form, "Włącz akceptacje", provider.enabled !== false, function (value) { provider.enabled = value; }, { type: "boolean" });
                saveButton.onclick = saveHandler(saveButton, message, modules, options, integrations, function () { renderMove(root, mode, button); });
            } else {
                var access = selector("Dostęp grup Portalu", snapshot.userGroups || [], (move.accessGroupIds || []).map(String));
                form.appendChild(access.card);
                saveButton.onclick = function () {
                    move.accessGroupIds = access.values();
                    saveHandler(saveButton, message, modules, options, integrations, function () { renderMove(root, mode, button); })();
                };
            }
            details.appendChild(form);
            actions(details, saveButton, message);
        });
    }

    function renderIntegration(root, item, button) {
        loaded(root, "integration:" + item.key, button, function (details, snapshot, modules, options, integrations) {
            integrations[item.key] = integrations[item.key] && typeof integrations[item.key] === "object" ? integrations[item.key] : {};
            var form = el("div");
            var saveButton = el("button", "sirk-button", "Zapisz");
            var message = el("span");
            form.setAttribute("data-settings-form", "1");
            objectForm(form, integrations[item.key]);
            if (!Object.keys(integrations[item.key]).length) {
                form.appendChild(el("div", "sirk-card", item.key === "sms" ? "Konfiguracja SMS jest gotowa do zdefiniowania." : "Brak pól konfiguracyjnych dla tej integracji."));
            }
            saveButton.type = "button";
            saveButton.onclick = saveHandler(saveButton, message, modules, options, integrations, function () { renderIntegration(root, item, button); });
            details.appendChild(form);
            actions(details, saveButton, message);
        });
    }

    function renderOverview(root, button) {
        loaded(root, "overview:permissions", button, function (details, snapshot, modules, options, integrations) {
            options.portal = options.portal || {};
            options.portal.views = options.portal.views || {};
            var overview = options.portal.views.overview = options.portal.views.overview || {};
            var form = el("div");
            var devices = selector("Pokaż Devices", snapshot.userGroups || [], (overview.devicesCardAccessGroupIds || []).map(String));
            var system = selector("Pokaż stan systemu", snapshot.userGroups || [], (overview.systemStatusCardAccessGroupIds || []).map(String));
            var integration = selector("Pokaż Integrations", snapshot.userGroups || [], (overview.integrationsCardAccessGroupIds || []).map(String));
            var saveButton = el("button", "sirk-button", "Zapisz");
            var message = el("span");
            form.setAttribute("data-settings-form", "1");
            form.appendChild(devices.card);
            form.appendChild(system.card);
            form.appendChild(integration.card);
            saveButton.type = "button";
            saveButton.onclick = function () {
                overview.devicesCardAccessGroupIds = devices.values();
                overview.systemStatusCardAccessGroupIds = system.values();
                overview.integrationsCardAccessGroupIds = integration.values();
                saveHandler(saveButton, message, modules, options, integrations, function () { renderOverview(root, button); })();
            };
            details.appendChild(form);
            actions(details, saveButton, message);
        });
    }

    function bannerDefaults(value) {
        value = value && typeof value === "object" ? value : {};
        value.templates = value.templates && typeof value.templates === "object" ? value.templates : {};
        var defaults = {
            success: { name: "Aktualizacja", text: "System został pomyślnie zaktualizowany.", backgroundColor: "#dcfce7", textColor: "#166534", fontSize: 16, durationMinutes: 60, noEnd: false },
            warning: { name: "Ostrzeżenie", text: "W systemie występują drobne problemy. Trwają prace nad ich usunięciem.", backgroundColor: "#fef3c7", textColor: "#92400e", fontSize: 16, durationMinutes: 60, noEnd: false },
            critical: { name: "Awaria", text: "Część funkcji systemu jest obecnie niedostępna.", backgroundColor: "#fee2e2", textColor: "#991b1b", fontSize: 16, durationMinutes: 60, noEnd: true }
        };
        BANNER_TEMPLATES.forEach(function (item) {
            value.templates[item.key] = Object.assign({}, defaults[item.key], value.templates[item.key] || {});
        });
        if (!value.activeTemplate) value.activeTemplate = "success";
        return value;
    }

    function builtInAnimations() {
        return [
            { id: "snow", builtIn: true, name: "Padający śnieg", type: "snow", enabled: false, symbol: "❄", colors: ["#ffffff", "#dbeafe", "#bfdbfe"], intensity: 45, speed: 1, size: 18, opacity: 0.9, durationSeconds: 0, startAt: "", endAt: "", layer: "foreground" },
            { id: "confetti", builtIn: true, name: "Confetti", type: "confetti", enabled: false, symbol: "", colors: ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"], intensity: 70, speed: 1.2, size: 12, opacity: 0.95, durationSeconds: 15, startAt: "", endAt: "", layer: "foreground" },
            { id: "walker", builtIn: true, name: "Postać przechodząca przez stronę", type: "walker", enabled: false, symbol: "🚶", colors: ["#2563eb"], intensity: 1, speed: 0.8, size: 44, opacity: 1, durationSeconds: 0, startAt: "", endAt: "", layer: "foreground" },
            { id: "christmas", builtIn: true, name: "Motyw świąteczny", type: "christmas", enabled: false, symbol: "❄ 🎄 ⭐ 🎁", colors: ["#ffffff", "#dc2626", "#16a34a", "#facc15"], intensity: 36, speed: 0.85, size: 22, opacity: 0.92, durationSeconds: 0, startAt: "", endAt: "", layer: "foreground" }
        ];
    }

    function animationDefaults(value) {
        value = value && typeof value === "object" ? value : {};
        var incoming = Array.isArray(value.effects) ? value.effects : [];
        var builtIns = builtInAnimations();
        var effects = builtIns.map(function (fallback) {
            var source = incoming.find(function (effect) { return effect && effect.id === fallback.id; });
            return Object.assign({}, fallback, source || {}, { id: fallback.id, builtIn: true });
        });
        incoming.forEach(function (effect, index) {
            if (!effect || builtIns.some(function (builtIn) { return builtIn.id === effect.id; })) return;
            effects.push(Object.assign({
                id: effect.id || ("custom-" + index),
                builtIn: false,
                name: "Własna animacja",
                type: "fall",
                enabled: false,
                symbol: "✨",
                colors: ["#60a5fa", "#a78bfa"],
                intensity: 24,
                speed: 1,
                size: 20,
                opacity: 0.9,
                durationSeconds: 0,
                startAt: "",
                endAt: "",
                layer: "foreground"
            }, effect, { builtIn: false }));
        });
        return {
            enabled: value.enabled === true,
            showOnPortal: value.showOnPortal !== false,
            showOnLogin: value.showOnLogin === true,
            respectReducedMotion: value.respectReducedMotion !== false,
            effects: effects
        };
    }

    function localDateTime(value) {
        if (!value) return "";
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
        var offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    }

    function renderAnimationEffect(host, animations, effect, redraw) {
        var box = el("details", "sirk-card");
        var summary = el("summary", "", effect.name || "Animacja");
        var body = el("div");
        box.open = effect.enabled === true;
        box.setAttribute("data-settings-section", "1");
        body.setAttribute("data-settings-section-body", "1");
        box.appendChild(summary);
        field(body, "Włącz animację", effect.enabled === true, function (value) { effect.enabled = value; }, { type: "boolean" });
        field(body, "Nazwa", effect.name, function (value) { effect.name = value; summary.textContent = value || "Animacja"; });
        field(body, "Typ animacji", effect.type, function (value) { effect.type = value; }, { choices: ANIMATION_TYPES });
        field(body, "Symbol / emoji", effect.symbol, function (value) { effect.symbol = value; }, { description: "Można podać kilka symboli oddzielonych spacją, np. ❄ 🎄 ⭐." });
        field(body, "Kolory", (effect.colors || []).join(", "), function (value) {
            effect.colors = String(value || "").split(/[,;\n]+/).map(function (item) { return item.trim(); }).filter(Boolean);
        }, { description: "Kolory CSS oddzielone przecinkami." });
        field(body, "Intensywność", effect.intensity, function (value) { effect.intensity = value; }, { type: "number", min: 1, max: 200 });
        field(body, "Prędkość", effect.speed, function (value) { effect.speed = value; }, { type: "number", min: 0.1, max: 5, step: 0.1 });
        field(body, "Rozmiar (px)", effect.size, function (value) { effect.size = value; }, { type: "number", min: 8, max: 120 });
        field(body, "Przezroczystość", effect.opacity, function (value) { effect.opacity = value; }, { type: "number", min: 0.1, max: 1, step: 0.05 });
        field(body, "Czas działania (sekundy)", effect.durationSeconds, function (value) { effect.durationSeconds = value; }, { type: "number", min: 0, max: 86400, description: "0 oznacza animację bez limitu czasu." });
        field(body, "Data rozpoczęcia", localDateTime(effect.startAt), function (value) { effect.startAt = value; }, { type: "datetime-local" });
        field(body, "Data zakończenia", localDateTime(effect.endAt), function (value) { effect.endAt = value; }, { type: "datetime-local" });
        field(body, "Warstwa", effect.layer || "foreground", function (value) { effect.layer = value; }, { choices: [["background", "W tle"], ["foreground", "Na wierzchu"]] });
        if (effect.builtIn !== true) {
            var removeButton = el("button", "sirk-button", "Usuń animację");
            removeButton.type = "button";
            removeButton.onclick = function () {
                animations.effects = animations.effects.filter(function (candidate) { return candidate !== effect; });
                redraw();
            };
            body.appendChild(removeButton);
        }
        box.appendChild(body);
        host.appendChild(box);
    }

    function renderPortal(root, section, button) {
        loaded(root, "portal:" + section, button, function (details, snapshot, modules, options, integrations) {
            var portal = options.portal = options.portal || {};
            var form = el("div");
            var saveButton = el("button", "sirk-button", "Zapisz");
            var message = el("span");
            var extraButtons = [];
            form.setAttribute("data-settings-form", "1");

            if (section === "banner") {
                var banner = portal.banner = bannerDefaults(portal.banner);
                field(form, "Włącz baner", banner.enabled === true, function (value) { banner.enabled = value; }, { type: "boolean" });
                field(form, "Pokaż w Portalu", banner.showOnPortal !== false, function (value) { banner.showOnPortal = value; }, { type: "boolean" });
                field(form, "Pokaż na stronie logowania", banner.showOnLogin === true, function (value) { banner.showOnLogin = value; }, { type: "boolean" });
                field(form, "Aktywny szablon", banner.activeTemplate, function (value) { banner.activeTemplate = value; }, { choices: BANNER_TEMPLATES.map(function (item) { return [item.key, item.label]; }) });
                BANNER_TEMPLATES.forEach(function (item) {
                    var template = banner.templates[item.key];
                    var box = el("details", "sirk-card");
                    var body = el("div");
                    box.open = item.key === banner.activeTemplate;
                    box.setAttribute("data-settings-section", "1");
                    box.appendChild(el("summary", "", item.label));
                    body.setAttribute("data-settings-section-body", "1");
                    field(body, "Nazwa", template.name, function (value) { template.name = value; });
                    field(body, "Tekst", template.text, function (value) { template.text = value; }, { multiline: true, rows: 5 });
                    field(body, "Kolor tła", template.backgroundColor, function (value) { template.backgroundColor = value; }, { type: "color" });
                    field(body, "Kolor tekstu", template.textColor, function (value) { template.textColor = value; }, { type: "color" });
                    field(body, "Rozmiar tekstu", template.fontSize, function (value) { template.fontSize = value; }, { type: "number" });
                    field(body, "Czas wyświetlania (minuty)", template.durationMinutes, function (value) { template.durationMinutes = value; }, { type: "number" });
                    field(body, "Bez wskazania końca", template.noEnd === true, function (value) { template.noEnd = value; }, { type: "boolean" });
                    box.appendChild(body);
                    form.appendChild(box);
                });
            } else if (section === "maintenance") {
                var maintenance = portal.maintenance = Object.assign({
                    enabled: false,
                    title: "Przerwa serwisowa",
                    text: "System jest chwilowo niedostępny z powodu zaplanowanych prac serwisowych.",
                    backgroundColor: "#0f172a",
                    textColor: "#ffffff",
                    estimatedEnd: "",
                    allowedIps: ["127.0.0.1", "::1"],
                    showNoticeToAllowed: true,
                    blockNative: true
                }, portal.maintenance || {});
                field(form, "Włącz zaślepkę", maintenance.enabled === true, function (value) { maintenance.enabled = value; }, { type: "boolean", description: "Blokuje dostęp użytkownikom spoza listy dozwolonych adresów IP." });
                field(form, "Tytuł", maintenance.title, function (value) { maintenance.title = value; });
                field(form, "Komunikat", maintenance.text, function (value) { maintenance.text = value; }, { multiline: true, rows: 6 });
                field(form, "Kolor tła", maintenance.backgroundColor, function (value) { maintenance.backgroundColor = value; }, { type: "color" });
                field(form, "Kolor tekstu", maintenance.textColor, function (value) { maintenance.textColor = value; }, { type: "color" });
                field(form, "Planowane zakończenie", maintenance.estimatedEnd, function (value) { maintenance.estimatedEnd = value; });
                field(form, "Dozwolone adresy IP", (maintenance.allowedIps || []).join("\n"), function (value) {
                    maintenance.allowedIps = String(value || "").split(/[\n,;]+/).map(function (item) { return item.trim(); }).filter(Boolean);
                }, { multiline: true, rows: 5, description: "Jeden adres lub zakres CIDR w wierszu." });
                field(form, "Pokaż informację dozwolonym IP", maintenance.showNoticeToAllowed !== false, function (value) { maintenance.showNoticeToAllowed = value; }, { type: "boolean" });
            } else if (section === "animations") {
                var animations = portal.animations = animationDefaults(portal.animations);
                field(form, "Włącz animacje", animations.enabled === true, function (value) { animations.enabled = value; }, { type: "boolean" });
                field(form, "Pokaż w Portalu", animations.showOnPortal !== false, function (value) { animations.showOnPortal = value; }, { type: "boolean" });
                field(form, "Pokaż na stronie logowania", animations.showOnLogin === true, function (value) { animations.showOnLogin = value; }, { type: "boolean" });
                field(form, "Ogranicz ruch zgodnie z ustawieniami użytkownika", animations.respectReducedMotion !== false, function (value) { animations.respectReducedMotion = value; }, { type: "boolean", description: "Wyłącza animacje, gdy system użytkownika ma włączone ograniczenie ruchu." });
                var effectsHost = el("div");
                function redrawEffects() {
                    effectsHost.innerHTML = "";
                    animations.effects.forEach(function (effect) { renderAnimationEffect(effectsHost, animations, effect, redrawEffects); });
                }
                redrawEffects();
                form.appendChild(effectsHost);
                var addButton = el("button", "sirk-button", "Dodaj animację");
                addButton.type = "button";
                addButton.onclick = function () {
                    animations.effects.push({
                        id: "custom-" + Date.now(),
                        builtIn: false,
                        name: "Własna animacja",
                        type: "fall",
                        enabled: true,
                        symbol: "✨",
                        colors: ["#60a5fa", "#a78bfa"],
                        intensity: 24,
                        speed: 1,
                        size: 20,
                        opacity: 0.9,
                        durationSeconds: 0,
                        startAt: "",
                        endAt: "",
                        layer: "foreground"
                    });
                    redrawEffects();
                    effectsHost.lastElementChild.open = true;
                };
                var previewButton = el("button", "sirk-button", "Podgląd animacji");
                previewButton.type = "button";
                previewButton.onclick = function () {
                    if (window.SirkPortalAnimations && typeof window.SirkPortalAnimations.preview === "function") {
                        window.SirkPortalAnimations.preview(animations);
                        message.textContent = "Uruchomiono podgląd. Animacja nie została jeszcze zapisana.";
                    } else {
                        message.textContent = "Podgląd będzie dostępny po odświeżeniu Portalu.";
                    }
                };
                extraButtons.push(addButton, previewButton);
            } else {
                var release = portal.release = Object.assign({ enabled: false, showAfterUpdate: true, title: "Co nowego", maxCommits: 12 }, portal.release || {});
                field(form, "Włącz komunikat Release", release.enabled === true, function (value) { release.enabled = value; }, { type: "boolean", description: "Pokazuje użytkownikom listę zmian po aktualizacji." });
                field(form, "Pokaż po aktualizacji", release.showAfterUpdate !== false, function (value) { release.showAfterUpdate = value; }, { type: "boolean" });
                field(form, "Tytuł komunikatu", release.title, function (value) { release.title = value; });
                field(form, "Maksymalna liczba commitów", release.maxCommits, function (value) { release.maxCommits = value; }, { type: "number" });
                var preview = el("section", "sirk-card");
                var list = el("ul");
                preview.appendChild(el("strong", "", "Podgląd listy zmian"));
                (snapshot.release && snapshot.release.commits || []).slice(0, Number(release.maxCommits) || 12).forEach(function (commit) {
                    list.appendChild(el("li", "", (commit.sha ? commit.sha + " — " : "") + commit.message));
                });
                if (!list.children.length) list.appendChild(el("li", "", "Lista commitów zostanie pobrana z GitHub po zapisaniu lub aktualizacji."));
                preview.appendChild(list);
                form.appendChild(preview);
            }

            saveButton.type = "button";
            saveButton.onclick = function () {
                if (section === "banner" && portal.banner.enabled) portal.banner.startedAt = new Date().toISOString();
                saveHandler(saveButton, message, modules, options, integrations, function () { renderPortal(root, section, button); })();
            };
            details.appendChild(form);
            actions(details, extraButtons.concat([saveButton]), message);
        });
    }

    function createGroup(label, marker) {
        var groupNode = el("details", "sirk-settings-nav-group");
        groupNode.setAttribute("data-source-settings-group", marker);
        groupNode.appendChild(el("summary", "", label));
        groupNode.appendChild(el("div", "sirk-settings-nav-group-body"));
        return groupNode;
    }

    function customButton(label, key, handler) {
        var button = el("button", "sirk-nav-item sirk-settings-nav-leaf", label);
        button.type = "button";
        button.setAttribute("data-source-settings-nav", key);
        button.onclick = function (event) {
            event.preventDefault();
            event.stopPropagation();
            handler(button);
        };
        return button;
    }

    function ensureLeaf(groupNode, label, key, handler) {
        if (!groupNode) return;
        var body = groupNode.querySelector(":scope > .sirk-settings-nav-group-body");
        var old = leaf(groupNode, label);
        if (old && old.getAttribute("data-source-settings-nav") === key) return;
        if (old) old.remove();
        body.appendChild(customButton(label, key, handler));
    }

    function ensureNavigation(root) {
        if (!root || !settingsActive(root)) return;
        var secondary = root.querySelector(":scope > .sirk-column-secondary");
        if (!secondary) return;
        if (secondary.getAttribute("data-source-settings-click-bound") !== "1") {
            secondary.setAttribute("data-source-settings-click-bound", "1");
            secondary.addEventListener("click", function (event) {
                var button = event.target && event.target.closest && event.target.closest(".sirk-nav-item");
                if (!button || button.hasAttribute("data-source-settings-nav")) return;
                activeCustom = "";
                var details = root.querySelector(":scope > .sirk-column-details");
                if (details) details.removeAttribute("data-custom-settings-key");
            }, true);
        }

        var modules = group(secondary, "Moduły");
        var modulesBody = modules && modules.querySelector(":scope > .sirk-settings-nav-group-body");
        if (modulesBody) {
            var approvals = group(modulesBody, "Akceptacje");
            var move = group(modulesBody, "Przenoszenie urządzeń");
            if (!move || move.getAttribute("data-source-settings-group") !== "move") {
                if (move) move.remove();
                move = createGroup("Przenoszenie urządzeń", "move");
                var moveBody = move.querySelector(":scope > .sirk-settings-nav-group-body");
                moveBody.appendChild(customButton("Ogólne", "move:general", function (button) { renderMove(root, "general", button); }));
                moveBody.appendChild(customButton("Permissions", "move:permissions", function (button) { renderMove(root, "permissions", button); }));
                if (approvals && approvals.nextSibling) modulesBody.insertBefore(move, approvals.nextSibling);
                else modulesBody.appendChild(move);
            }
            ensureLeaf(group(modulesBody, "Overview"), "Permissions", "overview:permissions", function (button) { renderOverview(root, button); });
        }

        var portal = group(secondary, "Portal");
        ensureLeaf(portal, "Baner", "portal:banner", function (button) { renderPortal(root, "banner", button); });
        ensureLeaf(portal, "Zaślepka", "portal:maintenance", function (button) { renderPortal(root, "maintenance", button); });
        ensureLeaf(portal, "Release", "portal:release", function (button) { renderPortal(root, "release", button); });
        ensureLeaf(portal, "Animacje", "portal:animations", function (button) { renderPortal(root, "animations", button); });

        var integrations = group(secondary, "Integracje");
        if (!integrations || integrations.getAttribute("data-source-settings-group") !== "integrations") {
            if (integrations) integrations.remove();
            integrations = createGroup("Integracje", "integrations");
            var integrationBody = integrations.querySelector(":scope > .sirk-settings-nav-group-body");
            INTEGRATIONS.forEach(function (item) {
                integrationBody.appendChild(customButton(item.label, "integration:" + item.key, function (button) { renderIntegration(root, item, button); }));
            });
            if (portal && portal.nextSibling) secondary.insertBefore(integrations, portal.nextSibling);
            else secondary.appendChild(integrations);
        }

        Array.prototype.forEach.call(secondary.querySelectorAll("[data-source-settings-nav]"), function (button) {
            var key = button.getAttribute("data-source-settings-nav");
            button.classList.toggle("active", key === activeCustom);
            if (key === activeCustom) {
                var groupNode = button.closest("details.sirk-settings-nav-group");
                if (groupNode) groupNode.open = true;
            }
        });
    }

    function cleanup(root) {
        if (!root || activeCustom) return;
        var secondary = root.querySelector(":scope > .sirk-column-secondary");
        var selected = secondary && secondary.querySelector(".sirk-nav-item.active,.sirk-nav-item.is-active");
        var groupNode = selected && selected.closest("details.sirk-settings-nav-group");
        var label = String(groupNode && groupNode.querySelector(":scope > summary") && groupNode.querySelector(":scope > summary").textContent || "").trim();
        var name = String(selected && selected.textContent || "").trim();
        var form = root.querySelector("[data-settings-form]");
        if (!form) return;
        if (label === "Akceptacje" && name === "Ogólne") {
            Array.prototype.forEach.call(form.querySelectorAll("[data-settings-section]"), function (section) {
                var title = String(section.querySelector(":scope > summary") && section.querySelector(":scope > summary").textContent || "").toLowerCase();
                if (title === "providers" || title.indexOf("moverequests") >= 0) section.remove();
            });
        }
        if (label === "Monitoring" && name === "Ogólne") {
            Array.prototype.forEach.call(form.querySelectorAll("[data-settings-section]"), function (section) {
                var title = String(section.querySelector(":scope > summary") && section.querySelector(":scope > summary").textContent || "").toLowerCase();
                if (title === "integracje") section.remove();
            });
        }
        Array.prototype.forEach.call(form.querySelectorAll(".sirk-card"), function (card) {
            if (/^(Ten moduł nie ma|Brak ustawień)/.test(String(card.textContent || "").trim())) card.remove();
        });
    }

    function refresh() {
        var root = workspace();
        if (!root || !settingsActive(root)) return;
        ensureNavigation(root);
        cleanup(root);
    }

    var observationRoot = document.getElementById("sirkStandaloneContent") || document.documentElement;
    var scheduled = false;
    new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(function () {
            scheduled = false;
            refresh();
        });
    }).observe(observationRoot, { childList: true, subtree: true });
    window.addEventListener("sirkportal:languagechange", refresh);
    refresh();
}());
