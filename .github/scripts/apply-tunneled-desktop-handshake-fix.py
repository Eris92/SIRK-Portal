from pathlib import Path

path = Path("public/portal/standalone/scripts/device-workspace.js")
text = path.read_text(encoding="utf-8")

old_operation_url = '''    function agentOperationUrl(action, parameters) {
        var endpoint = new URL("/api/agent-operations", window.location.href);
        Object.keys(parameters || {}).forEach(function (key) {
            endpoint.searchParams.set(key, parameters[key]);
        });
        return endpoint.href;
    }
'''
new_operation_url = '''    function portalHttpUrl(pathAndQuery) {
        var rewritten = core && typeof core.portalUrl === "function"
            ? core.portalUrl(pathAndQuery)
            : pathAndQuery;
        return new URL(rewritten, window.location.href).href;
    }

    function agentOperationUrl(action, parameters) {
        var endpoint = new URL(portalHttpUrl("/api/agent-operations"), window.location.href);
        Object.keys(parameters || {}).forEach(function (key) {
            endpoint.searchParams.set(key, parameters[key]);
        });
        return endpoint.href;
    }
'''
if old_operation_url not in text:
    raise SystemExit("agentOperationUrl marker not found")
text = text.replace(old_operation_url, new_operation_url, 1)

old_restart = '''            if (usesHttpTunnel()) {
                input(streamProfile).then(function () { snapshot(streamGeneration); })
                    .catch(function (error) {
                        status.textContent = error.message || String(error);
                        status.classList.add("is-error");
                    });
                return;
            }
'''
new_restart = '''            if (usesHttpTunnel()) {
                var generation = streamGeneration;
                var configureDeadline = Date.now() + 30000;
                status.textContent = "Uruchamianie kanału SIRK Agenta…";

                // The frame long-poll marks the HTTP viewer as active. The Agent uses
                // that state to establish its authenticated desktop WebSocket. Start
                // polling before sending the first profile to avoid a viewer/Agent
                // startup deadlock through the Central request/response tunnel.
                snapshot(generation);

                function configureStream() {
                    if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
                    input(Object.assign({}, streamProfile)).then(function () {
                        if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
                        setStreamStatus("Kanał Agenta gotowy · oczekiwanie na pierwszą klatkę…");
                    }).catch(function (error) {
                        if (stopped || !connected || !host.isConnected || generation !== streamGeneration) return;
                        var message = error.message || String(error);
                        if (Date.now() < configureDeadline &&
                            /desktop stream is offline|DESKTOP_STREAM_OFFLINE|HTTP 409/i.test(message)) {
                            status.textContent = "Oczekiwanie na kanał pulpitu SIRK Agenta…";
                            status.classList.remove("is-error");
                            setTimeout(configureStream, 500);
                            return;
                        }
                        status.textContent = message;
                        status.classList.add("is-error");
                    });
                }

                configureStream();
                return;
            }
'''
if old_restart not in text:
    raise SystemExit("tunneled restartStream marker not found")
text = text.replace(old_restart, new_restart, 1)

old_input = '''            return fetch("/api/agent-desktop/input", {
'''
new_input = '''            return fetch(portalHttpUrl("/api/agent-desktop/input"), {
'''
if old_input not in text:
    raise SystemExit("desktop input URL marker not found")
text = text.replace(old_input, new_input, 1)

old_frame = '''            var url = "/api/agent-desktop/frame?tenantId=" + encodeURIComponent(node.tenantId) +
                "&deviceId=" + encodeURIComponent(node.deviceId) +
                "&after=" + encodeURIComponent(snapshot.sequence || 0) + "&waitMilliseconds=25000";
'''
new_frame = '''            var url = portalHttpUrl("/api/agent-desktop/frame?tenantId=" + encodeURIComponent(node.tenantId) +
                "&deviceId=" + encodeURIComponent(node.deviceId) +
                "&after=" + encodeURIComponent(snapshot.sequence || 0) + "&waitMilliseconds=25000");
'''
if old_frame not in text:
    raise SystemExit("desktop frame URL marker not found")
text = text.replace(old_frame, new_frame, 1)

path.write_text(text, encoding="utf-8")
