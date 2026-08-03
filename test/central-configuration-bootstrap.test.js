"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "..", "tools", "Configure-SirkCentral.ps1"), "utf8");

assert.match(script, /central-connection\.json/);
assert.match(script, /tunnelUrl\s*=\s*\$tunnelText/);
assert.match(script, /portalId\s*=\s*\$idText/);
assert.match(script, /portalName\s*=\s*\$nameText/);
assert.match(script, /portalToken\s*=\s*\$tokenText/);
assert.match(script, /Move-Item -LiteralPath \$tempPath -Destination \$configPath -Force/);
assert.match(script, /icacls\.exe \$configPath \/inheritance:r/);
assert.match(script, /'\*S-1-5-18:F'/);
assert.match(script, /'\*S-1-5-32-544:F'/);
assert.match(script, /\/api\/portal\/v1\/config/);
assert.match(script, /Restart-Service\s+-Name\s+\$portal\.Name/);
assert.match(script, /SIRK_CENTRAL_PORTAL_CONFIGURATION_OK/);
assert.doesNotMatch(script, /SIRK_CENTRAL_(?:URL|API_URL|PORTAL_ID|PORTAL_NAME|TOKEN)=/);
assert.doesNotMatch(script, /api\/portal\/v1\/tunnel/);

console.log("central-configuration-bootstrap: OK");
