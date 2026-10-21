/* =========================================
   SMART STUDY - REST API
   All routes live under /api.

     POST   /api/auth/signup     {name, email, password}
     POST   /api/auth/login      {email, password}
     POST   /api/auth/logout
     GET    /api/auth/me
     PATCH  /api/auth/me         {name?, theme?, password?{current,next}}
     GET    /api/data            -> every collection for this user
     PUT    /api/data/:name      <json value>  (replace one collection)
     POST   /api/data/:name      (sendBeacon alias)
     DELETE /api/data            wipe every collection
     POST   /api/ai/openai       keyless relay to the free public endpoint

   Auth is a bearer token returned on signup/login.
   Responses are plain JSON; errors are {error: "..."}.
   ========================================= */

"use strict";

var crypto = require("crypto");
var Readable = require("stream").Readable;
var db = require("./db");
var Auth = require("./auth");
var admin = require("./admin");

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
var COLLECTION_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
var MAX_BODY = 8 * 1024 * 1024;   /* 8 MB per request */


/* ---------- small helpers ---------- */

function send(res, status, body) {

    var text = JSON.stringify(body === undefined ? null : body);

    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
        "Cache-Control": "no-store",
        /* the static site may be opened from file:// or another port */
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    });

    res.end(text);
}

function fail(res, status, message) {
    send(res, status, { error: message });
}

/* Reads and parses a JSON body with a size cap. Calls back with
   (status, parsed): an empty body counts as {} because the admin
   routes carry their credentials in headers, not in the payload. */
function readBody(req, done) {

    var chunks = [];
    var size = 0;

    req.on("data", function (chunk) {

        size += chunk.length;

        if (size > MAX_BODY) {
            req.destroy();
            done(413, null);
            return;
        }

        chunks.push(chunk);
    });

    req.on("end", function () {

        /* an empty body is a valid "no extra input" request */
        if (!chunks.length) { done(200, {}); return; }

        try {
            done(200, JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
            done(400, null);
        }
    });

    req.on("error", function () { done(400, null); });
}

function tokenFrom(req) {

    var header = req.headers.authorization || "";

    if (header.indexOf("Bearer ") === 0) {
        return header.slice(7).trim();
    }

    return null;
}

function publicUser(user) {
    return {
        name: user.name,
        email: user.email,
        theme: user.theme || "light",
        joinedAt: user.joinedAt
    };
}

/* Verifies the bearer token and hands the handler (user, session). */
function withAuth(req, res, handler) {

    var token = tokenFrom(req);
    var session = token && db.findSession(token);

    if (!session) {
        fail(res, 401, "Your session has expired. Please log in again.");
        return;
    }

    /* keep the idle window alive while the client is actually talking
       to us - the tab heartbeat and every write do this for free */
    db.touchSession(token);

    var user = db.findUser(session.email);

    if (!user) {
        db.deleteSession(token);
        fail(res, 401, "Account not found.");
        return;
    }

    handler(user, session, token);
}


/* =========================================
   AUTH ROUTES
   ========================================= */

function signup(req, res, body) {

    var name = String(body.name || "").trim();
    var email = String(body.email || "").trim().toLowerCase();
    var password = String(body.password || "");

    if (name.length < 2) { return fail(res, 400, "Please enter your full name."); }
    if (!EMAIL_RE.test(email)) { return fail(res, 400, "Please enter a valid email address."); }
    if (password.length < 6) { return fail(res, 400, "Password must be at least 6 characters."); }

    if (db.findUser(email)) {
        return fail(res, 409, "An account with this email already exists. Try logging in.");
    }

    var salt = Auth.makeSalt();

    var user = db.createUser({
        email: email,
        name: name,
        salt: salt,
        hash: Auth.hashPassword(password, salt),
        theme: "light",
        joinedAt: Date.now()
    });

    var token = Auth.makeToken();
    db.createSession(token, email, Auth.SESSION_TTL_MS);

    send(res, 201, { token: token, user: publicUser(user) });
}

function login(req, res, body) {

    var email = String(body.email || "").trim().toLowerCase();
    var password = String(body.password || "");

    var user = db.findUser(email);

    if (!user || !Auth.verifyPassword(password, user)) {
        return fail(res, 401, "Email or password is incorrect.");
    }

    var token = Auth.makeToken();
    db.createSession(token, email, Auth.SESSION_TTL_MS);

    send(res, 200, { token: token, user: publicUser(user) });
}

function logout(req, res) {
    var token = tokenFrom(req);
    if (token) { db.deleteSession(token); }
    send(res, 200, { ok: true });
}

function me(req, res) {
    withAuth(req, res, function (user) {
        send(res, 200, { user: publicUser(user) });
    });
}

/* Name, theme and password changes in one place. */
function updateMe(req, res, body) {

    withAuth(req, res, function (user, session, token) {

        var patch = {};

        if (body.name !== undefined) {
            var name = String(body.name).trim();
            if (name.length < 2) { return fail(res, 400, "Please enter a valid name."); }
            patch.name = name;
        }

        if (body.theme !== undefined) {
            var theme = String(body.theme);
            if (theme !== "light" && theme !== "dark") { return fail(res, 400, "Unknown theme."); }
            patch.theme = theme;
        }

        if (body.password) {

            var current = String(body.password.current || "");
            var next = String(body.password.next || "");

            if (!Auth.verifyPassword(current, user)) {
                return fail(res, 403, "Current password is incorrect.");
            }

            if (next.length < 6) {
                return fail(res, 400, "New password must be at least 6 characters.");
            }

            patch.salt = Auth.makeSalt();
            patch.hash = Auth.hashPassword(next, patch.salt);

            /* a password change also retires every other session */
            db.deleteSessionsFor(user.email);
            db.createSession(token, user.email, Auth.SESSION_TTL_MS);
        }

        var updated = db.updateUser(user.email, patch);

        send(res, 200, { user: publicUser(updated) });
    });
}


/* =========================================
   DATA SYNC ROUTES
   ========================================= */

function getData(req, res) {
    withAuth(req, res, function (user) {
        send(res, 200, { collections: db.getAllData(user.email) });
    });
}

function putData(req, res, collection, body) {

    if (!COLLECTION_RE.test(collection)) {
        return fail(res, 400, "Unknown collection name.");
    }

    withAuth(req, res, function (user) {
        db.setData(user.email, collection, body);
        send(res, 200, { ok: true });
    });
}

function wipe(req, res) {
    withAuth(req, res, function (user) {
        db.wipeData(user.email);
        send(res, 200, { ok: true });
    });
}


/* ---------- free AI relay ---------- */

/* The public free endpoint answers server-to-server requests, but it
   challenges anything that carries a browser Origin with an anti-bot
   token. The assistant therefore calls this route and the server
   forwards the call. Only the fixed endpoint below is ever contacted
   and the prompt passes straight through - no key, nothing stored
   beyond the life of the request. */

var FREE_ENDPOINT = "https://text.pollinations.ai/openai";
var FREE_MAX_BODY = 256 * 1024;    /* 256 KB of prompt + history */
var FREE_TIMEOUT_MS = 120000;      /* a slow answer may take a while */

function freeRelay(req, res) {

    var chunks = [];
    var size = 0;
    var overflow = false;

    req.on("data", function (chunk) {
        size += chunk.length;
        if (size > FREE_MAX_BODY) { overflow = true; return; }
        chunks.push(chunk);
    });

    req.on("error", function () {
        fail(res, 400, "Could not read the request.");
    });

    req.on("end", function () {

        if (overflow) { return fail(res, 413, "That prompt is too big."); }
        if (!chunks.length) { return fail(res, 400, "Missing request body."); }

        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, FREE_TIMEOUT_MS);

        function finish() {
            clearTimeout(timer);
        }

        /* the student may close the page or hit stop mid-answer */
        res.on("close", function () {
            finish();
            controller.abort();
        });

        fetch(FREE_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": req.headers.accept || "application/json"
            },
            body: Buffer.concat(chunks),
            signal: controller.signal
        }).then(function (up) {

            finish();

            res.writeHead(up.status, {
                "Content-Type": up.headers.get("content-type") || "application/json; charset=utf-8",
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*"
            });

            if (!up.body) { res.end(); return; }

            /* pipe the upstream stream straight through, so tokens
               reach the page as they arrive rather than all at once */
            var stream = Readable.fromWeb(up.body);

            stream.on("error", function () { res.destroy(); });
            stream.pipe(res);

        }).catch(function (err) {

            finish();

            if (res.headersSent) { res.destroy(); return; }

            fail(res, 502, (err && err.name === "AbortError")
                ? "The free endpoint took too long to answer."
                : "Could not reach the free endpoint.");
        });
    });
}


