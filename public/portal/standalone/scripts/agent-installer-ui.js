(function () {
    "use strict";

    var running = false;

    function node(tag, className, text) {
        var value = document.createElement(tag);
        if (className) value.className = className;
        if (text != null) value.textContent = text;
        return value;
    }

    function parseJson(response) {
        return response.text().then(function (text) {
            var payload = {};
            try { payload = text ? JSON.parse(text) : {}; }
            catch (_) { throw new Error("Portal returned invalid JSON."); }
            if (response.status === 401) {
                location.replace("/login");
                throw new Error("Authentication required.");
            }
            if (!response.ok || payload.ok === false) {
                throw new Error(payload.error || payload.title || ("HTTP " + response.status));
            }
            return payload;
        });
    }

    function csrf() {
        return fetch("/api/v1/auth/csrf", {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" }
        }).then(parseJson).then(function (payload) {
            var token = String(payload.requestToken || "");
            if (!token) throw new Error("CSRF token could not be issued.");
            return token;
        });
    }

    function fileName(response, fallback) {
        var disposition = response.headers.get("Content-Disposition") || "";
        var match = /filename\*?=(?:UTF-8''|\")?([^\";]+)/i.exec(disposition);
        return match
            ? decodeURIComponent(match[1].replace(/^\"|\"$/g, ""))
            : fallback;
    }

    function downloadInstaller(groupId, channel, validMinutes, status, button) {
        button.disabled = true;
        status.textContent = "Generowanie jednorazowego instalatora EXE…";
        csrf().then(function (token) {
            return fetch(
                "/api/v1/admin/agent-groups/" + encodeURIComponent(groupId) + "/installer",
                {
                    method: "POST",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: {
                        Accept: "application/vnd.microsoft.portable-executable, application/json",
                        "Content-Type": "application/json; charset=UTF-8",
                        "X-SIRK-CSRF": token
                    },
                    body: JSON.stringify({
                        channel: channel,
                        validMinutes: validMinutes
                    })
                });
        }).then(function (response) {
            if (!response.ok) {
                return response.text().then(function (text) {
                    var payload = {};
                    try { payload = text ? JSON.parse(text) : {}; } catch (_) {}
                    throw new Error(payload.error || payload.title || ("HTTP " + response.status));
                });
            }
            var expires = response.headers.get("X-SIRK-Installer-Expires-At");
            var name = fileName(response, "SIRK-Agent-" + groupId + "-Installer.exe");
            return response.blob().then(function (blob) {
                if (blob.size < 4096) throw new Error("Generated installer is unexpectedly small.");
                return { blob: blob, name: name, expires: expires };
            });
        }).then(function (download) {
            var url = URL.createObjectURL(download.blob);
            var link = node("a");
            link.href = url;
            link.download = download.name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            status.textContent = "Pobrano " + download.name + ". Bilet jest jednorazowy" +
                (download.expires ? " i ważny do " + new Date(download.expires).toLocaleString() : "") + ".";
        }).catch(function (error) {
            status.textContent = error && error.message || "Nie udało się wygenerować instalatora.";
        }).then(function () {
            button.disabled = false;
        });
    }

    function mount() {
        if (running) return;
        var settings = document.querySelector('[data-sirk-view-shell="settings"]');
        if (!settings) return;
        var active = settings.querySelector(".sirk-column-secondary .sirk-nav-item.is-active");
        if (!active || !/grupy komputerów|computer groups/i.test(active.textContent || "")) return;
        var details = settings.querySelector(".sirk-column-details");
        if (!details || details.querySelector("[data-sirk-agent-installer-panel]")) return;

        running = true;
        fetch("/api/v1/admin/computer-groups", {
            credentials: "same-origin",
            cache: "no-store",
            headers: { Accept: "application/json" }
        }).then(parseJson).then(function (payload) {
            if (!details.isConnected || details.querySelector("[data-sirk-agent-installer-panel]")) return;
            var groups = payload.value && payload.value.groups || [];
            var card = node("section", "sirk-card");
            card.setAttribute("data-sirk-agent-installer-panel", "1");
            card.appendChild(node("h2", "", "Instalator SIRK Agent EXE"));
            card.appendChild(node(
                "p",
                "sirk-muted",
                "Pobierz gotowy instalator przypisany do grupy. EXE zawiera krótkotrwały, jednorazowy bilet zamiast stałego tokenu grupy."));

            if (!groups.length) {
                card.appendChild(node("p", "sirk-muted", "Najpierw utwórz aktywną grupę komputerów."));
                details.insertBefore(card, details.firstChild);
                return;
            }

            var groupLabel = node("label", "sirk-field");
            groupLabel.appendChild(node("strong", "", "Grupa komputerów"));
            var group = node("select");
            groups.filter(function (item) { return item.enabled !== false; }).forEach(function (item) {
                var option = node("option", "", item.name + " (" + item.id + ")");
                option.value = item.id;
                group.appendChild(option);
            });
            groupLabel.appendChild(group);
            card.appendChild(groupLabel);

            var channelLabel = node("label", "sirk-field");
            channelLabel.appendChild(node("strong", "", "Kanał Agenta"));
            var channel = node("select");
            [["stable", "Stable"], ["dev", "Dev"]].forEach(function (item) {
                var option = node("option", "", item[1]);
                option.value = item[0];
                channel.appendChild(option);
            });
            channelLabel.appendChild(channel);
            card.appendChild(channelLabel);

            var lifetimeLabel = node("label", "sirk-field");
            lifetimeLabel.appendChild(node("strong", "", "Ważność przed pierwszym użyciem"));
            var lifetime = node("select");
            [[60, "1 godzina"], [480, "8 godzin"], [1440, "24 godziny"], [10080, "7 dni"]].forEach(function (item) {
                var option = node("option", "", item[1]);
                option.value = String(item[0]);
                option.selected = item[0] === 1440;
                lifetime.appendChild(option);
            });
            lifetimeLabel.appendChild(lifetime);
            card.appendChild(lifetimeLabel);

            var actions = node("div", "sirk-action-row");
            var button = node("button", "sirk-button", "Pobierz instalator EXE");
            button.type = "button";
            var status = node("p", "sirk-muted", "Po pierwszej poprawnej rejestracji ten sam plik nie zarejestruje kolejnego urządzenia.");
            button.onclick = function () {
                if (!group.value) return;
                downloadInstaller(
                    group.value,
                    channel.value,
                    Number(lifetime.value),
                    status,
                    button);
            };
            actions.appendChild(button);
            card.appendChild(actions);
            card.appendChild(status);
            details.insertBefore(card, details.firstChild);
        }).catch(function () {}).then(function () {
            running = false;
        });
    }

    var observer = new MutationObserver(function () {
        window.clearTimeout(observer.timer);
        observer.timer = window.setTimeout(mount, 50);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("hashchange", mount);
    window.addEventListener("popstate", mount);
    mount();
}());
