/* =========================================
   SMART STUDY - ADMIN API
   Operations dashboard for whoever runs the
   server: account list, per-account view,
   password resets, cleanup and deletion.

   NOT protected by a user login - by a key:
     1. SMART_STUDY_ADMIN_KEY env var (it
        always wins when set), else
     2. server/data/admin.key - written on the
        first boot and reused on every run, so
        the key is the same across restarts.

   Sent as the x-admin-key header, checked
   in constant time.
   ========================================= */

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var db = require("./db");
var Auth = require("./auth");

/* The env var overrides everything. Otherwise the key is read from
   server/data/admin.key, which is written once on the first boot -
   so the admin key stays the same across every restart, however the
   server was started. That folder is blocked by the static file
   server, so the file is never reachable over HTTP. A random key is
   only the last resort (e.g. a read-only disk). */
var KEY_FILE = path.join(__dirname, "data", "admin.key");

function resolveKey() {

    if (process.env.SMART_STUDY_ADMIN_KEY) {
        return { key: String(process.env.SMART_STUDY_ADMIN_KEY), source: "env" };
    }

    try {
        var saved = fs.readFileSync(KEY_FILE, "utf8").trim();
        if (saved) { return { key: saved, source: "file" }; }
    } catch (e) { /* first boot - it is minted below */ }

    var fresh = crypto.randomBytes(16).toString("hex");

    try {
        fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
        fs.writeFileSync(KEY_FILE, fresh + "\n", { encoding: "utf8", mode: 0o600 });
        return { key: fresh, source: "file" };
    } catch (e) {
        return { key: fresh, source: "random" };
    }
}

var RESOLVED = resolveKey();
var KEY = RESOLVED.key;
var FROM_ENV = RESOLVED.source === "env";
var FROM_FILE = RESOLVED.source === "file";

var STARTED_AT = Date.now();


/* ---------- key check ---------- */

function keyMatches(req) {

    var given = req.headers["x-admin-key"];

    if (!given) { return false; }

    if (constantTimeEquals(String(given), KEY)) { return true; }

    /* The first account created on this server is the admin: its
       password is accepted exactly like the key, so the console can be
       opened with a Gmail + password instead of the printed key. */
    return ownerKeyMatch(String(given));
}

/* Does the given string hash to the first account's password? */
function ownerKeyMatch(given) {

    if (!given) { return false; }

    var owner = db.firstUser();

    if (!owner) { return false; }

    return Auth.verifyPassword(given, owner);
}

function constantTimeEquals(a, b) {

    var x = Buffer.from(a);
    var y = Buffer.from(b);

    /* length check first: timingSafeEqual throws on mismatch */
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}


/* ---------- responses (kept local so api.js needs no export churn) ---------- */

function send(res, status, body) {

    var text = JSON.stringify(body === undefined ? null : body);

    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key, x-admin-email, x-admin-password",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
    });

    res.end(text);
}

function fail(res, status, message) {
    send(res, status, { error: message });
}


/* ---------- handlers ---------- */

function stats() {

    var s = db.adminStats();

    return {
        users: s.users,
        sessions: s.sessions,
        collections: s.collections,
        bytes: s.bytes,
        fileBytes: s.fileBytes,
        uptimeMs: Date.now() - STARTED_AT,
        nodeVersion: process.version,
        startedAt: STARTED_AT
    };
}

function users() {

    return {
        users: db.listUsers().map(function (u) {
            return {
                email: u.email,
                name: u.name,
                theme: u.theme || "light",
                joinedAt: u.joinedAt,
                lastActive: u.lastActive,
                collections: u.collections,
                bytes: u.bytes,
                sessions: u.sessions
            };
        })
    };
}

function userDetail(email) {

    var user = db.findUser(email);

    if (!user) { return null; }

    return {
        user: {
            email: user.email,
            name: user.name,
            theme: user.theme || "light",
            joinedAt: user.joinedAt
        },
        collections: db.dataOverview(email).map(function (row) {
            return { name: row.collection, bytes: row.bytes, updatedAt: row.updatedAt };
        }),
        sessions: db.countSessions(email)
    };
}