/* =========================================
   ROUTER
   Returns true when the request was an API
   call (and has been answered).
   ========================================= */

function handle(req, res, url) {

    var parts = url.pathname.split("/").filter(Boolean);   /* ["api", ...] */
    var route = parts.slice(1).join("/");
    var method = req.method.toUpperCase();

    /* preflight for pages opened from file:// */
    if (method === "OPTIONS") {
        send(res, 204, null);
        return true;
    }

    if (route === "auth/signup" && method === "POST") {
        return readBody(req, function (status, body) {
            if (status !== 200) { return fail(res, status, "Invalid JSON body."); }
            signup(req, res, body);
        }), true;
    }

    if (route === "auth/login" && method === "POST") {
        return readBody(req, function (status, body) {
            if (status !== 200) { return fail(res, status, "Invalid JSON body."); }
            login(req, res, body);
        }), true;
    }

    if (route === "auth/logout" && method === "POST") {
        return logout(req, res), true;
    }

    if (route === "auth/me" && method === "GET") {
        return me(req, res), true;
    }

    if (route === "auth/me" && method === "PATCH") {
        return readBody(req, function (status, body) {
            if (status !== 200) { return fail(res, status, "Invalid JSON body."); }
            updateMe(req, res, body);
        }), true;
    }

    if (route === "data" && method === "GET") {
        return getData(req, res), true;
    }

    if (route === "data" && method === "DELETE") {
        return wipe(req, res), true;
    }

    if (parts[1] === "data" && parts.length === 3 && (method === "PUT" || method === "POST")) {
        var collection = decodeURIComponent(parts[2]);

        return readBody(req, function (status, body) {
            if (status !== 200) { return fail(res, status, "Invalid JSON body."); }
            putData(req, res, collection, body);
        }), true;
    }

    /* /api/ai/openai - the browser cannot call the free public endpoint
       directly (it now demands an anti-bot token), so we forward it */
    if (route === "ai/openai" && method === "POST") {
        return freeRelay(req, res), true;
    }

    /* /api/admin/* - protected by the admin key, not a user login */
    if (parts[1] === "admin") {

        var segments = parts.slice(2).map(decodeURIComponent);

        /* only the password reset needs a body */
        if (method === "POST" && segments[0] === "cleanup") {
            return admin.handle(req, res, method, segments, null), true;
        }

        if (method === "POST") {
            return readBody(req, function (status, body) {
                if (status !== 200) { return fail(res, status, "Invalid JSON body."); }
                admin.handle(req, res, method, segments, body);
            }), true;
        }

        return admin.handle(req, res, method, segments, null), true;
    }

    fail(res, 404, "Unknown API route.");
    return true;
}


module.exports = { handle: handle };
