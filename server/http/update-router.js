"use strict";

function sendJson(res, status, value) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value));
}

function readBody(req) {
    if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
    return new Promise(function (resolve, reject) {
        var chunks = [];
        var size = 0;
        req.on("data", function (chunk) {
            size += chunk.length;
            if (size > 65536) {
                reject(new Error("Request body is too large."));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", function () {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
            catch (error) { reject(new Error("Request body is not valid JSON.")); }
        });
        req.on("error", reject);
    });
}

module.exports.createHandler = function (manager) {
    return function (req, res, url) {
        var action = url.pathname.slice("/api/system/updates".length).replace(/^\//, "");
        Promise.resolve().then(function () {
            if (req.method === "GET" && action === "status") {
                return Promise.all([
                    manager.check().catch(function (error) { return { error: String(error.message || error) }; }),
                    Promise.resolve(manager.backups()),
                    Promise.resolve(manager.health())
                ]).then(function (values) {
                    return {
                        current: manager.current(),
                        remote: values[0],
                        backups: values[1],
                        health: values[2],
                        history: manager.state().history || [],
                        jobs: manager.state().jobs || {}
                    };
                });
            }
            if (req.method === "GET" && action.indexOf("job/") === 0) {
                var job = manager.job(decodeURIComponent(action.slice(4)));
                if (!job) throw new Error("Update job was not found.");
                return job;
            }
            if (req.method !== "POST") throw new Error("Endpoint not found.");
            return readBody(req).then(function (body) {
                if (action === "channel") return manager.setChannel(body.channel);
                if (action === "check") return manager.check(body.channel);
                if (action === "backup") return manager.backup(body.reason || "manual");
                if (action === "delete-backup") return manager.deleteBackup(body.backupId);
                if (action === "update") return manager.install(body.channel);
                if (action === "restore") return manager.restore(body.backupId);
                if (action === "restart") return manager.restart();
                if (action === "clear-interrupted") return manager.clearInterrupted();
                throw new Error("Endpoint not found.");
            });
        }).then(function (value) {
            sendJson(res, 200, { ok: true, value: value });
        }).catch(function (error) {
            sendJson(res, 400, { ok: false, error: String(error.message || error) });
        });
    };
};