/* Sets a new password for an account and signs out every device. */
function resetPassword(email, password, done) {

    var user = db.findUser(email);

    if (!user) { done(404, { error: "No account with that email." }); return; }

    var next = String(password || "");

    if (next.length < 8) {
        done(400, { error: "Password must be at least 8 characters." });
        return;
    }

    var salt = Auth.makeSalt();

    db.updateUser(email, { salt: salt, hash: Auth.hashPassword(next, salt) });
    db.deleteSessionsFor(email);

    done(200, { ok: true });
}


/* ---------- router ----------
   Called by api.js for anything under /api/admin/.
   segments: the path after /api/admin, split on "/". */

function handle(req, res, method, segments, body) {

    var top = segments[0] || "";

    /* The console's own sign-in must stay reachable without a key -
       that is the whole point of it. Every other route demands one. */
    if (top === "login" || (top === "owner" && method === "GET")) {
        /* handled below, before the key gate */
    } else if (!keyMatches(req)) {
        fail(res, 401, "Wrong or missing admin key.");
        return;
    }

    /* GET /api/admin/owner - who signs in with Gmail + password.
       Only the address is exposed, never any hash. */
    if (top === "owner" && method === "GET") {

        var owner = db.firstUser();

        send(res, 200, {
            owner: owner ? { email: owner.email, name: owner.name } : null,
            keyFromEnv: FROM_ENV
        });
        return;
    }

    /* POST /api/admin/login - Gmail + password of the first account
       opens the console by returning the operations key.
       Header: x-admin-email / x-admin-password. */
    if (top === "login" && method === "POST") {

        var email = String(req.headers["x-admin-email"] || "").trim().toLowerCase();
        var password = String(req.headers["x-admin-password"] || "");

        if (!ownerKeyMatch(password)) {
            fail(res, 401, "That Gmail or password is not the admin account.");
            return;
        }

        var account = db.findUser(email);

        if (!account || account.email !== db.firstUser().email) {
            fail(res, 403, "This account is not the admin. Use " + db.firstUser().email + ".");
            return;
        }

        send(res, 200, { key: KEY, admin: { email: account.email, name: account.name } });
        return;
    }

    /* GET /api/admin/stats */
    if (top === "stats" && method === "GET") {
        send(res, 200, stats());
        return;
    }

    /* POST /api/admin/cleanup - sweep expired sessions */
    if (top === "cleanup" && method === "POST") {
        var swept = db.deleteExpiredSessions();
        send(res, 200, { ok: true, swept: swept });
        return;
    }

    /* /api/admin/users... */
    if (top === "users") {

        var email = segments[1] ? decodeURIComponent(segments[1]) : null;

        /* GET /api/admin/users */
        if (!email && method === "GET") {
            send(res, 200, users());
            return;
        }

        /* GET /api/admin/users/:email */
        if (email && segments.length === 2 && method === "GET") {
            var detail = userDetail(email);

            if (!detail) { fail(res, 404, "No account with that email."); return; }
            send(res, 200, detail);
            return;
        }

        /* DELETE /api/admin/users/:email */
        if (email && segments.length === 2 && method === "DELETE") {

            if (!db.findUser(email)) {
                fail(res, 404, "No account with that email.");
                return;
            }

            db.deleteAccount(email);
            send(res, 200, { ok: true });
            return;
        }

        /* POST /api/admin/users/:email/password */
        if (email && segments[2] === "password" && method === "POST") {
            resetPassword(email, body && body.password, function (status, out) {
                send(res, status, out);
            });
            return;
        }
    }

    fail(res, 404, "Unknown admin route.");
}


module.exports = {
    handle: handle,
    keyFromEnv: FROM_ENV,
    keyFromFile: FROM_FILE,
    KEY: KEY
};
