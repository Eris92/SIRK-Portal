"use strict";

var assert = require("assert");
var fs = require("fs");

var managed = fs.readFileSync("clean-install-managed.ps1", "utf8");
var clean = fs.readFileSync("clean-install.ps1", "utf8");
var installer = fs.readFileSync("install-v3.ps1", "utf8");

assert.match(managed, /MANAGED CLEAN INSTALLATION/);
assert.match(managed, /Ensure-SirkWindowsPrerequisites\.ps1/);
assert.match(managed, /install-v3\.ps1/);
assert.match(managed, /No migration/);
assert.match(managed, /Updater v2 release only/);
assert.doesNotMatch(managed, /install\.ps1|install-v2\.ps1|AllowSourceFallback/);
assert.doesNotMatch(managed, /\.Replace\(|-replace.*install-release/);

assert.match(clean, /develop\/install-v3\.ps1/);
assert.match(clean, /canonical one-line installer v3/i);
assert.doesNotMatch(clean, /develop\/install\.ps1/);

assert.match(installer, /Portal DNS name/);
assert.match(installer, /New-SelfSignedCertificate/);
assert.match(installer, /SIRK_ACCESS_KEY_HASH/);
assert.match(installer, /SIRK_PORTAL_FQDN/);
assert.match(installer, /Break-Glass URL/);
assert.match(installer, /Get-Sha256Hex/);
assert.match(installer, /RandomNumberGenerator/);
assert.match(installer, /SIRK_PORTAL_INSTALL_V3_OK/);
assert.match(installer, /Remove-Item -LiteralPath \$PortalRoot/);
assert.match(installer, /Remove-Item -LiteralPath \$DataRoot/);
assert.doesNotMatch(installer, /SIRK_ACCESS_KEY_HASH=\$accessToken/);
assert.doesNotMatch(installer, /agent-enrollment-token\.txt|SIRK_ENROLLMENT_TOKEN_FILE/);

console.log("canonical one-line installer contract: OK");
