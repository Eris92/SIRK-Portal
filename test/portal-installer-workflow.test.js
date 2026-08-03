"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");

var managed = fs.readFileSync(path.join(root, "clean-install-managed.ps1"), "utf8");
var installer = fs.readFileSync(path.join(root, "install-v3.ps1"), "utf8");
var updater = fs.readFileSync(path.join(root, "tools", "installer", "Ensure-SirkUpdater.ps1"), "utf8");
var prerequisites = fs.readFileSync(path.join(root, "tools", "install", "Ensure-SirkWindowsPrerequisites.ps1"), "utf8");

assert.match(managed, /MANAGED CLEAN INSTALLATION/);
assert.match(managed, /install-v3\.ps1/);
assert.match(managed, /Node\.js 24 LTS/);
assert.match(managed, /\.NET 10 LTS/);
assert.match(managed, /No migration/);
assert.doesNotMatch(managed, /Replace\([^)]*install-release/);
assert.doesNotMatch(managed, /AllowSourceFallback/);

assert.match(installer, /Installation mode' -Value 'Clean install/);
assert.match(installer, /Remove-Item -LiteralPath \$PortalRoot/);
assert.match(installer, /Remove-Item -LiteralPath \$DataRoot/);
assert.match(installer, /Node\.js 24 LTS is required/);
assert.match(installer, /\.NET 10 SDK is required/);
assert.match(installer, /Ensure-SirkUpdater\.ps1/);
assert.doesNotMatch(installer, /agent-enrollment-token\.txt/);
assert.doesNotMatch(installer, /SIRK_ENROLLMENT_TOKEN_FILE/);
assert.doesNotMatch(installer, /AllowSourceFallback/);
assert.doesNotMatch(installer, /install-release\.ps1/);

assert.match(updater, /install-release-v2\.ps1/);
assert.match(updater, /applicationId\s*=\s*'sirk-portal'/);
assert.match(updater, /SIRK_PORTAL_SHARED_UPDATER_READY/);
assert.doesNotMatch(updater, /AllowSourceFallback/);
assert.doesNotMatch(updater, /install-release\.ps1/);

assert.match(prerequisites, /OpenJS\.NodeJS\.LTS/);
assert.match(prerequisites, /Microsoft\.DotNet\.SDK\.10/);
assert.match(prerequisites, /Expected highest Node\.js LTS major 24/);
assert.match(prerequisites, /Expected highest \.NET LTS SDK major 10/);

for (var legacyPath of [
    path.join(root, "install.ps1"),
    path.join(root, "tools", "installer", "SIRK-Portal.iss"),
    path.join(root, "tools", "installer", "Install-SIRK-Portal-Service.ps1"),
    path.join(root, ".github", "workflows", "release-windows.yml")
]) {
    assert.strictEqual(fs.existsSync(legacyPath), false, "Legacy installer must be absent: " + legacyPath);
}

console.log("SIRK Portal canonical clean installer: OK");
