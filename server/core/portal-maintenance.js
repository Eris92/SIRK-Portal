"use strict";

var os = require("os");

function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (character) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character];
    });
}

function normalizeIp(value) {
    value = String(value || "").split(",")[0].trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
    return value === "::1" ? "127.0.0.1" : value.split("%")[0];
}

function append(list, value) {
    String(value || "").split(",").forEach(function (item) {
        item = normalizeIp(item);
        if (item && list.indexOf(item) < 0) list.push(item);
    });
}

function requestIps(req) {
    var list = [], headers = req && req.headers || {};
    append(list, headers["cf-connecting-ip"]);
    append(list, headers["x-real-ip"]);
    append(list, headers["x-forwarded-for"]);
    append(list, req && req.ip);
    append(list, req && req.socket && req.socket.remoteAddress);
    return list;
}

function localIps() {
    var list = ["127.0.0.1"];
    try {
        var networks = os.networkInterfaces();
        Object.keys(networks || {}).forEach(function (name) {
            (networks[name] || []).forEach(function (item) { append(list, item && item.address); });
        });
    } catch (error) {}
    return list;
}

function ipv4(value) {
    var parts = String(value || "").split("."), result = 0;
    if (parts.length !== 4) return null;
    for (var index = 0; index < 4; index += 1) {
        var item = Number(parts[index]);
        if (!Number.isInteger(item) || item < 0 || item > 255) return null;
        result = result * 256 + item;
    }
    return result >>> 0;
}

function matches(address, rule) {
    if (rule === "*") return true;
    if (rule.indexOf("/") < 0) return address === normalizeIp(rule);
    var parts = rule.split("/"), actual = ipv4(address), network = ipv4(parts[0]), bits = Number(parts[1]);
    if (actual == null || network == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    var mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (actual & mask) === (network & mask);
}

function allowed(address, rules, serverAddresses) {
    var values = Array.isArray(rules) ? rules : [];
    if (values.some(function (rule) { return String(rule).toLowerCase() === "localhost"; }) &&
            (serverAddresses || localIps()).some(function (value) { return normalizeIp(value) === normalizeIp(address); })) {
        return true;
    }
    return values.map(String).some(function (rule) {
        rule = rule.trim();
        return rule && rule.toLowerCase() !== "localhost" && matches(normalizeIp(address), rule);
    });
}

function requestAllowed(req, rules, serverAddresses) {
    return requestIps(req).some(function (address) { return allowed(address, rules, serverAddresses); });
}

function normalize(config) {
    config = config && typeof config === "object" && !Array.isArray(config) ? config : {};
    return {
        enabled: config.enabled === true,
        title: String(config.title || "Przerwa serwisowa"),
        text: String(config.text || "System jest chwilowo niedostępny z powodu zaplanowanych prac serwisowych."),
        backgroundColor: String(config.backgroundColor || "#0f172a"),
        textColor: String(config.textColor || "#ffffff"),
        estimatedEnd: String(config.estimatedEnd || ""),
        allowedIps: Array.isArray(config.allowedIps) ? config.allowedIps.map(String).filter(Boolean) : [],
        showNoticeToAllowed: config.showNoticeToAllowed !== false
    };
}

function status(config, req) {
    var current = normalize(config), addresses = requestIps(req);
    return {
        active: current.enabled,
        allowed: !current.enabled || requestAllowed(req, current.allowedIps),
        ip: addresses[0] || "",
        ips: addresses,
        showNoticeToAllowed: current.showNoticeToAllowed,
        title: current.title,
        text: current.text,
        backgroundColor: current.backgroundColor,
        textColor: current.textColor,
        estimatedEnd: current.estimatedEnd
    };
}

function page(config) {
    config = normalize(config);
    var end = config.estimatedEnd
        ? '<p class="end">Planowane zakończenie: <strong>' + escapeHtml(config.estimatedEnd) + "</strong></p>"
        : "";
    return '<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        "<title>" + escapeHtml(config.title) + "</title><style>html,body{min-height:100%;margin:0}" +
        "body{display:grid;place-items:center;padding:24px;background:" + escapeHtml(config.backgroundColor) +
        ";color:" + escapeHtml(config.textColor) + ";font:16px/1.55 Segoe UI,Arial}.card{width:min(720px,100%);" +
        "padding:36px;border:1px solid currentColor;border-radius:18px;background:#ffffff12;box-sizing:border-box}" +
        "h1{font-size:clamp(28px,5vw,44px)}.end{margin-top:22px;padding-top:18px;border-top:1px solid}</style>" +
        '<main class="card"><h1>' + escapeHtml(config.title) + "</h1><p>" + escapeHtml(config.text) + "</p>" + end + "</main></html>";
}

module.exports = {
    allowed: allowed,
    localIps: localIps,
    normalize: normalize,
    page: page,
    requestAllowed: requestAllowed,
    requestIps: requestIps,
    status: status
};
