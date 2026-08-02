"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

function cleanText(value, maximum) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maximum);
}

function normalize(input) {
    input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    var centralUrl = cleanText(input.centralUrl, 500).replace(/\/+$/, "");
    var tunnelUrl = cleanText(input.tunnelUrl, 500);
    var portalId = cleanText(input.portalId, 63).toLowerCase();
    var portalName = cleanText(input.portalName || portalId, 100);
    var portalToken = cleanText(input.portalToken, 512);
    var publicUrl = cleanText(input.publicUrl, 500).replace(/\/+$/, "");
    var central;
    var tunnel;
    try { central = new URL(centralUrl); } catch (_) { throw new Error("Central URL is invalid."); }
    if (central.protocol !== "https:" || central.username || central.password || central.pathname !== "/" || central.search || central.hash)
        throw new Error("Central URL must be an HTTPS origin without credentials, path, query or fragment.");
    if (!tunnelUrl) tunnelUrl = centralUrl.replace(/^https:/i, "wss:") + "/tunnel";
    try { tunnel = new URL(tunnelUrl); } catch (_) { throw new Error("Central tunnel URL is invalid."); }
    if (tunnel.protocol !== "wss:" || tunnel.username || tunnel.password || tunnel.origin.replace(/^wss:/, "https:") !== central.origin || tunnel.pathname !== "/tunnel" || tunnel.search || tunnel.hash)
        throw new Error("Central tunnel URL must use wss:// on the Central origin and path /tunnel.");
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(portalId)) throw new Error("Portal ID is invalid.");
    if (portalName.length < 2) throw new Error("Portal name is required.");
    if (!/^[A-Za-z0-9_-]{32,512}$/.test(portalToken)) throw new Error("Portal token is invalid.");
    if (publicUrl) {
        var publicOrigin;
        try { publicOrigin = new URL(publicUrl); } catch (_) { throw new Error("Public Portal URL is invalid."); }
        if (publicOrigin.protocol !== "https:" || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash)
            throw new Error("Public Portal URL must be an HTTPS origin.");
        publicUrl = publicOrigin.origin;
    }
    return {
        schemaVersion: 1,
        centralUrl: central.origin,
        tunnelUrl: tunnel.toString(),
        portalId: portalId,
        portalName: portalName,
        portalToken: portalToken,
        publicUrl: publicUrl,
        updatedAtUtc: new Date().toISOString()
    };
}

function create(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot || process.env.SIRK_DATA_ROOT || "C:\\ProgramData\\SIRK\\Portal");
    var filePath = path.join(dataRoot, "central-connection.json");

    function read() {
        try { return normalize(JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""))); }
        catch (error) {
            if (error && error.code === "ENOENT") return null;
            throw error;
        }
    }

    function write(input) {
        var value = normalize(input);
        fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
        var temporary = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(6).toString("hex");
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
        fs.renameSync(temporary, filePath);
        try { fs.chmodSync(filePath, 0o600); } catch (_) {}
        return publicValue(value);
    }

    function publicValue(value) {
        if (!value) return null;
        return {
            schemaVersion: value.schemaVersion,
            centralUrl: value.centralUrl,
            tunnelUrl: value.tunnelUrl,
            portalId: value.portalId,
            portalName: value.portalName,
            publicUrl: value.publicUrl,
            configured: true,
            updatedAtUtc: value.updatedAtUtc
        };
    }

    function status() {
        try { return publicValue(read()); }
        catch (error) { return { configured: false, error: error.message }; }
    }

    return { read: read, write: write, status: status, filePath: filePath };
}

module.exports = { create: create, normalize: normalize };
