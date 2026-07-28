"use strict";

var shared = require("./shared.js");
var baseFactory = require("./runtime.js");
var portalFactory = require("../modules/portal/index.js");
var VERSION = require("../../config.json").version;

var VIEW_DEFAULTS = {
    overview: { enabled: true, personalized: false, label: "", accent: "#4d6bd8", accessGroupIds: [] },
    devices: { enabled: true, personalized: false, label: "", accent: "#55b8ff", accessGroupIds: [] },
    approvals: { enabled: true, personalized: false, label: "", accent: "#35d7a4", accessGroupIds: [] },
    automation: { enabled: true, personalized: false, label: "", accent: "#ffae00", accessGroupIds: [] },
    monitoring: { enabled: true, personalized: false, label: "", accent: "#34d1e7", accessGroupIds: [] },
    assets: { enabled: true, personalized: false, label: "", accent: "#9a7cff", accessGroupIds: [] },
    management: { enabled: true, personalized: false, label: "", accent: "#ff5f7d", accessGroupIds: [] },
    reports: { enabled: true, personalized: false, label: "", accent: "#7f85ff", accessGroupIds: [] },
    security: { enabled: true, personalized: false, label: "", accent: "#ff385d", accessGroupIds: [] },
    settings: { enabled: true, personalized: false, label: "", accent: "#94a3b8", accessGroupIds: [] }
};

var BANNER_DEFAULTS = {
    enabled: false,
    showOnPortal: true,
    showOnLogin: false,
    activeTemplate: "success",
    templates: {
        success: { name: "Aktualizacja", text: "System został pomyślnie zaktualizowany.", backgroundColor: "#dcfce7", textColor: "#166534", fontSize: 16, durationMinutes: 60, noEnd: false },
        warning: { name: "Ostrzeżenie", text: "W systemie występują drobne problemy. Trwają prace nad ich usunięciem.", backgroundColor: "#fef3c7", textColor: "#92400e", fontSize: 16, durationMinutes: 60, noEnd: false },
        critical: { name: "Awaria", text: "Część funkcji systemu jest obecnie niedostępna.", backgroundColor: "#fee2e2", textColor: "#991b1b", fontSize: 16, durationMinutes: 60, noEnd: true }
    }
};

var PORTAL_DEFAULTS = {
    enabled: true,
    defaultView: "overview",
    forceNewLogin: false,
    showPasswordReset: true,
    passwordResetUrl: "https://passwordreset.microsoftonline.com/",
    siteName: "SIRK Platform",
    siteIconUrl: "",
    banner: BANNER_DEFAULTS,
    views: VIEW_DEFAULTS
};

