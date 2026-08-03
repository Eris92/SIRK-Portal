(function () {
    "use strict";

    var form = document.getElementById("sirkLoginForm");
    var error = document.getElementById("sirkLoginError");
    var button = form && form.querySelector('button[type="submit"]');

    function showError(message) {
        error.textContent = String(message || "Logowanie nie powiodło się.");
        error.hidden = false;
    }

    function parse(response) {
        return response.json().catch(function () { return {}; }).then(function (value) {
            if (!response.ok || value.ok === false) throw new Error(value.error || ("HTTP " + response.status));
            return value;
        });
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        error.hidden = true;
        button.disabled = true;
        var values = new FormData(form);
        var payload = {
            userName: String(values.get("username") || ""),
            password: String(values.get("password") || ""),
            accessCode: String(values.get("accessCode") || "")
        };
        fetch("/api/v1/auth/login", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "Content-Type": "application/json; charset=UTF-8",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload)
        }).then(parse).then(function () {
            form.elements.password.value = "";
            form.elements.accessCode.value = "";
            var target = new URL(window.__SIRK_PLATFORM_LOGIN_PORTAL_URL__ || "/", window.location.href);
            var requested = new URL(window.location.href).searchParams.get("return");
            if (requested && /^#[a-z0-9_-]+$/i.test(requested)) target.hash = requested;
            window.location.replace(target.href);
        }).catch(function (failure) {
            form.elements.password.value = "";
            form.elements.accessCode.value = "";
            showError(failure.message);
            button.disabled = false;
        });
    });

    var assetBase = String(window.__SIRK_PLATFORM_LOGIN_ASSET_BASE__ || "").replace(/\/$/, "");
    if (assetBase) {
        fetch(assetBase + "/portal-branding.json?v=" + encodeURIComponent(window.__SIRK_PLATFORM_PORTAL_VERSION__ || "1"),
            { credentials: "same-origin", cache: "no-store" })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (config) {
                var banner = config && config.banner;
                var template = banner && banner.templates && banner.templates[banner.activeTemplate];
                if (!banner || banner.enabled !== true || banner.showOnLogin !== true || !template) return;
                var node = document.createElement("div");
                node.className = "sirk-login-public-banner";
                node.textContent = String(template.text || "");
                node.style.background = String(template.backgroundColor || "#dcfce7");
                node.style.color = String(template.textColor || "#166534");
                node.style.fontSize = Math.max(10, Math.min(48, Number(template.fontSize) || 16)) + "px";
                document.body.appendChild(node);
            }).catch(function () {});
    }
}());
