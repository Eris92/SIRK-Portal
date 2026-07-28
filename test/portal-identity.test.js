"use strict";

var assert = require("assert");
var fs = require("fs");
var http = require("http");
var os = require("os");
var path = require("path");
var identityFactory = require("../server/core/identity-store.js");
var standalone = require("../server/standalone.js");

function request(port, method, target, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
        var req = http.request({
            hostname: "127.0.0.1",
            port: port,
            method: method,
            path: target,
            headers: Object.assign({}, options.headers || {}, options.body ? {
                "Content-Length": Buffer.byteLength(options.body)
            } : {})
        }, function (res) {
            var chunks = [];
            res.on("data", function (chunk) { chunks.push(chunk); });
            res.on("end", function () {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString("utf8")
                });
            });
        });
        req.on("error", reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

(async function () {
    var root = fs.mkdtempSync(path.join(os.tmpdir(), "sirk-identity-"));
    var store = identityFactory.create({
        dataRoot: root,
        initialUsername: "admin",
        initialPassword: "Initial-Test-Password-1"
    });
    assert.strictEqual(store.snapshot().users.length, 1);
    assert.strictEqual(store.authenticate("admin", "wrong"), null);
    assert.ok(store.authenticate("admin", "Initial-Test-Password-1"));
    var group = store.createGroup({ name: "Operators", description: "Test group" });
    var user = store.createUser({
        username: "operator",
        displayName: "Operator",
        password: "Operator-Test-Password-1",
        roles: ["operator"],
        groups: [group.id]
    });
    assert.deepStrictEqual(user.groups, [group.id]);
    assert.throws(function () { store.deleteUser(store.snapshot().users[0].id, "different"); }, /ostatniego administratora/i);

    var serverRoot = path.join(root, "server");
    var server = await standalone.start({
        dataRoot: serverRoot,
        host: "127.0.0.1",
        port: 0,
        initialUsername: "portaladmin",
        initialPassword: "Portal-Test-Password-1"
    });
    try {
        var port = server.address().port;
        var denied = await request(port, "GET", "/api/admin/identity");
        assert.strictEqual(denied.status, 401);
        var loginBody = new URLSearchParams({
            username: "portaladmin",
            password: "Portal-Test-Password-1"
        }).toString();
        var login = await request(port, "POST", "/api/auth/login", {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: loginBody
        });
        assert.strictEqual(login.status, 200);
        var cookie = String(login.headers["set-cookie"][0]).split(";")[0];
        var bootstrap = await request(port, "GET", "/api/bootstrap", { headers: { Cookie: cookie } });
        assert.strictEqual(bootstrap.status, 200);
        var csrf = JSON.parse(bootstrap.body).csrfToken;
        assert.ok(csrf);
        var rejected = await request(port, "POST", "/api/admin/identity", {
            headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create-group", value: { name: "Rejected" } })
        });
        assert.strictEqual(rejected.status, 403);
        var created = await request(port, "POST", "/api/admin/identity", {
            headers: { Cookie: cookie, "Content-Type": "application/json", "X-SIRK-CSRF": csrf },
            body: JSON.stringify({ action: "create-group", value: { name: "Helpdesk" } })
        });
        assert.strictEqual(created.status, 200);
        assert.strictEqual(JSON.parse(created.body).value.groups[0].name, "Helpdesk");
    } finally {
        await new Promise(function (resolve) { server.close(resolve); });
        fs.rmSync(root, { recursive: true, force: true });
    }
    console.log("Portal identity: OK");
}()).catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
