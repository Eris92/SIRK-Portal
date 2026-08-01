"use strict";

var assert = require("assert");
var fs = require("fs");

var installer = fs.readFileSync("install.ps1", "utf8");

assert.match(installer, /Read-Host 'Break-Glass administrator password' -AsSecureString/);
assert.match(installer, /Repeat password/);
assert.match(installer, /SirkPortalWatchdog/);
assert.match(installer, /SirkPortalStandalone/);
assert.match(installer, /SIRK_HTTPS_PORT=443/);
assert.match(installer, /https:\/\/127\.0\.0\.1\/login/);
assert.match(installer, /New-SelfSignedCertificate/);
assert.match(installer, /SIRK_LOGIN_PASSWORD=\$password/);
assert.match(installer, /Where-Object \{ \$_ -notmatch '\^SIRK_LOGIN_' \}/);
assert.match(installer, /Start-Process/);
assert.doesNotMatch(installer, /&\s+\$NodePath\s+\$TemporaryInstaller/);
assert.match(installer, /SIRK_PORTAL_CLEAN_INSTALL_OK/);

console.log("one-line installer contract: OK");
