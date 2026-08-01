"use strict";

var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var https = require("https");
var net = require("net");
var path = require("path");
var standalone = require("./standalone.js");

var ROOT = path.resolve(__dirname, "..");

function sha256(value) {
    return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
function equalHex(left, right) {
    if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
    return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
function cookie(req, name) {
    var match = String(req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[1]) : "";
}
function breakGlassAllowed(req, accessHash) {
    return Boolean(accessHash) && equalHex(cookie(req, "sirk_breakglass"), accessHash);
}
function microsoftPage() {
    return fs.readFileSync(path.join(ROOT, "public/portal/standalone/microsoft-login.html"), "utf8");
}
function proxyRequest(targetPort, req, res, activeRequests) {
    var upstream = http.request({ hostname: "127.0.0.1", port: targetPort, method: req.method, path: req.url,
        headers: Object.assign({}, req.headers, { "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host || "",
            "x-forwarded-for": req.socket && req.socket.remoteAddress || "" }) }, function (response) {
        res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
    });
    activeRequests.add(upstream);
    upstream.once("close", function () { activeRequests.delete(upstream); });
    upstream.on("error", function (error) {
        if (!res.headersSent) { res.statusCode = 502; res.setHeader("Content-Type", "application/json; charset=utf-8"); }
        res.end(JSON.stringify({ ok: false, error: "Standalone Portal upstream unavailable.", detail: error.message }));
    });
    req.pipe(upstream);
}

async function start(options) {
    options = options || {};
    var internalPort = Number(options.internalPort || process.env.SIRK_INTERNAL_PORT || 9080);
    var httpsPort = Number(options.httpsPort || process.env.SIRK_HTTPS_PORT || 443);
    var certificatePath = options.certificatePath || process.env.SIRK_TLS_CERT;
    var privateKeyPath = options.privateKeyPath || process.env.SIRK_TLS_KEY;
    var pfxPath = options.pfxPath || process.env.SIRK_TLS_PFX;
    var pfxPasswordFile = options.pfxPasswordFile || process.env.SIRK_TLS_PFX_PASSWORD_FILE;
    var enrollmentTokenFile = options.enrollmentTokenFile || process.env.SIRK_ENROLLMENT_TOKEN_FILE;
    var accessHash = String(options.accessHash || process.env.SIRK_ACCESS_KEY_HASH || "").toLowerCase();
    var microsoftLoginUrl = String(options.microsoftLoginUrl || process.env.SIRK_MICROSOFT_LOGIN_URL || "").trim();
    if (!pfxPath && (!certificatePath || !privateKeyPath)) throw new Error("SIRK_TLS_PFX or certificate/key is required.");
    if (accessHash && !/^[a-f0-9]{64}$/.test(accessHash)) throw new Error("Invalid SIRK_ACCESS_KEY_HASH.");

    var application = await standalone.start({ host: "127.0.0.1", port: internalPort, agentToken: options.agentToken,
        agentEnrollmentToken: options.agentEnrollmentToken || (enrollmentTokenFile ? fs.readFileSync(enrollmentTokenFile, "utf8").trim() : undefined) });
    var tlsOptions = pfxPath ? { pfx: fs.readFileSync(pfxPath),
        passphrase: pfxPasswordFile ? fs.readFileSync(pfxPasswordFile, "utf8").trim() : undefined } :
        { cert: fs.readFileSync(certificatePath), key: fs.readFileSync(privateKeyPath) };
    tlsOptions.minVersion = "TLSv1.2";
    var activeRequests = new Set(), activeSockets = new Set();
    var gateway = https.createServer(tlsOptions, function (req, res) {
        var url;
        try { url = new URL(req.url, "https://sirk.local"); } catch (error) { res.statusCode = 400; res.end("Bad request"); return; }
        if (!accessHash) { proxyRequest(internalPort, req, res, activeRequests); return; }
        if (req.method === "GET" && url.pathname === "/login" && url.searchParams.has("access")) {
            if (!equalHex(sha256(url.searchParams.get("access")), accessHash)) { res.statusCode = 404; res.end("Not found"); return; }
            res.statusCode = 302; res.setHeader("Cache-Control", "no-store");
            res.setHeader("Set-Cookie", "sirk_breakglass=" + accessHash + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800");
            res.setHeader("Location", "/login?breakglass=1"); res.end(); return;
        }
        if (req.method === "GET" && url.pathname === "/login" && !breakGlassAllowed(req, accessHash)) {
            res.statusCode = 200; res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
            res.end(microsoftPage()); return;
        }
        if (url.pathname === "/auth/microsoft") {
            if (!microsoftLoginUrl) { res.statusCode = 503; res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: "Microsoft Entra login is not configured." })); return; }
            res.statusCode = 302; res.setHeader("Location", microsoftLoginUrl); res.end(); return;
        }
        if (url.pathname === "/api/auth/login" && !breakGlassAllowed(req, accessHash)) { res.statusCode = 404; res.end("Not found"); return; }
        proxyRequest(internalPort, req, res, activeRequests);
    });
    gateway.on("connection", function (socket) { activeSockets.add(socket); socket.once("close", function () { activeSockets.delete(socket); }); });
    gateway.on("upgrade", function (req, socket, head) {
        var upstream = net.connect(internalPort, "127.0.0.1", function () {
            var headers = Object.assign({}, req.headers, { "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host || "",
                "x-forwarded-for": req.socket && req.socket.remoteAddress || "" });
            var lines = [req.method + " " + req.url + " HTTP/1.1"];
            Object.keys(headers).forEach(function (name) { lines.push(name + ": " + headers[name]); });
            upstream.write(lines.join("\r\n") + "\r\n\r\n"); if (head && head.length) upstream.write(head); socket.pipe(upstream).pipe(socket);
        });
        activeSockets.add(upstream); upstream.once("close", function () { activeSockets.delete(upstream); }); upstream.on("error", function () { socket.destroy(); });
    });
    await new Promise(function (resolve, reject) { gateway.once("error", reject); gateway.listen(httpsPort, "0.0.0.0", resolve); });
    function close() { gateway.close(); application.close(); activeRequests.forEach(function (r) { r.destroy(); });
        activeSockets.forEach(function (s) { s.destroy(); }); if (typeof gateway.closeAllConnections === "function") gateway.closeAllConnections();
        if (typeof application.closeAllConnections === "function") application.closeAllConnections(); setTimeout(function () { process.exit(0); }, 1000); }
    process.once("SIGTERM", close); process.once("SIGINT", close);
    return { application: application, gateway: gateway };
}
if (require.main === module) start().then(function (servers) { console.log("SIRK Portal standalone HTTPS listening on", servers.gateway.address()); })
    .catch(function (error) { console.error(error); process.exitCode = 1; });
module.exports = { start: start, sha256: sha256 };
