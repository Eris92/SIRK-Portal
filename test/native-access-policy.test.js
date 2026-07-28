"use strict";

var assert = require("assert");
var policy = require("../server/core/native-access-policy")._test;

var portalPolicy = { login: "/sirkportal/login" };

function request(destination, referer) {
    var headers = { "sec-fetch-dest": destination };
    if (referer != null) headers.referer = referer;
    return { headers: headers };
}

assert.strictEqual(
    policy.validLoginFrame(
        request("iframe"),
        portalPolicy,
        new URL("http://sirk.local/?sirkAuth=1")
    ),
    true,
    "Login iframe must work when MeshCentral suppresses Referer."
);
assert.strictEqual(
    policy.validLoginFrame(
        request("iframe", "https://mc.sir-k.local/sirkportal/login?return=portal"),
        portalPolicy,
        new URL("http://sirk.local/?sirkAuth=1")
    ),
    true,
    "Login iframe with the SIRK login Referer must be accepted."
);
assert.strictEqual(
    policy.validLoginFrame(
        request("document"),
        portalPolicy,
        new URL("http://sirk.local/?sirkAuth=1")
    ),
    false,
    "Top-level sirkAuth navigation must not bypass the portal policy."
);
assert.strictEqual(
    policy.validLoginFrame(
        request("iframe", "https://mc.sir-k.local/untrusted"),
        portalPolicy,
        new URL("http://sirk.local/?sirkAuth=1")
    ),
    false,
    "An iframe with an unrelated Referer must be rejected."
);
assert.strictEqual(
    policy.validLoginFrame(
        request("iframe"),
        portalPolicy,
        new URL("http://sirk.local/")
    ),
    false,
    "The explicit sirkAuth marker remains required."
);

console.log("Native access policy: OK");
