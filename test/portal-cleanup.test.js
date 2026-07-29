"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var css = fs.readFileSync(path.join(root, "public", "portal", "standalone", "styles", "cleanup.css"), "utf8");
var js = fs.readFileSync(path.join(root, "public", "portal", "standalone", "scripts", "cleanup.js"), "utf8");
var nav = fs.readFileSync(path.join(root, "public", "portal", "standalone", "scripts", "navigation.js"), "utf8");
var httpsHost = fs.readFileSync(path.join(root, "server", "standalone-https.js"), "utf8");

[
    ".sirk-device-compact-tabs",
    "--portal-primary-width: 184px",
    "--portal-secondary-width: 236px",
    "--portal-secondary-edit-width: 440px",
    "--portal-primary-collapsed-width: 56px",
    ".sirk-portal-view-host",
    ".",
    ".sirk-standalone-grid",
    ".sirk-standalone-settings-frame"
].forEach(function (token) {
    assert(css.indexOf(token) >= 0, "Missing cleanup CSS contract: " + token);
});

[
    "injectSettingsContract",
    "mc-portal-settings-document",
    "grid-template-columns:184px minmax(0,1fr)",
    "grid-template-columns:184px 236px minmax(0,1fr)",
    "addPortalClasses"
].forEach(function (token) {
    assert(js.indexOf(token) >= 0, "Missing cleanup JS contract: " + token);
});

assert(nav.indexOf('"portal-cleanup.css"') >= 0, "Standalone navigation must load cleanup CSS.");
assert(nav.indexOf('"portal-cleanup.js"') >= 0, "Standalone navigation must load cleanup JS.");
assert(css.indexOf("#sirkPortalRoot") >= 0, "Cleanup styles must remain scoped to the standalone Portal.");
assert(css.indexOf(".sirk-platform-native-ui") < 0, "Cleanup styles must not target native MeshCentral.");
assert(httpsHost.indexOf("closeAllConnections") >= 0,
    "Standalone HTTPS shutdown must terminate long-lived Agent connections.");
assert(httpsHost.indexOf("request.destroy()") >= 0,
    "Standalone HTTPS shutdown must terminate active upstream long-polls.");

console.log("Standalone Portal cleanup contract: OK");
