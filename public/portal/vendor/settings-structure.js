(function () {
    "use strict";

    if (window.__sirkSettingsStructureLoaded) return;
    window.__sirkSettingsStructureLoaded = true;

    var activePrimary = "modules";
    var settingsHost = null;
    var hiddenGeneral = {
        enabled: true,
        accessgroupids: true,
        folderpermissions: true,
        providers: true,
        showinmenu: true,
        showondevice: true,
        hostbuttonenabled: true,
        menuenabled: true
    };

    function lang() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function text(pl, en) { return lang() === "en" ? en : pl; }
    function el(tag, className, value) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (value != null) node.textContent = value;
        return node;
    }

    function normalize(value) {
        return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    }

    function waitFor(condition, callback, attempts) {
        attempts = attempts || 0;
        var value = condition();
        if (value) { callback(value); return; }
        if (attempts > 100) return;
        setTimeout(function () { waitFor(condition, callback, attempts + 1); }, 30);
    }

    function injectStyle() {
        if (document.getElementById("sirk-settings-structure-style")) return;
        var style = document.createElement("style");
        style.id = "sirk-settings-structure-style";
        style.textContent = [
            ".sirk-settings-primary{display:grid;gap:6px;width:100%}",
            ".sirk-settings-primary>.sirk-nav-item{width:100%;min-height:42px;padding:10px 12px;text-align:left}",
            ".sirk-settings-primary>.sirk-nav-item.active{background:var(--sirk-active-bg,#e7eefc);border-color:var(--sirk-accent,#4d6bd8)}",
            ".sirk-settings-hidden{display:none!important}",
            ".sirk-settings-root-group>summary{display:none!important}",
            ".sirk-settings-root-group>.sirk-settings-nav-group-body{display:block!important;padding:0!important}",
            ".sirk-settings-note{margin:0 0 12px;padding:12px 14px;border:1px solid var(--sirk-border,#d7dee8);border-radius:10px;background:var(--sirk-surface,#fff)}"
        ].join("");
        (document.head || document.documentElement).appendChild(style);
    }

    function originals(primary) {
        var result = {};
        Array.prototype.forEach.call(primary.querySelectorAll(":scope > .sirk-nav-item"), function (button) {
            if (button.closest(".sirk-settings-primary")) return;
            var label = String(button.textContent || "").trim().toLowerCase();
            if (label === "ustawienia" || label === "settings") result.settings = button;
            else if (label.indexOf("użytkownicy") >= 0 || label.indexOf("users") >= 0) result.identity = button;
            else if (label === "system" || label === "server") result.server = button;
            button.classList.add("sirk-settings-hidden");
        });
        return result;
    }

    function findGroup(secondary, names) {
        return Array.prototype.find.call(secondary.querySelectorAll(":scope > details.sirk-settings-nav-group"), function (group) {
            var summary = group.querySelector(":scope > summary");
            return names.indexOf(String(summary && summary.textContent || "").trim().toLowerCase()) >= 0;
        });
    }

    function showNativeGroup(secondary, kind) {
        var modules = findGroup(secondary, ["moduły", "modules"]);
        var portal = findGroup(secondary, ["portal"]);
        [modules, portal].forEach(function (group) {
            if (!group) return;
            group.classList.add("sirk-settings-hidden");
            group.classList.remove("sirk-settings-root-group");
        });
        var target = kind === "portal" ? portal : modules;
        if (!target) return;
        target.classList.remove("sirk-settings-hidden");
        target.classList.add("sirk-settings-root-group");
        target.open = true;
    }

    function activeLeaf(secondary) {
        return secondary.querySelector(".sirk-settings-nav-leaf.active,.sirk-settings-nav-leaf.is-active,.sirk-nav-item.active,.sirk-nav-item.is-active");
    }

    function cleanDetails(layout) {
        var secondary = layout.querySelector(":scope > .sirk-column-secondary");
        var details = layout.querySelector(":scope > .sirk-column-details");
        if (!secondary || !details || activePrimary !== "modules") return;
        var leaf = activeLeaf(secondary);
        var label = String(leaf && leaf.textContent || "").trim().toLowerCase();
        var isGeneral = label === "ogólne" || label === "general";
        var isPermissions = label === "permissions" || label === "uprawnienia";

        Array.prototype.forEach.call(details.querySelectorAll("[data-settings-field]"), function (row) {
            row.classList.remove("sirk-settings-hidden");
            if (!isGeneral) return;
            var strong = row.querySelector("strong");
            if (hiddenGeneral[normalize(strong && strong.textContent)]) row.classList.add("sirk-settings-hidden");
        });

        var oldNote = details.querySelector("[data-settings-clean-note]");
        if (oldNote) oldNote.remove();
        if (isGeneral || isPermissions) {
            var note = el("div", "sirk-settings-note", isPermissions ?
                text("Uprawnienia dostępu do modułu. Ustawienia techniczne nie są wyświetlane w sekcji Ogólne.", "Module access permissions. Technical settings are not shown in General.") :
                text("Ustawienia działania i widoczności modułu. Uprawnienia znajdują się w osobnej sekcji.", "Module behavior and visibility. Permissions are configured separately."));
            note.setAttribute("data-settings-clean-note", "1");
            details.insertBefore(note, details.firstChild);
        }
    }

    function selectPrimary(host, kind) {
        activePrimary = kind;
        var layout = host.querySelector("[data-portal-settings] .sirk-layout");
        if (!layout) return;
        var primary = layout.querySelector(":scope > .sirk-column-primary");
        var secondary = layout.querySelector(":scope > .sirk-column-secondary");
        var original = originals(primary);
        var promoted = primary.querySelector(".sirk-settings-primary");
        if (promoted) promoted.querySelectorAll("[data-settings-primary]").forEach(function (button) {
            button.classList.toggle("active", button.getAttribute("data-settings-primary") === kind);
        });

        if (kind === "identity") {
            if (original.identity) original.identity.click();
            return;
        }
        if (kind === "server") {
            if (original.server) original.server.click();
            return;
        }
        if (original.settings) original.settings.click();
        waitFor(function () {
            var next = layout.querySelector(":scope > .sirk-column-secondary");
            return next && findGroup(next, ["moduły", "modules"]) ? next : null;
        }, function (next) {
            showNativeGroup(next, kind);
            cleanDetails(layout);
        });
    }

    function primaryButton(host, key, pl, en) {
        var button = el("button", "sirk-nav-item" + (activePrimary === key ? " active" : ""), text(pl, en));
        button.type = "button";
        button.setAttribute("data-settings-primary", key);
        button.onclick = function () { selectPrimary(settingsHost, key); };
        host.appendChild(button);
    }

    function upgrade(host) {
        settingsHost = host;
        var layout = host.querySelector("[data-portal-settings] .sirk-layout");
        if (!layout) return;
        var primary = layout.querySelector(":scope > .sirk-column-primary");
        if (!primary) return;
        originals(primary);
        var promoted = primary.querySelector(".sirk-settings-primary");
        if (!promoted) {
            promoted = el("div", "sirk-settings-primary");
            primary.insertBefore(promoted, primary.firstChild);
            primaryButton(promoted, "modules", "Moduły", "Modules");
            primaryButton(promoted, "portal", "Portal", "Portal");
            primaryButton(promoted, "identity", "Użytkownicy i grupy", "Users and groups");
            primaryButton(promoted, "server", "Serwer", "Server");
        }
        selectPrimary(host, activePrimary);
        cleanDetails(layout);
    }

    function install() {
        if (!window.SirkPortalSettings || typeof window.SirkPortalSettings.mount !== "function") return false;
        if (window.SirkPortalSettings.mount.__sirkSettingsStructureWrapped) return true;
        var original = window.SirkPortalSettings.mount;
        var wrapped = function (host) {
            original(host);
            var scheduled = false;
            var observer = new MutationObserver(function () {
                if (scheduled) return;
                scheduled = true;
                requestAnimationFrame(function () {
                    scheduled = false;
                    upgrade(host);
                });
            });
            observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
            setTimeout(function () { upgrade(host); }, 0);
        };
        wrapped.__sirkSettingsStructureWrapped = true;
        window.SirkPortalSettings.mount = wrapped;
        return true;
    }

    injectStyle();
    var timer = setInterval(function () { if (install()) clearInterval(timer); }, 50);
}());