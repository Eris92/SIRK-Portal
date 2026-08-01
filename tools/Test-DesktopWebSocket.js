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
    var frames = 0, cursorUpdates = 0, bytes = 0, backends = new Set(), started = 0, firstSequence = 0, lastSequence = 0;
    var inputSentAt = 0, inputAckMilliseconds = 0;
    var cursorTimer = null, cursorStep = 0;
    var captureSamples = [], encodeSamples = [], sessionSamples = [], ageSamples = [];
    socket.on("message", function (packet, binary) {
        if (!binary) {
            var message = JSON.parse(packet.toString("utf8"));
            if (message.type === "inputAck" && message.id === 1)
                inputAckMilliseconds = Date.now() - inputSentAt;
            return;
        }
        var metadataLength = packet.readUInt32BE(0);
        var metadata = JSON.parse(packet.subarray(4, 4 + metadataLength).toString("utf8"));
        if (metadata.cursorOnly === true) cursorUpdates += 1; else frames += 1;
        if (!firstSequence) firstSequence = Number(metadata.sequence) || 0;
        lastSequence = Number(metadata.sequence) || 0;
        bytes += packet.length - 4 - metadataLength;
        backends.add(metadata.captureBackend);
        captureSamples.push(Number(metadata.captureMilliseconds || 0));
        encodeSamples.push(Number(metadata.encodeMilliseconds || 0));
        sessionSamples.push(Number(metadata.sessionMilliseconds || 0));
        if (metadata.capturedAtUnixMilliseconds)
            ageSamples.push(Math.max(0, Date.now() - Number(metadata.capturedAtUnixMilliseconds)));
    });
    await new Promise(function (resolve, reject) {
        socket.once("error", reject);
        socket.once("open", function () {
            started = Date.now(); inputSentAt = Date.now();
            socket.send(JSON.stringify({ type: "input", id: 1,
                input: { action: "requestKeyframe", sessionId: 2, monitorIndex: 0 } }));
            if (process.env.SIRK_TEST_CURSOR_MOTION === "1") cursorTimer = setInterval(function () {
                cursorStep += 1;
                socket.send(JSON.stringify({ type: "input", id: 0, input: {
                    action: "move", sessionId: 2, monitorIndex: 0,
                    x: 200 + (cursorStep * 17) % 800, y: 200 + (cursorStep * 11) % 400
                } }));
            }, 16);
            setTimeout(resolve, duration * 1000);
        });
    });
    var elapsed = (Date.now() - started) / 1000;
    if (cursorTimer) clearInterval(cursorTimer);
    socket.close();
    function percentile(values, fraction) {
        if (!values.length) return 0;
        values.sort(function (a, b) { return a - b; });
        return values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
    }
    process.stdout.write(JSON.stringify({ frames: frames, cursorUpdates: cursorUpdates, fps: frames / elapsed,
        mbps: bytes * 8 / elapsed / 1000000, firstSequence: firstSequence,
        lastSequence: lastSequence, inputAckMilliseconds: inputAckMilliseconds,
        captureP50Ms: percentile(captureSamples, 0.5), captureP95Ms: percentile(captureSamples, 0.95),
        encodeP50Ms: percentile(encodeSamples, 0.5), encodeP95Ms: percentile(encodeSamples, 0.95),
        sessionP50Ms: percentile(sessionSamples, 0.5), sessionP95Ms: percentile(sessionSamples, 0.95),
        frameAgeP50Ms: percentile(ageSamples, 0.5), frameAgeP95Ms: percentile(ageSamples, 0.95),
        backends: Array.from(backends) }, null, 2) + "\n");
}

main().catch(function (error) { console.error(error); process.exitCode = 1; });
