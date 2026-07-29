"use strict";

var fs = require("fs");
var http = require("http");
var https = require("https");
var standalone = require("./standalone.js");

function proxyRequest(targetPort, req, res, activeRequests) {
    var upstream = http.request({
        hostname: "127.0.0.1",
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: Object.assign({}, req.headers, {
            "x-forwarded-proto": "https",
            "x-forwarded-host": req.headers.host || ""
        })
    }, function (response) {
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
    });
    activeRequests.add(upstream);
    upstream.once("close", function () { activeRequests.delete(upstream); });
    upstream.on("error", function (error) {
        if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        res.end(JSON.stringify({ ok: false, error: "Standalone Portal upstream unavailable.", detail: error.message }));
    });
    req.pipe(upstream);
}

async function start(options) {
    options = options || {};
    var internalPort = Number(options.internalPort || process.env.SIRK_INTERNAL_PORT || 9080);
    var httpsPort = Number(options.httpsPort || process.env.SIRK_HTTPS_PORT || 9443);
    var certificatePath = options.certificatePath || process.env.SIRK_TLS_CERT;
    var privateKeyPath = options.privateKeyPath || process.env.SIRK_TLS_KEY;
    var pfxPath = options.pfxPath || process.env.SIRK_TLS_PFX;
    var pfxPasswordFile = options.pfxPasswordFile || process.env.SIRK_TLS_PFX_PASSWORD_FILE;
    var enrollmentTokenFile = options.enrollmentTokenFile || process.env.SIRK_ENROLLMENT_TOKEN_FILE;
    if (!pfxPath && (!certificatePath || !privateKeyPath))
        throw new Error("SIRK_TLS_PFX or SIRK_TLS_CERT with SIRK_TLS_KEY is required.");
    var application = await standalone.start({
        host: "127.0.0.1",
        port: internalPort,
        agentToken: options.agentToken,
        agentEnrollmentToken: options.agentEnrollmentToken ||
            (enrollmentTokenFile ? fs.readFileSync(enrollmentTokenFile, "utf8").trim() : undefined)
    });
    var tlsOptions = pfxPath ? {
        pfx: fs.readFileSync(pfxPath),
        passphrase: pfxPasswordFile ? fs.readFileSync(pfxPasswordFile, "utf8").trim() : undefined
    } : {
        cert: fs.readFileSync(certificatePath),
        key: fs.readFileSync(privateKeyPath)
    };
    tlsOptions.minVersion = "TLSv1.2";
    var activeRequests = new Set();
    var gateway = https.createServer(tlsOptions, function (req, res) {
        proxyRequest(internalPort, req, res, activeRequests);
    });
    await new Promise(function (resolve, reject) {
        gateway.once("error", reject);
        gateway.listen(httpsPort, "0.0.0.0", resolve);
    });
    function close() {
        gateway.close();
        application.close();
        activeRequests.forEach(function (request) { request.destroy(); });
        if (typeof gateway.closeAllConnections === "function") gateway.closeAllConnections();
        if (typeof application.closeAllConnections === "function") application.closeAllConnections();
        setTimeout(function () { process.exit(0); }, 1000);
    }
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
    return { application: application, gateway: gateway };
}

if (require.main === module) {
    start().then(function (servers) {
        console.log("SIRK Portal standalone HTTPS listening on", servers.gateway.address());
    }).catch(function (error) {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { start: start };
