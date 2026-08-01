"use strict";

var assert = require("assert");
var fs = require("fs");

var installer = fs.readFileSync("install.ps1", "utf8");

assert.match(installer, /Portal DNS name/);
assert.match(installer, /New-SelfSignedCertificate/);
assert.match(installer, /SIRK_ACCESS_KEY_HASH/);
assert.match(installer, /SIRK_PORTAL_FQDN/);
assert.match(installer, /Break-Glass URL/);
assert.match(installer, /Get-Sha256Hex/);
assert.match(installer, /RandomNumberGenerator/);
assert.match(installer, /https:\/\/raw\.githubusercontent\.com\/Eris92\/SIRK-Portal\//);
assert.doesNotMatch(installer, /SIRK_ACCESS_KEY_HASH=\$accessToken/);

console.log("one-line installer contract: OK");
