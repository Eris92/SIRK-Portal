(function () {
    "use strict";
    window.SharedTabs = {
        mount: function (options) {
            options = options || {};
            var root = typeof options.container === "string" ? document.querySelector(options.container) : options.container;
            if (!root) throw new Error("Tabs container not found.");
            root.innerHTML = "";
            root.className = "sirk-tabs-host";
            var state = { active: options.active || "" }, buttons = {};
            function select(key, notify) {
                state.active = key;
                Object.keys(buttons).forEach(function (name) { buttons[name].classList.toggle("active", name === key); });
                if (notify !== false && typeof options.onSelect === "function") options.onSelect(key, api);
            }
            (options.tabs || []).forEach(function (tab) {
                if (tab.visible === false) return;
                var item = document.createElement("button");
                item.type = "button";
                item.className = "sirk-shared-tab";
                item.textContent = tab.title || tab.key;
                item.onclick = function () { select(tab.key, true); };
                buttons[tab.key] = item;
                root.appendChild(item);
            });
            root.hidden = Object.keys(buttons).length === 0;
            var api = { root: root, buttons: buttons, state: state, select: select, setVisible: function (key, value) { if (buttons[key]) buttons[key].hidden = value === false; } };
            select(state.active || Object.keys(buttons)[0] || "", false);
            return api;
        }
    };
}());
