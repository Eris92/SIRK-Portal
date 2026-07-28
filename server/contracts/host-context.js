"use strict";

function normalizeUser(user) {
    user = user || {};
    return {
        id: String(user.id || user._id || ""),
        displayName: String(user.displayName || user.realname || user.name || user._id || "unknown"),
        tenantId: String(user.tenantId || user.domain || ""),
        roles: Array.isArray(user.roles) ? user.roles.map(String) : [],
        groups: Array.isArray(user.groups) ? user.groups.map(String) : [],
        csrfToken: String(user.csrfToken || ""),
        isAdmin: user.isAdmin === true || user.siteadmin === true || Number(user.siteadmin) === 0xFFFFFFFF || (Number(user.siteadmin) | 0) === -1,
        raw: user.raw || user
    };
}

function createHostContext(options) {
    options = options || {};
    ["dataRoot", "auth", "devices", "sessions"].forEach(function (key) {
        if (!options[key]) throw new Error("HostContext requires " + key + ".");
    });
    var context = {
        kind: String(options.kind || "standalone"),
        dataRoot: options.dataRoot,
        fs: options.fs || require("fs"),
        path: options.path || require("path"),
        logger: options.logger || console,
        auth: options.auth,
        devices: options.devices,
        sessions: options.sessions,
        events: options.events || { publish: function () { return false; } },
        capabilities: Object.assign({ devices: true, desktop: false, terminal: false, files: false, nativeUi: false, extensions: true }, options.capabilities || {}),
        legacyParent: options.legacyParent || null
    };
    context.currentUser = function (req) { return Promise.resolve(context.auth.currentUser(req)).then(normalizeUser); };
    context.normalizeUser = normalizeUser;
    return context;
}

module.exports = { createHostContext: createHostContext, normalizeUser: normalizeUser };
