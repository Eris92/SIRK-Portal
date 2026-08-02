"use strict";

var path = require("path");
var runtimeFactory = require("./core/runtime-portal.js");
var experience = require("./core/portal-experience-runtime.js");
var platformManagementFactory = require("./core/platform-management-service.js");

module.exports.createRuntime = function (host, pluginRoot) {
    var syntheticParent = {
        fs: host.fs,
        path: host.path,
        pluginPath: pluginRoot,
        identity: host.identity || null,
        devices: host.devices,
        parent: { datapath: path.dirname(host.dataRoot) }
    };
    var runtime = runtimeFactory.createRuntime({
        parent: syntheticParent,
        dataRoot: host.dataRoot,
        pluginRoot: pluginRoot,
        source: { shortName: "SIRKPortalStandalone" }
    });
    experience.extend(runtime, pluginRoot);
    var platform = platformManagementFactory.create({ dataRoot: host.dataRoot, agentGroups: host.agentGroups });
    var originalRequest = runtime.request.bind(runtime);
    runtime.request = function (method, moduleName, action, input, response, user) {
        if (moduleName !== "platform") return originalRequest(method, moduleName, action, input, response, user);
        if (!user || !(user.isAdmin || user.siteadmin || user.role === "admin" ||
                Array.isArray(user.roles) && user.roles.indexOf("admin") >= 0)) {
            response.status(403).send(JSON.stringify({ ok: false, error: "Administrator permission required." }));
            return Promise.resolve();
        }
        return Promise.resolve(platform.request(action, input)).then(function (value) {
            response.status(200).setHeader("Content-Type", "application/json; charset=utf-8");
            response.send(JSON.stringify({ ok: true, value: value }));
        }).catch(function (error) {
            response.status(error.statusCode || 400).setHeader("Content-Type", "application/json; charset=utf-8");
            response.send(JSON.stringify({ ok: false, code: error.code || "PLATFORM_MANAGEMENT_FAILED",
                error: String(error && error.message || error) }));
        });
    };
    var originalBootstrap = runtime.bootstrap;
    runtime.bootstrap = function (user) {
        var value = originalBootstrap(user && user.raw || user);
        value.host = { kind: host.kind, capabilities: host.capabilities };
        value.platformManagement = platform.status();
        return value;
    };
    runtime.host = host;
    runtime.platformManagement = platform;
    return runtime;
};
