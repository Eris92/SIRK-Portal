"use strict";

var fs = require("fs");
var path = require("path");
var secretStoreFactory = require("../server/core/secret-store.js");

function argument(name) {
    var index = process.argv.indexOf(name);
    return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function readToken() {
    return fs.readFileSync(0, "utf8").trim();
}

var dataRoot = path.resolve(argument("--data-root") || process.env.SIRK_DATA_ROOT || "");
var centralUrl = argument("--url");
var portalId = argument("--portal-id");
var portalName = argument("--portal-name") || portalId;
var portalToken = readToken();

if (!dataRoot || dataRoot === path.parse(dataRoot).root) throw new Error("A safe --data-root is required.");
if (!/^wss:\/\/[^/]+(?::\d+)?\/tunnel$/i.test(centralUrl)) throw new Error("Central URL must be a WSS /tunnel endpoint.");
if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(portalId)) throw new Error("Portal ID is invalid.");
if (!portalName || portalName.length > 128) throw new Error("Portal name is invalid.");
if (portalToken.length < 32) throw new Error("Portal token is invalid.");

var store = secretStoreFactory.createSecretStore({
    fs: fs,
    path: path,
    dataPath: path.join(dataRoot, "secrets.json"),
    keyPath: path.join(dataRoot, ".secret.key")
});
store.set("central-tunnel", {
    centralUrl: centralUrl,
    portalId: portalId,
    portalName: portalName,
    portalToken: portalToken
});
process.stdout.write("Central tunnel configuration saved in the encrypted secret store.\n");
