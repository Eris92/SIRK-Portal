"use strict";

var assert = require("assert");
var fs = require("fs");

var source = fs.readFileSync("server/standalone-https.js", "utf8");

assert.match(source, /Set-Cookie.*sirk_breakglass/,
    "Access exchange must set the protected break-glass cookie.");
assert.match(source, /setHeader\("Location", "\/login"\)/,
    "Access exchange must redirect to the canonical login route.");
assert.doesNotMatch(source, /Location", "\/login\?breakglass=1/,
    "Gateway must not expose or depend on the legacy breakglass query flag.");
assert.match(source, /url\.pathname === "\/api\/auth\/login" && !breakGlassAllowed/,
    "Local login API must remain protected by the break-glass cookie.");

console.log("Break-glass access gateway contract: OK");
