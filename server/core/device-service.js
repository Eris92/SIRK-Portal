"use strict";

var shared = require("./shared.js");

module.exports.createDeviceService = function (options) {
    var parent = options.parent || {};
    var provider = parent.devices;

    function requireProvider(method) {
        if (!provider || typeof provider[method] !== "function") {
            throw new Error("SIRK Agent device provider does not support " + method + ".");
        }
        return provider[method];
    }

    function visibleNodes(user) {
        return Promise.resolve(requireProvider("list").call(provider, user)).then(function (value) {
            value = value || {};
            return {
                groups: Array.isArray(value.groups) ? value.groups : [],
                nodes: Array.isArray(value.nodes) ? value.nodes : []
            };
        });
    }

    function visibleGroups(user) {
        return visibleNodes(user).then(function (value) { return value.groups; });
    }

    function resolveNode(user, nodeId) {
        nodeId = String(nodeId || "");
        if (!nodeId) return Promise.reject(new Error("Device identifier is required."));
        if (provider && typeof provider.resolve === "function") {
            return Promise.resolve(provider.resolve(user, nodeId));
        }
        return visibleNodes(user).then(function (value) {
            var node = value.nodes.find(function (item) { return String(item.id || "") === nodeId; });
            if (!node) throw new Error("Device not found or access denied.");
            return { node: node, nodeId: nodeId };
        });
    }

    function sendRunCommands(context, command, responseId, sessionId) {
        return Promise.resolve(requireProvider("runCommand").call(provider, {
            nodeId: context.nodeId,
            command: command,
            responseId: responseId,
            sessionId: sessionId
        }));
    }

    function moveToGroup(user, nodeId, groupId) {
        if (!provider || typeof provider.moveToGroup !== "function") {
            return Promise.reject(new Error("Device group assignment is unavailable."));
        }
        return Promise.resolve(provider.moveToGroup(user, String(nodeId || ""), String(groupId || "")));
    }

    function auditCommand(context, user, command) {
        var logger = parent.logger || console;
        if (logger && typeof logger.info === "function") {
            logger.info("SIRK command requested", {
                nodeId: context.nodeId,
                user: shared.userName(user),
                command: String(command && command.label || "command")
            });
        }
    }

    return {
        auditCommand: auditCommand,
        moveToGroup: moveToGroup,
        resolveNode: resolveNode,
        sendRunCommands: sendRunCommands,
        visibleGroups: visibleGroups,
        visibleNodes: visibleNodes
    };
};
