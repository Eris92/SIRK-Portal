"use strict";

var implementation = require("./plugin-main-standalone.js");
var routeCompat = require("./server/core/express-route-compat.js");
var shared = require("./server/core/shared.js");
var updateBridge = require("./server/core/plugin-update-bridge.js");
var maintenance = require("./server/core/portal-maintenance.js");
var experience = require("./server/core/portal-experience-runtime.js");
var nativeAccess = require("./server/core/native-access-policy.js");
var agentGatewayFactory = require("./server/core/agent-gateway.js");
var agentCommandBrokerFactory = require("./server/core/agent-command-broker.js");

module.exports.SIRKPortal = function (parent) {
    var plugin = implementation.createPlugin(parent, "SIRKPortal");
    experience.extend(plugin.runtime, __dirname);
    var setupHttpHandlers = plugin.hook_setupHttpHandlers;
    var originalAdminGet = plugin.handleAdminReq;
    var originalAdminPost = plugin.handleAdminPostReq;
    var dataRoot = plugin.runtime && plugin.runtime.context && plugin.runtime.context.dataRoot;
    var commandBroker = agentCommandBrokerFactory.create({ dataRoot: dataRoot });
    var agentGateway = agentGatewayFactory.create({
        dataRoot: dataRoot,
        commandBroker: commandBroker,
        autoCreateEnrollmentToken: true
    });

    function operationPayload(req) {
        var value = req && req.body || {};
        if (value && typeof value.payload === "string") {
            try { value = JSON.parse(value.payload); } catch (error) { value = {}; }
        }
        return value && typeof value === "object" ? value : {};
    }

    plugin.handleAdminReq = function (req, res, user) {
        var action = String(req && req.query && req.query.action || "");
        if (action === "portal-admin-snapshot") {
            if (!shared.isSiteAdmin(user)) { shared.sendJson(res, 403, { ok: false, error: "Forbidden" }); return; }
            try { shared.sendJson(res, 200, { ok: true, snapshot: plugin.runtime.adminSnapshot(user) }); }
            catch (error) { shared.sendJson(res, 500, { ok: false, error: String(error.message || error) }); }
            return;
        }
        if (action === "agent-operation-status") {
            if (!shared.isSiteAdmin(user)) { shared.sendJson(res, 403, { ok: false, error: "Forbidden" }); return; }
            try {
                var value = commandBroker.get(String(req.query.tenantId || ""),
                    String(req.query.deviceId || ""), String(req.query.commandId || ""));
                shared.sendJson(res, value ? 200 : 404,
                    value ? { ok: true, value: value } : { ok: false, error: "Operation not found." });
            } catch (error) {
                shared.sendJson(res, 400, { ok: false, error: String(error.message || error) });
            }
            return;
        }
        return originalAdminGet.call(plugin, req, res, user);
    };

    plugin.handleAdminPostReq = function (req, res, user) {
        var action = String(req && req.query && req.query.action || "");
        if (action === "agent-operation-create") {
            if (!shared.isSiteAdmin(user)) { shared.sendJson(res, 403, { ok: false, error: "Forbidden" }); return; }
            try {
                var body = operationPayload(req);
                var command = commandBroker.queue(String(body.tenantId || ""), String(body.deviceId || ""),
                    String(body.type || ""), body.parameters, user);
                shared.sendJson(res, 202, { ok: true, value: command });
            } catch (error) {
                shared.sendJson(res, 400, { ok: false, error: String(error.message || error) });
            }
            return;
        }
        return originalAdminPost.call(plugin, req, res, user);
    };

    plugin.hook_setupHttpHandlers = function (webserver, meshServer) {
        var domains = meshServer && meshServer.config && meshServer.config.domains || { "": { url: "/" } };
        Object.keys(domains).forEach(function (key) {
            var domain = domains[key] || {};
            if (domain.dns != null || domain.share != null) return;
            var base = String(domain.url || "/");
            if (base.charAt(0) !== "/") base = "/" + base;
            if (base.charAt(base.length - 1) !== "/") base += "/";
            ["enroll", "checkin"].forEach(function (action) {
                webserver.app.post(base + "api/agent/v1/" + action, function (req, res) {
                    agentGateway.handle(req, res);
                });
            });
        });
        updateBridge.install(plugin, parent, webserver, meshServer);
        maintenance.installPlugin(plugin, webserver, meshServer);
        var result = routeCompat.withExactPortalRedirect(webserver && webserver.app, function () {
            return setupHttpHandlers.call(plugin, webserver, meshServer);
        });
        nativeAccess.install(plugin, parent, webserver, meshServer);
        return result;
    };

    return plugin;
};
