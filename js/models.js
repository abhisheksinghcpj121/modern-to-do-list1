/* =========================================
   SMART STUDY - DATA MODELS
   One shared CRUD layer per collection so
   pages never talk to localStorage directly.
   ========================================= */

(function (global) {

    "use strict";

    var Store = global.SS.store;

    /*
       ui.js may be parsed after this file, so the UI kit is resolved
       on every call instead of being captured once at load time.
       This keeps models.js immune to <script> ordering.
    */
    function U() {
        return global.SS.ui;
    }

    function make(name) {
        return {

            all: function () {
                var v = Store.get(name);
                return Array.isArray(v) ? v : [];
            },

            save: function (list) {
                return Store.set(name, Array.isArray(list) ? list : []);
            },

            add: function (item) {
                var list = this.all();
                var rec = Object.assign(
                    { id: Store.uid(), createdAt: Date.now() },
                    item
                );

                list.push(rec);
                this.save(list);

                return rec;
            },

            find: function (id) {
                var hit = null;

                this.all().forEach(function (r) {
                    if (r.id === id) {
                        hit = r;
                    }
                });

                return hit;
            },

            update: function (id, patch) {
                var list = this.all();
                var saved = null;

                list = list.map(function (r) {
                    if (r.id === id) {
                        saved = Object.assign({}, r, patch, { updatedAt: Date.now() });
                        return saved;
                    }
                    return r;
                });

                this.save(list);

                return saved;
            },

            remove: function (id) {
                this.save(this.all().filter(function (r) {
                    return r.id !== id;
                }));
            },

            clear: function () {
                this.save([]);
            },

            count: function () {
                return this.all().length;
            }
        };
    }


    /* =========================================
       BUILT-IN SUBJECT SHELF
       The subjects every account starts with.
       One shared list: the Study Plan page,
       the Tasks dropdown and the Quiz page all
       read from here, so subjects are added
       exactly once and show up everywhere.
       ========================================= */

    var DEFAULT_SUBJECTS = [
        "DBMS (Database Management System)",
        "Web Technology",
        "DAA (Design & Analysis of Algorithms)",
        "Compiler Design",
        "Application of Soft Computing",
        "Constitution of India",
        "Computer Graphics",
        "Image Processing"
    ];

    /* Weekly hour target each subject gets when it is first seeded */
    var DEFAULT_TARGET_HOURS = [6, 5, 5, 4, 4, 2, 5, 4];


    var M = {

        tasks: make("tasks"),
        notes: make("notes"),
        goals: make("goals"),
        sessions: make("sessions"),
        exams: make("exams"),

        subjects: Object.assign(make("subjects"), {

            /* Guarantees the built-in shelf exists for this account.
               Idempotent and cheap, so it is safe to call on every page
               load - accounts created before the subject shelf existed
               get backfilled instead of staying empty forever. */
            seedDefaults: function () {
                if (this.count()) { return false; }

                DEFAULT_SUBJECTS.forEach(function (name, i) {
                    this.add({ name: name, targetHours: DEFAULT_TARGET_HOURS[i] });
                }, this);

                return true;
            }
        }),

        plan: make("plan"),

        /* ---------- derived study statistics ---------- */

        study: {

            minutesOn: function (iso) {
                var total = 0;

                this.focusSessions().forEach(function (s) {
                    if (s.date === iso) {
                        total += Number(s.minutes) || 0;
                    }
                });

                return total;
            },

            todayMinutes: function () {
                return this.minutesOn(U().todayISO());
            },

            totalMinutes: function () {
                var total = 0;

                this.focusSessions().forEach(function (s) {
                    total += Number(s.minutes) || 0;
                });

                return total;
            },

            focusSessions: function () {
                return M.sessions.all().filter(function (s) {
                    return s.mode === "focus";
                });
            },

            /* minutes for the last N days, oldest first */
            lastDays: function (n) {
                var out = [];
                var today = U().todayISO();

                for (var i = n - 1; i >= 0; i--) {
                    out.push({
                        date: U().addDays(today, -i),
                        minutes: this.minutesOn(U().addDays(today, -i))
                    });
                }

                return out;
            },

            /* consecutive days with study time, counting back from today */
            streak: function () {
                var days = 0;
                var cursor = U().todayISO();

                if (this.minutesOn(cursor) === 0) {
                    cursor = U().addDays(cursor, -1);
                }

                while (this.minutesOn(cursor) > 0 && days < 400) {
                    days++;
                    cursor = U().addDays(cursor, -1);
                }

                return days;
            },

            /* ---------- hourly and per-subject breakdowns ---------- */

            /* Focus minutes in 24 hourly buckets, 00:00 first.
               Only sessions that recorded a clock time can appear. */
            byHour: function () {

                var buckets = [];
                var i;

                for (i = 0; i < 24; i++) {
                    buckets.push({ hour: i, minutes: 0 });
                }

                this.focusSessions().forEach(function (s) {

                    var stamp = s.finishedAt || s.createdAt;

                    if (!stamp) { return; }

                    var hour = new Date(stamp).getHours();

                    if (hour >= 0 && hour < 24) {
                        buckets[hour].minutes += Number(s.minutes) || 0;
                    }
                });

                return buckets;
            },

            /* Busiest hours first - powers the "you focus best at..." hint */
            bestHours: function (limit) {

                return this.byHour()
                    .filter(function (b) { return b.minutes > 0; })
                    .sort(function (a, b) { return b.minutes - a.minutes; })
                    .slice(0, limit || 3);
            },

            /* Focus minutes per subject, biggest first. A session keeps the
               subject of the task it was started for; older rows fall back
               to matching the saved task title, then to "Unassigned". */
            bySubject: function () {

                var totals = {};
                var tasks = M.tasks.all();

                this.focusSessions().forEach(function (s) {

                    var name = s.subject || "";

                    if (!name && s.taskTitle) {
                        var match = "";

                        tasks.forEach(function (t) {
                            if (t.title === s.taskTitle) { match = t.subject; }
                        });

                        name = match;
                    }

                    name = name || "Unassigned";

                    totals[name] = (totals[name] || 0) + (Number(s.minutes) || 0);
                });

                return Object.keys(totals)
                    .map(function (name) {
                        return { name: name, minutes: totals[name] };
                    })
                    .sort(function (a, b) {
                        return b.minutes - a.minutes;
                    });
            }
        },

        /* ---------- task helpers ---------- */
    };

    /* ---------- task filtering ---------- */

    var REPEATS = {
        none: { label: "Does not repeat", short: "" },
        daily: { label: "Every day", short: "Daily" },
        weekdays: { label: "Every weekday (Mon–Fri)", short: "Weekdays" },
        weekly: { label: "Every week", short: "Weekly" }
    };

    M.taskView = {

        isOverdue: function (task) {
            return Boolean(task.date) && !task.completed && task.date < U().todayISO();
        },

        isToday: function (task) {
            return task.date === U().todayISO();
        },

        open: function () {
            return M.tasks.all().filter(function (t) {
                return !t.completed;
            });
        },

        completed: function () {
            return M.tasks.all().filter(function (t) {
                return t.completed;
            });
        },

        overdue: function () {
            return M.tasks.all().filter(function (t) {
                return M.taskView.isOverdue(t);
            });
        },

        subjects: function () {
            var seen = {};

            M.tasks.all().forEach(function (t) {
                var s = t.subject || "General";
                seen[s] = true;
            });

            return Object.keys(seen).sort();
        },

        /* ---------- recurrence ---------- */

        REPEATS: REPEATS,

        /* a rule only counts when the task also has a start date */
        isRecurring: function (task) {
            return Boolean(task && task.date && task.repeat && task.repeat !== "none");
        },

        repeatLabel: function (task) {
            var rule = (task && task.repeat) || "none";
            return (REPEATS[rule] || REPEATS.none).short;
        },

        /* one step forward along a rule, or null if the rule is unusable */
        stepFrom: function (isoDate, rule) {

            if (rule === "daily") { return U().addDays(isoDate, 1); }
            if (rule === "weekly") { return U().addDays(isoDate, 7); }

            if (rule === "weekdays") {
                var cursor = isoDate;

                /* Fri -> Sat -> Sun -> Mon, so stop on the first weekday */
                for (var i = 0; i < 5; i++) {
                    cursor = U().addDays(cursor, 1);

                    var day = U().parseISO(cursor).getDay();

                    if (day !== 0 && day !== 6) { return cursor; }
                }

                return null;
            }

            return null;
        },

        /* Next date this series should land on. Occurrences that are still
           in the past are skipped, so finishing a task late does not pile
           up a backlog of copies. */
        nextDate: function (task) {

            if (!M.taskView.isRecurring(task)) { return null; }

            var today = U().todayISO();
            var rule = task.repeat;
            var cursor = task.date;

            /* Jump forward in whole rule periods before stepping, so a
               series left untouched for years still resolves instantly
               instead of walking day by day and giving up. */
            if (cursor < today) {

                if (rule === "daily" || rule === "weekdays") {

                    /* Can land on any weekday, so jump to the day before
                       today and let the normal step land on today itself.
                       Starting AT today would skip today's occurrence. */
                    cursor = U().addDays(today, -1);
                } else if (rule === "weekly") {

                    /* weekly must keep its weekday, so move in 7-day jumps */
                    var jumps = Math.floor(U().diffDays(cursor, today) / 7) - 1;

                    if (jumps > 0) {
                        cursor = U().addDays(cursor, jumps * 7);
                    }
                }
            }

            /* bounded, so a malformed date can never spin forever */
            for (var i = 0; i < 60; i++) {

                var next = M.taskView.stepFrom(cursor, rule);

                if (!next) { return null; }

                cursor = next;

                if (cursor >= today) { return cursor; }
            }

            return null;
        },

        /* ---------- stats ---------- */

        stats: function () {
            var all = M.tasks.all();
            var done = all.filter(function (t) { return t.completed; });

            return {
                total: all.length,
                done: done.length,
                pending: all.length - done.length,
                overdue: M.taskView.overdue().length,
                percent: all.length
                    ? Math.round((done.length / all.length) * 100)
                    : 0
            };
        }
    };


    /* ---------- completion, with recurrence ---------- */

    /*
       Finishing a repeating task keeps the finished copy as history and
       schedules a fresh one for the next matching date. The link between
       them is remembered so reopening can undo the new copy.
    */
    M.completeTask = function (id) {

        var task = M.tasks.find(id);

        if (!task) { return null; }

        var next = M.taskView.nextDate(task);
        var spawned = null;

        if (next) {
            spawned = M.tasks.add({
                title: task.title,
                subject: task.subject || "General",
                date: next,
                priority: task.priority || "medium",
                notes: task.notes || "",
                repeat: task.repeat,
                completed: false
            });
        }

        M.tasks.update(id, {
            completed: true,
            completedAt: Date.now(),
            spawnedId: spawned ? spawned.id : null
        });

        return spawned;
    };

    /* Reopening removes the occurrence that was generated, unless the
       student has already completed that one too. */
    M.reopenTask = function (id) {

        var task = M.tasks.find(id);

        if (!task) { return; }

        if (task.spawnedId) {
            var child = M.tasks.find(task.spawnedId);

            if (child && !child.completed) {
                M.tasks.remove(task.spawnedId);
            }
        }

        M.tasks.update(id, {
            completed: false,
            completedAt: null,
            spawnedId: null
        });
    };


    /* ---------- goal helpers ---------- */

    M.goalView = {

        stats: function () {
            var all = M.goals.all();
            var done = all.filter(function (g) { return g.completed; });
            var avg = all.length
                ? Math.round(all.reduce(function (s, g) {
                    return s + (Number(g.progress) || 0);
                }, 0) / all.length)
                : 0;

            return {
                total: all.length,
                done: done.length,
                avgProgress: avg
            };
        },

        daysLeft: function (goal) {
            return goal.deadline ? U().diffDays(U().todayISO(), goal.deadline) : null;
        }
    };


    /* ---------- plan helpers ---------- */

    M.planView = {

        forDay: function (day) {
            return M.plan.all()
                .filter(function (p) {
                    return Number(p.day) === Number(day);
                })
                .sort(function (a, b) {
                    return String(a.start).localeCompare(String(b.start));
                });
        },

        minutesFor: function (subject) {
            return M.plan.all().reduce(function (sum, p) {
                if (!subject || p.subject === subject) {
                    sum += Number(p.minutes) || 0;
                }
                return sum;
            }, 0);
        },

        totalMinutes: function () {
            return M.planView.minutesFor(null);
        }
    };


    /* ---------- exam helpers ---------- */

    M.examView = {

        upcoming: function () {
            return M.exams.all()
                .filter(function (e) {
                    return e.date && e.date >= U().todayISO();
                })
                .sort(function (a, b) {
                    return a.date.localeCompare(b.date);
                });
        },

        daysLeft: function (exam) {
            return U().diffDays(U().todayISO(), exam.date);
        }
    };


    /* read-only copy of the built-in shelf, for pages that need a fallback */
    M.DEFAULT_SUBJECTS = DEFAULT_SUBJECTS.slice();


    global.SS = global.SS || {};
    global.SS.models = M;


}(window));