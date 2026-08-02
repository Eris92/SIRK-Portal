"use strict";

var crypto = require("crypto");
var fs = require("fs");
var http = require("http");
var https = require("https");
var path = require("path");
var connectionConfigFactory = require("./central-connection-config.js");

function atomicWrite(filePath, value, mode) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    var temporary = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(6).toString("hex");
    fs.writeFileSync(temporary, value, { encoding: "utf8", mode: mode || 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
    try { fs.chmodSync(filePath, mode || 0o600); } catch (_) {}
}

function normalizeCentralUrl(value) {
    var parsed = new URL(String(value || "").trim().replace(/\/+$/, ""));
    var loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
    if ((parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) ||
        parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw new Error("Central URL must be an HTTPS origin.");
    }
    return parsed.origin;
}

function requestJson(method, target, authorization, body, options) {
    options = options || {};
    var url = new URL(target);
    var raw = body == null ? "" : JSON.stringify(body);
    var transport = url.protocol === "https:" ? https : http;
    return new Promise(function (resolve, reject) {
        var request = transport.request(url, {
            method: method,
            timeout: Number(options.timeoutMilliseconds || 15000),
            rejectUnauthorized: options.rejectUnauthorized !== false,
            headers: Object.assign({
                "Accept": "application/json",
                "User-Agent": "SIRK-Portal-Enrollment/1"
            }, authorization ? { "Authorization": "Bearer " + authorization } : {}, raw ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(raw)
            } : {})
        }, function (response) {
            var chunks = [];
            var size = 0;
            response.on("data", function (chunk) {
                size += chunk.length;
                if (size > 1024 * 1024) {
                    request.destroy(new Error("Central response is too large."));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", function () {
                var parsed;
                try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
                catch (_) { return reject(new Error("Central returned invalid JSON.")); }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    var error = new Error(parsed.error || "Central request failed with HTTP " + response.statusCode + ".");
                    error.statusCode = response.statusCode;
                    error.code = parsed.code || "CENTRAL_REQUEST_REJECTED";
                    return reject(error);
                }
                resolve(parsed);
            });
        });
        request.on("timeout", function () { request.destroy(new Error("Central request timed out.")); });
        request.on("error", reject);
        request.end(raw);
    });
}

