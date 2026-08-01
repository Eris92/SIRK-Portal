"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var watchdog = fs.readFileSync(path.join(root, "tools", "watchdog", "portal-watchdog.js"), "utf8");

assert(watchdog.indexOf("maintenance.json") >= 0,
    "Watchdog must recognize the updater maintenance marker.");
assert(watchdog.indexOf("maintenanceActive") >= 0,
    "Watchdog must suspend recovery while maintenance is active.");
assert(watchdog.indexOf("maintenance: true") >= 0,
    "Watchdog health result must report maintenance mode.");

console.log("watchdog maintenance contract: OK");
