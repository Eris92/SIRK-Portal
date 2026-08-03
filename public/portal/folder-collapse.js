(function () {
    "use strict";

    if (window.__sirkPlatformPortalFolderCollapseLoaded) return;
    window.__sirkPlatformPortalFolderCollapseLoaded = true;

    var expanded = {};
    var activeShell = null;
    var activeRoot = "";
    var scheduled = false;

    function ensureStyle() {
        if (document.getElementById("sirkPlatformPortalFolderCollapseStyle")) return;
        var style = document.createElement("style");
        style.id = "sirkPlatformPortalFolderCollapseStyle";
        style.textContent = [
            "#sirkPortalRoot .sirk-folder-heading{cursor:pointer;user-select:none;border-radius:7px;outline:0}",
            "#sirkPortalRoot .sirk-folder-heading:hover,#sirkPortalRoot .sirk-folder-heading:focus-visible{background:rgba(96,165,250,.10)}",
            "#sirkPortalRoot .sirk-folder-heading.is-active{background:rgba(96,165,250,.16);box-shadow:inset 3px 0 0 var(--portal-accent,#60a5fa);color:var(--sirk-text,#172033);font-weight:700}",
            "#sirkPortalRoot .is-folder-child-hidden{display:none!important}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function depth(node) {
        var value = node && node.style && node.style.getPropertyValue("--sirk-depth");
        var number = parseInt(value || "0", 10);
        return isFinite(number) ? number : 0;
    }

    function text(node) {
        var labels = node.querySelectorAll(":scope > span");
        var label = labels.length ? labels[labels.length - 1] : node;
        return String(label && label.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function rootKey(shell) {
        var selected = shell.querySelector('.sirk-layout-host > .sirk-column:first-child [data-management-root].is-active');
        return String(selected && selected.getAttribute("data-management-root") || "root");
    }

    function assignKeys(shell, list) {
        var stack = [];
        var occurrence = Object.create(null);
        var root = rootKey(shell);
        var managementHost = shell.closest(".");
        var openPath = String(managementHost && managementHost.getAttribute("data-management-open-path") || "");

        Array.prototype.forEach.call(list.children, function (node) {
            if (!node.classList.contains("sirk-folder-heading")) return;
            var level = depth(node);
            var label = text(node) || "folder";
            var folderPath = String(node.getAttribute("data-folder-path") || "");
            stack.length = level;
            stack[level] = label;
            var base = root + "|" + (folderPath || stack.slice(0, level + 1).join("/"));
            occurrence[base] = (occurrence[base] || 0) + 1;
            var key = base + "#" + occurrence[base];
            node.setAttribute("data-folder-collapse-key", key);
            node.setAttribute("data-folder-depth", String(level));
            node.setAttribute("role", "button");
            node.setAttribute("tabindex", "0");

            var opensLinkedScript = folderPath && openPath && openPath.indexOf(folderPath + "/") === 0;
            if (opensLinkedScript) expanded[key] = true;
            var isExpanded = expanded[key] === true;
            node.classList.toggle("is-expanded", isExpanded);
            node.classList.toggle("is-collapsed", !isExpanded);
            node.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        });
        if (managementHost && openPath) managementHost.removeAttribute("data-management-open-path");
    }

    function applyVisibility(list) {
        var collapsed = [];

        Array.prototype.forEach.call(list.children, function (node) {
            var level = depth(node);
            while (collapsed.length && level <= collapsed[collapsed.length - 1]) collapsed.pop();

            var hiddenByParent = collapsed.length > 0;
            node.classList.toggle("is-folder-child-hidden", hiddenByParent);
            node.hidden = hiddenByParent;

            if (node.classList.contains("sirk-folder-heading")) {
                var ownExpanded = node.getAttribute("aria-expanded") !== "false";
                if (!ownExpanded) collapsed.push(level);
            }
        });
    }

    function enhance(shell) {
        if (!shell) return;
        ensureStyle();
        var list = shell.querySelector('.sirk-layout-host > .sirk-column:nth-child(2) > .sirk-list');
        if (!list) return;
        var currentRoot = rootKey(shell);
        if (shell !== activeShell || currentRoot !== activeRoot) {
            expanded = {};
            activeShell = shell;
            activeRoot = currentRoot;
        }
        assignKeys(shell, list);
        applyVisibility(list);
    }

    function schedule(shell) {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(function () {
            scheduled = false;
            enhance(shell || document.querySelector(".sirk-view-shell"));
        });
    }

    function toggle(heading) {
        var key = heading.getAttribute("data-folder-collapse-key");
        if (!key) return;
        var next = heading.getAttribute("aria-expanded") === "false";
        expanded[key] = next;
        heading.classList.toggle("is-expanded", next);
        heading.classList.toggle("is-collapsed", !next);
        Array.prototype.forEach.call(heading.parentElement.querySelectorAll(":scope > .sirk-folder-heading.is-active"), function (node) {
            node.classList.toggle("is-active", node === heading);
        });
        heading.classList.add("is-active");
        heading.setAttribute("aria-expanded", next ? "true" : "false");
        var list = heading.parentElement;
        if (list) applyVisibility(list);
    }

    document.addEventListener("click", function (event) {
        var heading = event.target && event.target.closest && event.target.closest("#sirkPortalRoot .sirk-view-shell .sirk-folder-heading");
        if (!heading) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(heading);
    }, true);

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        var heading = event.target && event.target.closest && event.target.closest("#sirkPortalRoot .sirk-view-shell .sirk-folder-heading");
        if (!heading) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(heading);
    }, true);

    function bind() {
        var portal = document.getElementById("sirkPortalRoot");
        if (!portal) return false;
        ensureStyle();
        schedule(portal.querySelector(".sirk-view-shell"));
        if (!portal.__sirkPlatformFolderCollapseObserver) {
            portal.__sirkPlatformFolderCollapseObserver = new MutationObserver(function (records) {
                for (var index = 0; index < records.length; index++) {
                    var target = records[index].target;
                    var shell = target && target.nodeType === 1 && target.closest && target.closest(".sirk-view-shell");
                    if (shell || portal.querySelector(".sirk-view-shell")) {
                        schedule(shell || portal.querySelector(".sirk-view-shell"));
                        break;
                    }
                }
            });
            portal.__sirkPlatformFolderCollapseObserver.observe(portal, { childList: true, subtree: true });
        }
        return true;
    }

    var attempts = 0;
    var timer = window.setInterval(function () {
        attempts++;
        if (bind() || attempts > 120) window.clearInterval(timer);
    }, 100);
}());

(function () {
    "use strict";

    if (window.__sirkSettingsI18nLoaded) return;
    window.__sirkSettingsI18nLoaded = true;

    var pairs = [
        ["Ustawienia", "Settings"], ["Serwer", "Server"], ["Moduły", "Modules"], ["Przegląd", "Overview"],
        ["Urządzenia", "Devices"], ["Akceptacje", "Approvals"], ["Przenoszenie urządzeń", "Move devices"],
        ["Automatyzacja", "Automation"], ["Zasoby", "Assets"], ["Zarządzanie", "Management"],
        ["Raporty", "Reports"], ["Bezpieczeństwo", "Security"], ["Integracje", "Integrations"],
        ["Ogólne", "General"], ["Widoczność", "Visibility"], ["Baner", "Banner"],
        ["Zaślepka", "Maintenance page"], ["Animacje", "Animations"], ["Usługa", "Service"],
        ["Konfiguracja", "Configuration"], ["Logi", "Logs"], ["Błędy", "Errors"], ["Aktualizacje", "Updates"],
        ["Sprawdź", "Check"], ["Historia", "History"], ["Kanał", "Channel"], ["Kopie zapasowe", "Backups"],
        ["Wtyczki", "Plugins"], ["Zainstalowane", "Installed"], ["Dostępne", "Available"],
        ["Odśwież", "Refresh"], ["Szukaj...", "Search..."], ["Zapisz", "Save"],
        ["Zapisywanie…", "Saving…"], ["Zapisano.", "Saved."], ["Ładowanie…", "Loading…"],
        ["Dodaj z URL", "Add from URL"], ["Sprawdź aktualizacje", "Check for updates"],
        ["Aktualizuj", "Update"], ["Przywróć", "Restore"], ["Usuń", "Delete"], ["Włącz", "Enable"], ["Wyłącz", "Disable"],
        ["Utwórz backup", "Create backup"], ["Restartuj usługę", "Restart service"],
        ["Widok domyślny", "Default view"], ["Włącz i pokaż", "Enable and show"],
        ["Włącz akceptacje", "Enable approvals"], ["Dostęp grup Portalu", "Portal group access"],
        ["Wybrane grupy widzą tę zakładkę. Brak wyboru oznacza dostęp dla wszystkich. Site administrator ma dostęp zawsze.", "Selected groups can see this tab. No selection means access for everyone. Site administrator always has access."],
        ["Brak wyboru oznacza dostęp dla wszystkich. Site administrator ma dostęp zawsze.", "No selection means access for everyone. Site administrator always has access."],
        ["Nie utworzono jeszcze grup użytkowników Portalu.", "No Portal user groups have been created yet."],
        ["Pokaż Devices", "Show Devices"], ["Pokaż stan systemu", "Show system status"], ["Pokaż Integrations", "Show Integrations"],
        ["Włącz baner", "Enable banner"], ["Pokaż w Portalu", "Show in Portal"], ["Pokaż na stronie logowania", "Show on login page"],
        ["Aktywny szablon", "Active template"], ["Zielony — aktualizacja", "Green — update"],
        ["Żółty — ostrzeżenie", "Yellow — warning"], ["Czerwony — awaria", "Red — outage"],
        ["Nazwa", "Name"], ["Tekst", "Text"], ["Kolor tła", "Background color"], ["Kolor tekstu", "Text color"],
        ["Rozmiar tekstu", "Text size"], ["Czas wyświetlania (minuty)", "Display time (minutes)"], ["Bez wskazania końca", "No end time"],
        ["Włącz zaślepkę", "Enable maintenance page"], ["Tytuł", "Title"], ["Komunikat", "Message"],
        ["Planowane zakończenie", "Planned end"], ["Dozwolone adresy IP", "Allowed IP addresses"],
        ["Jeden adres lub zakres CIDR w wierszu.", "One address or CIDR range per line."],
        ["Pokaż informację dozwolonym IP", "Show notice to allowed IPs"],
        ["Blokuje dostęp użytkownikom spoza listy dozwolonych adresów IP.", "Blocks users outside the allowed IP list."],
        ["Włącz animacje", "Enable animations"], ["Ogranicz ruch zgodnie z ustawieniami użytkownika", "Respect the user's reduced motion setting"],
        ["Wyłącza animacje, gdy system użytkownika ma włączone ograniczenie ruchu.", "Disables animations when the user's system requests reduced motion."],
        ["Dodaj animację", "Add animation"], ["Podgląd animacji", "Preview animation"], ["Włącz animację", "Enable animation"],
        ["Typ animacji", "Animation type"], ["Symbol / emoji", "Symbol / emoji"], ["Kolory", "Colors"],
        ["Intensywność", "Intensity"], ["Prędkość", "Speed"], ["Rozmiar (px)", "Size (px)"], ["Przezroczystość", "Opacity"],
        ["Czas działania (sekundy)", "Duration (seconds)"], ["Data rozpoczęcia", "Start date"], ["Data zakończenia", "End date"],
        ["Warstwa", "Layer"], ["W tle", "Background"], ["Na wierzchu", "Foreground"], ["Usuń animację", "Remove animation"],
        ["Padający śnieg", "Falling snow"], ["Postać przechodząca", "Walking character"],
        ["Postać przechodząca przez stronę", "Character walking across the page"], ["Motyw świąteczny", "Christmas theme"],
        ["Spadające symbole", "Falling symbols"], ["Unoszące się symbole", "Floating symbols"], ["Własna animacja", "Custom animation"],
        ["Można podać kilka symboli oddzielonych spacją, np. ❄ 🎄 ⭐.", "You can enter several symbols separated by spaces, for example ❄ 🎄 ⭐."],
        ["Kolory CSS oddzielone przecinkami.", "CSS colors separated by commas."],
        ["0 oznacza animację bez limitu czasu.", "0 means the animation has no time limit."],
        ["Uruchomiono podgląd. Animacja nie została jeszcze zapisana.", "Preview started. The animation has not been saved yet."],
        ["Podgląd będzie dostępny po odświeżeniu Portalu.", "Preview will be available after refreshing the Portal."],
        ["Włącz komunikat Release", "Enable release message"], ["Pokaż po aktualizacji", "Show after update"],
        ["Tytuł komunikatu", "Message title"], ["Maksymalna liczba commitów", "Maximum number of commits"],
        ["Podgląd listy zmian", "Change list preview"], ["Co nowego", "What's new"],
        ["Pokazuje użytkownikom listę zmian po aktualizacji.", "Shows users the change list after an update."],
        ["Lista commitów zostanie pobrana z GitHub po zapisaniu lub aktualizacji.", "The commit list will be retrieved from GitHub after saving or updating."],
        ["Konfiguracja SMS jest gotowa do zdefiniowania.", "SMS configuration is ready to be defined."],
        ["Brak pól konfiguracyjnych dla tej integracji.", "No configuration fields are available for this integration."],
        ["Pozwól wykonać bez akceptacji", "Allow execution without approval"], ["Pokaż w Akceptacjach", "Show in Approvals"],
        ["Pokaż na Overview", "Show on Overview"], ["Ładowanie polityk akceptacji…", "Loading approval policies…"],
        ["Żaden moduł nie ma włączonej obsługi akceptacji.", "No module has approval handling enabled."],
        ["Wnioski tego modułu będą obsługiwane przez moduł Akceptacje.", "Requests from this module will be handled by Approvals."],
        ["Pozwala wykonać operację od razu, gdy nie wybrano żadnego poziomu akceptacji.", "Allows the operation to run immediately when no approval level is selected."],
        ["Pokazuje wnioski tego modułu w widoku Akceptacje.", "Shows this module's requests in the Approvals view."],
        ["Uwzględnia ten typ wniosków na stronie głównej.", "Includes this request type on the Overview page."],
        ["Wszystkie", "All"], ["Aktualna", "Current"], ["Niezgodna", "Incompatible"], ["Brak danych", "No data"],
        ["Gotowe", "Ready"], ["Nie gotowe", "Not ready"], ["Uruchomiona", "Running"], ["Zatrzymana", "Stopped"],
        ["Włączona", "Enabled"], ["Wyłączona", "Disabled"], ["Wykonywanie operacji…", "Performing operation…"],
        ["Operacja zakończona.", "Operation completed."], ["Dodawanie…", "Adding…"],
        ["Wtyczka została zainstalowana i włączona.", "The plugin was installed and enabled."],
        ["Aktualizacja zakończona.", "Update completed."], ["Restart usługi SIRK Portal…", "Restarting the SIRK Portal service…"],
        ["Aktualizacja", "Update"], ["Ostrzeżenie", "Warning"], ["Awaria", "Outage"],
        ["System został pomyślnie zaktualizowany.", "The system was updated successfully."],
        ["W systemie występują drobne problemy. Trwają prace nad ich usunięciem.", "The system has minor issues. Work is underway to resolve them."],
        ["Część funkcji systemu jest obecnie niedostępna.", "Some system functions are currently unavailable."],
        ["Przerwa serwisowa", "Maintenance break"],
        ["System jest chwilowo niedostępny z powodu zaplanowanych prac serwisowych.", "The system is temporarily unavailable due to scheduled maintenance."],
        ["Rozumiem", "Got it"], ["Wróć", "Back"], ["Anuluj", "Cancel"], ["Potwierdź", "Confirm"],
        ["Tak", "Yes"], ["Nie", "No"], ["Stan", "Status"], ["Wersja", "Version"], ["Akcje", "Actions"]
    ];

    var plToEn = Object.create(null);
    var enToPl = Object.create(null);
    pairs.forEach(function (pair) { plToEn[pair[0]] = pair[1]; enToPl[pair[1]] = pair[0]; });

    var technical = {
        forceNewLogin: ["Wymuś nowe logowanie", "Force new login"], forcePortalInterface: ["Wymuś interfejs Portalu", "Force Portal interface"],
        keepSessionsAfterRestart: ["Zachowaj sesje po restarcie", "Keep sessions after restart"],
        accessGroupIds: ["Grupy dostępu", "Access groups"], retentionDays: ["Dni przechowywania", "Retention days"],
        maxMultiHostNodes: ["Maksymalna liczba hostów", "Maximum multi-host nodes"],
        multiHostConcurrency: ["Równoległość wielu hostów", "Multi-host concurrency"]
    };

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function mapped(value) {
        value = String(value == null ? "" : value);
        var trimmed = value.trim();
        var result = language() === "en" ? plToEn[trimmed] : enToPl[trimmed];
        if (!result && technical[trimmed]) result = technical[trimmed][language() === "en" ? 1 : 0];
        var level = trimmed.match(/^(?:Poziom|Level)\s+([123])\s+—\s+(?:grupy zatwierdzające|approver groups)$/i);
        if (level) result = language() === "en" ? "Level " + level[1] + " — approver groups" : "Poziom " + level[1] + " — grupy zatwierdzające";
        var available = trimmed.match(/^(?:Dostępna|Available)\s+(.+)$/i);
        if (available) result = (language() === "en" ? "Available " : "Dostępna ") + available[1];
        var error = trimmed.match(/^(?:Błąd|Error):\s*(.+)$/i);
        if (error) result = (language() === "en" ? "Error: " : "Błąd: ") + error[1];
        return result ? value.replace(trimmed, result) : value;
    }

    function ensureStyle(doc) {
        if (!doc || !doc.head || doc.getElementById("sirkSettingsI18nStyle")) return;
        var style = doc.createElement("style");
        style.id = "sirkSettingsI18nStyle";
        style.textContent = ".sirk-i18n-visual{font-size:0!important}.sirk-i18n-visual:after{content:attr(data-sirk-i18n-display);font-size:14px;line-height:1.35;white-space:normal}.sirk-nav-item.sirk-i18n-visual:after,.sirk-button.sirk-i18n-visual:after,button.sirk-i18n-visual:after{font-size:inherit}";
        doc.head.appendChild(style);
    }

    function visual(node) {
        return node && node.nodeType === 1 && node.matches("button,summary,.sirk-nav-item,[data-settings-field-copy] strong");
    }

    function translateVisual(node) {
        var source = node.getAttribute("data-sirk-i18n-source") || String(node.textContent || "").trim();
        var display = mapped(source);
        if (display === source && !plToEn[source] && !enToPl[source] && !technical[source]) return;
        node.setAttribute("data-sirk-i18n-source", source);
        node.setAttribute("data-sirk-i18n-display", display);
        node.classList.add("sirk-i18n-visual");
        var title = node.getAttribute("title");
        if (title) node.setAttribute("title", mapped(title));
        var aria = node.getAttribute("aria-label");
        if (aria) node.setAttribute("aria-label", mapped(aria));
    }

    function translateTextNode(node) {
        if (!node || node.nodeType !== 3 || !node.parentElement || visual(node.parentElement)) return;
        if (/^(SCRIPT|STYLE|TEXTAREA)$/i.test(node.parentElement.tagName)) return;
        var result = mapped(node.nodeValue);
        if (result !== node.nodeValue) node.nodeValue = result;
    }

    function applyDocument(doc) {
        if (!doc || !doc.documentElement) return;
        ensureStyle(doc);
        var scope = doc.getElementById("sirkStandaloneContent") || doc.getElementById("sirk-platform-admin") || doc.body;
        if (!scope) return;
        Array.prototype.forEach.call(scope.querySelectorAll("button,summary,.sirk-nav-item,[data-settings-field-copy] strong"), translateVisual);
        Array.prototype.forEach.call(scope.querySelectorAll("input,textarea,select,option,[title],[aria-label]"), function (node) {
            ["placeholder", "title", "aria-label"].forEach(function (attribute) {
                var value = node.getAttribute(attribute);
                if (value) node.setAttribute(attribute, mapped(value));
            });
            if (node.tagName === "OPTION") node.textContent = mapped(node.textContent);
        });
        var walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(translateTextNode);
        doc.documentElement.lang = language();
    }

    function applyAll() {
        applyDocument(document);
        Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (frame) {
            try { applyDocument(frame.contentDocument); } catch (error) {}
        });
    }

    var alertBase = window.alert;
    var confirmBase = window.confirm;
    if (typeof alertBase === "function" && !alertBase.__sirkI18n) {
        var alertTranslated = function (message) { return alertBase.call(window, mapped(message)); };
        alertTranslated.__sirkI18n = true;
        window.alert = alertTranslated;
    }
    if (typeof confirmBase === "function" && !confirmBase.__sirkI18n) {
        var confirmTranslated = function (message) { return confirmBase.call(window, mapped(message)); };
        confirmTranslated.__sirkI18n = true;
        window.confirm = confirmTranslated;
    }

    var i18nScheduled = false;
    new MutationObserver(function () {
        if (i18nScheduled) return;
        i18nScheduled = true;
        window.requestAnimationFrame(function () { i18nScheduled = false; applyAll(); });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["title", "aria-label", "placeholder"] });
    document.addEventListener("load", function (event) {
        if (event.target && event.target.tagName === "IFRAME") window.setTimeout(applyAll, 0);
    }, true);
    window.addEventListener("sirkportal:languagechange", function () { window.setTimeout(applyAll, 0); });
    applyAll();
}());
