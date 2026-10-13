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
        theme: "light",
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


    /* ---------- public API ---------- */

    var Store = {

        /* Namespaced, user-scoped collections */
        get: function (name, fallback) {
            return readJSON(scopeKey(name), fallback === undefined ? null : fallback);
        },

        set: function (name, value) {
            return writeJSON(scopeKey(name), value);
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