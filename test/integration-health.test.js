"use strict";

var assert = require("assert");
var factory = require("../server/core/integration-service.js");

var state = { integrations: {} };
var secretState = {};
var service = factory.createIntegrationService({
    parent: {},
    settings: {
        read: function () { return state; },
        update: function (callback) { state = callback(state); return Promise.resolve(state); }
    },
    secrets: {
        get: function () { return secretState; },
        set: function (key, value) { secretState = value; }
    }
});

service.save({ siteadmin: 0xFFFFFFFF }, {
    integrations: {
        ad: { health: { status: "ok", messagePl: "bez znaczenia" } },
        entra: { health: { status: "warning", messagePl: "Problemy z hostami", messageEn: "Host retrieval problems" } },
        jira: { health: { status: "invalid", messagePl: "\u0000test" } },
        defender: { health: { status: "critical", messagePl: "Awaria", messageEn: "Failure" } },
        zabbix: { health: { status: "ok" } }
    }
}).then(function () {
    var summary = service.healthSummary();
    assert.strictEqual(summary.status, "critical");
    assert.strictEqual(summary.items.length, 5);
    summary.items.forEach(function (item) {
        assert.strictEqual(item.configured, false);
        assert.strictEqual(item.status, "critical");
        assert.strictEqual(item.messageEn, "The integration is not fully configured.");
    });
    return service.save({ siteadmin: 0xFFFFFFFF }, {
        integrations: {
            ad: { domain: "example.local", login: "svc-ad", health: { status: "ok" } },
            entra: { tenantId: "tenant", clientId: "entra-client", health: { status: "warning", messagePl: "Problemy z hostami", messageEn: "Host retrieval problems" } },
            jira: { url: "https://example.atlassian.net", email: "svc@example.test", projectKey: "OPS", health: { status: "invalid", messagePl: "\u0000test" } },
            defender: { tenantId: "tenant", clientId: "defender-client", health: { status: "critical", messagePl: "Awaria", messageEn: "Failure" } },
            zabbix: { url: "https://zabbix.example.test", username: "svc-zabbix", health: { status: "ok" } }
        },
        secrets: {
            adPassword: "test-ad-password",
            entraClientSecret: "test-entra-secret",
            jiraToken: "test-jira-token",
            defenderClientSecret: "test-defender-secret",
            zabbixPassword: "test-zabbix-password"
        }
    });
}).then(function () {
    var summary = service.healthSummary();
    assert.strictEqual(summary.status, "critical");
    summary.items.forEach(function (item) { assert.strictEqual(item.configured, true); });
    assert.strictEqual(summary.items.find(function (item) { return item.key === "entra"; }).messagePl, "Problemy z hostami");
    assert.strictEqual(summary.items.find(function (item) { return item.key === "jira"; }).status, "ok");
    assert.strictEqual(summary.items.find(function (item) { return item.key === "jira"; }).messagePl, "test");
    var healthy = service.assessManagementPlane(
        { value: [{ id: "tenant", displayName: "Test", onPremisesSyncEnabled: false }] },
        { value: [
            {
                displayName: "Require MFA", state: "enabled",
                grantControls: { operator: "OR", builtInControls: ["mfa"] },
                conditions: { clientAppTypes: ["all"] }
            },
            {
                displayName: "Block legacy", state: "enabled",
                grantControls: { operator: "OR", builtInControls: ["block"] },
                conditions: { clientAppTypes: ["exchangeActiveSync", "other"] }
            }
        ] },
        { value: [] },
        ["Require MFA", "Block legacy"]
    );
    assert.strictEqual(healthy.status, "ok");
    assert.strictEqual(healthy.hostType, "Entra");
    var unhealthy = service.assessManagementPlane(
        { value: [{ id: "tenant", displayName: "Hybrid", onPremisesSyncEnabled: true }] },
        { value: [] },
        { value: [{}] },
        ["Corporate MFA"]
    );
    assert.strictEqual(unhealthy.status, "critical");
    assert.strictEqual(unhealthy.hostType, "Hybrid");
    assert.ok(unhealthy.issues.some(function (item) { return item.code === "CA_MFA_MISSING"; }));
    assert.ok(unhealthy.issues.some(function (item) { return item.code === "HYBRID_SYNC_PROTECTION_MISSING"; }));
    assert.strictEqual(unhealthy.issues[0].repairAttempt.attempted, false);
    console.log("Integration health checks passed.");
}).catch(function (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
});
