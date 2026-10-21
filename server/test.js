/* =========================================
   SMART STUDY - BACKEND TEST SUITE
   64 checks: the HTTP API, static serving,
   security, session expiry, the admin
   console, and the real frontend scripts
   (storage.js + auth.js) running against a
   live server from a fake browser sandbox.

     node server/server.js      (in one terminal)
     node server/test.js        (in another)

   No test framework, no dependencies.
   ========================================= */

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT) || 3000;
const BASE = "http://localhost:" + PORT;
const DIR = path.join(__dirname, "..", "js");   /* the real frontend scripts */

/* The mini servers below own their own database file so a suite run
   never writes to the real server/data/smartstudy.db, and so each of
   them really does have exactly one "first account" (the admin). */
const MINI_DB = path.join(__dirname, "data", "test-run.db");
const ADM_DB = path.join(__dirname, "data", "test-admin.db");
/* fresh files per run so the owner account really is the first one */
try { fs.rmSync(MINI_DB, { force: true }); } catch (e) { /* fine */ }
try { fs.rmSync(ADM_DB, { force: true }); } catch (e) { /* fine */ }

let failures = 0;
function check(label, cond, extra) {
    console.log((cond ? "PASS" : "FAIL") + " - " + label + (cond ? "" : "   [" + extra + "]"));
    if (!cond) failures++;
}

async function req(method, url, body, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? null : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-json */ }
    return { status: res.status, data };
}

function waitServer(tries) {
    return fetch(BASE + "/api/data").then(() => true).catch(() => {
        if (tries <= 0) throw new Error("server never came up");
        return new Promise(r => setTimeout(r, 300)).then(() => waitServer(tries - 1));
    });
}

/* ---- fake browser ---- */
function makeSandbox(fetchImpl) {
    const mem = {};
    const localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
        key: (i) => Object.keys(mem)[i] ?? null,
        get length() { return Object.keys(mem).length; }
    };
    const win = {
        localStorage, console, fetch: fetchImpl,
        location: { href: "", reload() {} },
        /* browsers provide these on window; the vm sandbox does not */
        setTimeout, clearTimeout
    };
    win.window = win;
    const sandbox = vm.createContext(win);
    for (const f of ["storage.js", "models.js", "ui-stub.js", "auth.js"]) {
        const code = f === "ui-stub.js"
            ? "window.SS.ui = { todayISO: function(){return new Date().toISOString().slice(0,10);}," +
              " addDays: function(iso,n){var d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);" +
              " return d.toISOString().slice(0,10);}, subjectColor: function(){return '#888888';} };"
            : fs.readFileSync(path.join(DIR, f), "utf8");
        vm.runInContext(code, sandbox, { filename: f });
    }
    return sandbox;
}

const proxiedFetch = (input, init) => fetch(new URL(input, BASE).href, init);
const deadFetch = () => Promise.reject(new TypeError("Failed to fetch"));

/* unique per run, so re-running the suite never hits "email exists" */
const RUN = Date.now().toString(36);
const EMAIL_A = "asha-" + RUN + "@test.com";
const EMAIL_D = "deepa-" + RUN + "@test.com";

