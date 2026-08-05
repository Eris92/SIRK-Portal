from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}: {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


root = Path(__file__).resolve().parents[2]
tabs_js = root / "public/portal/standalone/scripts/device-tabs.js"
tabs_css = root / "public/portal/standalone/styles/device-tabs.css"

replace_once(
    tabs_js,
    '''    function syncQuickCommandsToggle() {
        if (!state.header || !state.content) return;
        var panel = state.content.querySelector("#sirkQuickCommandsPanel");
        var toggle = document.getElementById("sirkQuickCommandsToggle");
        if (!panel) {
            if (toggle && toggle.classList.contains("is-header-mounted")) toggle.remove();
            return;
        }
        if (!toggle || !desktopMode()) return;
        var anchor = state.header.querySelector(".sirk-device-view-mode") || state.header.querySelector("#sirkUserMenu");
        toggle.classList.add("is-header-mounted");
        if (toggle.parentNode !== state.header || toggle.nextElementSibling !== anchor) {
            state.header.insertBefore(toggle, anchor || null);
        }
    }''',
    '''    function syncQuickCommandsToggle() {
        if (!state.header || !state.content) return;
        var panel = state.content.querySelector("#sirkQuickCommandsPanel");
        var toggle = document.getElementById("sirkQuickCommandsToggle");
        if (!panel) {
            if (toggle && toggle.classList.contains("is-header-mounted")) toggle.remove();
            return;
        }
        if (!toggle) return;
        if (!desktopMode()) {
            if (toggle.classList.contains("is-header-mounted")) {
                var operation = panel.parentElement;
                var stage = operation && operation.querySelector(".sirk-agent-desktop-stage");
                toggle.classList.remove("is-header-mounted");
                (stage || operation || state.content).appendChild(toggle);
            }
            return;
        }
        var anchor = state.header.querySelector(".sirk-device-view-mode") || state.header.querySelector("#sirkUserMenu");
        toggle.classList.add("is-header-mounted");
        if (toggle.parentNode !== state.header || toggle.nextElementSibling !== anchor) {
            state.header.insertBefore(toggle, anchor || null);
        }
    }'''
)
replace_once(
    tabs_js,
    '        state.observer.observe(state.content, { childList: true });',
    '        state.observer.observe(state.content, { childList: true, subtree: true });'
)
replace_once(
    tabs_css,
    'html.sirk-device-connection-mode #sirkPortalRoot .sirk-standalone-header{flex:0 0 48px!important;min-height:48px!important;height:48px!important;padding:2px 22px!important;box-sizing:border-box!important}',
    'html.sirk-device-connection-mode #sirkPortalRoot .sirk-standalone-header{flex:0 0 50px!important;min-height:50px!important;height:50px!important;padding:2px 22px!important;box-sizing:border-box!important}'
)

print("Expanded connection follow-up applied.")
