"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

function runIcacls(argumentsList) {
    var result = childProcess.spawnSync("icacls.exe", argumentsList, {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error("Unable to harden NTFS ACL: " + String(result.stderr || result.stdout || "icacls failed").trim());
    }
}

function hardenFile(filePath) {
    if (process.platform !== "win32") return;
    var target = path.resolve(filePath);
    if (!fs.existsSync(target)) throw new Error("ACL target does not exist: " + target);
    runIcacls([
        target,
        "/inheritance:r",
        "/grant:r",
        "*S-1-5-18:(F)",
        "*S-1-5-32-544:(F)"
    ]);
}

function hardenDirectory(directoryPath) {
    if (process.platform !== "win32") return;
    var target = path.resolve(directoryPath);
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    runIcacls([
        target,
        "/inheritance:r",
        "/grant:r",
        "*S-1-5-18:(OI)(CI)(F)",
        "*S-1-5-32-544:(OI)(CI)(F)"
    ]);
}

module.exports = { hardenFile: hardenFile, hardenDirectory: hardenDirectory };
