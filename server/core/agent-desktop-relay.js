"use strict";

function key(tenantId, deviceId) {
    return String(tenantId || "") + "/" + String(deviceId || "");
}

module.exports.create = function () {
    var streams = new Map();

    function state(tenantId, deviceId) {
        var id = key(tenantId, deviceId);
        var value = streams.get(id);
        if (!value) {
            value = {
                sequence: 0, frame: null, metadata: null, waiters: new Set(),
                controlWaiters: new Set(), viewerLeaseUntil: 0, inputs: []
            };
            streams.set(id, value);
        }
        return value;
    }

    function publish(tenantId, deviceId, frame, metadata) {
        var value = state(tenantId, deviceId);
        value.sequence += 1;
        value.frame = frame;
        value.metadata = Object.assign({}, metadata || {}, {
            sequence: value.sequence,
            receivedAtUtc: new Date().toISOString()
        });
        var viewers = value.viewerLeaseUntil > Date.now() ? 1 : 0;
        value.waiters.forEach(function (resolve) { resolve(); });
        value.waiters.clear();
        var inputs = value.inputs.splice(0, 128);
        return { sequence: value.sequence, viewers: viewers, inputs: inputs };
    }

    function wait(tenantId, deviceId, after, milliseconds) {
        var value = state(tenantId, deviceId);
        touchViewer(tenantId, deviceId);
        function result() {
            return value.sequence > after && value.frame
                ? { sequence: value.sequence, frame: value.frame, metadata: value.metadata }
                : null;
        }
        var current = result();
        if (current || milliseconds <= 0) {
            return Promise.resolve(current);
        }
        return new Promise(function (resolve) {
            var finished = false;
            function complete() {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                value.waiters.delete(complete);
                resolve(result());
            }
            var timer = setTimeout(complete, Math.min(25000, Math.max(1, milliseconds)));
            value.waiters.add(complete);
        });
    }

    function touchViewer(tenantId, deviceId) {
        var value = state(tenantId, deviceId);
        value.viewerLeaseUntil = Date.now() + 30000;
        value.controlWaiters.forEach(function (resolve) { resolve(); });
        value.controlWaiters.clear();
    }

    function input(tenantId, deviceId, command) {
        var value = state(tenantId, deviceId);
        if (command && command.action === "move")
            value.inputs = value.inputs.filter(function (item) { return !item || item.action !== "move"; });
        if (value.inputs.length >= 128) value.inputs.shift();
        value.inputs.push(command);
        value.controlWaiters.forEach(function (resolve) { resolve(); });
        value.controlWaiters.clear();
        return { queued: value.inputs.length };
    }

    function control(tenantId, deviceId, milliseconds) {
        var value = state(tenantId, deviceId);
        function result() {
            return {
                viewerActive: value.viewerLeaseUntil > Date.now(),
                inputs: value.inputs.splice(0, 128)
            };
        }
        if (value.inputs.length || milliseconds <= 0)
            return Promise.resolve(result());
        return new Promise(function (resolve) {
            var finished = false;
            function complete() {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                value.controlWaiters.delete(complete);
                resolve(result());
            }
            var timer = setTimeout(complete, Math.min(25000, Math.max(1, milliseconds)));
            value.controlWaiters.add(complete);
        });
    }

    return { publish: publish, wait: wait, touchViewer: touchViewer, input: input, control: control };
};
