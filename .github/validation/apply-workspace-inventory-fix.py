from pathlib import Path

path = Path("public/portal/standalone/scripts/device-workspace.js")
text = path.read_text(encoding="utf-8")
old = '''    function getInventory() {
        if (inventory) return Promise.resolve(inventory);
        return fetch("/api/devices", { credentials: "same-origin", cache: "no-store" }).then(function (response) { return response.json().then(function (value) { if (!response.ok || value.ok === false) throw new Error(value.error || "Device inventory unavailable."); return value.value || value; }); }).then(function (value) {
            inventory = {
                nodes: Array.isArray(value && value.nodes) ? value.nodes : [],
                groups: Array.isArray(value && value.groups) ? value.groups : []
            };
            return inventory;
        });
    }
'''
new = '''    function getInventory() {
        var apiBase = new URL(String(window.__SIRK_PLATFORM_API_BASE__ || ""), window.location.href);
        var request = apiBase.pathname.replace(/\\/+$/, "") === "/api"
            ? fetch("/api/devices", { credentials: "same-origin", cache: "no-store" }).then(function (response) { return response.json().then(function (value) { if (!response.ok || value.ok === false) throw new Error(value.error || "Device inventory unavailable."); return value.value || value; }); })
            : core.api("portal", "devices");
        return Promise.resolve(request).then(function (value) {
            inventory = {
                nodes: Array.isArray(value && value.nodes) ? value.nodes : [],
                groups: Array.isArray(value && value.groups) ? value.groups : []
            };
            return inventory;
        });
    }
'''
if old not in text:
    raise SystemExit("Expected legacy workspace inventory loader was not found.")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8", newline="\n")

updated = path.read_text(encoding="utf-8")
if 'core.api("portal", "devices")' not in updated:
    raise SystemExit("Tunneled Portal device inventory API was not added.")
if 'if (inventory) return Promise.resolve(inventory);' in updated:
    raise SystemExit("Stale workspace inventory cache remains enabled.")
print("WORKSPACE_INVENTORY_FIX_APPLIED")
