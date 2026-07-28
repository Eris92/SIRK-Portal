(function () {
    "use strict";

    if (window.__sirkPlatformPortalDeviceWorkspaceLoaded) return;
    window.__sirkPlatformPortalDeviceWorkspaceLoaded = true;

    var content = document.getElementById("sirkStandaloneContent");
    var core = window.SirkPlatformCore;
    var selectedNodeId = "";
    var selectedNode = null;
    var inventory = null;
    var activeTab = "general";
    var bridge = null;
    var bridgeSequence = 0;
    var transformScheduled = false;
    var quickCommands = { data: null, category: "", selected: null, search: "" };
    var DEVICE_ICON = '<svg class="sirk-device-computer-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M6.5 7.5h11v6h-11z" class="sirk-device-computer-screen"/></svg>';

    var VIEWMODES = { desktop: 11, terminal: 12, files: 13, registry: 9, software: 18, amt: 14 };
    var PANEL_IDS = {
        desktop: ["p11"],
        terminal: ["p12"],
        files: ["p13"],
        registry: ["p9", "p9registry", "p9Registry"],
        software: ["p18", "p18software", "p18Software"],
        amt: ["p14", "p14amt", "p14Amt"]
    };

    var TEXT = {
        pl: {
            general: "Ogólne", desktop: "Pulpit", terminal: "Terminal", commands: "Polecenia", files: "Pliki",
            registry: "Rejestr", software: "Oprogramowanie", amt: "Intel AMT",
            back: "Wróć do urządzeń", online: "Online", offline: "Offline",
            name: "Nazwa", status: "Status", group: "Grupa", system: "System",
            ip: "Adres IP", lastSeen: "Ostatnio widziany", agent: "Wersja agenta", nodeId: "Node ID",
            openMesh: "Otwórz w MeshCentral", noGroup: "Bez grupy", noOs: "Brak danych o systemie",
            method: "Metoda połączenia", meshAgent: "MeshAgent", amtKvm: "Intel AMT KVM",
            connect: "Połącz", disconnect: "Rozłącz", ready: "Pulpit nie jest połączony. Wybierz metodę i kliknij Połącz.",
            connectOptions: "Opcje połączenia", requestApprovalWithBar: "Zapytaj o zgodę + Bar", requestApprovalOnly: "Zapytaj o zgodę", privacyNotice: "Pasek Prywatności",
            loadingNative: "Ładowanie natywnej sesji MeshCentral…", preparing: "Przygotowanie modułu MeshCentral…",
            connecting: "Łączenie…", connected: "Połączono.", disconnected: "Rozłączono.",
            nativeReady: "Natywny moduł MeshCentral jest gotowy.", sessionError: "Nie udało się uruchomić natywnego modułu MeshCentral.",
            sessionMissing: "Sesja MeshCentral nie jest dostępna albo host nie został odnaleziony.", clickCanvas: "Kliknij ekran, aby przejąć klawiaturę.",
            quickCommands: "Szybkie polecenia", close: "Zamknij", loadingCommands: "Ładowanie poleceń…", noCommands: "Brak poleceń.",
            searchCommands: "Szukaj poleceń…", variables: "Parametry", runCommand: "Uruchom", requestCommand: "Wyślij wniosek",
            commandSent: "Polecenie zostało wysłane.", commandPending: "Polecenie oczekuje na akceptację.", commandFailed: "Nie udało się wysłać polecenia.", confirmCommand: "Uruchomić polecenie"
        },
        en: {
            general: "Overview", desktop: "Desktop", terminal: "Terminal", commands: "Commands", files: "Files",
            registry: "Registry", software: "Software", amt: "Intel AMT",
            back: "Back to devices", online: "Online", offline: "Offline",
            name: "Name", status: "Status", group: "Group", system: "Operating system",
            ip: "IP address", lastSeen: "Last seen", agent: "Agent version", nodeId: "Node ID",
            openMesh: "Open in MeshCentral", noGroup: "No group", noOs: "No operating system data",
            method: "Connection method", meshAgent: "MeshAgent", amtKvm: "Intel AMT KVM",
            connect: "Connect", disconnect: "Disconnect", ready: "Desktop is not connected. Choose a method and click Connect.",
            connectOptions: "Connect options", requestApprovalWithBar: "Request approval + Bar", requestApprovalOnly: "Request approval", privacyNotice: "Privacy notice",
            loadingNative: "Loading the native MeshCentral session…", preparing: "Preparing the MeshCentral module…",
            connecting: "Connecting…", connected: "Connected.", disconnected: "Disconnected.",
            nativeReady: "The native MeshCentral module is ready.", sessionError: "The native MeshCentral module could not be started.",
            sessionMissing: "The MeshCentral session is unavailable or the host could not be found.", clickCanvas: "Click the screen to capture the keyboard.",
            quickCommands: "Quick commands", close: "Close", loadingCommands: "Loading commands…", noCommands: "No commands.",
            searchCommands: "Search commands…", variables: "Variables", runCommand: "Run", requestCommand: "Request",
            commandSent: "Command submitted.", commandPending: "Command is waiting for approval.", commandFailed: "Command could not be submitted.", confirmCommand: "Run command"
        }
    };

    function language() {
        try { return localStorage.getItem("sirkPortal.language") === "en" ? "en" : "pl"; }
        catch (error) { return document.documentElement.lang === "en" ? "en" : "pl"; }
    }

    function t(key) { return TEXT[language()][key] || key; }

    function commandModule() {
        return window.SirkPlatformModules && window.SirkPlatformModules.mycommands || null;
    }

    function localized(item, field) {
        var locale = item && item.locales && item.locales[language()];
        return locale && locale[field] || item && item[field] || "";
    }

    function esc(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function shortId(value) {
        var parts = String(value || "").split("/");
        return parts[parts.length - 1] || "";
    }

    function sameNodeId(left, right) {
        left = String(left || "");
        right = String(right || "");
        return left === right || (shortId(left) && shortId(left) === shortId(right));
    }

    function formatLastSeen(value) {
        if (value == null || value === "") return "—";
        var number = Number(value);
        var date = Number.isFinite(number) ? new Date(number < 100000000000 ? number * 1000 : number) : new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(language() === "pl" ? "pl-PL" : "en-US");
    }

    function nodeOnline(node) { return Number(node && node.conn || 0) > 0; }

    function meshMap(value) {
        var map = Object.create(null);
        ((value && value.meshes) || []).forEach(function (mesh) {
            map[String(mesh.id || mesh._id || "")] = mesh;
        });
        return map;
    }

    function nodeGroup(node) {
        var map = meshMap(inventory);
        var mesh = map[String(node && (node.meshId || node.meshid) || "")];
        return String(mesh && mesh.name || t("noGroup"));
    }

    function getInventory() {
        if (inventory) return Promise.resolve(inventory);
        var apiBase = new URL(String(window.__SIRK_PLATFORM_API_BASE__ || ""), window.location.href);
        var request = apiBase.pathname.replace(/\/+$/, "") === "/api"
            ? fetch("/api/devices", { credentials: "same-origin", cache: "no-store" }).then(function (response) { return response.json().then(function (value) { if (!response.ok || value.ok === false) throw new Error(value.error || "Device inventory unavailable."); return value.value || value; }); })
            : core.api("portal", "devices");
        return request.then(function (value) {
            inventory = {
                nodes: Array.isArray(value && value.nodes) ? value.nodes : [],
                meshes: Array.isArray(value && value.meshes) ? value.meshes : []
            };
            return inventory;
        });
    }

    function findNode(value, id) {
        var nodes = value && value.nodes || [];
        for (var i = 0; i < nodes.length; i += 1) {
            if (sameNodeId(nodes[i].id || nodes[i]._id, id)) return nodes[i];
        }
        return null;
    }

    function nativeRootUrl(node, type) {
        var url = new URL(String(window.__SIRK_PLATFORM_NATIVE_URL__ || "/meshcentral/"), window.location.href);
        url.searchParams.set("sirkNative", "1");
        if (node && type && VIEWMODES[type]) {
            url.searchParams.set("viewmode", String(VIEWMODES[type]));
            url.searchParams.set("gotonode", String(node.id || node._id || ""));
        }
        return url.href;
    }

    function nativeDeviceUrl(node) {
        var url = new URL(String(window.__SIRK_PLATFORM_NATIVE_URL__ || "/meshcentral/"), window.location.href);
        url.pathname = url.pathname.replace(/meshcentral\/?$/i, "");
        if (!url.pathname) url.pathname = "/";
        if (url.pathname.charAt(url.pathname.length - 1) !== "/") url.pathname += "/";
        url.search = "";
        url.hash = "";
        url.searchParams.set("viewmode", "10");
        url.searchParams.set("gotonode", String(node.id || node._id || ""));
        return url.href;
    }

    function detailItem(label, value) {
        return '<div class="sirk-device-detail-item"><span>' + esc(label) + '</span><strong>' + esc(value == null || value === "" ? "—" : value) + '</strong></div>';
    }

    function fakeEvent() {
        return { shiftKey: false, preventDefault: function () {}, stopPropagation: function () {}, target: null, currentTarget: null };
    }

    function setBridgeStatus(value) {
        var element = document.getElementById("sirkNativeBridgeStatus");
        if (element) element.textContent = String(value || "");
    }

    function showBridgeOverlay(value, error) {
        var overlay = document.getElementById("sirkNativeBridgeOverlay");
        if (!overlay) return;
        overlay.hidden = false;
        overlay.innerHTML = '<div class="' + (error ?"sirk-native-bridge-error" : "") + '">' + esc(value) + '</div>';
    }

    function hideBridgeOverlay() {
        var overlay = document.getElementById("sirkNativeBridgeOverlay");
        if (overlay) overlay.hidden = true;
    }

    function activeNativeObject(win, type) {
        if (!win) return null;
        if (type === "desktop") return win.desktop;
        if (type === "terminal") return win.terminal;
        if (type === "files") return win.files;
        if (type === "registry") return win.registry || win.regedit || win.registryConnection;
        return null;
    }

    function stopBridge(removeFrame) {
        var current = bridge;
        bridge = null;
        bridgeSequence += 1;
        if (!current) return;
        if (current.closeMenuListener) {
            document.removeEventListener("click", current.closeMenuListener);
            current.closeMenuListener = null;
        }
        if (current.timer) clearInterval(current.timer);
        if (current.timeout) clearTimeout(current.timeout);
        try {
            var object = activeNativeObject(current.win, current.type);
            if (object && typeof object.Stop === "function") object.Stop();
        } catch (error) {}
        if (removeFrame !== false && current.frame && current.frame.parentNode) current.frame.parentNode.removeChild(current.frame);
    }

    function nativeNode(win, nodeId) {
        var sets = [win && win.nodes, win && win.xxnodes];
        for (var s = 0; s < sets.length; s += 1) {
            var set = sets[s];
            if (!set || typeof set !== "object") continue;
            if (set[nodeId]) return set[nodeId];
            if (set[shortId(nodeId)]) return set[shortId(nodeId)];
            var keys = Object.keys(set);
            for (var i = 0; i < keys.length; i += 1) {
                var node = set[keys[i]];
                var id = String(node && (node._id || node.id || keys[i]) || "");
                if (sameNodeId(id, nodeId)) return node;
            }
        }
        return null;
    }

    function injectNativeNode(win, node) {
        win.currentNode = node;
        win.xxcurrentNode = node;
        win.currentNodeId = node._id || node.id;
        win.currentNodeid = node._id || node.id;
        win.desktopNode = node;
        win.terminalNode = node;
        win.filesNode = node;
        var meshId = node.meshid || node.meshId;
        if (win.meshes && meshId && win.meshes[meshId]) {
            win.currentMesh = win.meshes[meshId];
            win.xxcurrentMesh = win.meshes[meshId];
        }
    }

    function findPanel(doc, type) {
        var ids = PANEL_IDS[type] || [];
        for (var i = 0; i < ids.length; i += 1) {
            var panel = doc.getElementById(ids[i]);
            if (panel) return panel;
        }
        return null;
    }

    function nativeAnchor(panel, type) {
        if (!panel) return null;
        if (type === "desktop") return panel.querySelector("#Desk") || panel.querySelector("canvas");
        if (type === "terminal") return panel.querySelector("#termarea3xdiv") || panel.querySelector(".xterm");
        if (type === "files") return panel.querySelector("#p13toolbar") || panel.querySelector("#fileArea4") || panel.querySelector("#p13files");
        return null;
    }

    function hideChromeBefore(panel, anchor) {
        if (!panel || !anchor || !panel.contains(anchor)) return;
        var current = anchor;
        while (current && current !== panel) {
            var parent = current.parentElement;
            if (!parent) break;
            var child = parent.firstElementChild;
            while (child && child !== current) {
                if (!child.contains(anchor)) child.classList.add("sirk-platform-native-bridge-hidden");
                child = child.nextElementSibling;
            }
            current = parent;
        }
    }

    function installNativeStage(win, panel, type) {
        var doc = win.document;
        var style = doc.getElementById("sirkPlatformNativeBridgeStyle");
        if (!style) {
            style = doc.createElement("style");
            style.id = "sirkPlatformNativeBridgeStyle";
            style.textContent = [
                "html,body{width:100%!important;height:100%!important;margin:0!important;overflow:hidden!important;background:#111!important}",
                "#sirkPlatformNativeBridgeStage{position:fixed!important;inset:0!important;z-index:2147483640!important;display:block!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#111!important}",
                ".sirk-platform-native-bridge-panel{position:relative!important;inset:auto!important;left:auto!important;top:auto!important;right:auto!important;bottom:auto!important;display:block!important;width:100%!important;height:100%!important;min-height:0!important;overflow:hidden!important;margin:0!important}",
                ".sirk-platform-native-bridge-information{overflow:auto!important;background:#fff!important;color:#111!important}",
                ".sirk-platform-native-bridge-hidden{display:none!important}",
                ".sirk-platform-native-bridge-panel #termarea3xdiv{top:0!important;bottom:30px!important}",
                ".sirk-platform-native-bridge-panel #p13toolbar{top:0!important}",
                ".sirk-platform-native-bridge-panel #fileArea4{height:calc(100% - 54px)!important}",
                ".sirk-platform-native-bridge-panel #Desk{max-width:100%!important;max-height:100%!important}"
            ].join("");
            (doc.head || doc.documentElement).appendChild(style);
        }
        var stage = doc.getElementById("sirkPlatformNativeBridgeStage");
        if (!stage) {
            stage = doc.createElement("div");
            stage.id = "sirkPlatformNativeBridgeStage";
            doc.body.appendChild(stage);
        }
        hideChromeBefore(panel, nativeAnchor(panel, type));
        stage.appendChild(panel);
        panel.classList.add("sirk-platform-native-bridge-panel");
        if (type === "registry" || type === "software" || type === "amt") panel.classList.add("sirk-platform-native-bridge-information");
        return panel;
    }

    function waitForNative(frame, nodeId, type, sequence) {
        return new Promise(function (resolve, reject) {
            var started = Date.now();
            function poll() {
                if (sequence !== bridgeSequence || !frame.parentNode) { reject(new Error("Native bridge was cancelled.")); return; }
                try {
                    var win = frame.contentWindow;
                    var doc = win && win.document;
                    var node = nativeNode(win, nodeId);
                    if (win && doc && doc.body && typeof win.go === "function" && node) {
                        resolve({ win: win, doc: doc, node: node });
                        return;
                    }
                } catch (error) {
                    reject(new Error("Same-origin access to MeshCentral was blocked: " + (error.message || error)));
                    return;
                }
                if (Date.now() - started > 25000) { reject(new Error(t("sessionMissing"))); return; }
                setTimeout(poll, 200);
            }
            poll();
        });
    }

    function waitForPanel(win, type, sequence) {
        return new Promise(function (resolve, reject) {
            var started = Date.now();
            function poll() {
                if (sequence !== bridgeSequence) { reject(new Error("Native bridge was cancelled.")); return; }
                var panel = findPanel(win.document, type);
                if (panel) { resolve(panel); return; }
                if (Date.now() - started > 12000) { reject(new Error("Native panel " + type + " was not found.")); return; }
                setTimeout(poll, 120);
            }
            poll();
        });
    }

    function nativeDiagnostics(current) {
        var object = activeNativeObject(current.win, current.type);
        var state = object && (object.State != null ? object.State : object.state);
        var socket = object && object.socket;
        return [
            "type=" + current.type,
            "node=" + (current.node && (current.node._id || current.node.id) || "BRAK"),
            "view=" + VIEWMODES[current.type],
            "object=" + (object ? "OK" : "BRAK"),
            "state=" + (state != null ? state : "n/a"),
            "socket=" + (socket ? socket.readyState : "BRAK")
        ].join(" | ");
    }

    function prepareNative(frame, node, type, sequence) {
        setBridgeStatus(t("preparing"));
        showBridgeOverlay(t("preparing"), false);
        return waitForNative(frame, node.id || node._id, type, sequence).then(function (native) {
            if (sequence !== bridgeSequence) throw new Error("Native bridge was cancelled.");
            injectNativeNode(native.win, native.node);
            native.win.go(VIEWMODES[type]);
            return waitForPanel(native.win, type, sequence).then(function (panel) {
                installNativeStage(native.win, panel, type);
                if (!bridge || sequence !== bridgeSequence) throw new Error("Native bridge was cancelled.");
                bridge.win = native.win;
                bridge.node = native.node;
                bridge.panel = panel;
                frame.classList.add("is-session-visible");
                hideBridgeOverlay();
                return bridge;
            });
        });
    }

    function connectNative(method) {
        var current = bridge;
        if (!current || !current.frame) return;
        var sequence = current.sequence;
        var connectButton = document.getElementById("sirkNativeConnect");
        var disconnectButton = document.getElementById("sirkNativeDisconnect");
        if (connectButton) connectButton.disabled = true;
        setBridgeStatus(t("connecting"));
        prepareNative(current.frame, current.portalNode, current.type, sequence).then(function (prepared) {
            var win = prepared.win;
            if (prepared.type === "desktop") {
                if (typeof win.connectDesktop !== "function") throw new Error("connectDesktop is unavailable.");
                win.connectDesktop(fakeEvent(), Number(method || 3));
            } else if (prepared.type === "terminal") {
                if (typeof win.setupTerminal === "function") win.setupTerminal();
                if (typeof win.connectTerminal !== "function") throw new Error("connectTerminal is unavailable.");
                win.connectTerminal(fakeEvent(), 1);
            } else if (prepared.type === "files") {
                if (typeof win.setupFiles === "function") win.setupFiles();
                if (typeof win.connectFiles !== "function") throw new Error("connectFiles is unavailable.");
                win.connectFiles(fakeEvent());
            }
            if (disconnectButton) disconnectButton.disabled = false;
            prepared.timer = setInterval(function () {
                if (!bridge || bridge.sequence !== sequence) return;
                var object = activeNativeObject(win, prepared.type);
                var state = object && (object.State != null ? object.State : object.state);
                if (state === 3 || state === 4) {
                    setBridgeStatus(t("connected") + (prepared.type === "desktop" ? " " + t("clickCanvas") : ""));
                    var quickToggle = document.getElementById("sirkQuickCommandsToggle");
                    if (quickToggle && prepared.type === "desktop") quickToggle.hidden = false;
                    if (prepared.type === "terminal" && win.xterm) { try { win.xterm.focus(); } catch (error) {} }
                } else setBridgeStatus(t("connecting") + (state != null ? " [" + state + "]" : ""));
            }, 250);
            prepared.timeout = setTimeout(function () {
                if (!bridge || bridge.sequence !== sequence) return;
                var object = activeNativeObject(win, prepared.type);
                var state = object && (object.State != null ? object.State : object.state);
                if (!object || (state !== 3 && state !== 4)) showBridgeOverlay(t("sessionError") + "\n" + nativeDiagnostics(prepared), true);
            }, 22000);
        }).catch(function (error) {
            if (connectButton) connectButton.disabled = false;
            if (disconnectButton) disconnectButton.disabled = true;
            showBridgeOverlay(t("sessionError") + "\n" + (error && (error.stack || error.message) || error), true);
            setBridgeStatus(t("sessionError"));
        });
    }

    function disconnectNative() {
        if (!bridge) return;
        try {
            var object = activeNativeObject(bridge.win, bridge.type);
            if (object && typeof object.Stop === "function") object.Stop();
        } catch (error) {}
        if (bridge.timer) { clearInterval(bridge.timer); bridge.timer = null; }
        if (bridge.timeout) { clearTimeout(bridge.timeout); bridge.timeout = null; }
        var connectButton = document.getElementById("sirkNativeConnect");
        var disconnectButton = document.getElementById("sirkNativeDisconnect");
        if (connectButton) connectButton.disabled = false;
        if (disconnectButton) disconnectButton.disabled = true;
        var quickToggle = document.getElementById("sirkQuickCommandsToggle");
        var quickPanel = document.getElementById("sirkQuickCommandsPanel");
        if (quickToggle) { quickToggle.hidden = true; quickToggle.setAttribute("aria-expanded", "false"); }
        if (quickPanel) quickPanel.hidden = true;
        if (bridge.frame) bridge.frame.classList.remove("is-session-visible");
        showBridgeOverlay(t("ready"), false);
        setBridgeStatus(t("disconnected"));
    }

    function renderNativeTab(host, node, type) {
        stopBridge(true);
        var nativeBase = new URL(String(window.__SIRK_PLATFORM_NATIVE_URL__ || "/meshcentral/"), window.location.href);
        if (nativeBase.origin !== window.location.origin) {
            var externalUrl = new URL(nativeDeviceUrl(node));
            externalUrl.searchParams.set("viewmode", String(VIEWMODES[type] || 10));
            externalUrl.searchParams.set("gotonode", String(node.id || node._id || ""));
            host.innerHTML = '<div class="sirk-native-bridge-shell"><div class="sirk-native-bridge-toolbar"><a class="sirk-native-bridge-button" target="_blank" rel="noopener noreferrer" href="' + esc(externalUrl.href) + '">' + esc(t("openMesh")) + '</a><span class="sirk-native-bridge-status">' + esc(t(type)) + '</span></div><div class="sirk-native-bridge-stage"><iframe class="sirk-native-bridge-frame is-session-visible" title="MeshCentral ' + esc(t(type)) + '" allow="clipboard-read; clipboard-write; fullscreen" src="' + esc(externalUrl.href) + '"></iframe></div></div>';
            return;
        }
        var interactive = type === "desktop" || type === "terminal" || type === "files";
        var selector = type === "desktop"
            ? '<div class="sirk-native-bridge-button-group">' +
              '<button id="sirkNativeConnect" class="sirk-native-bridge-button sirk-native-bridge-split-main" type="button">' + esc(t("connect")) + '</button>' +
              '<button id="sirkNativeConnectDropdown" class="sirk-native-bridge-button sirk-native-bridge-split-toggle" type="button" aria-expanded="false" aria-haspopup="menu" title="' + esc(t("connectOptions")) + '">▼</button>' +
              '<div id="sirkNativeConnectMenu" class="sirk-native-bridge-menu" hidden>' +
              '<button type="button" class="sirk-native-bridge-menu-item" data-connect-option="3">' + esc(t("requestApprovalWithBar")) + '</button>' +
              '<button type="button" class="sirk-native-bridge-menu-item" data-connect-option="3">' + esc(t("requestApprovalOnly")) + '</button>' +
              '<button type="button" class="sirk-native-bridge-menu-item" data-connect-option="1">' + esc(t("privacyNotice")) + '</button>' +
              '</div>' +
              '</div>' +
              '<button id="sirkNativeAMT" class="sirk-native-bridge-button" type="button">' + esc(t("amtKvm")) + '</button>'
            : '<span class="sirk-native-bridge-label">' + esc(t(type)) + '</span>';
        var controls = type === "desktop"
            ? '<button id="sirkNativeDisconnect" class="sirk-native-bridge-button" type="button" disabled>' + esc(t("disconnect")) + '</button>'
            : interactive
            ? '<button id="sirkNativeConnect" class="sirk-native-bridge-button" type="button">' + esc(t("connect")) + '</button><button id="sirkNativeDisconnect" class="sirk-native-bridge-button" type="button" disabled>' + esc(t("disconnect")) + '</button>'
            : "";
        var quickPanel = type === "desktop" ? '<button id="sirkQuickCommandsToggle" class="sirk-quick-commands-toggle" type="button" aria-expanded="false" title="' + esc(t("quickCommands")) + '" hidden><span>›_</span></button><aside id="sirkQuickCommandsPanel" class="sirk-quick-commands-panel" hidden></aside>' : "";
        host.innerHTML = '<div class="sirk-native-bridge-shell"><div class="sirk-native-bridge-toolbar">' + selector + controls + '<span id="sirkNativeBridgeStatus" class="sirk-native-bridge-status">' + esc(interactive ? t("ready") : t("loadingNative")) + '</span></div><div class="sirk-native-bridge-stage"><iframe id="sirkNativeBridgeFrame" class="sirk-native-bridge-frame" title="MeshCentral native module" allow="clipboard-read; clipboard-write; fullscreen"></iframe><div id="sirkNativeBridgeOverlay" class="sirk-native-bridge-overlay"><div>' + esc(interactive ? t("ready") : t("loadingNative")) + '</div></div>' + quickPanel + '</div></div>';
        var frame = document.getElementById("sirkNativeBridgeFrame");
        var sequence = ++bridgeSequence;
        bridge = { sequence: sequence, frame: frame, portalNode: node, type: type, win: null, node: null, panel: null, timer: null, timeout: null };
        frame.addEventListener("load", function () {
            if (!bridge || bridge.sequence !== sequence) return;
            setBridgeStatus(interactive ? t("ready") : t("preparing"));
            if (!interactive) {
                prepareNative(frame, node, type, sequence).then(function () {
                    setBridgeStatus(t("nativeReady"));
                }).catch(function (error) {
                    showBridgeOverlay(t("sessionError") + "\n" + (error && (error.stack || error.message) || error), true);
                    setBridgeStatus(t("sessionError"));
                });
            }
        });
        frame.src = nativeRootUrl(node, type);
        if (interactive) {
            var selectedConnectOption = type === "desktop" ? 3 : 1;
            
            document.getElementById("sirkNativeConnect").addEventListener("click", function () {
                var method = type === "desktop" ? selectedConnectOption : 1;
                connectNative(method);
            });
            
            if (type === "desktop") {
                var connectDropdown = document.getElementById("sirkNativeConnectDropdown");
                var connectMenu = document.getElementById("sirkNativeConnectMenu");
                var buttonGroup = connectDropdown.closest(".sirk-native-bridge-button-group");
                
                connectDropdown.addEventListener("click", function (event) {
                    event.stopPropagation();
                    connectMenu.hidden = !connectMenu.hidden;
                    connectDropdown.setAttribute("aria-expanded", connectMenu.hidden ? "false" : "true");
                });
                
                var menuItems = connectMenu.querySelectorAll("[data-connect-option]");
                menuItems.forEach(function (item) {
                    item.addEventListener("click", function () {
                        selectedConnectOption = parseInt(this.getAttribute("data-connect-option"), 10);
                        connectMenu.hidden = true;
                        connectDropdown.setAttribute("aria-expanded", "false");
                    });
                });
                
                var amtButton = document.getElementById("sirkNativeAMT");
                amtButton.addEventListener("click", function () {
                    connectNative(2);
                });
                
                var closeMenuOnClickOutside = function (event) {
                    if (buttonGroup && !buttonGroup.contains(event.target)) {
                        connectMenu.hidden = true;
                        connectDropdown.setAttribute("aria-expanded", "false");
                    }
                };
                document.addEventListener("click", closeMenuOnClickOutside);
                
                if (bridge) bridge.closeMenuListener = closeMenuOnClickOutside;
            }
            
            document.getElementById("sirkNativeDisconnect").addEventListener("click", disconnectNative);
        }
        if (type === "desktop") {
            document.getElementById("sirkQuickCommandsToggle").addEventListener("click", function () {
                var panel = document.getElementById("sirkQuickCommandsPanel");
                if (!panel) return;
                panel.hidden = !panel.hidden;
                this.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
                if (panel.hidden) return;
                panel.innerHTML = '<div class="sirk-quick-command-loading">' + esc(t("loadingCommands")) + '</div>';
                if (quickCommands.data) { renderCompactCommands(); return; }
                core.api("mycommands", "scripts").then(function (response) {
                    quickCommands.data = response;
                    renderCompactCommands();
                }).catch(function (error) {
                    panel.innerHTML = '<div class="sirk-device-command-error">' + esc(error.message || String(error)) + '</div>';
                });
            });
        }
    }

    function agentOperation(node, type, parameters) {
        var body = new URLSearchParams();
        body.set("payload", JSON.stringify({
            tenantId: node.tenantId,
            deviceId: node.deviceId,
            type: type,
            parameters: parameters || {}
        }));
        return fetch("/api/agent-operations", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: body.toString()
        }).then(function (response) {
            return response.json().then(function (value) {
                if (!response.ok || value.ok === false) throw new Error(value.error || "HTTP " + response.status);
                return value.value;
            });
        });
    }

    function waitForAgentOperation(node, commandId, status) {
        var deadline = Date.now() + 150000;
        return new Promise(function (resolve, reject) {
            function poll() {
                var endpoint = "/api/agent-operations?tenantId=" + encodeURIComponent(node.tenantId) +
                    "&deviceId=" + encodeURIComponent(node.deviceId) +
                    "&commandId=" + encodeURIComponent(commandId);
                fetch(endpoint, { credentials: "same-origin", cache: "no-store" }).then(function (response) {
                    return response.json().then(function (value) {
                        if (!response.ok || value.ok === false) throw new Error(value.error || "HTTP " + response.status);
                        if (value.value.status === "completed" || value.value.status === "failed") {
                            resolve(value.value);
                            return;
                        }
                        if (Date.now() >= deadline) throw new Error("Agent nie zwrócił wyniku w wymaganym czasie.");
                        status.textContent = "Oczekiwanie na SIRK Agenta…";
                        setTimeout(poll, 1500);
                    });
                }).catch(reject);
            }
            poll();
        });
    }

    function runAgentOperation(node, type, parameters, status) {
        status.textContent = "Wysyłanie do SIRK Agenta…";
        status.classList.remove("is-error");
        return agentOperation(node, type, parameters).then(function (command) {
            return waitForAgentOperation(node, command.commandId, status);
        });
    }

    function renderAgentTerminal(host, node) {
        host.innerHTML = '<div class="sirk-agent-operation"><header><strong>Terminal SIRK Agent</strong><small>PowerShell uruchamiany przez usługę na urządzeniu</small></header><textarea data-agent-terminal-command spellcheck="false" placeholder="Get-ComputerInfo | Select-Object WindowsProductName, OsVersion"></textarea><div class="sirk-agent-operation-actions"><button type="button" data-agent-terminal-run>Uruchom</button></div><pre data-agent-operation-status>Gotowy.</pre></div>';
        var command = host.querySelector("[data-agent-terminal-command]");
        var button = host.querySelector("[data-agent-terminal-run]");
        var status = host.querySelector("[data-agent-operation-status]");
        button.addEventListener("click", function () {
            if (!command.value.trim()) return;
            button.disabled = true;
            runAgentOperation(node, "terminal.execute", { command: command.value, timeoutSeconds: 30 }, status)
                .then(function (value) {
                    status.textContent = value.result && value.result.output || value.result && value.result.code || "Brak wyniku.";
                    status.classList.toggle("is-error", value.status === "failed");
                }).catch(function (error) {
                    status.textContent = error.message || String(error);
                    status.classList.add("is-error");
                }).then(function () { button.disabled = false; });
        });
    }

    function renderAgentFiles(host, node) {
        host.innerHTML = '<div class="sirk-agent-operation"><header><strong>Pliki SIRK Agent</strong><small>Lista jest ograniczona do 1000 pozycji</small></header><div class="sirk-agent-path"><input data-agent-files-path value="C:\\\\" spellcheck="false"><button type="button" data-agent-files-list>Otwórz</button></div><pre data-agent-operation-status>Gotowy.</pre><div class="sirk-agent-file-list" data-agent-file-list></div></div>';
        var input = host.querySelector("[data-agent-files-path]");
        var button = host.querySelector("[data-agent-files-list]");
        var status = host.querySelector("[data-agent-operation-status]");
        var list = host.querySelector("[data-agent-file-list]");
        function open(path) {
            button.disabled = true;
            runAgentOperation(node, "files.list", { path: path }, status).then(function (value) {
                var entries = value.result && value.result.data || [];
                status.textContent = value.status === "failed" ? (value.result.output || value.result.code) : entries.length + " pozycji";
                status.classList.toggle("is-error", value.status === "failed");
                list.innerHTML = entries.map(function (entry) {
                    return '<button type="button" data-agent-file-path="' + esc(entry.path) + '" data-agent-directory="' + (entry.isDirectory ? "1" : "0") + '"><span>' + (entry.isDirectory ? "📁" : "📄") + '</span><strong>' + esc(entry.name) + '</strong><small>' + (entry.isDirectory ? "" : esc(String(entry.length) + " B")) + '</small></button>';
                }).join("");
            }).catch(function (error) {
                status.textContent = error.message || String(error);
                status.classList.add("is-error");
            }).then(function () { button.disabled = false; });
        }
        button.addEventListener("click", function () { open(input.value); });
        list.addEventListener("click", function (event) {
            var item = event.target.closest("[data-agent-file-path]");
            if (!item || item.getAttribute("data-agent-directory") !== "1") return;
            input.value = item.getAttribute("data-agent-file-path");
            open(input.value);
        });
    }

    function renderAgentDesktop(host) {
        host.innerHTML = '<div class="sirk-agent-operation sirk-agent-desktop-pending"><header><strong>Pulpit SIRK Agent</strong></header><p>Usługa SIRK Agent działa w izolowanej sesji systemowej. Bezpieczny broker aktywnej sesji użytkownika jest wymagany do obrazu i sterowania pulpitem.</p><pre>INTERACTIVE_HELPER_REQUIRED</pre></div>';
    }

    function renderAgentTab(host, node, type) {
        stopBridge(true);
        if (type === "terminal") renderAgentTerminal(host, node);
        else if (type === "files") renderAgentFiles(host, node);
        else renderAgentDesktop(host, node);
    }

    function renderGeneral(host, node) {
        stopBridge(true);
        var online = nodeOnline(node);
        host.innerHTML = '<div class="sirk-device-general"><div class="sirk-device-detail-grid">' +
            detailItem(t("name"), node.name) + detailItem(t("status"), online ? t("online") : t("offline")) +
            detailItem(t("group"), nodeGroup(node)) + detailItem(t("system"), node.os || t("noOs")) +
            detailItem(t("ip"), node.ip || "—") + detailItem(t("lastSeen"), formatLastSeen(node.lastSeen)) +
            detailItem(t("agent"), node.agentVersion || "—") + detailItem(t("nodeId"), node.id || node._id) +
            '</div><div class="sirk-device-general-actions"><a href="' + esc(nativeDeviceUrl(node)) + '">' + esc(t("openMesh")) + '</a></div></div>';
    }

    function renderCommandsTab(host, node) {
        stopBridge(true);
        var module = commandModule();
        if (!module || typeof module.mount !== "function") {
            host.innerHTML = '<div class="sirk-device-command-error">' + esc(t("noCommands")) + '</div>';
            return;
        }
        host.innerHTML = '<div class="sirk-device-commands-host"></div>';
        var moduleHost = host.firstElementChild;
        if (typeof module.mountDeviceCommands === "function") module.mountDeviceCommands(moduleHost, String(node.id || node._id || ""));
        else {
            if (typeof module.onDeviceRefreshEnd === "function") module.onDeviceRefreshEnd(String(node.id || node._id || ""));
            module.mount(moduleHost, "sirk-device-commands");
        }
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
                    return { kind: "command", commandId: command.id, label: command.label || command.id, description: command.description || "", requiresApproval: command.requiresApproval === true, confirmExecution: command.confirmExecution === true, variables: command.variables || [] };
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

    function submitCompactCommand(item, values, button, status) {
        if (item.confirmExecution === true && !window.confirm(t("confirmCommand") + ' "' + item.label + '"?')) return;
        button.disabled = true;
        status.textContent = t("loadingCommands");
        var payload = { nodeId: String(selectedNode && (selectedNode.id || selectedNode._id) || ""), nodeName: selectedNode && selectedNode.name || "", variableValues: values || {}, confirmedExecution: item.confirmExecution === true, note: "" };
        if (item.kind === "command") payload.commandId = item.commandId;
        else payload.scriptPath = item.path;
        core.post("mycommands", "execute", payload).then(function (response) {
            status.textContent = response.request && response.request.status === "pending" ? t("commandPending") : t("commandSent");
            status.classList.remove("is-error");
        }).catch(function (error) {
            status.textContent = t("commandFailed") + " " + (error.message || String(error));
            status.classList.add("is-error");
        }).then(function () { button.disabled = false; });
    }

    function renderCompactCommands() {
        var panel = document.getElementById("sirkQuickCommandsPanel");
        if (!panel || !quickCommands.data) return;
        var categories = compactCategories(quickCommands.data);
        if (!categories.some(function (category) { return category.key === quickCommands.category; })) quickCommands.category = categories[0] && categories[0].key || "";
        var selectedCategory = categories.find(function (category) { return category.key === quickCommands.category; });
        var query = String(quickCommands.search || "").toLowerCase();
        var items = (selectedCategory && selectedCategory.items || []).filter(function (item) { return !query || (item.label + " " + item.description).toLowerCase().indexOf(query) >= 0; });
        panel.innerHTML = '<header><strong>' + esc(t("quickCommands")) + '</strong><button type="button" data-quick-command-close="1" title="' + esc(t("close")) + '">×</button></header><input class="sirk-quick-command-search" type="search" placeholder="' + esc(t("searchCommands")) + '" value="' + esc(quickCommands.search) + '"><div class="sirk-quick-command-browser"><nav>' + categories.map(function (category) { return '<button type="button" data-quick-command-category="' + esc(category.key) + '" class="' + (category.key === quickCommands.category ?"is-active" : "") + '">' + esc(category.label) + '</button>'; }).join("") + '</nav><section>' + (items.length ? items.map(function (item, index) { return '<button type="button" data-quick-command-item="' + index + '"><strong>' + esc(item.label) + '</strong>' + (item.description ? '<small>' + esc(item.description) + '</small>' : '') + '</button>'; }).join("") : '<p>' + esc(t("noCommands")) + '</p>') + '</section></div><div class="sirk-quick-command-run"></div><div class="sirk-quick-command-status" aria-live="polite"></div>';
        panel.__items = items;
    }

    function selectCompactCommand(item) {
        var runHost = document.querySelector("#sirkQuickCommandsPanel .sirk-quick-command-run");
        var status = document.querySelector("#sirkQuickCommandsPanel .sirk-quick-command-status");
        if (!runHost || !status) return;
        function show(value) {
            runHost.innerHTML = "";
            var heading = document.createElement("h3"); heading.textContent = value.label; runHost.appendChild(heading);
            if (value.description) { var description = document.createElement("p"); description.textContent = value.description; runHost.appendChild(description); }
            var collect = compactVariableForm(runHost, value);
            var run = document.createElement("button"); run.type = "button"; run.className = "sirk-quick-command-submit"; run.textContent = value.requiresApproval ? t("requestCommand") : t("runCommand");
            run.addEventListener("click", function () { submitCompactCommand(value, collect(), run, status); });
            runHost.appendChild(run);
        }
        if (item.kind !== "script") { show(item); return; }
        core.api("mycommands", "script", null, { path: item.path }).then(function (response) {
            var script = response.script || item;
            show({ kind: "script", path: script.path, label: localized(script, "label") || script.label || script.name, description: localized(script, "description") || script.description || "", variables: script.variables || [], requiresApproval: script.requiresApproval === true, confirmExecution: script.confirmExecution === true });
        }).catch(function (error) { status.textContent = error.message || String(error); status.classList.add("is-error"); });
    }

    function renderTab(node, type) {
        activeTab = VIEWMODES[type] || type === "commands" ? type : "general";
        var body = document.getElementById("sirkDeviceTabBody");
        if (!body) return;
        Array.prototype.forEach.call(document.querySelectorAll("[data-device-tab]"), function (button) {
            var active = button.getAttribute("data-device-tab") === activeTab;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
        });
        if (activeTab === "general") renderGeneral(body, node);
        else if (activeTab === "commands") renderCommandsTab(body, node);
        else if (node.source === "sirk-agent" && (activeTab === "desktop" || activeTab === "terminal" || activeTab === "files"))
            renderAgentTab(body, node, activeTab);
        else renderNativeTab(body, node, activeTab);
    }

    function renderWorkspace(node) {
        if (!content || !node) return;
        selectedNode = node;
        var online = nodeOnline(node);
        content.innerHTML = '<div class="sirk-device-workspace"><header class="sirk-device-compact-header"><button type="button" class="sirk-device-compact-back" data-device-back="1" title="' + esc(t("back")) + '">‹</button><span class="sirk-device-compact-icon" aria-hidden="true">' + DEVICE_ICON + '</span><div class="sirk-device-compact-main"><strong>' + esc(node.name || shortId(node.id)) + '</strong><small>' + esc(nodeGroup(node)) + ' · ' + esc(node.os || t("noOs")) + '</small></div><div class="sirk-device-compact-meta"><span class="sirk-device-connection ' + (online ?"is-online" : "is-offline") + '"><i></i>' + esc(online ? t("online") : t("offline")) + '</span><small>' + esc(node.ip || "—") + '</small></div></header><nav class="sirk-device-tabs" role="tablist">' +
            ["general", "desktop", "terminal", "commands", "files", "registry", "software", "amt"].map(function (type) {
                return '<button type="button" role="tab" data-device-tab="' + type + '">' + esc(t(type)) + '</button>';
            }).join("") + '</nav><section id="sirkDeviceTabBody" class="sirk-device-tab-body"></section></div>';
        renderTab(node, activeTab);
    }

    function extractNodeId() {
        if (selectedNodeId) return selectedNodeId;
        var link = content && content.querySelector(".sirk-device-native-button[href]");
        if (link) {
            try { return new URL(link.href, window.location.href).searchParams.get("gotonode") || ""; }
            catch (error) {}
        }
        return "";
    }

    function transformDetail() {
        transformScheduled = false;
        if (!content || content.querySelector(".sirk-device-workspace")) return;
        if (!content.querySelector(".sirk-device-native-card")) return;
        var nodeId = extractNodeId();
        if (!nodeId) return;
        getInventory().then(function (value) {
            var node = findNode(value, nodeId);
            if (!node || !content.querySelector(".sirk-device-native-card")) return;
            selectedNodeId = String(node.id || node._id || nodeId);
            renderWorkspace(node);
        }).catch(function () {});
    }

    function scheduleTransform() {
        if (transformScheduled) return;
        transformScheduled = true;
        setTimeout(transformDetail, 0);
    }

    document.addEventListener("click", function (event) {
        var row = event.target && event.target.closest && event.target.closest("[data-device-id]");
        if (row) {
            selectedNodeId = row.getAttribute("data-device-id") || "";
            selectedNode = null;
            activeTab = "general";
            stopBridge(true);
            scheduleTransform();
            return;
        }
        var tab = event.target && event.target.closest && event.target.closest("[data-device-tab]");
        if (tab && content && content.contains(tab)) {
            event.preventDefault();
            event.stopPropagation();
            renderTab(selectedNode, tab.getAttribute("data-device-tab"));
            return;
        }
        var back = event.target && event.target.closest && event.target.closest("[data-device-back]");
        if (back) {
            selectedNodeId = "";
            selectedNode = null;
            activeTab = "general";
            stopBridge(true);
            return;
        }
        var navigation = event.target && event.target.closest && event.target.closest(".sirk-standalone-nav [data-view]");
        if (navigation) {
            selectedNodeId = "";
            selectedNode = null;
            activeTab = "general";
            stopBridge(true);
        }
        var quickClose = event.target && event.target.closest && event.target.closest("[data-quick-command-close]");
        if (quickClose) {
            var quickPanel = document.getElementById("sirkQuickCommandsPanel");
            var quickToggle = document.getElementById("sirkQuickCommandsToggle");
            if (quickPanel) quickPanel.hidden = true;
            if (quickToggle) quickToggle.setAttribute("aria-expanded", "false");
            return;
        }
        var quickCategory = event.target && event.target.closest && event.target.closest("[data-quick-command-category]");
        if (quickCategory) {
            quickCommands.category = quickCategory.getAttribute("data-quick-command-category") || "";
            renderCompactCommands();
            return;
        }
        var quickItem = event.target && event.target.closest && event.target.closest("[data-quick-command-item]");
        if (quickItem) {
            var panel = document.getElementById("sirkQuickCommandsPanel");
            var index = Number(quickItem.getAttribute("data-quick-command-item"));
            if (panel && panel.__items && panel.__items[index]) selectCompactCommand(panel.__items[index]);
        }
    }, true);

    document.addEventListener("input", function (event) {
        if (!event.target || !event.target.classList.contains("sirk-quick-command-search")) return;
        quickCommands.search = event.target.value || "";
        renderCompactCommands();
        var search = document.querySelector("#sirkQuickCommandsPanel .sirk-quick-command-search");
        if (search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    }, true);

    window.addEventListener("sirkportal:languagechange", function () {
        if (selectedNode && content && content.querySelector(".sirk-device-workspace")) renderWorkspace(selectedNode);
    });

    window.addEventListener("beforeunload", function () { stopBridge(true); });

    if (content) {
        new MutationObserver(scheduleTransform).observe(content, { childList: true, subtree: true });
        scheduleTransform();
    }
}());
