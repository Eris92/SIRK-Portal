(function () {
    "use strict";

    var selectedStatus = "";
    var hostButtonId = "MoveRequestHostButton";
    var legacyTopButtonId = "MainDevSirkPlatform-MoveRequest";

    function renderRows(shell) {
        return shell.api("requests", {
            status: selectedStatus,
            q: shell.state.search,
            page: 1,
            perPage: 100
        }).then(function (result) {
            shell.state.page.details.innerHTML = "";
            (result.rows || []).forEach(function (request) {
                shell.state.page.details.appendChild(shell.card(
                    request.title || "Move request",
                    (request.requester && request.requester.name || "") +
                        " · " +
                        request.status
                ));
            });
        });
    }

    function normalizeNodeId(value) {
        if (value && typeof value === "object") {
            value = value._id ||
                value.nodeid ||
                value.nodeId ||
                value.dbNodeKey ||
                value.id;
        }
        return String(value || "").trim();
    }

    function resolveHostNodeId(host) {
        var values = [];

        function add(value) {
            value = normalizeNodeId(value);
            if (value && values.indexOf(value) < 0) values.push(value);
        }

        add(module.api.state.nodeId);
        add(window.SirkPlatformRuntime &&
            window.SirkPlatformRuntime.state &&
            window.SirkPlatformRuntime.state.nodeId);
        add(window.currentNodeId);
        add(window.xxcurrentNodeId);
        add(window.nodeid);
        add(window.xxnodeid);
        add(window.currentNode);
        add(window.currentDevice);
        add(window.selectedNode);

        var buttons = host
            ? host.querySelectorAll('input[type="button"],button')
            : [];

        for (var index = 0; index < buttons.length; index++) {
            var onclick = buttons[index].getAttribute("onclick") || "";
            var match = onclick.match(/runDeviceCmd\(["']([^"']+)["']/);
            if (match) add(match[1]);
        }

        try {
            var params = new URL(window.location.href).searchParams;
            add(params.get("gotonode"));
            add(params.get("nodeid"));
        } catch (error) {}

        try {
            return values.length ? decodeURIComponent(values[0]) : "";
        } catch (error) {
            return values[0] || "";
        }
    }

    function nodeName(nodeId) {
        if (window.currentNode && window.currentNode.name) {
            return String(window.currentNode.name);
        }
        if (window.nodes && window.nodes[nodeId] && window.nodes[nodeId].name) {
            return String(window.nodes[nodeId].name);
        }
        return String(nodeId || "Device");
    }

    function currentGroupId(nodeId) {
        if (window.currentNode && window.currentNode.groupId) {
            return String(window.currentNode.groupId);
        }
        if (window.nodes && window.nodes[nodeId] && window.nodes[nodeId].groupId) {
            return String(window.nodes[nodeId].groupId);
        }
        return "";
    }

    function closeDialog(dialog) {
        if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
    }

    function openMoveDialog(nodeId) {
        nodeId = String(nodeId || "");
        if (!nodeId) {
            window.alert("No device is selected.");
            return;
        }

        module.api.api("groups", { nodeId: nodeId }).then(function (result) {
            var overlay = document.createElement("div");
            overlay.className = "sirk-move-dialog-overlay";

            var dialog = document.createElement("div");
            dialog.className = "sirk-move-dialog";
            overlay.appendChild(dialog);

            var title = document.createElement("h3");
            title.textContent = "Move Request";
            dialog.appendChild(title);

            var device = document.createElement("div");
            device.className = "sirk-move-dialog-device";
            device.textContent = nodeName(nodeId);
            dialog.appendChild(device);

            var groupLabel = document.createElement("label");
            groupLabel.textContent = "Target group";
            dialog.appendChild(groupLabel);

            var select = document.createElement("select");
            select.className = "sirk-move-dialog-input";
            var sourceGroupId = currentGroupId(nodeId);

            (result.groups || [])
                .filter(function (group) {
                    return !sourceGroupId || String(group.id) !== sourceGroupId;
                })
                .forEach(function (group) {
                    var option = document.createElement("option");
                    option.value = group.id;
                    option.textContent = group.name;
                    select.appendChild(option);
                });

            dialog.appendChild(select);

            var noteLabel = document.createElement("label");
            noteLabel.textContent = "Requester note";
            dialog.appendChild(noteLabel);

            var note = document.createElement("textarea");
            note.className = "sirk-move-dialog-input";
            note.rows = 4;
            dialog.appendChild(note);

            var status = document.createElement("div");
            status.className = "sirk-move-dialog-status";
            dialog.appendChild(status);

            if (!select.options.length) {
                select.disabled = true;
                status.textContent = "No target group is available.";
            }

            var actions = document.createElement("div");
            actions.className = "sirk-move-dialog-actions";
            dialog.appendChild(actions);

            var cancel = document.createElement("button");
            cancel.type = "button";
            cancel.textContent = "Cancel";
            cancel.onclick = function () { closeDialog(overlay); };
            actions.appendChild(cancel);

            var submit = document.createElement("button");
            submit.type = "button";
            submit.className = "btn btn-primary";
            submit.textContent = "Submit request";
            submit.disabled = !select.options.length;
            submit.onclick = function () {
                var option = select.options[select.selectedIndex];
                if (!option) {
                    status.textContent = "Select a target group.";
                    return;
                }

                submit.disabled = true;
                status.textContent = "Submitting...";

                module.api.post("submit", {
                    nodeId: nodeId,
                    nodeName: nodeName(nodeId),
                    sourceGroupId: sourceGroupId,
                    targetGroupId: option.value,
                    targetGroupName: option.textContent,
                    note: note.value || ""
                }).then(function () {
                    closeDialog(overlay);
                    window.alert("Move request was created in Approval Center.");
                }).catch(function (error) {
                    status.textContent = error.message || String(error);
                    submit.disabled = false;
                });
            };
            actions.appendChild(submit);

            overlay.onclick = function (event) {
                if (event.target === overlay) closeDialog(overlay);
            };

            document.body.appendChild(overlay);
        }).catch(function (error) {
            window.alert(error.message || String(error));
        });
    }

    function hostButtonEnabled() {
        var bootstrap = module.api.state.bootstrap || {};
        var config = bootstrap.config || {};
        return config.hostButtonEnabled !== false;
    }

    function removeElement(id) {
        var element = document.getElementById(id);
        if (element && element.parentNode) element.parentNode.removeChild(element);
    }

    function removeHostButton() {
        removeElement(hostButtonId);
        removeElement(legacyTopButtonId);
    }

    function buttonText(button) {
        return String(button.value || button.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function handleHostButtonClick(event) {
        if (event && event.preventDefault) event.preventDefault();
        if (event && event.stopPropagation) event.stopPropagation();

        var host = document.getElementById("p10html") ||
            document.getElementById("p10");

        openMoveDialog(resolveHostNodeId(host));
        return false;
    }

    function installHostButton() {
        removeElement(legacyTopButtonId);

        if (!hostButtonEnabled()) {
            removeElement(hostButtonId);
            return false;
        }

        var host = document.getElementById("p10html") ||
            document.getElementById("p10");

        if (!host) return false;

        var existing = document.getElementById(hostButtonId);
        if (existing && host.contains(existing)) {
            if (String(existing.tagName).toLowerCase() === "input") {
                existing.value = "Move Request";
            } else {
                existing.textContent = "Move Request";
            }
            existing.disabled = false;
            existing.removeAttribute("onclick");
            existing.removeAttribute("onmouseup");
            existing.onclick = handleHostButtonClick;
            return true;
        }

        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }

        var buttons = host.querySelectorAll('input[type="button"],button');
        var anchor = null;
        var fallback = null;

        for (var index = 0; index < buttons.length; index++) {
            var value = buttonText(buttons[index]);
            fallback = buttons[index];

            if (
                value === "share" ||
                value === "udostępnij" ||
                value === "udostepnij"
            ) {
                anchor = buttons[index];
                break;
            }

            if (!anchor && (value === "chat" || value === "czat")) {
                anchor = buttons[index];
            }
        }

        anchor = anchor || fallback;
        if (!anchor || !anchor.parentNode) return false;

        var button = anchor.cloneNode(false);
        button.id = hostButtonId;
        button.type = "button";

        if (String(button.tagName).toLowerCase() === "input") {
            button.value = "Move Request";
        } else {
            button.textContent = "Move Request";
        }

        button.title = "Submit a device move request";
        button.disabled = false;
        button.setAttribute("data-sirk-module", "device-transfers");
        button.setAttribute("data-sirk-action", "move-request");
        button.removeAttribute("onclick");
        button.removeAttribute("onmouseup");
        button.onclick = handleHostButtonClick;

        anchor.parentNode.insertBefore(button, anchor.nextSibling);
        return true;
    }

    function scheduleHostButton() {
        [0, 100, 400, 1000, 2000, 4000].forEach(function (delay) {
            window.setTimeout(installHostButton, delay);
        });
    }

    var module = window.SirkPlatformModuleShell.create({
        key: "moverequests",
        title: "Move Requests",
        menuTitle: "Move Requests",
        showInMenu: false,
        order: 120,
        preset: "standard",
        buttons: {
            favorites: false,
            manage: false,
            settings: false
        },
        tabs: [
            { key: "requests", title: "Requests" }
        ],
        defaultTab: "requests",
        render: function (shell) {
            shell.nav(
                shell.state.page.primary,
                [{ key: "moverequests", title: "Move Requests", icon: "⇄" }],
                "moverequests",
                function () {}
            );
            window.SharedStatusNav.mount(shell.state.page.secondary, {
                selected: selectedStatus,
                onSelect: function (value) {
                    selectedStatus = value;
                    shell.render();
                }
            });
            return renderRows(shell);
        }
    });

    var baseDeviceRefresh = module.onDeviceRefreshEnd;
    module.onDeviceRefreshEnd = function (nodeId) {
        baseDeviceRefresh(nodeId);
        scheduleHostButton();
    };

    var basePageEnd = module.onNativePageEnd;
    module.onNativePageEnd = function (view) {
        basePageEnd(view);
        scheduleHostButton();
    };

    window.SirkPlatformModules.moverequests = module;
}());
