"use strict";

var shared = require("./shared.js");
var http = require("./http-client.js");

function asBoolean(value, fallback) {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    if (/^(true|yes|tak|on)$/i.test(String(value || ""))) return true;
    if (/^(false|no|nie|off)$/i.test(String(value || ""))) return false;
    return fallback;
}

function text(value, limit) {
    return shared.cleanText(value, limit || 1000).trim();
}

function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

var HEALTH_STATES = ["ok", "warning", "critical"];
var HEALTH_NAMES = ["ad", "entra", "jira", "defender", "zabbix"];

function normalizeHealth(value) {
    value = object(value);
    var status = String(value.status || "ok").toLowerCase();
    return {
        status: HEALTH_STATES.indexOf(status) >= 0 ? status : "ok",
        messagePl: text(value.messagePl, 300),
        messageEn: text(value.messageEn, 300)
    };
}

module.exports.createIntegrationService = function (options) {
    var settings = options.settings;
    var secrets = options.secrets;
    var parent = options.parent;
    var secretNamespace = "integration-secrets";
    var entraTokenCache = { token: "", expiresAt: 0 };

    function readSettings() {
        var current = settings.read();
        return shared.copy(current.integrations || {});
    }

    function readSecrets() {
        return secrets.get(secretNamespace);
    }

    function get(name) {
        var publicValue = readSettings()[name] || {};
        var secretValue = readSecrets();
        var result = shared.copy(publicValue);

        if (name === "ad") result.password = secretValue.adPassword || "";
        if (name === "entra") result.clientSecret = secretValue.entraClientSecret || "";
        if (name === "jira") result.token = secretValue.jiraToken || "";
        if (name === "defender") result.clientSecret = secretValue.defenderClientSecret || "";
        if (name === "zabbix") {
            result.password = secretValue.zabbixPassword || "";
            result.token = secretValue.zabbixToken || "";
        }

        return result;
    }

    function configured() {
        var current = readSettings();
        var secretValue = readSecrets();
        return {
            adPassword: !!secretValue.adPassword,
            entraClientSecret: !!secretValue.entraClientSecret,
            jiraToken: !!secretValue.jiraToken,
            defenderClientSecret: !!secretValue.defenderClientSecret,
            zabbixPassword: !!secretValue.zabbixPassword,
            zabbixToken: !!secretValue.zabbixToken,
            ad: !!(
                current.ad && current.ad.domain && current.ad.login && secretValue.adPassword
            ),
            entra: !!(
                current.entra && current.entra.tenantId && current.entra.clientId && secretValue.entraClientSecret
            ),
            jira: !!(
                current.jira && current.jira.url && current.jira.email &&
                current.jira.projectKey && secretValue.jiraToken
            ),
            defender: !!(
                current.defender && current.defender.tenantId &&
                current.defender.clientId && secretValue.defenderClientSecret
            ),
            zabbix: !!(
                current.zabbix && current.zabbix.url &&
                (secretValue.zabbixToken || (current.zabbix.username && secretValue.zabbixPassword))
            )
        };
    }

    function healthSummary() {
        var current = readSettings();
        var readiness = configured();
        var weight = { ok: 0, warning: 1, critical: 2 };
        var status = "ok";
        var items = HEALTH_NAMES.map(function (name) {
            var health = normalizeHealth(object(current[name]).health);
            var isConfigured = readiness[name] === true;
            if (!isConfigured) {
                health = {
                    status: "critical",
                    messagePl: "Integracja nie jest w pełni skonfigurowana.",
                    messageEn: "The integration is not fully configured."
                };
            }
            if (weight[health.status] > weight[status]) status = health.status;
            return {
                key: name,
                configured: isConfigured,
                status: health.status,
                messagePl: health.messagePl,
                messageEn: health.messageEn
            };
        });
        return { status: status, items: items };
    }

    function entraToken() {
        if (entraTokenCache.token && entraTokenCache.expiresAt > Date.now() + 60000) {
            return Promise.resolve(entraTokenCache.token);
        }
        var value = get("entra");
        if (!value.tenantId || !value.clientId || !value.clientSecret) {
            return Promise.reject(new Error("Entra integration is not configured."));
        }
        return http.requestJson({
            method: "POST",
            url: "https://login.microsoftonline.com/" + encodeURIComponent(value.tenantId) + "/oauth2/v2.0/token",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "client_id=" + encodeURIComponent(value.clientId) +
                "&client_secret=" + encodeURIComponent(value.clientSecret) +
                "&scope=" + encodeURIComponent("https://graph.microsoft.com/.default") +
                "&grant_type=client_credentials",
            errorPrefix: "Microsoft identity"
        }).then(function (result) {
            entraTokenCache.token = result.access_token;
            entraTokenCache.expiresAt = Date.now() + Math.max(300, Number(result.expires_in) || 3600) * 1000;
            return entraTokenCache.token;
        });
    }

    function entraGraph(endpoint) {
        return entraToken().then(function (accessToken) {
            return http.requestJson({
                method: "GET",
                url: "https://graph.microsoft.com/v1.0" + endpoint,
                headers: { Authorization: "Bearer " + accessToken },
                errorPrefix: "Microsoft Graph"
            });
        });
    }

    function assessManagementPlane(organization, conditionalAccess, synchronization, requiredNames) {
        var organizationRow = array(organization && organization.value)[0] || {};
        var policies = array(conditionalAccess && conditionalAccess.value);
        var enabled = policies.filter(function (policy) {
            return policy && (policy.state === "enabled" || policy.state === "enabledForReportingButNotEnforced");
        });
        var enforced = enabled.filter(function (policy) { return policy.state === "enabled"; });
        var issues = [];
        var hasMfa = enforced.some(function (policy) {
            return array(policy.grantControls && policy.grantControls.builtInControls).indexOf("mfa") >= 0;
        });
        var hasLegacyBlock = enforced.some(function (policy) {
            var clients = array(policy.conditions && policy.conditions.clientAppTypes);
            return policy.grantControls && policy.grantControls.operator === "OR" &&
                array(policy.grantControls.builtInControls).indexOf("block") >= 0 &&
                (clients.indexOf("exchangeActiveSync") >= 0 || clients.indexOf("other") >= 0);
        });
        var missingRequired = requiredNames.filter(function (name) {
            return !enforced.some(function (policy) {
                return String(policy.displayName || "").toLowerCase() === name.toLowerCase();
            });
        });
        var hybrid = organizationRow.onPremisesSyncEnabled === true;
        var syncRows = array(synchronization && synchronization.value);
        var syncConfigured = !hybrid || syncRows.some(function (item) {
            return item && item.configuration && item.configuration.accidentalDeletionPrevention &&
                item.configuration.accidentalDeletionPrevention.synchronizationPreventionType;
        });

        if (!enforced.length) issues.push({
            code: "CA_NONE_ENFORCED", severity: "critical",
            problem: "No enforced Conditional Access policy was found.",
            remediation: "Create and validate Conditional Access in report-only mode before enforcement.",
            repairAttempt: { attempted: false, safe: false, reason: "Tenant-wide access changes can lock out administrators." }
        });
        if (!hasMfa) issues.push({
            code: "CA_MFA_MISSING", severity: "critical",
            problem: "No enforced Conditional Access policy requiring MFA was found.",
            remediation: "Deploy an MFA policy with emergency access account exclusions.",
            repairAttempt: { attempted: false, safe: false, reason: "Emergency access exclusions require operator review." }
        });
        if (!hasLegacyBlock) issues.push({
            code: "CA_LEGACY_AUTH_NOT_BLOCKED", severity: "warning",
            problem: "No enforced policy blocking legacy authentication was found.",
            remediation: "Validate sign-in impact, then deploy a legacy authentication block policy.",
            repairAttempt: { attempted: false, safe: false, reason: "Legacy application compatibility must be reviewed." }
        });
        missingRequired.forEach(function (name) {
            issues.push({
                code: "CA_REQUIRED_POLICY_MISSING", severity: "warning",
                problem: "Required Conditional Access policy is not enforced: " + name,
                remediation: "Create or enable the named policy after impact analysis.",
                repairAttempt: { attempted: false, safe: false, reason: "Named tenant policy changes require approval." }
            });
        });
        if (!syncConfigured) issues.push({
            code: "HYBRID_SYNC_PROTECTION_MISSING", severity: "critical",
            problem: "Hybrid synchronization protection is not configured.",
            remediation: "Configure accidental deletion prevention and verify synchronization health.",
            repairAttempt: { attempted: false, safe: false, reason: "Directory synchronization changes require AD and Entra approval." }
        });
        return {
            checkedAtUtc: new Date().toISOString(),
            hostType: hybrid ? "Hybrid" : "Entra",
            tenant: {
                id: String(organizationRow.id || ""),
                displayName: String(organizationRow.displayName || ""),
                onPremisesSyncEnabled: hybrid
            },
            conditionalAccess: {
                total: policies.length,
                enabled: enabled.length,
                enforced: enforced.length,
                mfaEnforced: hasMfa,
                legacyAuthenticationBlocked: hasLegacyBlock,
                missingRequiredPolicies: missingRequired
            },
            synchronization: { configured: syncConfigured, connectors: syncRows.length },
            status: issues.some(function (issue) { return issue.severity === "critical"; })
                ? "critical" : issues.length ? "warning" : "ok",
            issues: issues
        };
    }

    function managementPlaneHealth() {
        if (!configured().entra) {
            return Promise.resolve({
                checkedAtUtc: new Date().toISOString(),
                hostType: "Unknown",
                status: "critical",
                issues: [{
                    code: "ENTRA_NOT_CONFIGURED",
                    severity: "critical",
                    problem: "Entra integration is not configured.",
                    remediation: "Configure tenant ID, client ID and the protected client secret.",
                    repairAttempt: { attempted: false, safe: false, reason: "Credentials are required." }
                }]
            });
        }
        var requiredNames = array(get("entra").requiredConditionalAccessPolicies)
            .map(function (value) { return text(value, 300); }).filter(Boolean).slice(0, 100);
        return Promise.all([
            entraGraph("/organization?$select=id,displayName,onPremisesSyncEnabled"),
            entraGraph("/identity/conditionalAccess/policies")
        ]).then(function (results) {
            var organization = array(results[0] && results[0].value)[0] || {};
            if (organization.onPremisesSyncEnabled !== true) {
                return assessManagementPlane(results[0], results[1], { value: [] }, requiredNames);
            }
            return entraGraph("/directory/onPremisesSynchronization").then(function (synchronization) {
                return assessManagementPlane(results[0], results[1], synchronization, requiredNames);
            });
        });
    }

    function publicSettings(user) {
        if (!shared.isSiteAdmin(user)) return null;
        return {
            groups: shared.getUserGroups(parent),
            values: readSettings(),
            configured: configured()
        };
    }

    function normalizeGroups(value, knownGroups) {
        return array(value).map(String).filter(function (id, index, list) {
            return knownGroups.indexOf(id) >= 0 && list.indexOf(id) === index;
        });
    }

    function normalizePublic(payload, knownGroups) {
        payload = object(payload);
        var result = {};
        var ad = object(payload.ad);
        var entra = object(payload.entra);
        var jira = object(payload.jira);
        var defender = object(payload.defender);
        var zabbix = object(payload.zabbix);

        result.ad = {
            domain: text(ad.domain, 300),
            login: text(ad.login, 500),
            health: normalizeHealth(ad.health)
        };
        result.entra = {
            tenantId: text(entra.tenantId, 200),
            clientId: text(entra.clientId, 200),
            requiredConditionalAccessPolicies: array(entra.requiredConditionalAccessPolicies)
                .map(function (value) { return text(value, 300); }).filter(Boolean).slice(0, 100),
            health: normalizeHealth(entra.health)
        };
        result.jira = {
            url: text(jira.url, 1000).replace(/\/+$/, ""),
            email: text(jira.email, 500),
            projectKey: text(jira.projectKey, 100),
            assetFieldId: text(jira.assetFieldId, 100),
            hostnameAttribute: text(jira.hostnameAttribute, 200) || "Hostname",
            workspaceId: text(jira.workspaceId, 200),
            cloudId: text(jira.cloudId, 200),
            aql: text(jira.aql, 4000) || "objectType = Computer",
            maxResults: Math.max(10, Math.min(500, Number(jira.maxResults) || 100)),
            verifyTls: asBoolean(jira.verifyTls, true),
            cmdbEnabled: asBoolean(jira.cmdbEnabled, true),
            approvalTransitionId: text(jira.approvalTransitionId, 100),
            closeTransitionId: text(jira.closeTransitionId, 100),
            health: normalizeHealth(jira.health)
        };
        result.defender = {
            tenantId: text(defender.tenantId, 200),
            clientId: text(defender.clientId, 200),
            incidentMode: ["active", "all"].indexOf(String(defender.incidentMode || "").toLowerCase()) >= 0 ? String(defender.incidentMode).toLowerCase() : "active",
            timeRange: ["none", "7d", "30d", "90d", "180d", "365d", "month", "year", "custom"].indexOf(String(defender.timeRange || "").toLowerCase()) >= 0 ? String(defender.timeRange).toLowerCase() : "30d",
            dateField: ["lastUpdateDateTime", "createdDateTime"].indexOf(String(defender.dateField || "")) >= 0 ? String(defender.dateField) : "lastUpdateDateTime",
            customFromUtc: text(defender.customFromUtc, 100),
            customToUtc: text(defender.customToUtc, 100),
            showIncidentId: text(defender.showIncidentId, 100),
            nameContains: text(defender.nameContains, 500),
            mdcaApiBaseUrl: text(defender.mdcaApiBaseUrl, 1000) || "https://portal.cloudappsecurity.com/cas/api",
            permissions: {
                incidents: normalizeGroups(object(defender.permissions).incidents, knownGroups),
                email: normalizeGroups(object(defender.permissions).email, knownGroups),
                trusted: normalizeGroups(object(defender.permissions).trusted, knownGroups),
                hunting: normalizeGroups(object(defender.permissions).hunting, knownGroups)
            },
            health: normalizeHealth(defender.health)
        };
        result.zabbix = {
            url: text(zabbix.url, 1000).replace(/\/+$/, ""),
            username: text(zabbix.username, 500),
            verifyTls: asBoolean(zabbix.verifyTls, true),
            health: normalizeHealth(zabbix.health)
        };

        if (result.jira.url && !/^https:\/\//i.test(result.jira.url)) {
            throw new Error("Jira URL must use HTTPS.");
        }
        if (result.zabbix.url && !/^https?:\/\//i.test(result.zabbix.url)) {
            throw new Error("Zabbix URL must use HTTP or HTTPS.");
        }
        return result;
    }

    function save(user, payload) {
        if (!shared.isSiteAdmin(user)) {
            return Promise.reject(new Error("Only Site Admin can change integrations."));
        }

        payload = object(payload);
        var knownGroups = shared.getUserGroups(parent).map(function (group) { return group.id; });
        var normalized = normalizePublic(payload.integrations, knownGroups);
        var secretInput = object(payload.secrets);

        return settings.update(function (current) {
            current.integrations = normalized;
            return current;
        }).then(function () {
            var currentSecrets = readSecrets();
            [
                "adPassword",
                "entraClientSecret",
                "jiraToken",
                "defenderClientSecret",
                "zabbixPassword",
                "zabbixToken"
            ].forEach(function (key) {
                var value = text(secretInput[key], 20000);
                if (value) currentSecrets[key] = value;
            });
            secrets.set(secretNamespace, currentSecrets);
            return publicSettings(user);
        });
    }

    function importValues(publicValues, secretValues) {
        publicValues = object(publicValues);
        secretValues = object(secretValues);
        return settings.update(function (current) {
            function mergeMissing(target, incoming) {
                target = target && typeof target === "object" && !Array.isArray(target) ? target : {};
                incoming = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
                Object.keys(incoming).forEach(function (key) {
                    var existing = target[key];
                    var value = incoming[key];
                    if (value && typeof value === "object" && !Array.isArray(value)) {
                        target[key] = mergeMissing(existing, value);
                        return;
                    }
                    var empty = existing == null || existing === "" ||
                        (Array.isArray(existing) && existing.length === 0);
                    if (empty && value != null && value !== "") {
                        target[key] = shared.copy(value);
                    }
                });
                return target;
            }
            current.integrations = mergeMissing(current.integrations || {}, publicValues);
            return current;
        }).then(function () {
            var currentSecrets = readSecrets();
            Object.keys(secretValues).forEach(function (key) {
                if (!currentSecrets[key] && secretValues[key]) {
                    currentSecrets[key] = String(secretValues[key]);
                }
            });
            secrets.set(secretNamespace, currentSecrets);
            return true;
        });
    }

    return {
        configured: configured,
        get: get,
        healthSummary: healthSummary,
        managementPlaneHealth: managementPlaneHealth,
        assessManagementPlane: assessManagementPlane,
        importValues: importValues,
        publicSettings: publicSettings,
        readSettings: readSettings,
        save: save
    };
};
