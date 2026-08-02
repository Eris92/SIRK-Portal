#!/usr/bin/env node
"use strict";

var os = require("os");
var path = require("path");
var clientFactory = require("../../server/core/central-enrollment-client.js");
var VERSION = require("../../config.json").version;

function value(name) {
    var index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : "";
}

function flag(name) {
    return process.argv.indexOf(name) >= 0;
}

function output(value) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function sleep(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
}

async function main() {
    var command = String(process.argv[2] || "status").toLowerCase();
    var dataRoot = path.resolve(value("--data-root") || process.env.SIRK_DATA_ROOT || "C:\\ProgramData\\SIRK\\Portal");
    var client = clientFactory.create({
        dataRoot: dataRoot,
        rejectUnauthorized: !flag("--insecure-test-only"),
        timeoutMilliseconds: Number(value("--timeout-ms") || 15000)
    });

    if (command === "status") {
        output(client.status());
        return;
    }

    if (command === "begin") {
        var centralUrl = value("--central-url");
        var enrollmentToken = value("--token") || process.env.SIRK_CENTRAL_ENROLLMENT_TOKEN || "";
        var portalId = value("--portal-id") || os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
        var portalName = value("--portal-name") || os.hostname();
        var publicUrl = value("--public-url") || process.env.SIRK_PUBLIC_URL || "";
        var result = await client.begin({
            centralUrl: centralUrl,
            enrollmentToken: enrollmentToken,
            portalId: portalId,
            portalName: portalName,
            publicUrl: publicUrl,
            version: VERSION
        });
        output(result);
        process.stdout.write("SIRK_PORTAL_ENROLLMENT_PENDING\n");
        return;
    }

    if (command === "poll") {
        var polled = await client.poll();
        output(polled);
        if (polled.status === "configured") process.stdout.write("SIRK_PORTAL_ENROLLMENT_CONFIGURED\n");
        return;
    }

    if (command === "wait") {
        var intervalSeconds = Math.max(2, Math.min(60, Number(value("--interval-seconds") || 5)));
        var timeoutSeconds = Math.max(30, Math.min(86400, Number(value("--wait-timeout-seconds") || 1800)));
        var deadline = Date.now() + timeoutSeconds * 1000;
        while (Date.now() < deadline) {
            var status = await client.poll();
            output(status);
            if (status.status === "configured") {
                process.stdout.write("SIRK_PORTAL_ENROLLMENT_CONFIGURED\n");
                return;
            }
            if (status.status === "rejected") throw new Error("Portal enrollment was rejected in SIRK Central.");
            await sleep(intervalSeconds * 1000);
        }
        throw new Error("Portal enrollment approval timed out.");
    }

    throw new Error("Usage: sirk-central-enroll.js <begin|poll|wait|status> [options]");
}

main().catch(function (error) {
    process.stderr.write("SIRK_PORTAL_ENROLLMENT_ERROR: " + (error && error.message || error) + "\n");
    process.exitCode = 1;
});
