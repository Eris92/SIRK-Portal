"use strict";

var fs = require("fs");
var path = require("path");
var shared = require("../../core/shared.js");
var folderAccess = require("../../core/folder-access.js");

var VENDOR_VERSION = "0.3.17";
var BUNDLED_FILES = ["sirk-portal.css"];
var VIEW_KEYS = ["overview", "devices", "approvals", "automation", "monitoring", "assets", "management", "reports", "security", "settings"];

function cleanLabel(value) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40);
}

function cleanAccent(value, fallback) {
    value = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function updateViews(current, input, knownGroups) {
    current = current && typeof current === "object" ? current : {};
    input = input && typeof input === "object" ? input : {};
    knownGroups = Array.isArray(knownGroups) ? knownGroups.map(String) : [];
    var enabledCount = 0;
    VIEW_KEYS.forEach(function (key) {
        var previous = current[key] && typeof current[key] === "object" ? current[key] : {};
        var next = input[key] && typeof input[key] === "object" ? input[key] : {};
        current[key] = {
            enabled: typeof next.enabled === "boolean" ? next.enabled : previous.enabled !== false,
            allowAll: typeof next.allowAll === "boolean" ? next.allowAll : previous.allowAll === true,
            personalized: typeof next.personalized === "boolean" ? next.personalized : previous.personalized === true,
            label: Object.prototype.hasOwnProperty.call(next, "label") ? cleanLabel(next.label) : cleanLabel(previous.label),
            accent: cleanAccent(next.accent, cleanAccent(previous.accent, "#4d6bd8")),
            groupIds: (Array.isArray(next.groupIds) ? next.groupIds : Array.isArray(previous.groupIds) ? previous.groupIds : []).map(String).filter(function (id, index, all) {
                return knownGroups.indexOf(id) >= 0 && all.indexOf(id) === index;
            })
        };
        if (current[key].enabled) enabledCount += 1;
    });
    if (!enabledCount) current.overview.enabled = true;
    return current;
}

module.exports.createModule = function (context) {
    var vendorState = {
        version: VENDOR_VERSION,
        ready: false,
        directory: "",
        missing: [],
        error: "",
        earlyOverlay: false,
        customFilesDomains: []
    };

    function settings() {
        return context.settings.read().modules.portal || {};
    }

    function allowed(user) {
        return !!user;
    }

    function viewAllowed(user, key) {
        return folderAccess.canAccess(user, settings().views || {}, key);
    }

    function visibleViews(user) {
        var source = settings().views || {};
        var result = {};
        VIEW_KEYS.forEach(function (key) {
            var view = source[key] && typeof source[key] === "object" ? source[key] : {};
            result[key] = {
                enabled: viewAllowed(user, key),
                personalized: view.personalized === true,
                label: cleanLabel(view.label),
                accent: cleanAccent(view.accent, "#4d6bd8")
            };
        });
        return result;
    }

    function requireView(user, key) {
        if (!viewAllowed(user, key)) throw new Error("Portal view access denied.");
    }

    function requireAdmin(user) {
        if (!shared.isSiteAdmin(user)) throw new Error("Permission denied.");
    }

    function vendorDirectory() {
        return path.join(context.pluginRoot, "public", "portal", "vendor");
    }

    function validBundledFile(filePath) {
        try {
            return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 32;
        } catch (error) {
            return false;
        }
    }

    function validateBundledAssets() {
        vendorState.directory = vendorDirectory();
        vendorState.missing = BUNDLED_FILES.filter(function (name) {
            return !validBundledFile(path.join(vendorState.directory, name));
        });
        vendorState.ready = vendorState.missing.length === 0;
        vendorState.error = vendorState.ready
            ? ""
            : "Missing bundled SirK Portal assets: " + vendorState.missing.join(", ");
        vendorState.earlyOverlay = false;
        vendorState.customFilesDomains = [];
        if (!vendorState.ready) return Promise.reject(new Error(vendorState.error));
        return Promise.resolve(vendorState);
    }

    return {
        key: "portal",
        canAccessView: viewAllowed,
        clientConfig: function (user) {
            var value = settings();
            var views = visibleViews(user);
            var defaultView = String(value.defaultView || "overview");
            if (!views[defaultView] || views[defaultView].enabled !== true) {
                defaultView = VIEW_KEYS.find(function (key) { return views[key].enabled === true; }) || "overview";
            }
            return {
                key: "portal",
                name: "SirK Portal",
                menuTitle: "SirK Portal",
                script: "",
                style: "",
                showInMenu: false,
                defaultView: defaultView,
                views: views,
                showLauncher: value.showLauncher === true,
                forceNewLogin: value.forceNewLogin === true,
                forcePortalInterface: value.forcePortalInterface === true,
                vendorVersion: VENDOR_VERSION,
                vendorReady: vendorState.ready,
                earlyOverlay: false
            };
        },
        getAccess: function (user) {
            return {
                allowed: allowed(user) && VIEW_KEYS.some(function (key) { return viewAllowed(user, key); }),
                siteAdmin: shared.isSiteAdmin(user)
            };
        },
        initialize: validateBundledAssets,
        apiGet: function (asset, req, user) {
            if (!allowed(user)) throw new Error("Permission denied.");
            if (asset === "overview") {
                requireView(user, "overview");
                return context.approval.list(user, { status: "pending", page: 1, perPage: 10 }).then(function (requests) {
                    return {
                        ok: true,
                        pendingApprovals: Number(requests && requests.total) || 0,
                        integrations: context.integrations.healthSummary()
                    };
                });
            }
            if (asset === "devices") {
                requireView(user, "devices");
                if (!context.parent.devices || typeof context.parent.devices.list !== "function") {
                    throw new Error("Device inventory is unavailable.");
                }
                return Promise.resolve(context.parent.devices.list(user)).then(function (value) {
                    return {
                        ok: true,
                        nodes: value && value.nodes || [],
                        groups: value && value.groups || []
                    };
                });
            }
            if (asset === "settings") requireAdmin(user);
            if (asset === "status" || asset === "settings") {
                return {
                    ok: true,
                    module: asset === "settings" ? settings() : this.clientConfig(user),
                    siteAdmin: shared.isSiteAdmin(user),
                    vendor: vendorState
                };
            }
            throw new Error("Unknown Portal action.");
        },
        apiPost: function (asset, req, user) {
            requireAdmin(user);
            var value = req && req.body || {};
            if (asset !== "settings") throw new Error("Unknown Portal action.");
            return context.settings.update(function (current) {
                current.modules.portal = current.modules.portal || {};
                if (typeof value.enabled === "boolean") current.modules.portal.enabled = value.enabled;
                current.modules.portal.defaultView = VIEW_KEYS.indexOf(String(value.defaultView || "")) >= 0
                    ? String(value.defaultView)
                    : "overview";
                current.modules.portal.showLauncher = value.showLauncher === true;
                if (typeof value.forceNewLogin === "boolean") current.modules.portal.forceNewLogin = value.forceNewLogin;
                if (typeof value.forcePortalInterface === "boolean") current.modules.portal.forcePortalInterface = value.forcePortalInterface;
                if (current.modules.portal.forceNewLogin === true || current.modules.portal.forcePortalInterface === true) {
                    current.modules.portal.enabled = true;
                }
                var knownGroups = context.parent.identity && typeof context.parent.identity.groups === "function"
                    ? context.parent.identity.groups()
                    : [];
                current.modules.portal.views = updateViews(current.modules.portal.views, value.views, knownGroups.map(function (group) { return group.id; }));
                if (current.modules.portal.views[current.modules.portal.defaultView].enabled === false) {
                    current.modules.portal.defaultView = VIEW_KEYS.find(function (key) {
                        return current.modules.portal.views[key].enabled !== false;
                    }) || "overview";
                }
                return current;
            }).then(function () {
                var moduleSettings = settings();
                return {
                    ok: true,
                    module: moduleSettings,
                    reloadRequired: true,
                    serviceRestartRequired: false,
                    vendor: vendorState
                };
            });
        }
    };
};
