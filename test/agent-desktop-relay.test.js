"use strict";

var assert = require("assert");
var EventEmitter = require("events");
var relay = require("../server/core/agent-desktop-relay.js").create();

(async function () {
    var first = relay.publish("tenant", "device", Buffer.from([1, 2, 3]), { fullFrame: true });
    assert.strictEqual(first.sequence, 1);
    var frame = await relay.wait("tenant", "device", 0, 0);
    assert(frame);
    assert.deepStrictEqual(Array.from(frame.frame), [1, 2, 3]);
    assert.strictEqual(frame.metadata.fullFrame, true);

    relay.input("tenant", "device", { action: "move", x: 10, y: 20 });
    var waiting = relay.wait("tenant", "device", 1, 1000);
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    var second = relay.publish("tenant", "device", Buffer.from([4]), { fullFrame: false });
    assert.strictEqual(second.viewers, 1);

    var pendingControl = relay.control("tenant-a", "device-a", 1000);
    relay.touchViewer("tenant-a", "device-a");
    var activeControl = await pendingControl;
    assert.strictEqual(activeControl.viewerActive, true);
    assert.strictEqual(second.inputs.length, 1);
    assert.strictEqual(second.inputs[0].action, "move");
    frame = await waiting;
    assert.strictEqual(frame.sequence, 2);
    var idle = await relay.control("tenant", "idle", 0);
    assert.strictEqual(idle.viewerActive, false);
    var controlWaiting = relay.control("tenant", "controlled", 1000);
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    relay.input("tenant", "controlled", { action: "key", key: "A" });
    var control = await controlWaiting;
    assert.strictEqual(control.inputs.length, 1);
    assert.strictEqual(control.inputs[0].key, "A");
    relay.input("tenant", "mouse", { action: "move", x: 1, y: 2 });
    relay.input("tenant", "mouse", { action: "key", key: "B" });
    relay.input("tenant", "mouse", { action: "move", x: 30, y: 40 });
    var mouse = await relay.control("tenant", "mouse", 0);
    assert.strictEqual(mouse.inputs.length, 2);
    assert.strictEqual(mouse.inputs[0].key, "B");
    assert.strictEqual(mouse.inputs[1].x, 30);
    var viewerControl = relay.control("tenant", "viewer", 1000);
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    relay.wait("tenant", "viewer", 0, 1);
    assert.strictEqual((await viewerControl).viewerActive, true);
    var directSocket = new EventEmitter();
    directSocket.readyState = 1;
    directSocket.sent = [];
    directSocket.send = function (value) { this.sent.push(JSON.parse(value)); };
    relay.attachAgent("tenant", "direct", directSocket);
    var direct = relay.input("tenant", "direct", { action: "key", key: "C" });
    assert.strictEqual(direct.direct, true);
    assert.strictEqual(directSocket.sent[0].input.key, "C");
    assert.strictEqual((await relay.control("tenant", "direct", 0)).inputs.length, 0);
    directSocket.emit("close");
    relay.input("tenant", "direct", { action: "key", key: "D" });
    assert.strictEqual((await relay.control("tenant", "direct", 0)).inputs[0].key, "D");
    console.log("SIRK Agent desktop binary relay: OK");
})().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
});
