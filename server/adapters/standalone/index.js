"use strict";

var fs = require("fs");
var path = require("path");
var contract = require("../../contracts/host-context.js");

module.exports.createHost = function (options) {
    options = options || {};
    var applicationRoot = path.resolve(__dirname, "..", "..", "..");
    var defaultDataRoot = path.join(path.dirname(applicationRoot), "sirk-platform-data");
    var dataRoot = path.resolve(options.dataRoot || process.env.SIRK_DATA_ROOT || defaultDataRoot);
    fs.mkdirSync(path.join(dataRoot, "extensions"), { recursive: true });
    function localMeshInventory() {
        var databasePath = process.env.SIRK_MESHCENTRAL_DB || "";
        if (!fs.existsSync(databasePath)) return { meshes: [], nodes: localAgentInventory() };
        var records = Object.create(null);
        fs.readFileSync(databasePath, "utf8").split(/\r?\n/).forEach(function (line) {
            if (!line.trim()) return;
            try { var value = JSON.parse(line); if (value && value._id) records[value._id] = value; } catch (ignored) {}
        });
        var meshes = [], nodes = [];
        Object.keys(records).forEach(function (id) {
            var value = records[id];
            if (value.type === "mesh") meshes.push({ id: value._id, name: value.name || value._id });
            if (value.type === "node") nodes.push({ id: value._id, meshId: value.meshid || "", name: value.name || value.rname || value._id, os: value.osdesc || "", ip: value.ip || value.host || "", agentVersion: value.agent && value.agent.ver || "", lastSeen: value.lastconnect || value.firstconnect || 0, conn: 1 });
        });
        return { meshes: meshes, nodes: nodes.concat(localAgentInventory()).filter(function (node, index, all) {
            return all.findIndex(function (candidate) { return candidate.id === node.id; }) === index;
        }) };
    }
    function localAgentInventory() {
        var registryPath = path.join(dataRoot, "agent-registry.json");
        try {
            var registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
            return Object.keys(registry.devices || {}).map(function (key) {
                var device = registry.devices[key] || {};
                return {
                    id: "sirk/" + device.tenantId + "/" + device.deviceId,
                    meshId: "sirk/" + device.tenantId,
                    name: device.machineName || device.deviceId,
                    os: "Windows",
                    ip: "",
                    agentVersion: device.agentVersion || "",
                    lastSeen: device.lastSeenUtc || 0,
                    conn: Date.now() - Date.parse(device.lastSeenUtc || 0) < 120000 ? 1 : 0,
                    source: "sirk-agent",
                    deviceId: device.deviceId,
                    tenantId: device.tenantId
                };
            });
        } catch (error) {
            return [];
        }
    }
    return contract.createHostContext({
        kind: "standalone",
        dataRoot: dataRoot,
        fs: fs,
        path: path,
        auth: options.auth || {
            currentUser: function () {
                return {
                    id: process.env.SIRK_USER_ID || "local/admin",
                    displayName: process.env.SIRK_USER_NAME || "Local Administrator",
                    tenantId: process.env.SIRK_TENANT_ID || "local",
                    roles: ["admin"],
                    groups: [],
                    isAdmin: true,
                    siteadmin: true
                };
            }
        },
        devices: options.devices || {
            list: function () { return Promise.resolve(localMeshInventory()); },
            resolve: function () { return Promise.reject(new Error("No device connector is configured.")); },
            runCommand: function () { return Promise.reject(new Error("No agent transport is configured.")); }
        },
        sessions: options.sessions || {
            create: function () { return Promise.reject(new Error("No remote-session connector is configured.")); }
        },
        capabilities: Object.assign({ devices: true, desktop: false, terminal: false, files: false, nativeUi: false, extensions: true }, options.capabilities || {}),
        logger: options.logger || console
    });
};
