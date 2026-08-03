(function () {
    "use strict";

    function div(className) {
        var value = document.createElement("div");
        value.className = className;
        return value;
    }

    window.SharedLayout = {
        mount: function (options) {
            options = options || {};
            var root = typeof options.container === "string" ? document.querySelector(options.container) : options.container;
            if (!root) throw new Error("Layout container not found.");
            root.innerHTML = "";
            root.className = "sirk-layout-host";
            var primary = div("sirk-column-primary");
            var secondary = div("sirk-column-secondary");
            var details = div("sirk-column-details");
            var key = options.storageKey || "";
            var collapsed = false;

            try { collapsed = key && window.localStorage.getItem(key) === "collapsed"; } catch (error) {}

            function setCollapsed(value) {
                collapsed = value === true;
                root.classList.toggle("is-collapsed", collapsed);
                root.setAttribute("data-collapsed", collapsed ? "1" : "0");
                try { if (key) window.localStorage.setItem(key, collapsed ? "collapsed" : "expanded"); } catch (error) {}
                return collapsed;
            }

            root.appendChild(primary);
            root.appendChild(secondary);
            root.appendChild(details);
            setCollapsed(collapsed);

            return {
                root: root,
                primary: primary,
                secondary: secondary,
                details: details,
                isCollapsed: function () { return collapsed; },
                setCollapsed: setCollapsed,
                toggleCollapsed: function () { return setCollapsed(!collapsed); },
                clear: function () { primary.innerHTML = ""; secondary.innerHTML = ""; details.innerHTML = ""; }
            };
        }
    };
}());
