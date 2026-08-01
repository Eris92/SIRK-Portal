"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var source = fs.readFileSync(path.join(__dirname, "..", "server", "standalone-https.js"), "utf8");

assert(source.indexOf('url.pathname === "/" && !hasPortalSession') >= 0,
    "Anonymous Portal root must redirect to /login.");
assert(source.indexOf('redirect(res, "/login" + url.search)') >= 0,
    "Portal root redirect must preserve the query string.");
assert(source.indexOf('url.pathname === "/login" && hasPortalSession') >= 0,
    "Authenticated /login must redirect to the Portal workspace.");
assert(source.indexOf('redirect(res, "/")') >= 0,
    "Authenticated login redirect must target the workspace root.");
assert(source.indexOf('cookie(req, "sirk_session")') >= 0,
    "Canonical routing must use the Portal session cookie.");

console.log("Portal canonical login route: OK");
