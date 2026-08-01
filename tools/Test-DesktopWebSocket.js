"use strict";

var WebSocket = require("ws");

async function main() {
    var base = process.argv[2] || "http://127.0.0.1:9080";
    var duration = Math.max(5, Math.min(120, Number(process.argv[3]) || 15));
    var tenantId = process.argv[4] || "investa";
    var deviceId = process.argv[5];
    if (!deviceId) throw new Error("Usage: node tools/Test-DesktopWebSocket.js <portal> <seconds> <tenant> <device>");
    var username = process.env.SIRK_TEST_PORTAL_USER;
    var password = process.env.SIRK_TEST_PORTAL_PASSWORD;
    if (!username || !password) throw new Error("Set SIRK_TEST_PORTAL_USER and SIRK_TEST_PORTAL_PASSWORD.");
    var response = await fetch(base + "/api/auth/login", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: username, password: password }).toString()
    });
    if (!response.ok) throw new Error("Login failed: " + response.status);
    var cookie = response.headers.getSetCookie()[0].split(";")[0];
    response = await fetch(base + "/api/bootstrap", { headers: { cookie: cookie } });
    var bootstrap = await response.json();
    await fetch(base + "/api/agent-desktop/input", {
        method: "POST", headers: {
            cookie: cookie, "content-type": "application/json", "x-sirk-csrf": bootstrap.csrfToken
        }, body: JSON.stringify({ tenantId: tenantId, deviceId: deviceId, input: {
            action: "streamProfile", sessionId: 2, monitorIndex: 0,
            maxWidth: 1280, quality: 72, targetKbps: 1000
        } })
    });
    var wsBase = base.replace(/^http/, "ws");
    var socket = new WebSocket(wsBase + "/api/agent-desktop/stream?tenantId=" +
        encodeURIComponent(tenantId) + "&deviceId=" + encodeURIComponent(deviceId), {
        headers: { cookie: cookie }, rejectUnauthorized: false, perMessageDeflate: false
    });
    var frames = 0, bytes = 0, backends = new Set(), started = Date.now();
    socket.on("message", function (packet) {
        var metadataLength = packet.readUInt32BE(0);
        var metadata = JSON.parse(packet.subarray(4, 4 + metadataLength).toString("utf8"));
        frames += 1;
        bytes += packet.length - 4 - metadataLength;
        backends.add(metadata.captureBackend);
    });
    await new Promise(function (resolve, reject) {
        socket.once("error", reject);
        socket.once("open", function () { setTimeout(resolve, duration * 1000); });
    });
    var elapsed = (Date.now() - started) / 1000;
    socket.close();
    process.stdout.write(JSON.stringify({ frames: frames, fps: frames / elapsed,
        mbps: bytes * 8 / elapsed / 1000000, backends: Array.from(backends) }, null, 2) + "\n");
}

main().catch(function (error) { console.error(error); process.exitCode = 1; });
