"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var installer = fs.readFileSync(path.join(root, "install-v2.ps1"), "utf8");
var managed = fs.readFileSync(path.join(root, "clean-install-managed.ps1"), "utf8");

assert.ok(installer.indexOf("WinSW-x64.exe") >= 0, "Installer v2 must use WinSW.");
assert.ok(installer.indexOf("SirkPortal.xml") < 0 || installer.indexOf("ServiceName") >= 0, "Installer v2 must generate service XML dynamically.");
assert.ok(installer.indexOf("INPUT REQUIRED") >= 0, "Installer v2 must clearly mark interactive input.");
assert.ok(installer.indexOf("Portal URL (copied to clipboard)") >= 0, "Installer v2 must show the Portal URL.");
assert.ok(installer.indexOf("Break-Glass URL (save securely)") >= 0, "Installer v2 must show the Break-Glass URL.");
assert.ok(installer.indexOf("SIRK_PORTAL_INSTALL_V2_OK") >= 0, "Installer v2 must expose a machine-readable success marker.");
assert.strictEqual(installer.indexOf("node-windows"), -1, "Installer v2 must not use node-windows.");
assert.strictEqual(installer.indexOf("wrapper.js"), -1, "Installer v2 must not use the node-windows wrapper.");
assert.strictEqual(managed.indexOf("clean-install.ps1"), -1, "Managed installer must not invoke the legacy clean installer.");
assert.strictEqual(managed.indexOf("install-v2.ps1"), -1, "Managed installer must not invoke the superseded installer v2.");
assert.ok(managed.indexOf("install-v3.ps1") >= 0, "Managed installer must invoke the current installer v3.");
assert.ok(managed.indexOf("install-release-v2.ps1") >= 0, "Managed installer must enforce transactional Updater release v2.");

console.log("installer-v2-contract: OK");