(async function main() {

    await waitServer(20);

    /* ---------- static serving ---------- */
    const index = await fetch(BASE + "/");
    check("GET / serves index.html", index.status === 200 && (await index.text()).includes("Smart Study"));

    const storageJs = await fetch(BASE + "/js/storage.js");
    check("GET /js/storage.js served with js mime",
        storageJs.status === 200 && storageJs.headers.get("content-type").includes("javascript"));

    const blocked = await fetch(BASE + "/server/server.js");
    check("server code is NOT reachable over HTTP", blocked.status === 404);

    const traversal = await fetch(BASE + "/%2e%2e/%2e%2e/windows/win.ini");
    check("path traversal is blocked", traversal.status === 403 || traversal.status === 404);

    const missing = await fetch(BASE + "/nope.html");
    check("unknown page -> 404", missing.status === 404);

    /* ---------- API: auth ---------- */
    const EMAIL_S = "student-" + RUN + "@test.com";
    let r = await req("POST", "/api/auth/signup", { name: "Test Student", email: EMAIL_S, password: "secret123" });
    check("signup creates account + token", r.status === 201 && !!r.data.token && r.data.user.email === EMAIL_S, JSON.stringify(r.data));
    const token = r.data.token;

    r = await req("POST", "/api/auth/signup", { name: "Test Student", email: EMAIL_S, password: "secret123" });
    check("duplicate signup rejected with a clear message", r.status === 409 && /already exists/i.test(r.data.error), JSON.stringify(r.data));

    r = await req("POST", "/api/auth/signup", { name: "X", email: "bad", password: "123" });
    check("weak signup rejected", r.status === 400);

    r = await req("POST", "/api/auth/login", { email: EMAIL_S, password: "wrongpass" });
    check("wrong password rejected", r.status === 401);

    r = await req("POST", "/api/auth/login", { email: "nobody@test.com", password: "secret123" });
    check("unknown email rejected", r.status === 401);

    r = await req("POST", "/api/auth/login", { email: EMAIL_S, password: "secret123" });
    check("correct login returns token", r.status === 200 && !!r.data.token);
    const token2 = r.data.token;

    r = await req("GET", "/api/auth/me", undefined, token2);
    check("GET /api/auth/me returns the user", r.status === 200 && r.data.user.name === "Test Student");

    r = await req("GET", "/api/auth/me", undefined, "deadbeef");
    check("bad token -> 401", r.status === 401);

    /* ---------- API: data sync ---------- */
    r = await req("GET", "/api/data", undefined, token2);
    check("fresh account has no collections", r.status === 200 && Object.keys(r.data.collections).length === 0, JSON.stringify(r.data));

    r = await req("PUT", "/api/data/tasks", [{ id: "t1", title: "Learn node http" }], token2);
    check("PUT a collection", r.status === 200 && r.data.ok === true);

    r = await req("PUT", "/api/data/settings", { theme: "dark", focus: 50 }, token2);
    check("PUT a non-array collection (settings)", r.status === 200);

    r = await req("GET", "/api/data", undefined, token2);
    check("GET returns both collections",
        r.status === 200 &&
        r.data.collections.tasks.length === 1 &&
        r.data.collections.tasks[0].title === "Learn node http" &&
        r.data.collections.settings.focus === 50, JSON.stringify(r.data));

    r = await req("PUT", "/api/data/tasks;drop table", [], token2);
    check("weird collection name rejected", r.status === 400);

    r = await req("PATCH", "/api/auth/me", { name: "New Name", theme: "dark" }, token2);
    check("PATCH profile name + theme", r.status === 200 && r.data.user.name === "New Name" && r.data.user.theme === "dark");

    r = await req("PATCH", "/api/auth/me", { password: { current: "nope", next: "secret456" } }, token2);
    check("password change with wrong current -> 403", r.status === 403);

    r = await req("PATCH", "/api/auth/me", { password: { current: "secret123", next: "secret456" } }, token2);
    check("password change works", r.status === 200);

    r = await req("POST", "/api/auth/login", { email: EMAIL_S, password: "secret123" });
    check("old password no longer works", r.status === 401);

    r = await req("POST", "/api/auth/login", { email: EMAIL_S, password: "secret456" });
    check("new password works", r.status === 200);
    const token3 = r.data.token;

    r = await req("DELETE", "/api/data", undefined, token3);
    check("wipe endpoint clears collections", r.status === 200);

    r = await req("GET", "/api/data", undefined, token3);
    check("data really gone", Object.keys(r.data.collections).length === 0);

    r = await req("GET", "/api/nope", undefined, token3);
    check("unknown API route -> 404", r.status === 404);

    r = await req("POST", "/api/auth/logout", undefined, token3);
    check("logout ok", r.status === 200);

    r = await req("GET", "/api/auth/me", undefined, token3);
    check("token dead after logout", r.status === 401);

    /* ---------- frontend: real storage.js + auth.js against the server ---------- */

    // browser A: signup through the actual Auth script
    let A = makeSandbox(proxiedFetch);
    let res = await A.SS.auth.signup({ name: "Asha", email: EMAIL_A, password: "hunter22", confirm: "hunter22" });
    check("frontend signup succeeds", res.ok === true, JSON.stringify(res));

    const sessA = A.SS.store.session.get();
    check("frontend session holds a server token", !!sessA.token && sessA.email === EMAIL_A);

    check("demo data seeded after signup", A.SS.models.subjects.count() === 8 && A.SS.models.tasks.count() > 0);

    // writes should mirror to the server within ~1s
    A.SS.models.tasks.add({ title: "Read the node:http docs", subject: "Web Technology", date: "2026-10-20", priority: "high", completed: false, repeat: "none" });
    await new Promise(r2 => setTimeout(r2, 1200));

    r = await req("GET", "/api/data", undefined, sessA.token);
    const mirrored = r.data.collections.tasks;
    check("frontend writes mirror to the server",
        Array.isArray(mirrored) && mirrored.some(t => t.title === "Read the node:http docs"), JSON.stringify(mirrored || []).slice(0, 120));
    check("subject shelf synced too",
        Array.isArray(r.data.collections.subjects) && r.data.collections.subjects.length === 8);
    check("the AI key never syncs", r.data.collections.ai === undefined);

    // browser B: fresh device, same account -> pull on login brings everything
    let B = makeSandbox(proxiedFetch);
    res = await B.SS.auth.login(EMAIL_A, "hunter22");
    check("frontend login succeeds", res.ok === true, JSON.stringify(res));
    check("login pulls tasks from the server", B.SS.models.tasks.all().some(t => t.title === "Read the node:http docs"));
    check("login pulls the subject shelf", B.SS.models.subjects.count() === 8);

    // offline world: an account that lives only on this device
    let C = makeSandbox(deadFetch);
    const EMAIL_V = "vikram-" + RUN + "@test.com";

    res = await C.SS.auth.signup({ name: "Vikram", email: EMAIL_V, password: "pass1234", confirm: "pass1234" });
    check("offline signup falls back locally", res.ok === true && res.offline === true, JSON.stringify(res));
    check("offline signup still seeds subjects", C.SS.models.subjects.count() === 8);

    C.SS.store.session.clear();

    res = await C.SS.auth.login(EMAIL_V, "pass1234");
    check("offline login falls back to the local account", res.ok === true && res.offline === true, JSON.stringify(res));

    res = await C.SS.auth.login(EMAIL_V, "wrongpass");
    check("offline login still checks the password", res.ok === false, JSON.stringify(res));

    C.SS.models.tasks.add({ title: "Offline task" });
    check("offline writes still work locally", C.SS.models.tasks.count() > 0);

    // guest mode: no server account, no sync
    let G = makeSandbox(proxiedFetch);
    G.SS.auth.loginAsGuest();
    check("guest has no server token", !G.SS.store.session.get().token);
    G.SS.models.tasks.add({ title: "Guest task" });
    await new Promise(r2 => setTimeout(r2, 900));
    r = await req("POST", "/api/auth/login", { email: "guest@smartstudy.app", password: "x" });
    check("guest never created a server account", r.status === 401);

    /* ---------- sessions: server-side idle expiry ----------
       A second server with a 2-second idle window proves the session
       policy without waiting half an hour in the test run. */

    const MINI_PORT = PORT + 1;
    const MINI_BASE = "http://localhost:" + MINI_PORT;
    const mini = spawn(process.execPath, [path.join(__dirname, "server.js")], {
        env: Object.assign({}, process.env, {
            PORT: String(MINI_PORT),
            SMART_STUDY_SESSION_IDLE_MS: "2000",   /* 2 s idle window for the test */
            SMART_STUDY_DB_FILE: MINI_DB
        }),
        stdio: "ignore"
    });

    async function miniReq(method, url, body, token) {
        const headers = { "Content-Type": "application/json" };
        if (token) headers.Authorization = "Bearer " + token;
        const res = await fetch(MINI_BASE + url, { method, headers, body: body === undefined ? null : JSON.stringify(body) });
        let data = null;
        try { data = await res.json(); } catch (e) { /* non-json */ }
        return { status: res.status, data };
    }

    try {
        // wait for the mini server to come up
        let up = false;
        for (let i = 0; i < 40 && !up; i++) {
            up = await fetch(MINI_BASE + "/api/data").then(() => true).catch(() => false);
            if (!up) await new Promise(r2 => setTimeout(r2, 250));
        }
        check("mini server (idle test) came up", up);

        const EMAIL_I = "isha-" + RUN + "@test.com";
        let m = await miniReq("POST", "/api/auth/signup", { name: "Isha", email: EMAIL_I, password: "secret123" });
        const idleToken = m.data && m.data.token;
        check("mini server signup works", m.status === 201 && !!idleToken);

        // staying active inside the window keeps the session alive
        for (let i = 0; i < 3; i++) {
            await new Promise(r2 => setTimeout(r2, 900));   /* < 2 s idle */
            m = await miniReq("GET", "/api/auth/me", undefined, idleToken);
        }
        check("active use keeps the session alive past its idle window", m.status === 200);

        // now go quiet: after the idle window the server lets go
        await new Promise(r2 => setTimeout(r2, 2600));
        m = await miniReq("GET", "/api/data", undefined, idleToken);
        check("idle session dies server-side", m.status === 401, "status " + m.status);

        // and logging in again gets a fresh session
        m = await miniReq("POST", "/api/auth/login", { email: EMAIL_I, password: "secret123" });
        check("re-login after idle expiry works", m.status === 200 && !!m.data.token);

        m = await miniReq("GET", "/api/auth/me", undefined, m.data.token);
        check("fresh session answers /me", m.status === 200);

    } finally {
        mini.kill();
    }

    /* an account for the admin server to own: it is created on that
       server below and becomes its "first account" (the admin) */

    /* ---------- admin console ----------
       A third mini server with a known admin key, so the suite can
       exercise /api/admin/* regardless of the main server's key. */

    const ADM_PORT = PORT + 2;
    const ADM_BASE = "http://localhost:" + ADM_PORT;
    const ADM_KEY = "test-admin-key-" + RUN;
    const admSrv = spawn(process.execPath, [path.join(__dirname, "server.js")], {
        env: Object.assign({}, process.env, {
            PORT: String(ADM_PORT),
            SMART_STUDY_ADMIN_KEY: ADM_KEY,
            SMART_STUDY_DB_FILE: ADM_DB
        }),
        stdio: "ignore"
    });

    async function admReq(method, sub, body, key) {
        const headers = { "Content-Type": "application/json" };
        if (key) headers["x-admin-key"] = key;
        const res = await fetch(ADM_BASE + "/api/admin" + sub, {
            method, headers, body: body === undefined ? null : JSON.stringify(body)
        });
        let data = null;
        try { data = await res.json(); } catch (e) { /* non-json */ }
        return { status: res.status, data };
    }

    async function plainPost(url, body) {
        const res = await fetch(ADM_BASE + url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        return res.status;
    }

    try {
        let up = false;
        for (let i = 0; i < 40 && !up; i++) {
            up = await fetch(ADM_BASE + "/api/data").then(() => true).catch(() => false);
            if (!up) await new Promise(r2 => setTimeout(r2, 250));
        }
        check("admin test server came up", up);

        /* the first account on this server is its admin - create it
           before anything else touches the database */
        const EMAIL_OWNER = "owner-" + RUN + "@test.com";
        await plainPost("/api/auth/signup", { name: "Owner", email: EMAIL_OWNER, password: "ownerpass1" });

        // a regular account for the admin to manage
        const EMAIL_M = "meera-" + RUN + "@test.com";
        await plainPost("/api/auth/signup", { name: "Meera", email: EMAIL_M, password: "secret123" });

        let a = await admReq("GET", "/stats");
        check("admin routes demand a key", a.status === 401, "status " + a.status);

        a = await admReq("GET", "/stats", undefined, "wrong-key");
        check("wrong admin key rejected", a.status === 401);

        a = await admReq("GET", "/stats", undefined, ADM_KEY);
        check("stats answers with the right key",
            a.status === 200 && a.data.users >= 1 && typeof a.data.fileBytes === "number",
            JSON.stringify(a.data).slice(0, 140));

        /* the first account on a server is its admin: Gmail + password
           opens the console (see the owner/login routes) */
        a = await admReq("GET", "/owner", undefined, ADM_KEY);
        check("owner route names the first account",
            a.status === 200 && a.data.owner && typeof a.data.owner.email === "string",
            JSON.stringify(a.data));

        const ownerEmail = a.data.owner.email;

        async function ownerLogin(email, password) {
            const res = await fetch(ADM_BASE + "/api/admin/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-admin-email": email,
                    "x-admin-password": password
                },
                /* the credentials travel in the headers; the body just
                   satisfies the shared JSON-reader for POST routes */
                body: "{}"
            });
            let data = null;
            try { data = await res.json(); } catch (e) { /* non-json */ }
            return { status: res.status, data };
        }

        a = await ownerLogin(ownerEmail, "totally-wrong");
        check("admin login rejects a wrong password", a.status === 401, "status " + a.status);

        a = await ownerLogin(ownerEmail, "a".repeat(8));
        check("admin login rejects a wrong-length password", a.status === 401, "status " + a.status);

        a = await admReq("GET", "/users", undefined, ADM_KEY);
        check("users list includes the fresh account",
            a.status === 200 && a.data.users.some(u => u.email === EMAIL_M),
            JSON.stringify((a.data.users || []).map(u => u.email)).slice(0, 140));

        a = await admReq("GET", "/users/" + encodeURIComponent(EMAIL_M), undefined, ADM_KEY);
        check("user detail shows the account", a.status === 200 && a.data.user.name === "Meera");

        a = await admReq("POST", "/users/" + encodeURIComponent(EMAIL_M) + "/password",
            { password: "sh" }, ADM_KEY);
        check("short reset password rejected", a.status === 400);

        a = await admReq("POST", "/users/" + encodeURIComponent(EMAIL_M) + "/password",
            { password: "brandnew123" }, ADM_KEY);
        check("admin password reset works", a.status === 200);

        let lr = await plainPost("/api/auth/login", { email: EMAIL_M, password: "brandnew123" });
        check("reset password actually logs in", lr === 200);

        a = await admReq("POST", "/cleanup", undefined, ADM_KEY);
        check("cleanup endpoint sweeps", a.status === 200 && typeof a.data.swept === "number");

        a = await admReq("DELETE", "/users/" + encodeURIComponent(EMAIL_M), undefined, ADM_KEY);
        check("delete account works", a.status === 200);

        a = await admReq("GET", "/users/" + encodeURIComponent(EMAIL_M), undefined, ADM_KEY);
        check("deleted account is gone", a.status === 404);

        lr = await plainPost("/api/auth/login", { email: EMAIL_M, password: "brandnew123" });
        check("deleted account cannot log in", lr === 401);

        a = await admReq("GET", "/nonsense", undefined, ADM_KEY);
        check("unknown admin route -> 404", a.status === 404);

        a = await ownerLogin("nobody-admin-" + RUN + "@test.com", "ownerpass1");
        check("admin login rejects a non-owner account", a.status === 403, "status " + a.status);

        /* the password of the first account on this server is the
           admin password - no key needed to reach the console */
        a = await ownerLogin(EMAIL_OWNER, "ownerpass1");
        check("Gmail + password of the first account returns the key",
            a.status === 200 && a.data.key === ADM_KEY, "status " + a.status);

    } finally {
        admSrv.kill();
    }

    console.log(failures === 0 ? "\nALL TESTS PASSED" : "\n" + failures + " TEST(S) FAILED");
    process.exit(failures === 0 ? 0 : 1);

})().catch(err => { console.error("TEST HARNESS ERROR:", err); process.exit(1); });
