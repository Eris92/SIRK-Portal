(function () {
    "use strict";
    if (window.__sirkWorkspaceConnectionV1Loaded) return;
    window.__sirkWorkspaceConnectionV1Loaded = true;

    var sessions = Object.create(null), current = null, queued = false;
    var link = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l6-6M7 17l-1 1a3 3 0 104 4l3-3a3 3 0 000-4M17 7l1-1a3 3 0 10-4-4l-3 3a3 3 0 000 4"/></svg>';
    var unlink = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16l-2 2a3 3 0 104 4l3-3M16 8l2-2a3 3 0 10-4-4l-3 3M5 5l14 14"/></svg>';

    function lang() { try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; } catch (_) { return "pl"; } }
    function tx(pl, en) { return lang() === "en" ? en : pl; }
    function keyOf(ws) {
        var root = ws.closest("#sirkStandaloneContent"), id = root && root.getAttribute("data-sirk-active-device-id");
        if (id) return String(id);
        var name = ws.querySelector(".sirk-device-compact-main strong");
        return "name:" + String(name && name.textContent || "unknown").trim();
    }
    function state(ws) {
        var key = keyOf(ws);
        if (!sessions[key]) sessions[key] = { connected: false, explicit: "general" };
        return sessions[key];
    }
    function online(ws) {
        if (ws.querySelector(".sirk-device-connection.is-offline")) return false;
        if (ws.querySelector(".sirk-device-connection.is-online")) return true;
        var host = document.querySelector(".sirk-device-host-tab.is-active");
        return !!(host && host.classList.contains("is-online"));
    }
    function nav(ws) { return ws.querySelector(":scope > .sirk-device-tabs"); }
    function active(ws) {
        var node = nav(ws) && nav(ws).querySelector("[data-device-tab].is-active");
        return node && node.getAttribute("data-device-tab") || "general";
    }
    function desktopStop(ws) {
        var button = ws.querySelector("[data-agent-desktop-disconnect]");
        if (button && !button.disabled) try { button.click(); } catch (_) {}
    }
    function general(ws, s) {
        if (active(ws) === "general") return;
        var button = nav(ws) && nav(ws).querySelector('[data-device-tab="general"]');
        if (button) { s.explicit = "general"; try { button.click(); } catch (_) {} }
    }
    function toggle(ws, s) {
        var bar = nav(ws), button = bar && bar.querySelector("[data-sirk-workspace-connection-toggle]");
        if (!bar) return null;
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "sirk-workspace-connection-toggle";
            button.setAttribute("data-sirk-workspace-connection-toggle", "1");
            bar.insertBefore(button, bar.firstChild);
            button.onclick = function (event) {
                event.preventDefault(); event.stopPropagation();
                if (!online(ws)) return;
                if (s.connected) { desktopStop(ws); s.connected = false; s.explicit = "general"; general(ws, s); }
                else { s.connected = true; s.explicit = "general"; }
                syncWorkspace(ws);
            };
        }
        return button;
    }
    function paintToggle(button, connected, isOnline) {
        if (button.disabled !== !isOnline) button.disabled = !isOnline;
        button.classList.toggle("is-connected", connected);
        button.classList.toggle("is-disconnected", !connected);
        button.setAttribute("aria-pressed", connected ? "true" : "false");
        button.title = !isOnline ? tx("Urządzenie jest offline", "Device is offline") : connected ? tx("Rozłącz", "Disconnect") : tx("Połącz", "Connect");
        var signature = (connected ? "1" : "0") + ":" + (isOnline ? "1" : "0") + ":" + lang();
        if (button.dataset.sirkConnectionSignature !== signature) {
            button.dataset.sirkConnectionSignature = signature;
            button.innerHTML = (connected ? unlink : link) + "<span>" + (connected ? tx("Rozłącz", "Disconnect") : tx("Połącz", "Connect")) + "</span>";
        }
    }
    function gate(ws, s, isOnline) {
        var connected = s.connected && isOnline;
        Array.prototype.forEach.call(nav(ws).querySelectorAll("[data-device-tab]"), function (button) {
            var type = button.getAttribute("data-device-tab") || "general", allowed = type === "general" || connected;
            if (button.disabled !== !allowed) button.disabled = !allowed;
            button.setAttribute("aria-disabled", allowed ? "false" : "true");
            button.title = allowed ? "" : tx("Najpierw połącz z urządzeniem", "Connect to the device first");
        });
        ws.classList.toggle("is-workspace-connected", connected);
        ws.classList.toggle("is-workspace-disconnected", !connected);
    }
    function desktopStart(ws, s) {
        if (!s.connected || s.explicit !== "desktop" || active(ws) !== "desktop") return;
        var button = ws.querySelector("[data-agent-desktop-connect]");
        if (!button || button.disabled || button.dataset.sirkWorkspaceStarted === "1") return;
        button.dataset.sirkWorkspaceStarted = "1";
        setTimeout(function () { if (ws.isConnected && s.connected && s.explicit === "desktop" && !button.disabled) try { button.click(); } catch (_) {} }, 0);
    }
    function syncWorkspace(ws) {
        if (!ws || !ws.isConnected || !nav(ws)) return;
        var s = state(ws), isOnline = online(ws);
        if (!isOnline && s.connected) { desktopStop(ws); s.connected = false; s.explicit = "general"; }
        paintToggle(toggle(ws, s), s.connected, isOnline);
        gate(ws, s, isOnline);
        if (active(ws) !== "general" && (!s.connected || s.explicit !== active(ws))) general(ws, s);
        desktopStart(ws, s);
    }
    function sync() {
        queued = false;
        var ws = document.querySelector("#sirkStandaloneContent .sirk-device-workspace");
        if (!ws) { current = null; return; }
        if (ws !== current) { current = ws; state(ws).explicit = "general"; }
        syncWorkspace(ws);
    }
    function schedule() { if (!queued) { queued = true; requestAnimationFrame(sync); } }
    function explicit(target) {
        var ws = target && target.closest && target.closest(".sirk-device-workspace");
        if (!ws) return;
        var type = target.getAttribute("data-device-tab");
        if (type && (type === "general" || state(ws).connected)) state(ws).explicit = type;
    }

    document.addEventListener("pointerdown", function (event) {
        var tab = event.target && event.target.closest && event.target.closest(".sirk-device-workspace [data-device-tab]");
        if (tab) explicit(tab);
        var menu = event.target && event.target.closest && event.target.closest("[data-device-tab-section]");
        if (menu && current) { var type = menu.getAttribute("data-device-tab-section") || "general", s = state(current); if (type === "general" || s.connected) s.explicit = type; }
        var close = event.target && event.target.closest && event.target.closest("[data-device-tab-close],[data-device-back]");
        if (close && current) { var key = keyOf(current), s2 = state(current); desktopStop(current); s2.connected = false; s2.explicit = "general"; if (close.matches("[data-device-tab-close]")) delete sessions[key]; }
    }, true);
    document.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        var tab = event.target && event.target.closest && event.target.closest(".sirk-device-workspace [data-device-tab]");
        if (tab) explicit(tab);
    }, true);
    window.addEventListener("sirkportal:languagechange", schedule);
    window.addEventListener("sirkportal:deviceviewmodechange", schedule);

    var css = document.createElement("style");
    css.id = "sirk-workspace-connection-style";
    css.textContent = [
        "#sirkPortalRoot .sirk-device-tabs-standalone{align-items:center!important;height:46px!important;min-height:46px!important;padding:4px 0!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab{height:38px!important;min-height:38px!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-all{align-self:center!important;margin-top:0!important}",
        "#sirkPortalRoot .sirk-device-workspace>.sirk-device-tabs{align-items:center!important;height:42px!important;min-height:42px!important;padding:4px 12px!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-connection-actions{display:none!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab{display:grid!important;grid-template-columns:minmax(118px,1fr) 28px!important;grid-template-rows:19px 19px!important;min-width:154px!important;max-width:250px!important;height:38px!important;min-height:38px!important;padding:0!important;overflow:hidden!important;border-radius:9px!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-main{grid-column:1!important;grid-row:1/span 2!important;justify-content:flex-start!important;height:auto!important;min-height:0!important;padding:0 10px!important;border-radius:8px 0 0 8px!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-actions{grid-column:2!important;grid-row:1/span 2!important;display:grid!important;grid-template-rows:1fr 1fr!important;width:28px!important;min-width:28px!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-close,#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-tab-menu-toggle{display:grid!important;width:27px!important;min-width:27px!important;height:auto!important;min-height:0!important;padding:0!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{border-color:#16a34a!important;background:rgba(22,163,74,.16)!important;color:var(--sirk-text,#172033)!important}",
        "#sirkPortalRoot .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{border-color:#dc2626!important;background:rgba(220,38,38,.14)!important;color:var(--sirk-text,#172033)!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-online{background:rgba(22,163,74,.25)!important;color:#dcfce7!important}",
        "#sirkPortalRoot.sirk-theme-dark .sirk-device-tabs-standalone .sirk-device-host-tab.is-offline{background:rgba(220,38,38,.24)!important;color:#fee2e2!important}",
        "#sirkPortalRoot .sirk-device-workspace>.sirk-device-tabs .sirk-workspace-connection-toggle{order:-1;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;min-width:92px!important;min-height:32px!important;padding:5px 12px!important;border-radius:7px!important;font-weight:700!important;color:#fff!important}",
        "#sirkPortalRoot .sirk-workspace-connection-toggle.is-disconnected{border-color:#15803d!important;background:#198754!important}",
        "#sirkPortalRoot .sirk-workspace-connection-toggle.is-connected{border-color:#b91c1c!important;background:#dc2626!important}",
        "#sirkPortalRoot .sirk-workspace-connection-toggle:disabled{border-color:#94a3b8!important;background:#64748b!important;opacity:.58!important;cursor:not-allowed!important}",
        "#sirkPortalRoot .sirk-workspace-connection-toggle svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
        "#sirkPortalRoot .sirk-device-workspace>.sirk-device-tabs [data-device-tab]:disabled{opacity:.38!important;cursor:not-allowed!important;filter:saturate(.35)}",
        "#sirkPortalRoot .sirk-device-workspace .sirk-agent-desktop-controls [data-agent-desktop-connect],#sirkPortalRoot .sirk-device-workspace .sirk-agent-desktop-controls [data-agent-desktop-disconnect]{display:none!important}"
    ].join("");
    (document.head || document.documentElement).appendChild(css);

    new MutationObserver(schedule).observe(document.getElementById("sirkStandaloneContent") || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled", "data-sirk-active-device-id"] });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true }); else schedule();
}());
