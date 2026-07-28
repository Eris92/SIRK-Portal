"use strict";

var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");
var required = [
    "server/standalone.js",
    "server/standalone-https.js",
    "server/core/identity-store.js",
    "server/core/agent-gateway.js",
    "server/http/api-router.js",
    "public/portal/standalone/index.html",
    "public/portal/standalone/login.html",
    "public/portal/settings.js",
    "portal-independence.json"
];
var forbiddenPaths = [
    "SIRKPortal.js", "SIRKPortalAdmin.js", "plugin-main.js", "plugin-main-standalone.js",
    "admin.js", "public/native", "views", "web/admin", "embedded"
];
var patterns = [/MeshCentral/i, /pluginadmin\.ashx/i, /meshId/i, /data-mesh/i];
var errors = [];

required.forEach(function (relative) {
    if (!fs.existsSync(path.join(root, relative))) errors.push("Missing required standalone file: " + relative);
});
forbiddenPaths.forEach(function (relative) {
    var target = path.join(root, relative);
    if (!fs.existsSync(target)) return;
    var stat = fs.statSync(target);
    var populated = stat.isFile() || fs.readdirSync(target, { recursive: true, withFileTypes: true })
        .some(function (entry) { return entry.isFile(); });
    if (populated) errors.push("Legacy integration path still exists: " + relative);
});

["server", "public"].forEach(function walk(relative) {
    var absolute = path.join(root, relative);
    fs.readdirSync(absolute, { withFileTypes: true }).forEach(function (entry) {
        var child = path.join(relative, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (/\.(js|json|html|css)$/i.test(entry.name)) {
            var text = fs.readFileSync(path.join(root, child), "utf8");
            patterns.forEach(function (pattern) {
                if (pattern.test(text)) errors.push(child + " contains forbidden integration pattern " + pattern);
            });
        }
    });
});

if (errors.length) {
    errors.forEach(function (error) { console.error(error); });
    process.exitCode = 1;
} else {
    console.log("Standalone architecture: OK");
}
