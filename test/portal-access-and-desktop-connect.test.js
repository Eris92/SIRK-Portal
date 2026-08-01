"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
var portal = read("public/portal/standalone/index.html");
var workspace = read("public/portal/standalone/scripts/device-workspace.js").replace(/\r\n/g, "\n");
var standalone = read("server/standalone.js").replace(/\r\n/g, "\n");
assert(portal.indexOf('select.value="3"') >= 0);
assert(portal.indexOf('select.value="2"') >= 0);
assert(portal.indexOf("Zapytaj o zgodę + Bar") >= 0);
assert(portal.indexOf("Zapytaj o zgodę") >= 0);
assert(portal.indexOf("Pasek Prywatności") >= 0);
assert(portal.indexOf("Number(amt.state)===2") >= 0);
assert(portal.indexOf("pendingConsent") >= 0);
assert(workspace.indexOf('"/api/agent-desktop/frame?tenantId="') >= 0);
assert(workspace.indexOf('response.arrayBuffer()') >= 0);
assert(workspace.indexOf('new VideoDecoder') >= 0);
assert(workspace.indexOf('new EncodedVideoChunk') >= 0);
assert(workspace.indexOf('X-SIRK-Sequence') >= 0);
assert(workspace.indexOf('desktop.snapshot') < 0);
assert(workspace.indexOf('fetch("/api/agent-desktop/input"') >= 0);
assert(workspace.indexOf('inputChannel.send(JSON.stringify({ type: "input"') >= 0);
assert(workspace.indexOf('message.type === "inputAck"') >= 0);
assert(workspace.indexOf('"/api/agent-desktop/input-stream?"') >= 0);
assert(workspace.indexOf("desktopInputSocket") >= 0);
assert(standalone.indexOf('url.pathname === "/api/agent-desktop/input-stream"') >= 0);
assert(standalone.indexOf("if (inputOnly) return;") >= 0);
assert(workspace.indexOf('event.key.length === 1') >= 0);
assert(workspace.indexOf('data.cursorOnly === true') >= 0);
assert(workspace.indexOf('point.x / sourceWidth') >= 0);
assert(workspace.indexOf('runAgentOperation(node, "desktop.sessions"') >= 0);
assert(workspace.indexOf('runAgentOperation(node, "desktop.monitors"') >= 0);
assert(workspace.indexOf('action: "clipboardGet"') >= 0);
assert(workspace.indexOf('action: "clipboardSet"') >= 0);
assert(workspace.indexOf('action: "clipboardFileSet"') >= 0);
assert(workspace.indexOf("navigator.clipboard.readText()") >= 0);
assert(workspace.indexOf("navigator.clipboard.writeText") >= 0);
assert(workspace.indexOf('image.addEventListener("drop"') >= 0);
assert(workspace.indexOf('key: "C", modifiers: "Control"') >= 0);
assert(workspace.indexOf('key: "V", modifiers: "Control"') >= 0);
assert(workspace.indexOf("function desktopData(value)") >= 0);
assert(workspace.indexOf("desktopData(value).text") >= 0);
assert(workspace.indexOf('action: "text"') >= 0);
assert(workspace.indexOf('action: "leftDown"') >= 0);
assert(workspace.indexOf('action: "leftUp"') >= 0);
assert(workspace.indexOf('action: "move"') >= 0);
assert(workspace.indexOf('action: "wheel"') >= 0);
assert(workspace.indexOf('action: "middleClick"') >= 0);
assert(workspace.indexOf('"desktop.admin.start"') >= 0);
assert(workspace.indexOf("data-agent-desktop-connect") >= 0);
assert(workspace.indexOf("data-agent-desktop-disconnect") >= 0);
assert(workspace.indexOf("PowerShell SYSTEM") >= 0);
assert(workspace.indexOf("streamGeneration") >= 0);
assert(workspace.indexOf("waitMilliseconds: 25000") >= 0);
assert(workspace.indexOf("setTimeout(poll, 0)") >= 0);
assert(workspace.indexOf('value="auto"') >= 0);
assert(workspace.indexOf('value="minimum"') >= 0);
assert(workspace.indexOf('minimum: { maxWidth: 1920, quality: 68, targetKbps: 550, targetFps: 15, frameMode: "tiles", deltaScalePercent: 50 }') >= 0,
    "minimum-transfer desktop profile must preserve readable resolution and save bandwidth with frame rate");
assert(workspace.indexOf('targetFps: settings.targetFps') >= 0,
    "desktop profile must send its target frame rate to the Agent");
assert(workspace.indexOf('deltaScalePercent: settings.deltaScalePercent') >= 0,
    "desktop profile must send its motion-delta scale to the Agent");
assert(workspace.indexOf('smooth: { maxWidth: 1920, quality: 72, targetKbps: 1000, targetFps: 120, frameMode: "tiles", deltaScalePercent: 25 }') >= 0,
    "smooth GUI profile must request 120 Hz dirty-region delivery within its bandwidth target");
assert(workspace.indexOf('value="video">Wideo H.264') >= 0,
    "full-motion content must keep an explicit H.264 profile instead of forcing full-frame video on GUI sessions");
assert(workspace.indexOf('function renderJpegFrame(') >= 0 &&
    workspace.indexOf('data.contentType === "image/jpeg"') >= 0,
    "binary desktop WebSocket must render dirty-region JPEG atlases without falling back to polling");
assert(workspace.indexOf("function effectiveProfile()") >= 0);
assert(workspace.indexOf('"&after=" + encodeURIComponent(snapshot.sequence || 0)') >= 0);
assert(workspace.indexOf('"&waitMilliseconds=25000"') >= 0);
assert(workspace.indexOf("data-agent-desktop-stats") >= 0);
assert(workspace.indexOf("data-stat-latency") >= 0);
assert(workspace.indexOf("data-stat-delta") >= 0);
assert(workspace.indexOf('"bez zmian · 0 B"') >= 0,
    "desktop statistics must decay to zero traffic when DXGI reports no changes");
assert((workspace.match(/value="event-viewer"/g) || []).length === 1);
assert((workspace.match(/value="device-manager"/g) || []).length === 1);
assert(workspace.indexOf("setTimeout(function () { snapshot(generation); }, 0)") >= 0);
assert(workspace.indexOf('return fetch(endpoint, {\n            method: "POST",') >= 0);
console.log("Portal allowAll save and Desktop connection controls: OK");
