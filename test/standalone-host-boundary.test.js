"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var root = path.join(__dirname, "..");
var adapter = require("../server/adapters/standalone/index.js");
var registry = require("../server/core/module-registry.js");
var server = require("../server/standalone.js");
var temp = path.join(root, ".tmp-standalone-host");
var host = adapter.createHost({ dataRoot: temp });

assert.strictEqual(host.kind, "standalone");
assert.strictEqual(host.capabilities.nativeUi, false);
assert.strictEqual(host.capabilities.desktop, false);
assert.strictEqual(typeof host.devices.list, "function");
assert.strictEqual(typeof host.sessions.create, "function");
assert.strictEqual(typeof server.start, "function");
assert.strictEqual(typeof server.renderPortalHtml, "function");
assert.ok(server.assets["shared-ui/toolbar-config.js"]);
assert.ok(server.assets["approvalcenter.js"]);
assert.ok(registry.descriptors(temp).length >= 6);
assert.ok(fs.existsSync(path.join(temp, "extensions")));

var transport = fs.readFileSync(path.join(root, "public/portal/standalone/scripts/core.js"), "utf8");
assert.ok(transport.indexOf("/api") >= 0);

var renderedPortal = server.renderPortalHtml();
assert.ok(renderedPortal.indexOf("window.__SIRK_PLATFORM_NATIVE_URL__ = null;") >= 0);
assert.ok(!/=\s*__[A-Z0-9_]+__\s*;/.test(renderedPortal),
    "Rendered Portal still contains an unresolved JavaScript value placeholder.");
assert.ok(!/(?:src|href)=["']__[A-Z0-9_]+__/.test(renderedPortal),
    "Rendered Portal still contains an unresolved asset placeholder.");

fs.rmSync(temp, { recursive: true, force: true });
console.log("Standalone host boundary: OK");
