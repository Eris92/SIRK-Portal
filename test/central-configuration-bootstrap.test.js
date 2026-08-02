"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "..", "tools", "Configure-SirkCentral.ps1"), "utf8");

assert.match(script, /SIRK_CENTRAL_URL=\$tunnelUrl/);
assert.match(script, /SIRK_CENTRAL_API_URL=/);
assert.match(script, /SIRK_CENTRAL_PORTAL_ID=/);
assert.match(script, /SIRK_CENTRAL_PORTAL_NAME=/);
assert.match(script, /SIRK_CENTRAL_TOKEN=/);
assert.match(script, /\$tunnelUrl\s*=\s*"\$webSocketUrl\/tunnel"/);
assert.match(script, /\/api\/portal\/v1\/config/);
assert.match(script, /Restart-Service\s+-Name\s+\$portal\.Name/);
assert.match(script, /SIRK_CENTRAL_PORTAL_CONFIGURATION_OK/);
assert.doesNotMatch(script, /api\/portal\/v1\/tunnel/);

console.log("central-configuration-bootstrap: OK");