function create(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot || process.env.SIRK_DATA_ROOT || "C:\\ProgramData\\SIRK\\Portal");
    var enrollmentRoot = path.join(dataRoot, "central-enrollment");
    var privateKeyPath = path.join(enrollmentRoot, "private-key.pem");
    var publicKeyPath = path.join(enrollmentRoot, "public-key.pem");
    var statePath = path.join(enrollmentRoot, "state.json");
    var connectionStore = connectionConfigFactory.create({ dataRoot: dataRoot });

    function ensureKeyPair() {
        if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
            return {
                privateKeyPem: fs.readFileSync(privateKeyPath, "utf8"),
                publicKeyPem: fs.readFileSync(publicKeyPath, "utf8")
            };
        }
        var keys = crypto.generateKeyPairSync("rsa", {
            modulusLength: 3072,
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" }
        });
        atomicWrite(privateKeyPath, keys.privateKey, 0o600);
        atomicWrite(publicKeyPath, keys.publicKey, 0o600);
        return { privateKeyPem: keys.privateKey, publicKeyPem: keys.publicKey };
    }

    function readState() {
        try { return JSON.parse(fs.readFileSync(statePath, "utf8").replace(/^\uFEFF/, "")); }
        catch (error) {
            if (error && error.code === "ENOENT") return null;
            throw error;
        }
    }

    function writeState(value) {
        atomicWrite(statePath, JSON.stringify(value, null, 2) + "\n", 0o600);
        return value;
    }

    function begin(input) {
        input = input || {};
        var centralUrl = normalizeCentralUrl(input.centralUrl);
        var enrollmentToken = String(input.enrollmentToken || "").trim();
        if (!/^[A-Za-z0-9_-]{20,256}$/.test(enrollmentToken)) throw new Error("Enrollment token is invalid.");
        var portalId = String(input.portalId || "").trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(portalId)) throw new Error("Portal ID is invalid.");
        var portalName = String(input.portalName || "").trim();
        if (portalName.length < 2 || portalName.length > 100) throw new Error("Portal name is invalid.");
        var keys = ensureKeyPair();

        return requestJson("POST", centralUrl + "/api/portal-enrollment/requests", enrollmentToken, {
            portalId: portalId,
            portalName: portalName,
            publicUrl: String(input.publicUrl || "").trim(),
            version: String(input.version || "").trim(),
            platform: process.platform + "-" + process.arch,
            publicKeyPem: keys.publicKeyPem
        }, options).then(function (response) {
            if (!response || !response.enrollment || !response.enrollment.requestId || !response.enrollment.pollToken) {
                throw new Error("Central returned an incomplete enrollment response.");
            }
            var state = {
                schemaVersion: 1,
                centralUrl: centralUrl,
                requestId: response.enrollment.requestId,
                pollToken: response.enrollment.pollToken,
                portalId: portalId,
                portalName: portalName,
                publicUrl: String(input.publicUrl || "").trim(),
                status: response.enrollment.status || "pending",
                createdAtUtc: new Date().toISOString(),
                expiresAtUtc: response.enrollment.expiresAtUtc || null
            };
            writeState(state);
            return {
                requestId: state.requestId,
                portalId: state.portalId,
                portalName: state.portalName,
                status: state.status,
                expiresAtUtc: state.expiresAtUtc
            };
        });
    }

    function poll() {
        var state = readState();
        if (!state) return Promise.reject(new Error("Portal enrollment has not been started."));
        return requestJson("GET", state.centralUrl + "/api/portal-enrollment/requests/" + encodeURIComponent(state.requestId), state.pollToken, null, options)
            .then(function (response) {
                var enrollment = response && response.enrollment;
                if (!enrollment || !enrollment.status) throw new Error("Central returned an incomplete enrollment status.");
                state.status = enrollment.status;
                state.updatedAtUtc = new Date().toISOString();
                writeState(state);
                if (enrollment.status !== "approved") {
                    return { configured: false, status: enrollment.status, requestId: state.requestId };
                }
                if (!enrollment.encryptedBootstrap) throw new Error("Approved enrollment does not contain encrypted bootstrap data.");

                var privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
                var plaintext = crypto.privateDecrypt({
                    key: privateKeyPem,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                    oaepHash: "sha256"
                }, Buffer.from(enrollment.encryptedBootstrap, "base64"));
                var bundle = JSON.parse(plaintext.toString("utf8"));
                var saved = connectionStore.write({
                    centralUrl: bundle.centralUrl,
                    tunnelUrl: bundle.tunnelUrl,
                    portalId: bundle.portalId,
                    portalName: bundle.portalName,
                    portalToken: bundle.portalToken,
                    publicUrl: state.publicUrl
                });

                state.status = "configured";
                state.configuredAtUtc = new Date().toISOString();
                delete state.pollToken;
                writeState(state);
                try { fs.rmSync(privateKeyPath, { force: true }); } catch (_) {}
                return Object.assign({ status: "configured" }, saved);
            });
    }

    function status() {
        var state = readState();
        var connection = connectionStore.status();
        return {
            enrollment: state ? {
                requestId: state.requestId,
                portalId: state.portalId,
                portalName: state.portalName,
                status: state.status,
                createdAtUtc: state.createdAtUtc,
                updatedAtUtc: state.updatedAtUtc || null,
                expiresAtUtc: state.expiresAtUtc || null,
                configuredAtUtc: state.configuredAtUtc || null
            } : null,
            connection: connection
        };
    }

    return {
        begin: begin,
        poll: poll,
        status: status,
        ensureKeyPair: ensureKeyPair,
        statePath: statePath,
        privateKeyPath: privateKeyPath,
        publicKeyPath: publicKeyPath
    };
}

module.exports = { create: create, normalizeCentralUrl: normalizeCentralUrl, requestJson: requestJson };
