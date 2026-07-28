"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;
var ROLES = ["admin", "operator", "viewer"];

function copy(value) {
    return JSON.parse(JSON.stringify(value));
}

function atomicWrite(filePath, value) {
    var temporary = filePath + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600
    });
    fs.renameSync(temporary, filePath);
}

function hashPassword(password, salt) {
    salt = salt || crypto.randomBytes(16).toString("hex");
    return {
        algorithm: "scrypt",
        salt: salt,
        hash: crypto.scryptSync(String(password), Buffer.from(salt, "hex"), 64).toString("hex")
    };
}

function verifyPassword(password, credential) {
    if (!credential || credential.algorithm !== "scrypt") return false;
    try {
        var expected = Buffer.from(String(credential.hash || ""), "hex");
        var actual = crypto.scryptSync(String(password), Buffer.from(String(credential.salt || ""), "hex"), expected.length);
        return expected.length > 0 && crypto.timingSafeEqual(expected, actual);
    } catch (error) {
        return false;
    }
}

function normalizeText(value, maximum) {
    return String(value == null ? "" : value).trim().slice(0, maximum);
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        roles: user.roles.slice(),
        groups: user.groups.slice(),
        enabled: user.enabled !== false,
        createdAtUtc: user.createdAtUtc,
        updatedAtUtc: user.updatedAtUtc,
        lastLoginAtUtc: user.lastLoginAtUtc || null
    };
}

