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

        if (M.tasks.count() === 0 && M.goals.count() === 0 && M.notes.count() === 0) {
            seedDemo();
        }
    }

    function seedDemo() {
        var M = global.SS.models;
        var d = function (n) { return ui.addDays(ui.todayISO(), n); };

        /* Subjects + weekly hour targets */
        [
            ["Mathematics", 6],
            ["Physics", 5],
            ["Chemistry", 4],
            ["Computer Science", 5],
            ["English", 3]
        ].forEach(function (s) {
            M.subjects.add({ name: s[0], targetHours: s[1] });
        });

        /* Tasks */
        [
            ["Complete Integration exercise 4.2", "Mathematics", d(0), "high", false],
            ["Revise chapter 6 - Optics", "Physics", d(0), "high", false],
            ["Submit chemistry lab record", "Chemistry", d(-1), "high", false],
            ["Read DBMS normalization chapter", "Computer Science", d(0), "medium", false],
            ["Write 200 word essay draft", "English", d(1), "medium", false],
            ["Practice trigonometry questions", "Mathematics", d(1), "medium", false],
            ["Make organic chemistry flashcards", "Chemistry", d(2), "low", false],
            ["Solve past paper - Physics", "Physics", d(3), "high", false],
            ["Clean up CSS project files", "Computer Science", d(4), "low", false],
            ["Revise vocabulary - Unit 3", "English", d(-2), "medium", true],
            ["Solve quadratic equations set B", "Mathematics", d(-2), "medium", true]
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
            subject: "Physics",
            date: d(0),
            priority: "medium",
            completed: false,
            repeat: "daily"
        });

        M.tasks.add({
            title: "Weekly problem sheet",
            subject: "Mathematics",
            date: d(1),
            priority: "high",
            completed: false,
            repeat: "weekly"
        });

        /* Goals */
        [
            ["Score above 85% in Physics", "Exams", d(45), 62, false],
            ["Finish Calculus syllabus", "Exams", d(20), 78, false],
            ["Build 2 portfolio projects", "Projects", d(60), 35, false],
            ["Study 10 hours every week", "Habits", d(7), 80, false],
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
            ["Integration by parts - formula sheet",
             "LIATE rule: Logarithmic, Inverse trig, Algebraic, Trigonometric, Exponential.\n\nBy parts:  ∫u dv = uv − ∫v du\n\nExample:\n∫x·ln(x) dx = x²/2 · ln(x) − ∫x²/2 · (1/x) dx\n= x²/2 · ln(x) − x²/4 + C\n\nExam tip: always state which letter is u first.",
             ["maths", "formulas"]],

            ["Newton's laws - quick recap",
             "1st law: body stays at rest or uniform motion unless a net force acts.\n2nd law: F = ma (vector form). Weight = mg.\n3rd law: every action has an equal and opposite reaction (forces act on DIFFERENT bodies).\n\nCommon trap: action/reaction pairs never cancel because they act on different objects.",
             ["physics", "chapter-6"]],

            ["DBMS normalisation cheat sheet",
             "1NF: atomic values, no repeating groups.\n2NF: 1NF + no partial dependency on a composite key.\n3NF: 2NF + no transitive dependency.\nBCNF: every determinant is a candidate key.\n\nDenormalisation is done only for read performance, not correctness.",
             ["cs", "dbms"]],

            ["Essay structure template",
             "1. Hook - one strong opening line\n2. Context - why this topic matters\n3. Thesis - state your position in ONE sentence\n4. Body - 2 paragraphs, each: claim → evidence → analysis\n5. Counter argument + rebuttal\n6. Conclusion - restate thesis in new words",
             ["english", "writing"]]
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
            ["Physics mid-term", d(12), "Centre A, Hall 2"],
            ["Mathematics unit test", d(5), "Room 104"],
            ["CS practical exam", d(24), "Lab 3"]
        ].forEach(function (e) {
            M.exams.add({ title: e[0], date: e[1], venue: e[2] });
        });

        /* Weekly plan */
        [
            [1, "07:00", "Physics", "Optics revision", 60],
            [1, "16:00", "Mathematics", "Integration practice", 90],
            [2, "07:00", "Chemistry", "Organic mechanisms", 60],
            [2, "17:00", "Computer Science", "DBMS normalisation", 60],
            [3, "07:00", "Mathematics", "Calculus problem set", 90],
            [3, "16:00", "English", "Essay writing practice", 45],
            [4, "07:00", "Physics", "Numerical problems", 60],
            [4, "17:00", "Chemistry", "Chemical bonding", 45],
            [5, "07:00", "Mathematics", "Trigonometry revision", 60],
            [5, "16:00", "Computer Science", "Project work", 90],
            [6, "09:00", "Physics", "Past paper", 120],
            [0, "10:00", "English", "Revision + flashcards", 60]
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
            [75, "Calculus practice", "Mathematics", 8],
            [110, "Optics revision", "Physics", 17],
            [45, "Essay draft", "English", 21],
            [150, "DBMS chapter", "Computer Science", 14],
            [95, "Past paper", "Physics", 10],
            [130, "Organic chemistry", "Chemistry", 16],
            [60, "Flashcards", "Chemistry", 20]
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

    var Auth = {

        signup: function (data) {
            var error = validateSignup(data);

            if (error) {
                return { ok: false, error: error };
            }

            var salt = Store.makeSalt();

            Store.users.create({
                name: String(data.name).trim(),
                email: Store.normalizeEmail(data.email),
                salt: salt,
                hash: Store.hashPassword(data.password, salt),
                theme: "light",
                joinedAt: Date.now()
            });

            Store.session.set({
                name: String(data.name).trim(),
                email: Store.normalizeEmail(data.email),
                guest: false,
                since: Date.now()
            });

            seedIfEmpty();

            return { ok: true };
        },

        login: function (email, password) {
            var key = Store.normalizeEmail(email);
            var user = Store.users.find(key);

            if (!user) {
                return { ok: false, error: "No account found with this email." };
            }

            if (Store.hashPassword(password, user.salt) !== user.hash) {
                return { ok: false, error: "Incorrect password. Please try again." };
            }

            Store.session.set({
                name: user.name,
                email: user.email,
                guest: false,
                theme: user.theme || "light",
                since: Date.now()
            });

            return { ok: true };
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

        logout: function () {
            Store.session.clear();
            global.location.href = "index.html";
        },

        current: function () {
            return Store.session.get();
        },

        isGuest: function () {
            var s = Store.session.get();
            return Boolean(s && s.guest);
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