module.exports.createRuntime = function (options) {
    var runtime = baseFactory.createRuntime(options);
    var context = runtime.context;
    context.settings.defaults.modules = context.settings.defaults.modules || {};
    context.settings.defaults.modules.portal = shared.copy(PORTAL_DEFAULTS);
    runtime.modules.portal = portalFactory.createModule(context);

    function normalizedTemplate(source, fallback) {
        source = source && typeof source === "object" && !Array.isArray(source) ? source : {};
        return {
            name: String(source.name || fallback.name),
            text: String(source.text != null ? source.text : fallback.text),
            backgroundColor: String(source.backgroundColor || fallback.backgroundColor),
            textColor: String(source.textColor || fallback.textColor),
            fontSize: Math.max(10, Math.min(48, Number(source.fontSize) || fallback.fontSize)),
            durationMinutes: Math.max(1, Math.min(525600, Number(source.durationMinutes) || fallback.durationMinutes)),
            noEnd: source.noEnd === true
        };
    }

    function normalizeBanner(source) {
        source = source && typeof source === "object" && !Array.isArray(source) ? source : {};
        var active = ["success", "warning", "critical"].indexOf(String(source.activeTemplate)) >= 0
            ? String(source.activeTemplate) : BANNER_DEFAULTS.activeTemplate;
        var templates = source.templates && typeof source.templates === "object" ? source.templates : {};
        return {
            enabled: source.enabled === true,
            showOnPortal: source.showOnPortal !== false,
            showOnLogin: source.showOnLogin === true,
            activeTemplate: active,
            templates: {
                success: normalizedTemplate(templates.success, BANNER_DEFAULTS.templates.success),
                warning: normalizedTemplate(templates.warning, BANNER_DEFAULTS.templates.warning),
                critical: normalizedTemplate(templates.critical, BANNER_DEFAULTS.templates.critical)
            }
        };
    }

    function knownGroups() {
        if (context.parent && context.parent.identity && typeof context.parent.identity.groups === "function") {
            return context.parent.identity.groups();
        }
        return shared.getUserGroups(context.parent);
    }

    function normalizeGroupIds(value) {
        var known = knownGroups().map(function (group) { return group.id; });
        return (Array.isArray(value) ? value : []).map(String).filter(function (id, index, list) {
            return known.indexOf(id) >= 0 && list.indexOf(id) === index;
        });
    }

    function hasGroupAccess(user, groupIds) {
        if (shared.isSiteAdmin(user)) return true;
        groupIds = Array.isArray(groupIds) ? groupIds : [];
        return !groupIds.length || shared.isUserInAnyGroup(user, groupIds);
    }

    function moduleGroupAccess(user, key) {
        var current = context.settings.read();
        var config = current.modules && current.modules[key] || {};
        return hasGroupAccess(user, config.accessGroupIds);
    }

    function applyPortalViewAccess(config, user) {
        config = shared.copy(config || {});
        if (!config.views || typeof config.views !== "object") return config;
        Object.keys(config.views).forEach(function (key) {
            var view = config.views[key] || {};
            if (!hasGroupAccess(user, view.accessGroupIds)) view.enabled = false;
            config.views[key] = view;
        });
        return config;
    }

    function persistPortalExtras(current, portal) {
        current.modules.portal = current.modules.portal || shared.copy(PORTAL_DEFAULTS);
        portal = portal && typeof portal === "object" && !Array.isArray(portal) ? portal : {};

        if (Object.prototype.hasOwnProperty.call(portal, "banner")) {
            current.modules.portal.banner = normalizeBanner(portal.banner);
        }

        current.modules.portal.views = current.modules.portal.views || {};
        if (portal.views && typeof portal.views === "object" && !Array.isArray(portal.views)) {
            Object.keys(portal.views).forEach(function (key) {
                if (!current.modules.portal.views[key]) return;
                var source = portal.views[key] && typeof portal.views[key] === "object" ? portal.views[key] : {};
                var target = current.modules.portal.views[key];

                if (Object.prototype.hasOwnProperty.call(source, "accessGroupIds")) {
                    target.accessGroupIds = normalizeGroupIds(source.accessGroupIds);
                }

                [
                    "devicesCardAccessGroupIds",
                    "systemStatusCardAccessGroupIds",
                    "integrationsCardAccessGroupIds"
                ].forEach(function (field) {
                    if (Object.prototype.hasOwnProperty.call(source, field)) {
                        target[field] = normalizeGroupIds(source[field]);
                    }
                });

                ["showDevicesCard", "showSystemStatusCard", "showIntegrationsCard", "personalized"].forEach(function (field) {
                    if (Object.prototype.hasOwnProperty.call(source, field)) target[field] = source[field] === true;
                });

                ["label", "accent"].forEach(function (field) {
                    if (Object.prototype.hasOwnProperty.call(source, field)) target[field] = String(source[field] || "");
                });
            });
        }
    }

    var baseSaveAdminSettings = runtime.saveAdminSettings;
    runtime.saveAdminSettings = function (user, payload) {
        payload = payload && typeof payload === "object" ? shared.copy(payload) : {};
        payload.moduleOptions = payload.moduleOptions && typeof payload.moduleOptions === "object" ? payload.moduleOptions : {};
        if (!payload.portal && payload.moduleOptions.portal && typeof payload.moduleOptions.portal === "object") {
            payload.portal = shared.copy(payload.moduleOptions.portal);
        }

        var portal = payload.portal || payload.moduleOptions.portal || {};
        var moduleAccess = {};
        Object.keys(payload.moduleOptions).forEach(function (key) {
            var value = payload.moduleOptions[key];
            if (!value || typeof value !== "object" || Array.isArray(value)) return;
            if (Object.prototype.hasOwnProperty.call(value, "accessGroupIds")) {
                value.accessGroupIds = normalizeGroupIds(value.accessGroupIds);
                moduleAccess[key] = value.accessGroupIds.slice();
            }
        });

        if (portal && portal.views && typeof portal.views === "object") {
            Object.keys(portal.views).forEach(function (key) {
                var view = portal.views[key];
                if (view && typeof view === "object" && Object.prototype.hasOwnProperty.call(view, "accessGroupIds")) {
                    view.accessGroupIds = normalizeGroupIds(view.accessGroupIds);
                }
            });
            payload.portal = portal;
            payload.moduleOptions.portal = shared.copy(portal);
        }

        return baseSaveAdminSettings(user, payload).then(function () {
            return context.settings.update(function (current) {
                Object.keys(moduleAccess).forEach(function (key) {
                    current.modules[key] = current.modules[key] || {};
                    current.modules[key].accessGroupIds = moduleAccess[key].slice();
                });
                persistPortalExtras(current, portal);
                return current;
            });
        }).then(function () {
            return runtime.adminSnapshot(user);
        });
    };

    var baseSnapshot = runtime.adminSnapshot;
    runtime.adminSnapshot = function (user) {
        var value = baseSnapshot(user);
        if (value && value.plugin) {
            value.plugin.name = "SIRK Management Platform";
            value.plugin.shortName = "SIRK-Portal";
            value.plugin.version = VERSION;
            value.userGroups = knownGroups();
        }
        return value;
    };

    runtime.bootstrap = function (user) {
        var result = {};
        Object.keys(runtime.modules).forEach(function (key) {
            var module = runtime.modules[key];
            var access = module.getAccess(user);
            if (!moduleGroupAccess(user, key)) access = Object.assign({}, access || {}, { allowed: false, siteAdmin: false });
            var config = module.clientConfig(user);
            if (key === "portal") config = applyPortalViewAccess(config, user);
            result[key] = {
                enabled: context.settings.isModuleEnabled(key),
                ready: !module.__loadError,
                error: module.__loadError
                    ? (shared.isSiteAdmin(user) ? module.__loadError : "Module failed to load.")
                    : null,
                config: config,
                access: access
            };
        });
        return {
            ok: true,
            version: VERSION,
            user: {
                name: shared.userName(user),
                hasImage: !!(user && user.flags && (user.flags & 1)),
                imageRnd: user && user.accountImageRnd != null ? String(user.accountImageRnd) : ""
            },
            modules: result
        };
    };

    var baseRequest = runtime.request;
    runtime.request = function (method, moduleName, asset, req, res, user) {
        if (moduleName === "_runtime" && method === "GET") {
            shared.sendJson(res, 200, runtime.bootstrap(user));
            return;
        }
        moduleName = String(moduleName || "").toLowerCase();
        if (moduleName && runtime.modules[moduleName] && !moduleGroupAccess(user, moduleName)) {
            shared.sendJson(res, 403, { ok: false, error: "Permission denied." });
            return;
        }
        return baseRequest(method, moduleName, asset, req, res, user);
    };

    runtime.version = VERSION;
    return runtime;
};
