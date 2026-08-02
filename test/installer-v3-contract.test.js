"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var installer = fs.readFileSync(path.join(root, "install-v3.ps1"), "utf8");
var managed = fs.readFileSync(path.join(root, "clean-install-managed.ps1"), "utf8");
var updater = fs.readFileSync(path.join(root, "tools", "installer", "Ensure-SirkUpdater.ps1"), "utf8");

assert.match(installer, /WinSW-x64\.exe/, "Installer v3 must use verified WinSW.");
assert.match(installer, /WinSW SHA-256 mismatch/, "Installer v3 must verify WinSW SHA-256.");
assert.match(installer, /Write-SirkInputRequired/, "Installer v3 must clearly mark interactive input.");
assert.match(installer, /Portal URL/, "Installer v3 must show the Portal URL.");
assert.match(installer, /Break-Glass URL/, "Installer v3 must show the Break-Glass URL.");
assert.match(installer, /SIRK_PORTAL_INSTALL_V3_OK/, "Installer v3 must expose a machine-readable success marker.");
assert.match(installer, /Node\.js 24 LTS is required/, "Installer v3 must require Node.js 24 LTS.");
assert.match(installer, /\.NET 10 SDK is required/, "Installer v3 must require .NET 10.");
assert.match(installer, /Remove-Item -LiteralPath \$PortalRoot/, "Installer v3 must delete previous Portal binaries.");
assert.match(installer, /Remove-Item -LiteralPath \$DataRoot/, "Installer v3 must delete previous Portal data.");
assert.match(installer, /Ensure-SirkUpdater\.ps1/, "Installer v3 must use the shared Updater integration.");
assert.doesNotMatch(installer, /node-windows|wrapper\.js/, "Installer v3 must not use node-windows.");
assert.doesNotMatch(installer, /agent-enrollment-token\.txt|SIRK_ENROLLMENT_TOKEN_FILE/, "Installer v3 must not use a global Agent token.");
assert.doesNotMatch(installer, /AllowSourceFallback|install-release\.ps1/, "Installer v3 must not use an Updater source fallback.");

assert.match(managed, /install-v3\.ps1/, "Managed installer must invoke installer v3.");
assert.match(managed, /No migration/, "Managed installer must state the clean-install contract.");
assert.doesNotMatch(managed, /install-v2\.ps1|clean-install\.ps1|AllowSourceFallback/, "Managed installer must not invoke legacy installers.");
assert.doesNotMatch(managed, /\.Replace\(|-replace.*install-release/, "Managed installer must not patch downloaded installer code.");

assert.match(updater, /install-release-v2\.ps1/, "Portal must install transactional Updater v2.");
assert.doesNotMatch(updater, /AllowSourceFallback|install-release\.ps1/, "Portal Updater integration must be release-only.");

for (var legacyPath of [
    path.join(root, "install.ps1"),
    path.join(root, "install-v2.ps1"),
    path.join(root, "tools", "installer", "SIRK-Portal.iss"),
    path.join(root, "tools", "installer", "Install-SIRK-Portal-Service.ps1")
]) {
    assert.strictEqual(fs.existsSync(legacyPath), false, "Legacy installer must be absent: " + legacyPath);
}

console.log("installer-v3-contract: OK");
