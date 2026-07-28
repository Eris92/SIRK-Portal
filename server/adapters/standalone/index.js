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
    var deviceGroupsPath = path.join(dataRoot, "device-groups.json");
    function deviceGroups() {
        try {
            var value = JSON.parse(fs.readFileSync(deviceGroupsPath, "utf8"));
            return value && typeof value === "object" ? value : { groups: [], assignments: {} };
        } catch (error) { return { groups: [], assignments: {} }; }
    }
    function localAgentInventory() {
        var registryPath = path.join(dataRoot, "agent-registry.json");
        try {
            var registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
            var organization = deviceGroups();
            return Object.keys(registry.devices || {}).map(function (key) {
                var device = registry.devices[key] || {};
                var defaultGroup = "tenant/" + device.tenantId;
                return {
                    id: "sirk/" + device.tenantId + "/" + device.deviceId,
                    groupId: String(organization.assignments && organization.assignments[device.deviceId] || defaultGroup),
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
            list: function () {
                var nodes = localAgentInventory();
                var groups = deviceGroups().groups || [];
                nodes.forEach(function (node) {
                    if (!groups.some(function (group) { return group.id === node.groupId; })) {
                        groups.push({ id: node.groupId, name: node.tenantId });
                    }
                });
                return Promise.resolve({ groups: groups, nodes: nodes });
            },
            resolve: function () { return Promise.reject(new Error("No device connector is configured.")); },
            runCommand: function () { return Promise.reject(new Error("Use the authenticated SIRK Agent operation broker.")); },
            moveToGroup: function (user, nodeId, groupId) {
                var deviceId = String(nodeId || "").split("/").pop();
                var organization = deviceGroups();
                if (!(organization.groups || []).some(function (group) { return group.id === groupId; })) {
                    return Promise.reject(new Error("Target device group does not exist."));
                }
                organization.assignments = organization.assignments || {};
                organization.assignments[deviceId] = groupId;
                var temporary = deviceGroupsPath + ".tmp-" + process.pid;
                fs.writeFileSync(temporary, JSON.stringify(organization, null, 2) + "\n", "utf8");
                fs.renameSync(temporary, deviceGroupsPath);
                return Promise.resolve();
            }
        },
        sessions: options.sessions || {
            create: function () { return Promise.reject(new Error("No remote-session connector is configured.")); }
        },
        capabilities: Object.assign({ devices: true, desktop: false, terminal: false, files: false, nativeUi: false, extensions: true }, options.capabilities || {}),
        logger: options.logger || console
    });
};