function create(options) {
    options = options || {};
    var dataRoot = path.resolve(options.dataRoot);
    var filePath = path.join(dataRoot, "identity.json");
    fs.mkdirSync(dataRoot, { recursive: true });
    var state;

    function load() {
        try {
            state = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (error) {
            state = { version: 1, revision: 0, users: [], groups: [] };
        }
        if (!Array.isArray(state.users)) state.users = [];
        if (!Array.isArray(state.groups)) state.groups = [];
    }

    function save() {
        state.revision = Number(state.revision || 0) + 1;
        atomicWrite(filePath, state);
    }

    function userById(id) {
        return state.users.find(function (user) { return user.id === String(id || ""); }) || null;
    }

    function userByName(username) {
        username = String(username || "").toLowerCase();
        return state.users.find(function (user) { return user.username.toLowerCase() === username; }) || null;
    }

    function groupById(id) {
        return state.groups.find(function (group) { return group.id === String(id || ""); }) || null;
    }

    function validatePassword(password) {
        password = String(password || "");
        if (password.length < 10 || password.length > 256) {
            throw new Error("Hasło musi mieć od 10 do 256 znaków.");
        }
        return password;
    }

    function normalizeRoles(value) {
        var roles = (Array.isArray(value) ? value : []).map(String).filter(function (role, index, list) {
            return ROLES.indexOf(role) >= 0 && list.indexOf(role) === index;
        });
        return roles.length ? roles : ["viewer"];
    }

    function normalizeGroups(value) {
        return (Array.isArray(value) ? value : []).map(String).filter(function (id, index, list) {
            return !!groupById(id) && list.indexOf(id) === index;
        });
    }

    function administratorCount(exceptId) {
        return state.users.filter(function (user) {
            return user.id !== exceptId && user.enabled !== false && user.roles.indexOf("admin") >= 0;
        }).length;
    }

    function ensureInitialAdministrator() {
        if (state.users.length) return;
        var username = String(options.initialUsername || "admin");
        var password = String(options.initialPassword || "");
        if (!USERNAME_PATTERN.test(username)) throw new Error("Initial administrator username is invalid.");
        if (!password) throw new Error("SIRK_LOGIN_PASSWORD is required when the identity store is empty.");
        var now = new Date().toISOString();
        state.users.push({
            id: crypto.randomUUID(),
            username: username,
            displayName: normalizeText(options.initialDisplayName || username, 120),
            roles: ["admin"],
            groups: [],
            enabled: true,
            credential: hashPassword(password),
            sessionVersion: 1,
            createdAtUtc: now,
            updatedAtUtc: now,
            lastLoginAtUtc: null
        });
        save();
    }

    load();
    ensureInitialAdministrator();

    return {
        authenticate: function (username, password) {
            var user = userByName(username);
            if (!user || user.enabled === false || !verifyPassword(password, user.credential)) return null;
            user.lastLoginAtUtc = new Date().toISOString();
            save();
            return publicUser(user);
        },
        resolveSessionUser: function (id, sessionVersion) {
            var user = userById(id);
            if (!user || user.enabled === false || Number(user.sessionVersion || 0) !== Number(sessionVersion || 0)) return null;
            return publicUser(user);
        },
        sessionVersion: function (id) {
            var user = userById(id);
            return user ? Number(user.sessionVersion || 0) : 0;
        },
        snapshot: function () {
            return {
                revision: state.revision,
                users: state.users.map(publicUser),
                groups: state.groups.map(copy)
            };
        },
        groups: function () {
            return state.groups.map(function (group) { return { id: group.id, name: group.name }; });
        },
        findUser: function (id) {
            var user = userById(id);
            return user ? publicUser(user) : null;
        },
        createUser: function (value) {
            value = value || {};
            var username = normalizeText(value.username, 64);
            if (!USERNAME_PATTERN.test(username)) throw new Error("Nazwa użytkownika ma nieprawidłowy format.");
            if (userByName(username)) throw new Error("Użytkownik o tej nazwie już istnieje.");
            var now = new Date().toISOString();
            var user = {
                id: crypto.randomUUID(),
                username: username,
                displayName: normalizeText(value.displayName || username, 120),
                roles: normalizeRoles(value.roles),
                groups: normalizeGroups(value.groups),
                enabled: value.enabled !== false,
                credential: hashPassword(validatePassword(value.password)),
                sessionVersion: 1,
                createdAtUtc: now,
                updatedAtUtc: now,
                lastLoginAtUtc: null
            };
            state.users.push(user);
            save();
            return publicUser(user);
        },
        updateUser: function (id, value, actorId) {
            value = value || {};
            var user = userById(id);
            if (!user) throw new Error("Użytkownik nie istnieje.");
            var roles = Object.prototype.hasOwnProperty.call(value, "roles") ? normalizeRoles(value.roles) : user.roles;
            var enabled = Object.prototype.hasOwnProperty.call(value, "enabled") ? value.enabled === true : user.enabled !== false;
            if ((!enabled || roles.indexOf("admin") < 0) && user.roles.indexOf("admin") >= 0 && administratorCount(user.id) === 0) {
                throw new Error("Nie można wyłączyć ani zdegradować ostatniego administratora.");
            }
            if (user.id === actorId && !enabled) throw new Error("Nie można wyłączyć bieżącego konta.");
            user.displayName = Object.prototype.hasOwnProperty.call(value, "displayName")
                ? normalizeText(value.displayName || user.username, 120) : user.displayName;
            user.roles = roles;
            user.groups = Object.prototype.hasOwnProperty.call(value, "groups") ? normalizeGroups(value.groups) : user.groups;
            user.enabled = enabled;
            if (value.password) user.credential = hashPassword(validatePassword(value.password));
            user.sessionVersion = Number(user.sessionVersion || 0) + 1;
            user.updatedAtUtc = new Date().toISOString();
            save();
            return publicUser(user);
        },
        deleteUser: function (id, actorId) {
            var user = userById(id);
            if (!user) throw new Error("Użytkownik nie istnieje.");
            if (user.id === actorId) throw new Error("Nie można usunąć bieżącego konta.");
            if (user.roles.indexOf("admin") >= 0 && administratorCount(user.id) === 0) {
                throw new Error("Nie można usunąć ostatniego administratora.");
            }
            state.users = state.users.filter(function (item) { return item.id !== user.id; });
            save();
        },
        createGroup: function (value) {
            var name = normalizeText(value && value.name, 120);
            if (!name) throw new Error("Nazwa grupy jest wymagana.");
            if (state.groups.some(function (group) { return group.name.toLowerCase() === name.toLowerCase(); })) {
                throw new Error("Grupa o tej nazwie już istnieje.");
            }
            var group = {
                id: crypto.randomUUID(),
                name: name,
                description: normalizeText(value && value.description, 500),
                createdAtUtc: new Date().toISOString()
            };
            state.groups.push(group);
            save();
            return copy(group);
        },
        updateGroup: function (id, value) {
            var group = groupById(id);
            if (!group) throw new Error("Grupa nie istnieje.");
            var name = normalizeText(value && value.name, 120);
            if (!name) throw new Error("Nazwa grupy jest wymagana.");
            if (state.groups.some(function (item) { return item.id !== group.id && item.name.toLowerCase() === name.toLowerCase(); })) {
                throw new Error("Grupa o tej nazwie już istnieje.");
            }
            group.name = name;
            group.description = normalizeText(value && value.description, 500);
            save();
            return copy(group);
        },
        deleteGroup: function (id) {
            if (!groupById(id)) throw new Error("Grupa nie istnieje.");
            state.groups = state.groups.filter(function (group) { return group.id !== id; });
            state.users.forEach(function (user) {
                user.groups = user.groups.filter(function (groupId) { return groupId !== id; });
                user.sessionVersion = Number(user.sessionVersion || 0) + 1;
            });
            save();
        }
    };
}

module.exports = { create: create, verifyPassword: verifyPassword };
