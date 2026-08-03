(function () {
    "use strict";

    if (window.__sirkPlatformPortalSubfolderIconsLoaded) return;
    window.__sirkPlatformPortalSubfolderIconsLoaded = true;

    function svg(path) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
    }

    var icons = {
        folder: svg('<path d="M3 6h6l2 2h10v11H3V6Z"/>'),
        groups: svg('<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20c0-4 2.5-7 6-7s6 3 6 7"/><path d="M14 15c3.5 0 6 2 6 5"/>'),
        ou: svg('<rect x="4" y="4" width="6" height="5" rx="1"/><rect x="14" y="15" width="6" height="5" rx="1"/><rect x="4" y="15" width="6" height="5" rx="1"/><path d="M7 9v3h10v3M7 12v3"/>'),
        computer: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
        policy: svg('<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>'),
        users: svg('<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-4 2.5-7 6-7s6 3 6 7"/><path d="M15 14c3 0 5 2 5 5"/>'),
        server: svg('<rect x="4" y="3" width="16" height="7" rx="1"/><rect x="4" y="14" width="16" height="7" rx="1"/><path d="M8 6h.01M8 17h.01M12 6h5M12 17h5"/>'),
        network: svg('<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 7v5M12 12 6 16M12 12l6 4"/>'),
        settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>')
    };

    function normalize(value) {
        return String(value || "")
            .trim()
            .toUpperCase()
            .replace(/[._-]+/g, " ")
            .replace(/\s+/g, " ");
    }

    function iconFor(label) {
        var value = normalize(label);
        if (/\b(GROUP|GROUPS|GRUPA|GRUPY)\b/.test(value)) return icons.groups;
        if (/\b(OU|ORGANIZATIONAL UNIT|ORGANIZATIONAL UNITS)\b/.test(value)) return icons.ou;
        if (/\b(PC|COMPUTER|COMPUTERS|DEVICE|DEVICES|WORKSTATION|WORKSTATIONS)\b/.test(value)) return icons.computer;
        if (/\b(POLICY|POLICIES|GPO|POLITYKA|POLITYKI)\b/.test(value)) return icons.policy;
        if (/\b(USER|USERS|ACCOUNTS|UŻYTKOWNICY|UZYTKOWNICY)\b/.test(value)) return icons.users;
        if (/\b(SERVER|SERVERS|SERWER|SERWERY)\b/.test(value)) return icons.server;
        if (/\b(NETWORK|NETWORKS|SIEĆ|SIEC)\b/.test(value)) return icons.network;
        if (/\b(SETTING|SETTINGS|CONFIG|CONFIGURATION)\b/.test(value)) return icons.settings;
        return icons.folder;
    }

    function apply(host) {
        host = host || document;
        var headings = host.querySelectorAll("#sirkPortalRoot .sirk-folder-heading");
        Array.prototype.forEach.call(headings, function (heading) {
            var iconHost = heading.querySelector(".sirk-nav-icon");
            if (!iconHost) return;
            if (iconHost.querySelector("img.sirk-management-folder-image")) return;
            var labelNode = heading.lastElementChild;
            var label = labelNode ? labelNode.textContent : heading.textContent;
            var key = normalize(label);
            if (heading.getAttribute("data-sirk-platform-subfolder-icon") === key) return;
            iconHost.innerHTML = iconFor(label);
            heading.setAttribute("data-sirk-platform-subfolder-icon", key);
        });
    }

    function bind() {
        var portal = document.getElementById("sirkPortalRoot");
        if (!portal) return false;
        apply(portal);
        if (!portal.__sirkPlatformSubfolderIconsObserver) {
            portal.__sirkPlatformSubfolderIconsObserver = new MutationObserver(function (records) {
                records.forEach(function (record) {
                    if (record.target && record.target.nodeType === 1) apply(record.target.closest("#sirkPortalRoot") || portal);
                });
            });
            portal.__sirkPlatformSubfolderIconsObserver.observe(portal, { childList: true, subtree: true });
        }
        return true;
    }

    var attempts = 0;
    var timer = window.setInterval(function () {
        attempts++;
        if (bind() || attempts > 120) window.clearInterval(timer);
    }, 100);

    var nativeSetAttribute = window.Element && Element.prototype.setAttribute;
    if (nativeSetAttribute && !nativeSetAttribute.__sirkSameValueGuard) {
        var guardedSetAttribute = function (name, value) {
            var textValue = String(value);
            if (/^(title|aria-label|placeholder)$/i.test(String(name)) && this.getAttribute(name) === textValue) return;
            return nativeSetAttribute.call(this, name, value);
        };
        guardedSetAttribute.__sirkSameValueGuard = true;
        Element.prototype.setAttribute = guardedSetAttribute;
    }

    var i18nStyle = document.createElement("style");
    i18nStyle.id = "sirkSettingsI18nVisibilityFix";
    i18nStyle.textContent = "html body #sirkPortalRoot .sirk-i18n-visual:after{font-size:14px!important;line-height:1.35!important}";
    (document.head || document.documentElement).appendChild(i18nStyle);
}());

