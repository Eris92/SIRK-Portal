(function () {
    "use strict";

    if (window.__sirkUpdateAvailabilityUiLoaded) return;
    window.__sirkUpdateAvailabilityUiLoaded = true;

    var scheduled = false;
    var requestRunning = false;

    function apiPath() {
        var base = String(window.__SIRK_PLATFORM_API_BASE__ || "/api/v1").replace(/\/+$/, "");
        return base + "/admin/maintenance/status";
    }

    function updateCard() {
        var cards = document.querySelectorAll(".sirk-card");
        for (var i = 0; i < cards.length; i += 1) {
            var heading = cards[i].querySelector("h2");
            if (heading && heading.textContent.trim() === "Aktualizacje") return cards[i];
        }
        return null;
    }

    function shortSha(value) {
        value = String(value || "").trim();
        return /^[0-9a-f]{40}$/i.test(value) ? value.slice(0, 12) : "—";
    }

    function setText(node, value) {
        if (node && node.textContent !== value) node.textContent = value;
    }

    function apply(snapshot) {
        var card = updateCard();
        if (!card) return;

        var current = snapshot.current || {};
        var remote = snapshot.remote || {};
        var capabilities = snapshot.capabilities || {};
        var description = card.querySelector("p.sirk-muted");
        setText(
            description,
            "Wersja: " + (current.version || "—") +
            " · build: " + shortSha(current.commit) +
            " · dostępna: " + (remote.remoteCommit || remote.commit ? shortSha(remote.remoteCommit || remote.commit) : (remote.availableVersion || "—")));

        var buttons = card.querySelectorAll("button");
        var updateButton = null;
        for (var i = 0; i < buttons.length; i += 1) {
            if (buttons[i].textContent.trim() === "Aktualizuj teraz") {
                updateButton = buttons[i];
                break;
            }
        }
        if (updateButton) {
            updateButton.disabled = !(capabilities.update && remote.updateAvailable && !remote.error);
            updateButton.title = remote.error
                ? "Nie udało się potwierdzić dostępności zweryfikowanej aktualizacji."
                : updateButton.disabled
                    ? "Portal ma już najnowszy zweryfikowany pakiet."
                    : "Zainstaluj zweryfikowaną aktualizację przez SIRK Updater.";
        }

        var status = null;
        var paragraphs = card.querySelectorAll("p");
        for (var p = 0; p < paragraphs.length; p += 1) {
            if (!paragraphs[p].classList.contains("sirk-muted")) {
                status = paragraphs[p];
                break;
            }
        }
        if (!status) {
            status = document.createElement("p");
            card.appendChild(status);
        }

        status.classList.toggle("sirk-error", !!remote.error);
        if (remote.error) {
            setText(status, "Nie udało się sprawdzić aktualizacji: " + remote.error);
        } else if (remote.updateAvailable) {
            setText(status, "Dostępna jest aktualizacja.");
        } else {
            setText(status, "Portal jest aktualny dla main/latest.");
        }
    }

    function sync() {
        if (requestRunning || !updateCard()) return;
        requestRunning = true;
        fetch(apiPath(), { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (payload) {
                if (payload && payload.ok !== false && payload.value) apply(payload.value);
            })
            .catch(function () {})
            .then(function () { requestRunning = false; });
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(function () {
            scheduled = false;
            sync();
        }, 120);
    }

    new MutationObserver(schedule).observe(document.documentElement, {
        childList: true,
        subtree: true
    });
    document.addEventListener("click", function (event) {
        var target = event.target && event.target.closest ? event.target.closest("button") : null;
        if (!target) return;
        var label = target.textContent.trim();
        if (label === "Sprawdź aktualizacje" || label === "Aktualizuj teraz") {
            setTimeout(schedule, 250);
        }
    }, true);
    schedule();
}());
