/* =========================================
   SMART STUDY - AUTH
   Client side demo accounts stored in
   localStorage. NOT real security: a real
   deployment needs a backend + server side
   password hashing (bcrypt/argon2).
   ========================================= */

(function (global) {

    "use strict";

    var Store = global.SS.store;
    var ui = global.SS.ui;

    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;


    /* =========================================
       VALIDATION
       ========================================= */

    function validateSignup(data) {
        var name = String(data.name || "").trim();
        var email = Store.normalizeEmail(data.email);
        var password = String(data.password || "");
        var confirm = String(data.confirm || "");

        if (name.length < 2) {
            return "Please enter your full name.";
        }

        if (!EMAIL_RE.test(email)) {
            return "Please enter a valid email address.";
        }

        if (Store.users.find(email)) {
            return "An account with this email already exists. Try logging in.";
        }

        if (password.length < 6) {
            return "Password must be at least 6 characters.";
        }

        if (password !== confirm) {
            return "Passwords do not match.";
        }

        return null;
    }

    function passwordStrength(password) {
        var p = String(password || "");
        var score = 0;

        if (p.length >= 6) { score++; }
        if (p.length >= 10) { score++; }
        if (/[A-Z]/.test(p) && /[a-z]/.test(p)) { score++; }
        if (/\d/.test(p) || /[^\w\s]/.test(p)) { score++; }

        if (!p) { score = 0; }

        return {
            score: Math.min(score, 4),
            label: ["Too weak", "Weak", "Fair", "Good", "Strong"][Math.min(score, 4)],
            color: ["var(--danger)", "var(--danger)", "var(--warn)", "var(--info)", "var(--ok)"][Math.min(score, 4)]
        };
    }


    /* =========================================
       SEED DATA
       Runs after a session exists so the data
       is written into the right user scope.
       ========================================= */

    function seedIfEmpty() {
        var M = global.SS.models;

        /* The subject shelf is idempotent, so it is never held back by the
           bigger demo seed - an account that already has tasks still gets
           its subjects the first time. */
        M.subjects.seedDefaults();

        if (M.tasks.count() === 0 && M.goals.count() === 0 && M.notes.count() === 0) {
            seedDemo();
        }
    }

    function seedDemo() {
        var M = global.SS.models;
        var d = function (n) { return ui.addDays(ui.todayISO(), n); };

        /* Subjects + weekly hour targets (the built-in shelf) */
        M.subjects.seedDefaults();

        /* Tasks */
        [
            ["Finish ER diagram assignment", "DBMS (Database Management System)", d(0), "high", false],
            ["Revise greedy algorithms - activity selection", "DAA (Design & Analysis of Algorithms)", d(0), "high", false],
            ["Submit web technology lab file", "Web Technology", d(-1), "high", false],
            ["Practice lex and yacc programs", "Compiler Design", d(0), "medium", false],
            ["Read fuzzy logic basics", "Application of Soft Computing", d(1), "medium", false],
            ["Learn the Fundamental Rights articles", "Constitution of India", d(1), "medium", false],
            ["Make 3D transformation flashcards", "Computer Graphics", d(2), "low", false],
            ["Solve past paper - Image Processing", "Image Processing", d(3), "high", false],
            ["Clean up portfolio CSS files", "Web Technology", d(4), "low", false],
            ["Revise BCNF examples", "DBMS (Database Management System)", d(-2), "medium", true],
            ["Practice recurrence relations", "DAA (Design & Analysis of Algorithms)", d(-2), "medium", true]
        ].forEach(function (t) {
            M.tasks.add({
                title: t[0],
                subject: t[1],
                date: t[2],
                priority: t[3],
                completed: t[4],
                repeat: "none"
            });
        });

        /* A couple of repeating series, so the feature is visible at once */
        M.tasks.add({
            title: "Spaced revision - one chapter",
            subject: "Compiler Design",
            date: d(0),
            priority: "medium",
            completed: false,
            repeat: "daily"
        });

        M.tasks.add({
            title: "Weekly problem sheet",
            subject: "DAA (Design & Analysis of Algorithms)",
            date: d(1),
            priority: "high",
            completed: false,
            repeat: "weekly"
        });

        /* Goals */
        [
            ["Score above 85% in DBMS", "Exams", d(45), 62, false],
            ["Finish the DAA syllabus", "Exams", d(20), 78, false],
            ["Build 2 web projects", "Projects", d(60), 35, false],
            ["Study 35 hours every week", "Habits", d(7), 80, false],
            ["Improve typing speed to 45 wpm", "Skills", d(30), 40, false],
            ["Morning 6am wake up streak", "Habits", d(14), 90, true]
        ].forEach(function (g) {
            M.goals.add({
                title: g[0],
                category: g[1],
                deadline: g[2],
                progress: g[3],
                completed: g[4]
            });
        });

        /* Notes */
        [
            ["Greedy vs dynamic programming - when to use which",
             "Greedy: make the locally best choice and never revisit it. Works only when the choice leads to a global optimum (activity selection, Huffman, Kruskal).\n\nDynamic programming: overlapping subproblems + optimal substructure — store answers (memoisation / tabulation).\n\nExam tip: if the greedy choice property fails, fall back to DP (0/1 knapsack, LCS).",
             ["daa", "algorithms"]],

            ["Fundamental Rights - quick recap",
             "Articles 14-18: Right to Equality.\nArticles 19-22: Right to Freedom.\nArticles 23-24: Right against Exploitation.\nArticles 25-28: Right to Freedom of Religion.\nArticles 29-30: Cultural & Educational Rights.\nArticle 32: Right to Constitutional Remedies — described by Ambedkar as the 'heart and soul' of the Constitution.\n\nCommon trap: Article 21 (Right to Life) has been widened by many Supreme Court judgments.",
             ["constitution", "polity"]],

            ["DBMS normalisation cheat sheet",
             "1NF: atomic values, no repeating groups.\n2NF: 1NF + no partial dependency on a composite key.\n3NF: 2NF + no transitive dependency.\nBCNF: every determinant is a candidate key.\n\nDenormalisation is done only for read performance, not correctness.",
             ["dbms", "sql"]],

            ["HTML5 semantic elements - revision sheet",
             "Structure: header, nav, main, section, article, aside, footer.\n\nWhy semantics: screen readers and search engines understand the page; layout elements like div give no meaning.\nNew input types: email, date, range, color — they give mobile keyboards and validation for free.\n\nTable tip: always use th with scope, and caption for the table title.",
             ["web", "html"]]
        ].forEach(function (n) {
            M.notes.add({
                title: n[0],
                content: n[1],
                tags: n[2],
                pinned: false,
                color: ui.subjectColor(n[2][0])
            });
        });

        /* Exams */
        [
            ["DBMS mid-term", d(12), "Centre A, Hall 2"],
            ["DAA unit test", d(5), "Room 104"],
            ["Computer Graphics practical", d(24), "Lab 3"]
        ].forEach(function (e) {
            M.exams.add({ title: e[0], date: e[1], venue: e[2] });
        });

        /* Weekly plan */
        [
            [1, "07:00", "DBMS (Database Management System)", "Normalisation up to BCNF", 60],
            [1, "16:00", "DAA (Design & Analysis of Algorithms)", "Greedy algorithms practice", 90],
            [2, "07:00", "Web Technology", "HTML5 + CSS3 layout", 60],
            [2, "17:00", "Compiler Design", "Lexical analysis", 60],
            [3, "07:00", "DAA (Design & Analysis of Algorithms)", "Recurrence relations", 90],
            [3, "16:00", "Constitution of India", "Fundamental Rights", 45],
            [4, "07:00", "Computer Graphics", "2D transformations", 60],
            [4, "17:00", "Application of Soft Computing", "Fuzzy logic basics", 45],
            [5, "07:00", "Image Processing", "Filters and edge detection", 60],
            [5, "16:00", "Web Technology", "JavaScript DOM", 90],
            [6, "09:00", "Compiler Design", "Past paper", 120],
            [0, "10:00", "DBMS (Database Management System)", "Revision + flashcards", 60]
        ].forEach(function (p) {
            M.plan.add({
                day: p[0],
                start: p[1],
                subject: p[2],
                topic: p[3],
                minutes: p[4]
            });
        });

        /* Pomodoro history for the last 7 days.
           Each row is [minutes, task, subject, hourOfDay]. */
        var history = [
            [75, "DAA problem set", "DAA (Design & Analysis of Algorithms)", 8],
            [110, "Normalisation chapter", "DBMS (Database Management System)", 17],
            [45, "Fuzzy logic notes", "Application of Soft Computing", 21],
            [150, "JavaScript DOM practice", "Web Technology", 14],
            [95, "Past paper", "Compiler Design", 10],
            [130, "Edge detection", "Image Processing", 16],
            [60, "Flashcards", "Constitution of India", 20]
        ];

        history.forEach(function (row, i) {
            var iso = ui.addDays(ui.todayISO(), -(history.length - 1 - i));
            var p = iso.split("-");

            /* build the stamp from the session's own date, otherwise
               finishedAt points at today and the hourly chart lies */
            var stamp = new Date(
                Number(p[0]), Number(p[1]) - 1, Number(p[2]), row[3], 0, 0, 0
            ).getTime();

            M.sessions.add({
                mode: "focus",
                minutes: row[0],
                date: iso,
                taskTitle: row[1],
                subject: row[2],
                completed: true,
                finishedAt: stamp
            });
        });
    }


    /* =========================================
       PUBLIC API
       ========================================= */

    /* =========================================
       SERVER ACCOUNTS (with offline fallback)
       The Node backend is the real account store
       whenever it answers; when it does not, the
       old local-only behaviour still runs so the
       app never bricks offline or over file://.
       ========================================= */

    function startSession(user, token) {

        Store.session.set({
            name: user.name,
            email: user.email,
            guest: false,
            theme: user.theme || "dark",
            since: Date.now(),
            token: token || null
        });

        seedIfEmpty();
    }

    /* Server copy wins on login, then anything local is pushed up and
       the demo seed fills the blanks. Resolves to {ok}. */
    function afterServerLogin(user, token) {

        startSession(user, token);

        return Store.sync.pull().then(function () {
            seedIfEmpty();
            Store.sync.pushAll();
            return { ok: true };
        });
    }

    /* Legacy local-only account: rebuild it on the server with the same
       password and keep its data, so nothing is lost at the upgrade. */
    function promoteLocalAccount(local, password) {

        return Store.api("POST", "/api/auth/signup", {
            name: local.name,
            email: local.email,
            password: password
        }).then(function (r) {
            return afterServerLogin(r.user, r.token);
        });
    }

    /* Offline path: the original local-only account check. */
    function localLogin(key, password, local) {

        if (!local) {
            return {
                ok: false,
                error: "No account found with this email, and the server is unreachable."
            };
        }

        if (Store.hashPassword(password, local.salt) !== local.hash) {
            return { ok: false, error: "Incorrect password. Please try again." };
        }

        Store.session.set({
            name: local.name,
            email: local.email,
            guest: false,
            theme: local.theme || "dark",
            since: Date.now(),
            token: null
        });

        seedIfEmpty();

        return { ok: true, offline: true };
    }


    var Auth = {

        signup: function (data) {

            var error = validateSignup(data);

            if (error) {
                return Promise.resolve({ ok: false, error: error });
            }

            var name = String(data.name).trim();
            var email = Store.normalizeEmail(data.email);

            return Store.api("POST", "/api/auth/signup", {
                name: name,
                email: email,
                password: data.password
            }).then(function (r) {

                /* keep a local mirror so this account also works offline */
                var salt = Store.makeSalt();

                Store.users.create({
                    name: name,
                    email: email,
                    salt: salt,
                    hash: Store.hashPassword(data.password, salt),
                    theme: "dark",
                    joinedAt: Date.now()
                });

                startSession(r.user, r.token);
                Store.sync.pushAll();

                return { ok: true };

            }).catch(function (err) {

                /* the server refused (duplicate email, weak password) */
                if (err && err.status) {
                    return { ok: false, error: err.message };
                }

                /* offline: the original local-only signup */
                var salt = Store.makeSalt();

                Store.users.create({
                    name: name,
                    email: email,
                    salt: salt,
                    hash: Store.hashPassword(data.password, salt),
                    theme: "dark",
                    joinedAt: Date.now()
                });

                startSession({ name: name, email: email }, null);

                return { ok: true, offline: true };
            });
        },

        login: function (email, password) {

            var key = Store.normalizeEmail(email);
            var local = Store.users.find(key);

            if (!EMAIL_RE.test(key)) {
                return Promise.resolve({ ok: false, error: "Please enter a valid email address." });
            }

            if (!String(password || "")) {
                return Promise.resolve({ ok: false, error: "Please enter your password." });
            }

            return Store.api("POST", "/api/auth/login", {
                email: key,
                password: password
            }).then(function (r) {
                return afterServerLogin(r.user, r.token);

            }).catch(function (err) {

                /* already on the server under an older local-only
                   account - move it up instead of failing */
                if (local && Store.hashPassword(password, local.salt) === local.hash) {

                    return promoteLocalAccount(local, password).catch(function () {
                        return localLogin(key, password, local);
                    });
                }

                if (err && err.status) {
                    return { ok: false, error: err.message };
                }

                /* offline: local accounts still open the app */
                return localLogin(key, password, local);
            });
        },

        loginAsGuest: function () {
            Store.session.set({
                name: "Guest",
                email: "guest@smartstudy.app",
                guest: true,
                since: Date.now()
            });

            seedIfEmpty();

            return { ok: true };
        },

        logout: function (options) {

            var silent = Boolean(options && options.silent);

            Store.api("POST", "/api/auth/logout").catch(function () { /* offline */ });
            Store.session.clear();

            /* a stepped-down session (expired / idle timed out) goes
               back to the login screen, a voluntary logout to home */
            global.location.href = silent ? "login.html" : "index.html";
        },

        /* Asks the server whether this session is still alive.
           Resolves true (fine), false (expired - step down) or
           null (server unreachable - leave things alone). */
        refreshLogin: function () {

            if (!Store.sync || !Store.sync.isSyncedAccount()) {
                return Promise.resolve(null);
            }

            return Store.api("GET", "/api/auth/me").then(function () {
                return true;
            }, function (err) {
                return (err && err.status === 401) ? false : null;
            });
        },

        current: function () {
            return Store.session.get();
        },

        /* Redirect to login if nobody is signed in */
        require: function () {
            var session = Store.session.get();

            if (!session) {
                var next = (location.pathname.split("/").pop() || "dashboard.html") + location.search;
                global.location.replace("login.html?next=" + encodeURIComponent(next));
                return null;
            }

            return session;
        },

        /* Send already signed in users away from login/signup */
        redirectIfAuthed: function () {
            if (Store.session.get()) {
                global.location.replace("dashboard.html");
                return true;
            }
            return false;
        },

        nextUrl: function () {
            var params = new URLSearchParams(location.search);
            var next = params.get("next");

            /* only allow local page names, never external URLs */
            if (next && /^[a-z0-9_\-]+\.html$/i.test(next)) {
                return next;
            }

            return "dashboard.html";
        },

        strength: passwordStrength,

        seedDemo: seedDemo
    };


    global.SS = global.SS || {};
    global.SS.auth = Auth;


}(window));