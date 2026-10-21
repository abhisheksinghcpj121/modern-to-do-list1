/* =========================================
   SMART STUDY - STORAGE LAYER
   Thin, safe wrapper over localStorage.
   All app data is namespaced PER USER so two
   accounts on one browser never mix data.
   ========================================= */

(function (global) {

    "use strict";

    var NS = "smartStudy";
    var LEGACY_NS = "studySync";
    var MIGRATED_FLAG = NS + ":migrated";
    var SESSION_KEY = NS + ":session";
    var USERS_KEY = NS + ":users";

    var SETTINGS_DEFAULTS = {
        theme: "dark",
        focus: 25,
        shortBreak: 5,
        longBreak: 15,
        longEvery: 4,
        sound: true,
        notify: false,
        dailyGoal: 120
    };

    /*
       Collections that must never leave the device inside a backup
       file. "ai" holds the student's own API key, and a backup is a
       file people mail to themselves or drop in a shared folder -
       the key has no business travelling with it.
    */
    var EXPORT_SKIP = ["ai"];

    /* ...and the same rule for server sync: the key stays local. */
    var SYNC_SKIP = ["ai"];

    var SYNC_DELAY = 400;   /* ms of quiet before a changed collection is pushed */


    /* ---------- raw guards ---------- */

    function rawGet(key) {
        try {
            return global.localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function rawSet(key, value) {
        try {
            global.localStorage.setItem(key, value);
            return true;
        } catch (e) {
            return false;
        }
    }

    function rawDel(key) {
        try {
            global.localStorage.removeItem(key);
        } catch (e) { /* ignore */ }
    }


    /* ---------- one-time namespace migration ----------
       The app was renamed from StudySync to Smart Study, which
       also changed the localStorage prefix. Re-key anything
       written by the older build exactly once so existing
       tasks, notes, plans and accounts are not lost. */
    function migrateLegacyNamespace() {
        if (rawGet(MIGRATED_FLAG)) { return; }

        try {
            var stale = [];
            var i, key;

            /* collect first - deleting shifts the storage index */
            for (i = 0; i < global.localStorage.length; i++) {
                key = global.localStorage.key(i);
                if (key && key.indexOf(LEGACY_NS + ":") === 0) {
                    stale.push(key);
                }
            }

            for (i = 0; i < stale.length; i++) {
                var value = rawGet(stale[i]);
                rawSet(NS + stale[i].slice(LEGACY_NS.length), value);
                rawDel(stale[i]);
            }
        } catch (e) { /* never block startup on this */ }

        rawSet(MIGRATED_FLAG, String(Date.now()));
    }


    /* ---------- json helpers ---------- */

    function readJSON(key, fallback) {
        var raw = rawGet(key);

        if (raw === null) {
            return fallback;
        }

        try {
            var parsed = JSON.parse(raw);
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch (e) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        return rawSet(key, JSON.stringify(value));
    }


    /* ---------- helpers ---------- */

    function normalizeEmail(email) {
        return String(email || "").trim().toLowerCase();
    }

    /*
       Lightweight non-cryptographic hash.
       NOTE: this is a classroom demo - it hides
       passwords from casual shoulder-surfing but
       is NOT real security. A real app needs a
       server + bcrypt/argon2.
    */
    function hashPassword(password, salt) {
        var input = String(password) + "|" + salt;
        var h1 = 5381;
        var h2 = 52711;
        var i;

        for (i = 0; i < input.length; i++) {
            h1 = ((h1 << 5) + h1) ^ input.charCodeAt(i);
            h2 = ((h2 << 5) + h2) + input.charCodeAt(i);
        }

        return (h1 >>> 0).toString(36) + "-" + (h2 >>> 0).toString(36);
    }

    function makeSalt() {
        return Math.random().toString(36).slice(2, 10);
    }


    /* ---------- key scoping ---------- */

    function currentUserKey() {
        var session = readJSON(SESSION_KEY, null);

        if (session && session.email) {
            return session.email;
        }

        return "guest";
    }

    function scopeKey(name) {
        return NS + ":" + currentUserKey() + ":" + name;
    }


    /* =========================================
       SERVER SYNC
       localStorage stays the source of truth the
       pages read (the Store API is synchronous
       and every page depends on that). Writes
       are mirrored to the Node backend in the
       background; a pull on login/page start
       brings in anything saved elsewhere.

       No server / guest mode? Nothing here runs
       and the app behaves exactly as before.
       ========================================= */

    var syncTimer = null;
    var pending = {};
    var suppress = false;   /* true while a server pull is being applied */
    var stateListener = null;   /* UI hook: "syncing" | "synced" | "offline" */

    function report(state) {
        if (stateListener) { stateListener(state); }
    }

    function currentToken() {
        var s = readJSON(SESSION_KEY, null);
        return s && !s.guest && s.token ? s.token : null;
    }

    /* The site can be previewed from a static server - VS Code Live Server,
       or a plain file:// open - while the API only runs on the app's own
       Node server. A relative /api path would then hit the preview server
       and 404, so send it to the backend on port 3000 instead. When the
       app is served by that backend itself the path stays relative, which
       keeps LAN access working exactly as before. */
    function apiOrigin() {

        var here = global.location || {};
        var port = String(here.port || "");
        var protocol = String(here.protocol || "");
        var host = String(here.hostname || "");

        if (port === "3000") { return ""; }
        if (protocol === "file:") { return "http://localhost:3000"; }

        /* same host as the page, so a LAN preview still finds the backend */
        if (!host) { return ""; }

        return (protocol === "https:" ? "https:" : "http:") + "//" + host + ":3000";
    }

    /* One JSON call to the backend. Rejects with {status, message}. */
    function api(method, path, body) {

        var headers = { "Content-Type": "application/json" };
        var token = currentToken();

        if (token) { headers.Authorization = "Bearer " + token; }

        return fetch(apiOrigin() + path, {
            method: method,
            headers: headers,
            body: body === undefined ? null : JSON.stringify(body)
        }).then(function (res) {
            return res.json()
                .catch(function () { return null; })
                .then(function (data) {
                    if (!res.ok) {
                        throw {
                            status: res.status,
                            message: (data && data.error) || "The server said no."
                        };
                    }
                    return data;
                });
        });
    }

    function queueSync(name) {

        if (suppress || SYNC_SKIP.indexOf(name) !== -1) { return; }
        if (!currentToken()) { return; }

        pending[name] = true;

        report("syncing");

        if (syncTimer) { clearTimeout(syncTimer); }
        syncTimer = setTimeout(flushSync, SYNC_DELAY);
    }

    /* Push every queued collection. keepalive=true survives a page unload. */
    function flushSync(keepalive) {

        if (syncTimer) { clearTimeout(syncTimer); }
        syncTimer = null;

        var token = currentToken();

        if (!token) { pending = {}; return; }

        Object.keys(pending).forEach(function (name) {

            if (!pending[name]) { return; }
            pending[name] = false;

            var value = readJSON(scopeKey(name), null);

            fetch(apiOrigin() + "/api/data/" + encodeURIComponent(name), {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
                body: JSON.stringify(value === null ? [] : value),
                keepalive: Boolean(keepalive)
            }).then(function (res) {
                report(res.ok ? "synced" : "offline");
            }).catch(function () {
                report("offline");   /* offline - the next write tries again */
            });
        });
    }

    function collectionNames() {
        var prefix = NS + ":" + currentUserKey() + ":";

        return Store.myKeys().map(function (k) {
            return k.slice(prefix.length);
        }).filter(function (name) {
            return SYNC_SKIP.indexOf(name) === -1;
        });
    }

    /* First login / signup: send everything this device has. */
    function pushAll() {
        collectionNames().forEach(function (name) { pending[name] = true; });
        flushSync();
    }

    /* Fetch the server copy and apply it locally. Resolves to true when
       anything on this device actually changed. */
    function pull() {

        if (!currentToken()) { return Promise.resolve(false); }

        return api("GET", "/api/data").then(function (data) {

            var changed = false;

            suppress = true;

            try {
                Object.keys(data.collections || {}).forEach(function (name) {

                    if (SYNC_SKIP.indexOf(name) !== -1) { return; }

                    var incoming = data.collections[name];
                    var local = readJSON(scopeKey(name), null);

                    if (JSON.stringify(local) !== JSON.stringify(incoming)) {
                        writeJSON(scopeKey(name), incoming);
                        changed = true;
                    }
                });
            } finally {
                suppress = false;
            }

            report("synced");

            return changed;

        }).catch(function (err) {

            report("offline");

            /* an expired token should not spam the console - quietly fall
               back to device-only mode until the next login */
            if (err && err.status === 401) {
                var s = readJSON(SESSION_KEY, null);
                if (s) { writeJSON(SESSION_KEY, Object.assign({}, s, { token: null })); }
            }

            return false;
        });
    }

    /* Cheap reachability check for the UI status chip. */
    function probe() {

        if (!currentToken()) { return Promise.resolve(false); }

        return api("GET", "/api/auth/me").then(function () {
            return true;
        }, function () {
            return false;
        });
    }

    /* Wipe the server copy too (Settings -> Erase all data). */
    function wipeRemote() {
        if (!currentToken()) { return; }
        api("DELETE", "/api/data").catch(function () { /* offline: nothing to wipe */ });
    }

    /* Anything still queued should still reach the server when the tab
       closes, otherwise the last few seconds of work would be lost. */
    if (global.addEventListener) {
        global.addEventListener("beforeunload", function () {
            if (Object.keys(pending).some(function (k) { return pending[k]; })) {
                flushSync(true);
            }
        });
    }


    /* ---------- public API ---------- */

    var Store = {

        /* Namespaced, user-scoped collections */
        get: function (name, fallback) {
            return readJSON(scopeKey(name), fallback === undefined ? null : fallback);
        },

        set: function (name, value) {
            var ok = writeJSON(scopeKey(name), value);
            if (ok) { queueSync(name); }
            return ok;
        },

        remove: function (name) {
            rawDel(scopeKey(name));
        },

        /* Every namespaced key belonging to current user */
        myKeys: function () {
            var prefix = NS + ":" + currentUserKey() + ":";
            var keys = [];
            var i;

            try {
                for (i = 0; i < global.localStorage.length; i++) {
                    var k = global.localStorage.key(i);
                    if (k && k.indexOf(prefix) === 0) {
                        keys.push(k);
                    }
                }
            } catch (e) { /* ignore */ }

            return keys;
        },

        /* Login session (not user scoped) */
        session: {
            get: function () {
                return readJSON(SESSION_KEY, null);
            },
            set: function (data) {
                return writeJSON(SESSION_KEY, data);
            },
            clear: function () {
                rawDel(SESSION_KEY);
            }
        },

        /* Registered accounts */
        users: {
            all: function () {
                return readJSON(USERS_KEY, []);
            },
            save: function (list) {
                return writeJSON(USERS_KEY, list);
            },
            find: function (email) {
                var key = normalizeEmail(email);
                var list = this.all();
                var i;

                for (i = 0; i < list.length; i++) {
                    if (list[i].email === key) {
                        return list[i];
                    }
                }

                return null;
            },
            create: function (user) {
                var list = this.all();
                list.push(user);
                return this.save(list);
            },
            update: function (email, patch) {
                var key = normalizeEmail(email);
                var list = this.all();
                var i;

                for (i = 0; i < list.length; i++) {
                    if (list[i].email === key) {
                        list[i] = Object.assign({}, list[i], patch);
                        return this.save(list);
                    }
                }

                return false;
            }
        },

        /* Per-user settings with defaults */
        settings: {
            all: function () {
                return Object.assign(
                    {},
                    SETTINGS_DEFAULTS,
                    readJSON(scopeKey("settings"), {})
                );
            },
            patch: function (obj) {
                var merged = Object.assign({}, this.all(), obj);
                return writeJSON(scopeKey("settings"), merged);
            },
            reset: function () {
                return writeJSON(scopeKey("settings"), SETTINGS_DEFAULTS);
            }
        },

        /* Backup / restore / wipe */
        exportData: function () {
            var out = {};
            var keys = this.myKeys();
            var skip = EXPORT_SKIP.map(function (name) {
                return scopeKey(name);
            });

            keys.forEach(function (k) {
                if (skip.indexOf(k) === -1) {
                    out[k] = rawGet(k);
                }
            });

            return {
                app: "Smart Study",
                version: 2,
                exportedAt: new Date().toISOString(),
                user: currentUserKey(),
                data: out
            };
        },

        importData: function (payload) {
            if (!payload || payload.app !== "Smart Study" || !payload.data) {
                return false;
            }

            var prefix = NS + ":" + currentUserKey() + ":";
            var ok = true;

            Object.keys(payload.data).forEach(function (k) {
                if (k.indexOf(prefix) === 0) {
                    ok = rawSet(k, payload.data[k]) && ok;
                }
            });

            return ok;
        },

        wipe: function () {
            var keys = this.myKeys();
            var i;

            for (i = 0; i < keys.length; i++) {
                rawDel(keys[i]);
            }

            wipeRemote();
        },

        /* Backend access for the auth + settings scripts */
        api: api,

        /* Where /api lives: "" when this page is served by that backend,
           otherwise the port-3000 origin (Live Server, file://). */
        apiOrigin: apiOrigin,

        sync: {
            pushAll: pushAll,
            pull: pull,
            flush: flushSync,
            probe: probe,
            onState: function (fn) { stateListener = fn; },
            isSyncedAccount: function () { return Boolean(currentToken()); }
        },

        uid: function () {
            return (
                Date.now().toString(36) +
                Math.random().toString(36).slice(2, 7)
            );
        },

        hashPassword: hashPassword,
        makeSalt: makeSalt,
        normalizeEmail: normalizeEmail
    };


    /* Runs on every load, but only does work once. */
    migrateLegacyNamespace();

    global.SS = global.SS || {};
    global.SS.store = Store;


}(window));