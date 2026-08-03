(function () {
    "use strict";

    function svg(path) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>'; }

    var definitions = {
        collapse: { title: "Collapse", icon: svg('<path d="m15 18-6-6 6-6"/>'), expandIcon: svg('<path d="m9 18 6-6-6-6"/>'), side: "left", order: 10, handler: "onCollapse" },
        favorites: { title: "Favorites", icon: svg('<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>'), side: "left", order: 20, handler: "onFavorites" },
        link: { title: "Copy link", icon: svg('<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>'), side: "left", order: 30, handler: "onLink" },
        manage: { title: "Edit", icon: svg('<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'), side: "left", order: 40, handler: "onManage" },
        refresh: { title: "Refresh", icon: svg('<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 8A7 7 0 0 1 18 6l2 5M4 13l2 5a7 7 0 0 0 11.9-2"/>'), side: "left", order: 50, handler: "onRefresh" },
        multi: { title: "Multi-device execution", icon: svg('<circle cx="12" cy="12" r="8"/><path d="m9 12 2 2 4-5"/>'), side: "left", order: 60, handler: "onMulti" },
        search: { title: "Search", icon: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'), side: "left", order: 70, handler: "onSearchToggle", search: true },
        clear: { title: "Clear", icon: svg('<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>'), side: "right", order: 110, handler: "onClear" },
        settings: { title: "Settings", icon: svg('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5a7 7 0 0 0 .1-1Z"/>'), side: "right", order: 140, handler: "onSettings" }
    };

    var presets = {
        approvals: { collapse: true, link: false, refresh: true, clear: false, favorites: false, search: true, manage: false, multi: false, settings: false },
        management: { collapse: true, favorites: true, link: false, manage: true, refresh: true, multi: false, search: true, clear: false, settings: false },
        commands: { collapse: true, favorites: true, link: true, manage: true, refresh: true, multi: true, search: true, clear: false, settings: false },
        standard: { collapse: false, link: true, manage: false, refresh: true, multi: false, search: true, clear: false, favorites: false, settings: true },
        minimal: { collapse: false, refresh: true, search: true }
    };

    function clone(value) {
        var result = {};
        Object.keys(value || {}).forEach(function (key) { result[key] = value[key]; });
        return result;
    }

    window.SharedToolbarConfig = {
        definitions: definitions,
        presets: presets,
        resolve: function (preset, overrides) {
            var source = clone(presets[preset] || presets.standard);
            Object.keys(overrides || {}).forEach(function (key) { source[key] = overrides[key]; });
            return Object.keys(source).map(function (key) {
                var value = source[key];
                if (value === false || value == null) return null;
                var item = clone(definitions[key] || { title: key, icon: key, side: "right", order: 500 });
                item.key = key;
                if (typeof value === "object") Object.keys(value).forEach(function (name) { item[name] = value[name]; });
                return item;
            }).filter(Boolean).sort(function (a, b) {
                if (a.side !== b.side) return a.side === "left" ? -1 : 1;
                return Number(a.order) - Number(b.order);
            });
        }
    };
}());
