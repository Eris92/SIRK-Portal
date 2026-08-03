(function () {
    "use strict";

    if (window.__sirkPlatformPortalUiFixLoaded) return;
    window.__sirkPlatformPortalUiFixLoaded = true;

    function svg(path) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
    }

    var icons = {
        folder: svg('<path d="M3 6h6l2 2h10v11H3V6Z"/>'),
        script: svg('<path d="M6 3h9l3 3v15H6V3Z"/><path d="M9 11h6M9 15h6"/>'),
        result: svg('<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8"/>')
    };

    function portalRoot() {
        return document.getElementById("sirkPortalRoot");
    }

    function markPortalReady(root) {
        if (!root) return;
        try { window.localStorage.setItem("sirkPortal.enabled", "1"); }
        catch (error) {}
        document.documentElement.classList.remove("sirk-platform-auth-portal-pending");
        if (typeof window.__sirkPlatformRevealAuthenticatedPortal === "function") {
            window.__sirkPlatformRevealAuthenticatedPortal();
        }
        root.setAttribute("data-sirk-platform-portal-ready", "1");
    }

    function managementActive(root) {
        if (!root) return false;
        var host = root.querySelector('[data-="1"],.');
        if (host && !host.hidden && host.style.display !== "none" && host.querySelector(".sirk-view-shell")) return true;
        var button = root.querySelector('[data-sirk-platform-management-nav="1"].is-active,[data-sirk-view="management"].is-active');
        return !!button;
    }

    function replaceIcon(host, markup) {
        if (!host) return;
        if (host.querySelector("svg,img")) return;
        host.textContent = "";
        host.innerHTML = markup;
    }

    function normalizeManagementIcons(root) {
        if (!root) return;
        root.querySelectorAll('.sirk-nav-item[data-management-root]').forEach(function (button) {
            var icon = button.querySelector('.sirk-nav-icon');
            var path = button.getAttribute('data-management-root') || '';
            replaceIcon(icon, path === '@results' ? icons.result : icons.folder);
        });
        root.querySelectorAll('.sirk-folder-heading .sirk-nav-icon').forEach(function (icon) {
            replaceIcon(icon, icons.folder);
        });
        root.querySelectorAll('.sirk-script-open .sirk-nav-icon').forEach(function (icon) {
            replaceIcon(icon, icons.script);
        });
    }

    function titleCandidates(root) {
        return root.querySelectorAll([
            '[data-sirk-page-title]',
            '.sirk-page-title',
            '.sirk-topbar-title',
            '.sirk-header-title',
            '.sirk-content-header>h1',
            '.sirk-content-header>h2',
            '.sirk-main-header>h1',
            '.sirk-main-header>h2',
            '.sirk-topbar h1',
            '.sirk-topbar h2'
        ].join(','));
    }

    function normalizeTitle(root) {
        if (!managementActive(root)) return;
        var candidates = titleCandidates(root);
        for (var index = 0; index < candidates.length; index++) {
            var node = candidates[index];
            if (node.closest('.sirk-content,.sirk-card')) continue;
            node.textContent = 'Zarządzanie';
        }
        document.title = document.title.replace(/Przegląd|Overview|Jira|Defender/i, 'Zarządzanie');
    }

    function apply() {
        var root = portalRoot();
        if (!root) return false;
        normalizeManagementIcons(root);
        normalizeTitle(root);
        markPortalReady(root);
        return true;
    }

    var attempts = 0;
    var timer = window.setInterval(function () {
        attempts++;
        if (!apply()) {
            if (attempts > 150) {
                window.clearInterval(timer);
                document.documentElement.classList.remove("sirk-platform-auth-portal-pending");
                if (typeof window.__sirkPlatformRevealAuthenticatedPortal === "function") {
                    window.__sirkPlatformRevealAuthenticatedPortal();
                }
            }
            return;
        }
        window.clearInterval(timer);
        var root = portalRoot();
        var pending = 0;
        new MutationObserver(function () {
            window.clearTimeout(pending);
            pending = window.setTimeout(apply, 20);
        }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
        root.addEventListener('click', function () {
            window.setTimeout(apply, 0);
            window.setTimeout(apply, 80);
        }, true);
    }, 100);
}());