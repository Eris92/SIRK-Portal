(function () {
    "use strict";

    function resolve(value) { return typeof value === "string" ? document.querySelector(value) : value; }

    function button(definition) {
        var value = document.createElement("button");
        value.type = "button";
        value.className = "sirk-toolbar-button";
        value.title = definition.title || definition.key;
        value.setAttribute("aria-label", value.title);
        value.innerHTML = '<span class="sirk-toolbar-icon"></span>';
        var icon = definition.icon || definition.title || definition.key;
        if (String(icon).indexOf("<svg") === 0) value.firstChild.innerHTML = icon;
        else value.firstChild.textContent = icon;
        return value;
    }

    window.SharedToolbar = {
        mount: function (options) {
            options = options || {};
            var root = resolve(options.container);
            if (!root) throw new Error("Toolbar container not found.");
            root.innerHTML = "";
            root.className = "sirk-toolbar-host";
            var left = document.createElement("div"); left.className = "sirk-group sirk-left";
            var center = document.createElement("div"); center.className = "sirk-group sirk-center";
            var right = document.createElement("div"); right.className = "sirk-group sirk-right";
            root.appendChild(left); root.appendChild(center); root.appendChild(right);
            var searchWrap = document.createElement("div"); searchWrap.className = "sirk-toolbar-search"; searchWrap.hidden = true;
            var searchInput = document.createElement("input"); searchInput.type = "search"; searchInput.className = "sirk-filter"; searchInput.placeholder = options.searchPlaceholder || "Search"; searchWrap.appendChild(searchInput);
            var context = { root: root, groups: { left: left, center: center, right: right }, buttons: {}, searchWrap: searchWrap, searchInput: searchInput, state: { search: "", searchVisible: false }, onSearch: options.handlers && options.handlers.onSearch };
            var api = window.SharedToolbarApi.create(context); var handlers = options.handlers || {};
            function add(definition) {
                var item = button(definition); context.buttons[definition.key] = item;
                var group = context.groups[definition.side] || right; group.appendChild(item);
                item.onclick = function (event) {
                    if (definition.search) { api.showSearch(!context.state.searchVisible); return; }
                    var handler = definition.onClick || handlers[definition.handler]; if (typeof handler === "function") handler(api, event, definition);
                };
                return item;
            }
            window.SharedToolbarConfig.resolve(options.preset, options.buttons).forEach(add);
            (options.customButtons || []).sort(function (a, b) { return Number(a.order || 500) - Number(b.order || 500); }).forEach(function (definition) {
                definition.side = definition.side || "right"; definition.key = definition.key || ("custom-" + Object.keys(context.buttons).length); add(definition);
            });
            if (context.buttons.search) left.appendChild(searchWrap); api.addButton = add;
            var timer = 0;
            searchInput.oninput = function () { context.state.search = searchInput.value || ""; clearTimeout(timer); timer = setTimeout(function () { if (typeof handlers.onSearch === "function") handlers.onSearch(context.state.search, api); }, 120); };
            if (context.buttons.clear && typeof handlers.onClear !== "function") context.buttons.clear.onclick = function () { api.clearSearch(true); };
            center.hidden = center.childNodes.length === 0;
            right.hidden = right.childNodes.length === 0;
            root.hidden = Object.keys(context.buttons).length === 0;
            return api;
        }
    };
}());
