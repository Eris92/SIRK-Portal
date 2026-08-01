"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var helper = fs.readFileSync(path.join(root, "server", "update-helper.js"), "utf8");

assert(helper.indexOf('start=", "disabled"') < 0,
    "Updater must not persistently disable the Portal service during an update.");
assert(helper.indexOf("waitForHttpHealth") >= 0,
    "Updater must validate runtime HTTP health after starting the new version.");
assert(helper.indexOf("complete(path.resolve(manifest.stateFile)") > helper.indexOf("waitForHttpHealth"),
    "Updater must mark the operation complete only after runtime health succeeds.");
assert(helper.indexOf("rollbackHealth") >= 0,
    "Updater must validate the restored version after rollback.");
assert(helper.indexOf("finally") >= 0 && helper.indexOf("maintenance") >= 0,
    "Updater must always clear its maintenance marker.");

console.log("update-helper transactional contract: OK");
