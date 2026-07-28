"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
var portal = read("public/portal/standalone/index.html");
var workspace = read("public/portal/standalone/scripts/device-workspace.js").replace(/\r\n/g, "\n");
assert(portal.indexOf('select.value="3"') >= 0);
assert(portal.indexOf('select.value="2"') >= 0);
assert(portal.indexOf("Zapytaj o zgodę + Bar") >= 0);
assert(portal.indexOf("Zapytaj o zgodę") >= 0);
assert(portal.indexOf("Pasek Prywatności") >= 0);
assert(portal.indexOf("Number(amt.state)===2") >= 0);
assert(portal.indexOf("pendingConsent") >= 0);
assert(workspace.indexOf('runAgentOperation(node, "desktop.snapshot"') >= 0);
assert(workspace.indexOf('agentOperation(node, "desktop.input"') >= 0);
assert(workspace.indexOf('return fetch(endpoint, {\n            method: "POST",') >= 0);
console.log("Portal allowAll save and Desktop connection controls: OK");
