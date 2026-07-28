"use strict";

var shared = require("../../core/shared.js");

module.exports.createModule = function (context) {
    var unregister = null;

    function access(user) {
        return {
            allowed: !!user,
            siteAdmin: shared.isSiteAdmin(user)
        };
    }

    function groupRows(user) {
        return context.device.visibleGroups(user).then(function (groups) {
            return groups.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
        });
    }

    function normalizeLevelList(value) {
        if (value === 0 || value === "0") return [];
        if (!Array.isArray(value)) value = value == null ? [] : [value];
        return value.map(Number).filter(function (level, index, all) {
            return level >= 1 && level <= 3 && Math.floor(level) === level && all.indexOf(level) === index;
        }).sort();
    }

    function normalizeGroupApprovalLevels(value, allowedGroupIds) {
        value = value && typeof value === "object" && !Array.isArray(value) ? value : {};
        allowedGroupIds = Array.isArray(allowedGroupIds) ? allowedGroupIds.map(String) : [];
        var result = {};
        Object.keys(value).forEach(function (groupId) {
            groupId = String(groupId || "");
            if (!groupId || allowedGroupIds.indexOf(groupId) < 0) return;
            result[groupId] = normalizeLevelList(value[groupId]);
        });
        return result;
    }

    function configuredLevels(targetGroupId) {
        var config = context.settings.read().modules.moverequests || {};
        var levels = config.targetGroupApprovalLevels || {};
        if (!Object.prototype.hasOwnProperty.call(levels, targetGroupId)) return [1];
        return normalizeLevelList(levels[targetGroupId]);
    }

    function moveNode(payload, request) {
        return context.device.moveToGroup(
            request.requester,
            payload.nodeId,
            payload.targetGroupId
        ).then(function () {
            return {
                message: "Device moved.",
                nodeId: payload.nodeId,
                targetGroupId: payload.targetGroupId
            };
        });
    }

    var provider = {
        type: "moverequests",
        moduleKey: "moverequests",
        title: "Move Requests",
        tabTitle: "Move Requests",
        description: "Device move requests and approval-aware group changes.",
        columns: ["createdAt", "title", "requester", "status"],
        normalizePayload: function (payload) {
            payload = payload || {};
            return {
                nodeId: shared.cleanText(payload.nodeId, 300),
                nodeName: shared.cleanText(payload.nodeName, 300),
                sourceGroupId: shared.cleanText(payload.sourceGroupId, 300),
                sourceGroupName: shared.cleanText(payload.sourceGroupName, 300),
                targetGroupId: shared.cleanText(payload.targetGroupId, 300),
                targetGroupName: shared.cleanText(payload.targetGroupName, 300)
            };
        },
        getTitle: function (payload) {
            return "Move " + (payload.nodeName || payload.nodeId || "device");
        },
        getSummary: function (payload) {
            return (payload.sourceGroupName || payload.sourceGroupId || "Current group") +
                " → " +
                (payload.targetGroupName || payload.targetGroupId);
        },
        getApprovalLevels: function (payload) {
            return configuredLevels(String(payload && payload.targetGroupId || ""));
        },
        canSubmit: function (user) {
            return !!user;
        },
        getResources: function (user, query) {
            return Promise.resolve(context.device.visibleNodes(user)).then(function (value) {
                var nodeId = String(query && query.nodeId || "");
                var nodes = value && value.nodes || [];
                return {
                    nodes: nodeId ? nodes.filter(function (node) { return String(node._id || node.nodeid || node.id || "") === nodeId; }) : nodes,
                    groups: value && value.groups || []
                };
            });
        },
        execute: moveNode
    };

    return {
        key: "moverequests",
        clientConfig: function () {
            var value = context.settings.read().modules.moverequests || {};
            return {
                key: "moverequests",
                name: "Move Requests",
                script: "moverequests.js",
                showInMenu: false,
                hostButtonEnabled: value.hostButtonEnabled !== false,
                toolbar: {
                    refresh: true,
                    clear: true,
                    favorites: false,
                    search: true,
                    manage: false,
                    settings: false
                }
            };
        },
        getAccess: access,
        initialize: function () {
            if (!unregister) unregister = context.approval.registerProvider(provider);
            return Promise.resolve();
        },
        apiGet: function (asset, req, user) {
            if (!user) throw new Error("Permission denied.");
            if (asset === "groups") {
                return groupRows(user).then(function (groups) { return { ok: true, groups: groups }; });
            }
            if (asset === "requests") {
                var q = Object.assign({}, req && req.query || {}, {
                    type: "moverequests"
                });
                return context.approval.list(user, q).then(function (value) {
                    value.ok = true;
                    return value;
                });
            }
            if (asset === "settings") {
                if (!shared.isSiteAdmin(user)) throw new Error("Permission denied.");
                var current = context.settings.read().modules.moverequests || {};
                return groupRows(user).then(function (groups) {
                    return { ok: true, settings: current, groups: groups };
                });
            }
            throw new Error("Unknown Move Requests action.");
        },
        apiPost: function (asset, req, user) {
            var value = req && req.body || {};
            if (asset === "submit") {
                return context.approval.submit("moverequests", user, value, value.note)
                    .then(function (request) {
                        return { ok: true, request: request };
                    });
            }
            if (asset === "settings") {
                if (!shared.isSiteAdmin(user)) throw new Error("Permission denied.");
                return groupRows(user).then(function (groups) {
                    var allowedGroups = groups.map(function (group) { return group.id; });
                    return context.settings.update(function (current) {
                        current.modules.moverequests.hostButtonEnabled = value.hostButtonEnabled !== false;
                        current.modules.moverequests.menuEnabled = false;
                        if (Object.prototype.hasOwnProperty.call(value, "targetGroupApprovalLevels")) {
                            current.modules.moverequests.targetGroupApprovalLevels = normalizeGroupApprovalLevels(
                                value.targetGroupApprovalLevels,
                                allowedGroups
                            );
                        }
                        return current;
                    });
                }).then(function () { return { ok: true }; });
            }
            throw new Error("Unknown Move Requests action.");
        }
    };
};
