"use strict";

// Stable boundary for the independent Portal application. Feature modules
// depend only on these host-neutral ports.
var PORTS = {
    identity: ["currentUser", "login", "logout"],
    devices: ["list", "resolve"],
    agent: ["desktop", "terminal", "files", "software", "registry", "amt"],
    permissions: ["can"]
};

function assertPort(name, provider) {
    var methods = PORTS[name];
    if (!methods) throw new Error("Unknown Portal provider: " + name);
    if (!provider || typeof provider !== "object") throw new Error("Portal provider is required: " + name);
    methods.forEach(function (method) {
        if (typeof provider[method] !== "function") throw new Error("Portal provider " + name + " is missing " + method + "().");
    });
    return provider;
}

function createPorts(options) {
    options = options || {};
    return {
        identity: assertPort("identity", options.identity),
        devices: assertPort("devices", options.devices),
        agent: assertPort("agent", options.agent),
        permissions: assertPort("permissions", options.permissions)
    };
}

module.exports = { PORTS: PORTS, assertPort: assertPort, createPorts: createPorts };