(function () {
    "use strict";

    if (window.__sirkPlatformCenterLoaded) return;
    window.__sirkPlatformCenterLoaded = true;

    var lastDeployment = null;
    var platformState = null;

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (_) { return "pl"; }
    }

    function tr(pl, en) { return language() === "en" ? en : pl; }

    function csrf() {
        var runtime = window.SirkPlatformRuntime && window.SirkPlatformRuntime.state;
        return String(runtime && runtime.bootstrap && runtime.bootstrap.csrfToken || "");
    }

    function parse(response) {
        return response.text().then(function (text) {
            var value;
            try { value = JSON.parse(text || "{}"); }
            catch (_) { throw new Error(text || ("HTTP " + response.status)); }
            if (!response.ok || value.ok === false) throw new Error(value.error || ("HTTP " + response.status));
            return value.value == null ? value : value.value;
        });
    }

    function platform(action, body) {
        var url = "/api/modules/platform/" + encodeURIComponent(action);
        if (!body) return fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }).then(parse);
        return fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json; charset=UTF-8",
                "X-SIRK-CSRF": csrf()
            },
            body: JSON.stringify(body)
        }).then(parse);
    }

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function button(text, action, danger) {
        var node = element("button", "sirk-button" + (danger ? " sirk-button-danger" : ""), text);
        node.type = "button";
        node.onclick = action;
        return node;
    }

    function field(label, value, type) {
        var wrapper = element("label", "sirk-platform-field");
        wrapper.appendChild(element("strong", "", label));
        var input = element("input");
        input.type = type || "text";
        input.value = value || "";
        wrapper.appendChild(input);
        return { wrapper: wrapper, input: input };
    }

    function copyText(value, message) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(function () { message.textContent = tr("Skopiowano.", "Copied."); });
            return;
        }
        var area = element("textarea");
        area.value = value;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        message.textContent = tr("Skopiowano.", "Copied.");
    }

    function ensureStyle() {
        if (document.getElementById("sirkPlatformCenterStyle")) return;
        var style = element("style");
        style.id = "sirkPlatformCenterStyle";
        style.textContent = [
            ".sirk-platform-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:16px}",
            ".sirk-platform-card{display:grid;gap:12px;align-content:start}",
            ".sirk-platform-card h2,.sirk-platform-card h3{margin:0}",
            ".sirk-platform-fields{display:grid;gap:10px}",
            ".sirk-platform-field{display:grid;gap:6px}",
            ".sirk-platform-field input,.sirk-platform-field select,.sirk-platform-command{width:100%;box-sizing:border-box}",
            ".sirk-platform-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
            ".sirk-platform-status{padding:10px;border-radius:8px;background:rgba(96,165,250,.10)}",
            ".sirk-platform-status[data-error=\"1\"]{background:rgba(239,68,68,.12)}",
            ".sirk-platform-command{white-space:pre-wrap;word-break:break-all;padding:10px;border-radius:8px;background:rgba(15,23,42,.06)}",
            ".sirk-platform-downloads{display:grid;gap:10px}",
            ".sirk-platform-downloads a{text-decoration:none}",
            "@media(max-width:700px){.sirk-platform-grid{grid-template-columns:1fr}}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function setBusy(host, text) {
        host.innerHTML = "";
        host.appendChild(element("div", "sirk-card", text));
    }

    function restartPortal(message) {
        fetch("/api/admin/runtime?action=server-state", { credentials: "same-origin", cache: "no-store" })
            .then(parse).then(function (state) {
                var services = state.services || [];
                var service = services.find(function (item) {
                    return /portal/i.test(String(item.name || item.displayName || "")) && !/watchdog/i.test(String(item.name || item.displayName || ""));
                });
                if (!service) throw new Error(tr("Nie znaleziono usługi Portalu.", "Portal service was not found."));
                return fetch("/api/admin/runtime?action=server-restart", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", "X-SIRK-CSRF": csrf() },
                    body: JSON.stringify({ serviceName: service.name })
                }).then(parse);
            }).then(function () {
                message.textContent = tr("Restart Portalu został zlecony. Strona odświeży się automatycznie.", "Portal restart was scheduled. The page will refresh automatically.");
                window.setTimeout(function () { window.location.reload(); }, 8000);
            }).catch(function (error) {
                message.textContent = error.message;
                message.setAttribute("data-error", "1");
            });
    }

    function centralCard(host, state, message) {
        var card = element("section", "sirk-card sirk-platform-card");
        card.appendChild(element("h2", "", "SIRK Central"));
        var connection = state.connection || {};
        var enrollment = state.enrollment || null;

        if (connection.configured) {
            card.appendChild(element("div", "sirk-platform-status",
                tr("Połączono: ", "Connected: ") + connection.centralUrl + " · " + connection.portalId));
            var rename = field(tr("Nazwa Portalu", "Portal name"), connection.portalName);
            card.appendChild(rename.wrapper);
            var actions = element("div", "sirk-platform-actions");
            actions.appendChild(button(tr("Sprawdź połączenie", "Check connection"), function () {
                message.textContent = tr("Sprawdzanie…", "Checking…");
                platform("central-refresh", {}).then(function (value) {
                    message.textContent = value.central && value.central.connected
                        ? tr("Central potwierdził aktywne połączenie.", "Central confirmed the active connection.")
                        : tr("Konfiguracja istnieje, ale tunel jest offline.", "Configuration exists, but the tunnel is offline.");
                }).catch(function (error) { message.textContent = error.message; message.setAttribute("data-error", "1"); });
            }));
            actions.appendChild(button(tr("Zapisz nazwę", "Save name"), function () {
                platform("central-update", { portalName: rename.input.value }).then(function () {
                    message.textContent = tr("Nazwa zapisana. Wymagany restart Portalu.", "Name saved. Portal restart is required.");
                    load(host);
                }).catch(function (error) { message.textContent = error.message; message.setAttribute("data-error", "1"); });
            }));
            actions.appendChild(button(tr("Obróć poświadczenie", "Rotate credential"), function () {
                if (!window.confirm(tr("Obrócić credential Portalu? Aktywny tunel zostanie ponownie zestawiony.", "Rotate the Portal credential? The active tunnel will reconnect."))) return;
                platform("central-rotate", {}).then(function () {
                    message.textContent = tr("Credential obrócony. Wymagany restart Portalu.", "Credential rotated. Portal restart is required.");
                    load(host);
                }).catch(function (error) { message.textContent = error.message; message.setAttribute("data-error", "1"); });
            }));
            actions.appendChild(button(tr("Odłącz i usuń", "Disconnect and remove"), function () {
                if (!window.confirm(tr("Usunąć połączenie zarówno z Portalu, jak i z Central?", "Remove the connection from both Portal and Central?"))) return;
                platform("central-disconnect", {}).then(function () {
                    message.textContent = tr("Połączenie usunięte. Wymagany restart Portalu.", "Connection removed. Portal restart is required.");
                    load(host);
                }).catch(function (error) { message.textContent = error.message; message.setAttribute("data-error", "1"); });
            }, true));
            actions.appendChild(button(tr("Restartuj Portal", "Restart Portal"), function () { restartPortal(message); }));
            card.appendChild(actions);
        } else {
            card.appendChild(element("p", "", tr("Portal działa samodzielnie. Podaj token wygenerowany w Central.", "Portal is standalone. Enter a token generated in Central.")));
            var centralUrl = field("Central URL", "https://central.sirkportal.com");
            var portalId = field("Portal ID", "portal-" + String(location.hostname || "local").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));
            var portalName = field(tr("Nazwa Portalu", "Portal name"), location.hostname || "SIRK Portal");
            var publicUrl = field(tr("Publiczny URL Portalu", "Public Portal URL"), location.origin);
            var token = field(tr("Jednorazowy token enrollment", "One-time enrollment token"), "", "password");
            var fields = element("div", "sirk-platform-fields");
            [centralUrl, portalId, portalName, publicUrl, token].forEach(function (item) { fields.appendChild(item.wrapper); });
            card.appendChild(fields);
            var beginActions = element("div", "sirk-platform-actions");
            beginActions.appendChild(button(tr("Rozpocznij enrollment", "Start enrollment"), function () {
                message.textContent = tr("Wysyłanie requestu…", "Submitting request…");
                platform("central-begin", {
                    centralUrl: centralUrl.input.value,
                    portalId: portalId.input.value,
                    portalName: portalName.input.value,
                    publicUrl: publicUrl.input.value,
                    enrollmentToken: token.input.value,
                    version: String(window.__SIRK_PLATFORM_PORTAL_VERSION__ || "")
                }).then(function (value) {
                    message.textContent = tr("Request utworzony: ", "Request created: ") + value.enrollment.requestId +
                        tr(". Zatwierdź go w Central.", ". Approve it in Central.");
                    load(host);
                }).catch(function (error) { message.textContent = error.message; message.setAttribute("data-error", "1"); });
            }));
            if (enrollment && enrollment.requestId) {
                beginActions.appendChild(button(tr("Sprawdź zatwierdzenie", "Check approval"), function () {
                    message.textContent = tr("Sprawdzanie approval…", "Checking approval…");
                    platform("central-poll", {}).then(function (value) {
                        message.textContent = value.result.status === "configured"
                            ? tr("Połączenie zapisane. Zrestartuj Portal.", "Connection saved. Restart Portal.")
                            : tr("Status enrollmentu: ", "Enrollment status: ") + value.result.status;
                        load(host);
                    }).catch(function (error) { message.textContent = error.message; message.setAttribute("data-error", "1"); });
                }));
            }
            card.appendChild(beginActions);
            if (enrollment) card.appendChild(element("small", "", tr("Bieżący status: ", "Current status: ") + enrollment.status + " · " + enrollment.requestId));
        }
        host.appendChild(card);
    }

    function agentCard(host, state, message) {
        var card = element("section", "sirk-card sirk-platform-card");
        card.appendChild(element("h2", "", tr("Pobieranie SIRK Agent", "SIRK Agent downloads")));
        card.appendChild(element("p", "", tr("Wygeneruj jednorazowy deployment dla grupy. Token jest ważny 24 godziny.", "Generate a one-time deployment for a group. The token is valid for 24 hours.")));
        var groups = state.agentGroups || [];
        if (!groups.length) {
            card.appendChild(element("div", "sirk-platform-status", tr("Najpierw utwórz grupę w Ustawienia → Grupy hostów.", "Create a group first in Settings → Host groups.")));
            host.appendChild(card);
            return;
        }
        var selectWrap = element("label", "sirk-platform-field");
        selectWrap.appendChild(element("strong", "", tr("Grupa urządzeń", "Device group")));
        var select = element("select");
        groups.forEach(function (group) {
            var option = element("option", "", group.name + " (" + group.id + ")");
            option.value = group.id;
            select.appendChild(option);
        });
        selectWrap.appendChild(select);
        card.appendChild(selectWrap);
        card.appendChild(button(tr("Generuj EXE/MSI", "Generate EXE/MSI deployment"), function () {
            message.textContent = tr("Generowanie tokenu i pobieranie katalogu wydań…", "Generating token and resolving release catalog…");
            platform("agent-deployment", {
                groupId: select.value,
                portalOrigin: location.origin,
                channel: "stable"
            }).then(function (value) {
                lastDeployment = value;
                message.textContent = tr("Deployment gotowy. Token ważny do: ", "Deployment ready. Token valid until: ") + value.expiresAtUtc;
                renderDeployment(card, value, message);
            }).catch(function (error) { message.textContent = error.message; message.setAttribute("data-error", "1"); });
        }));
        if (lastDeployment) renderDeployment(card, lastDeployment, message);
        host.appendChild(card);
    }

    function renderDeployment(card, value, message) {
        var old = card.querySelector("[data-sirk-agent-deployment]");
        if (old) old.remove();
        var box = element("div", "sirk-platform-downloads");
        box.setAttribute("data-sirk-agent-deployment", "1");
        box.appendChild(element("h3", "", tr("Wydanie ", "Release ") + value.release.version));
        var links = element("div", "sirk-platform-actions");
        [[value.release.installers.exe, tr("Pobierz EXE", "Download EXE")], [value.release.installers.msi, tr("Pobierz MSI", "Download MSI")]].forEach(function (item) {
            var link = element("a", "sirk-button", item[1]);
            link.href = item[0].downloadUrl;
            link.download = item[0].name;
            link.rel = "noopener";
            links.appendChild(link);
        });
        box.appendChild(links);
        [[tr("Cicha instalacja EXE", "Silent EXE install"), value.silentInstall.exe], [tr("Cicha instalacja MSI", "Silent MSI install"), value.silentInstall.msi]].forEach(function (item) {
            box.appendChild(element("strong", "", item[0]));
            var command = element("pre", "sirk-platform-command", item[1]);
            box.appendChild(command);
            box.appendChild(button(tr("Kopiuj", "Copy"), function () { copyText(item[1], message); }));
        });
        box.appendChild(element("small", "", tr("Token enrollment jest pokazany tylko w tej odpowiedzi. Wygenerowanie nowego unieważnia poprzedni token grupy.", "The enrollment token is shown only in this response. Generating another one invalidates the previous group token.")));
        card.appendChild(box);
    }

    function render(host) {
        ensureStyle();
        setBusy(host, tr("Ładowanie Platformy…", "Loading Platform…"));
        platform("status").then(function (state) {
            platformState = state;
            host.innerHTML = "";
            var message = element("div", "sirk-platform-status", "");
            var grid = element("div", "sirk-platform-grid");
            centralCard(grid, state, message);
            agentCard(grid, state, message);
            host.appendChild(message);
            host.appendChild(grid);
        }).catch(function (error) {
            host.innerHTML = "";
            var message = element("div", "sirk-platform-status", error.message);
            message.setAttribute("data-error", "1");
            host.appendChild(message);
        });
    }

    function load(host) {
        platform("status").then(function (state) {
            platformState = state;
            render(host);
        }).catch(function () { render(host); });
    }

    function enhanceSettings() {
        var settings = document.querySelector("[data-portal-settings]");
        if (!settings) return false;
        var primary = settings.querySelector("[data-settings-primary], .sirk-column-primary");
        var secondary = settings.querySelector("[data-settings-secondary], .sirk-column-secondary");
        var details = settings.querySelector("[data-settings-details], .sirk-column-details");
        if (!primary || !details) return false;
        var existing = primary.querySelector("[data-sirk-platform-center]");
        if (existing) {
            existing.textContent = tr("Platforma", "Platform");
            return true;
        }
        var entry = element("button", "sirk-nav-item", tr("Platforma", "Platform"));
        entry.type = "button";
        entry.setAttribute("data-sirk-platform-center", "1");
        entry.onclick = function () {
            Array.prototype.forEach.call(primary.children, function (node) { node.classList.toggle("active", node === entry); });
            if (secondary) { secondary.innerHTML = ""; secondary.hidden = true; }
            details.innerHTML = "";
            render(details);
        };
        primary.appendChild(entry);
        return true;
    }

    var observer = new MutationObserver(function () { window.requestAnimationFrame(enhanceSettings); });
    var portal = document.getElementById("sirkPortalRoot") || document.body;
    observer.observe(portal, { childList: true, subtree: true });
    window.addEventListener("sirkportal:languagechange", enhanceSettings);
    enhanceSettings();
}());
