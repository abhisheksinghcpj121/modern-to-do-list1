/* =========================================
   SMART STUDY - DASHBOARD
   Premium "dashboard-ultra" layout wired to
   real data: hero, KPI sparkline cards, big
   pomodoro ring, weekly bars, study streak,
   today's plan, kanban, exam countdowns,
   heatmap, AI insights and subject rings.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var Store = global.SS.store;
    var ui = global.SS.ui;
    var M = global.SS.models;

    var el = ui.el;
    var svg = ui.svg;

    /* badges the streak widget counts up to */
    var STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 100, 200, 365];

    var nodes = {};


    /* =========================================
       SMALL HELPERS
       ========================================= */

    function greeting() {
        var h = new Date().getHours();

        if (h < 5) { return "Still up"; }
        if (h < 12) { return "Good morning"; }
        if (h < 17) { return "Good afternoon"; }
        if (h < 21) { return "Good evening"; }

        return "Winding down";
    }

    /* "DBMS (Database Management System)" -> "DBMS" */
    function shortSubject(name) {
        return String(name || "General").split(" (")[0].trim();
    }

    function dailyGoal() {
        return Number(Store.settings.all().dailyGoal) || 120;
    }

    /* tasks that are due today or already overdue */
    function dueToday() {
        var today = ui.todayISO();

        return M.tasks.all().filter(function (t) {
            return t.date === today || M.taskView.isOverdue(t);
        });
    }

    /* focus minutes logged per task title */
    function minutesByTask() {

        var map = {};

        M.study.focusSessions().forEach(function (s) {
            if (s.taskTitle) {
                map[s.taskTitle] = (map[s.taskTitle] || 0) + (Number(s.minutes) || 0);
            }
        });

        return map;
    }

    /* every date that has any logged focus time */
    function studiedDates() {

        var set = {};

        M.study.focusSessions().forEach(function (s) {
            if (s.date && (Number(s.minutes) || 0) > 0) {
                set[s.date] = true;
            }
        });

        return set;
    }

    /* longest run of consecutive study days in the whole history */
    function bestStreak() {

        var dates = Object.keys(studiedDates()).sort();
        var best = 0;
        var run = 0;
        var prev = null;

        dates.forEach(function (iso) {
            run = (prev !== null && ui.addDays(prev, 1) === iso) ? run + 1 : 1;
            if (run > best) { best = run; }
            prev = iso;
        });

        return best;
    }

    /* tasks completed on a given day (uses the completedAt stamp) */
    function completedOn(iso) {

        var count = 0;

        M.tasks.all().forEach(function (t) {

            if (!t.completed || !t.completedAt) { return; }

            var d = new Date(Number(t.completedAt));

            if (isNaN(d.getTime())) { return; }

            var stamp = d.getFullYear() + "-" +
                ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
                ("0" + d.getDate()).slice(-2);

            if (stamp === iso) { count++; }
        });

        return count;
    }

    /* a daily "focus score": how much of the goal was hit plus task follow-through */
    function scoreOn(iso) {

        var goal = dailyGoal();
        var minutes = M.study.minutesOn(iso);
        var timePct = goal ? Math.min(100, (minutes / goal) * 100) : 0;

        var due = M.tasks.all().filter(function (t) { return t.date === iso; });
        var done = due.filter(function (t) { return t.completed; }).length;
        var taskPct = due.length ? (done / due.length) * 100 : timePct;

        return Math.max(0, Math.min(100, Math.round(timePct * 0.6 + taskPct * 0.4)));
    }

    /* turn a series of numbers into an SVG path inside a 0..120 x 0..40 box */
    function sparkPath(values) {

        if (!values || !values.length) { return ""; }

        var max = 1;
        var n = values.length;
        var out = "";

        values.forEach(function (v) { if (v > max) { max = v; } });

        values.forEach(function (v, i) {
            var x = n > 1 ? (i / (n - 1)) * 118 + 1 : 60;
            var y = 36 - (v / max) * 28;
            out += (i ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        });

        return out;
    }

    function setText(node, text) {
        if (node) { node.textContent = text; }
    }

    /* big number + optional <small> suffix */
    function setVal(node, main, small) {

        if (!node) { return; }

        ui.clear(node);
        node.appendChild(doc.createTextNode(main));

        if (small) {
            node.appendChild(el("small", { text: " " + small }));
        }
    }

    function setDelta(node, diff, suffix, alwaysUp) {

        if (!node) { return; }

        node.className = "delta";

        var v = Math.round(diff);

        if (alwaysUp) {
            node.classList.add("up");
            node.textContent = alwaysUp;
            return;
        }

        if (v > 0) {
            node.classList.add("up");
            node.textContent = "▲ " + Math.abs(v) + (suffix || "");
        } else if (v < 0) {
            node.classList.add("down");
            node.textContent = "▼ " + Math.abs(v) + (suffix || "");
        } else {
            node.textContent = "—";
        }
    }

    /* per-subject rollup used by the mastery rings and the insights list */
    function subjectStats() {

        var minutesByName = {};

        M.study.bySubject().forEach(function (s) {
            minutesByName[s.name] = (minutesByName[s.name] || 0) + s.minutes;
        });

        return M.subjects.all().map(function (sub) {

            var name = sub.name;
            var short = shortSubject(name);

            var list = M.tasks.all().filter(function (t) {
                return (t.subject || "General") === name;
            });

            var done = list.filter(function (t) { return t.completed; }).length;
            var taskPct = list.length ? (done / list.length) * 100 : 0;

            var minutes = minutesByName[name];

            if (minutes === undefined) {
                minutes = 0;

                Object.keys(minutesByName).forEach(function (k) {
                    if (shortSubject(k).toLowerCase() === short.toLowerCase()) {
                        minutes += minutesByName[k];
                    }
                });
            }

            var target = (Number(sub.targetHours) || 4) * 60;
            var timePct = target ? Math.min(100, (minutes / target) * 100) : 0;
            var hasData = list.length > 0 || minutes > 0;
            var mastery = hasData ? Math.round(taskPct * 0.6 + timePct * 0.4) : 0;

            return {
                name: name,
                short: short,
                total: list.length,
                done: done,
                pending: list.length - done,
                minutes: minutes,
                mastery: Math.max(0, Math.min(100, mastery)),
                color: ui.subjectColor(name)
            };
        });
    }


    /* =========================================
       HERO
       ========================================= */

    function renderHero() {

        var session = global.SS.auth.require();

        if (!session || !nodes.greetName) { return; }

        var firstName = String(session.name || "").split(" ")[0] || "there";

        ui.clear(nodes.greetName);
        nodes.greetName.appendChild(doc.createTextNode(greeting() + ", "));
        nodes.greetName.appendChild(el("em", { text: firstName }));
        nodes.greetName.appendChild(doc.createTextNode(" 👋"));

        if (nodes.greetMeta) {

            var goal = dailyGoal();
            var today = M.study.todayMinutes();
            var left = Math.max(0, goal - today);

            var dateStr = new Date().toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long"
            });

            ui.clear(nodes.greetMeta);
            nodes.greetMeta.appendChild(doc.createTextNode(dateStr + " · Today's target is "));
            nodes.greetMeta.appendChild(el("b", { text: ui.fmtMinutes(goal) }));
            nodes.greetMeta.appendChild(doc.createTextNode(" — you're at " + ui.fmtMinutes(today) + ". "));
            nodes.greetMeta.appendChild(doc.createTextNode(
                left === 0 ? "Goal reached 🎉" : ui.fmtMinutes(left) + " to go!"
            ));
        }
    }


    /* =========================================
       KPI CARDS
       ========================================= */

    function renderKpis() {

        var goal = dailyGoal();
        var today = ui.todayISO();
        var yesterday = ui.addDays(today, -1);
        var days = M.study.lastDays(9);

        /* 1. study time today */
        var todayMinutes = M.study.todayMinutes();

        setVal(nodes.kpiFocusVal, ui.fmtMinutes(todayMinutes));
        setDelta(nodes.kpiFocusDelta, todayMinutes - M.study.minutesOn(yesterday), "m");

        if (nodes.kpiFocusSpark) {
            nodes.kpiFocusSpark.setAttribute("d", sparkPath(days.map(function (d) { return d.minutes; })));
        }

        /* 2. tasks complete */
        var stats = M.taskView.stats();

        setVal(nodes.kpiTasksVal, String(stats.done), "/ " + stats.total + " tasks");
        setDelta(nodes.kpiTasksDelta, completedOn(today) - completedOn(yesterday), "");

        if (nodes.kpiTasksSpark) {
            nodes.kpiTasksSpark.setAttribute("d", sparkPath(days.map(function (d) {
                return completedOn(d.date);
            })));
        }

        /* 3. focus score */
        var score = scoreOn(today);

        setVal(nodes.kpiScoreVal, String(score), "/ 100");
        setDelta(nodes.kpiScoreDelta, score - scoreOn(yesterday), "");

        if (nodes.kpiScoreSpark) {
            nodes.kpiScoreSpark.setAttribute("d", sparkPath(days.map(function (d) {
                return scoreOn(d.date);
            })));
        }

        /* 4. current streak */
        var streak = M.study.streak();
        var best = Math.max(bestStreak(), streak);

        setVal(nodes.kpiStreakVal, String(streak), streak === 1 ? "day" : "days");
        setDelta(nodes.kpiStreakDelta, 0, "", "best " + best);

        if (nodes.kpiStreakSpark) {
            nodes.kpiStreakSpark.setAttribute("d", sparkPath(days.map(function (d) { return d.minutes; })));
        }
    }


    /* =========================================
       WEEKLY BARS
       ========================================= */

    function renderWeekBars() {

        if (!nodes.weekBars) { return; }

        var days = M.study.lastDays(7);
        var goal = dailyGoal();
        var max = goal;

        days.forEach(function (d) { if (d.minutes > max) { max = d.minutes; } });

        ui.clear(nodes.weekBars);

        /* dashed goal line */
        var goalTop = Math.max(3, Math.min(96, Math.round(100 - (goal / max) * 100)));

        nodes.weekBars.appendChild(
            el("div", { class: "goal", style: { top: goalTop + "%" } }, [
                el("span", { text: "Goal " + ui.fmtMinutes(goal) })
            ])
        );

        var maxIdx = 0;

        days.forEach(function (d, i) { if (d.minutes > days[maxIdx].minutes) { maxIdx = i; } });

        days.forEach(function (d, i) {

            var pct = Math.max(4, Math.round((d.minutes / max) * 100));
            var label = ui.weekdayName(ui.parseISO(d.date).getDay(), true);

            var col = el("div", {
                class: "col" + (i === maxIdx && d.minutes > 0 ? " hot" : "")
            }, [
                el("i"),
                el("small", { text: label })
            ]);

            col.style.setProperty("--h", pct + "%");
            col.style.setProperty("--d", (i * 0.07).toFixed(2) + "s");
            col.title = ui.fmtDateLong(d.date) + " · " + (d.minutes ? ui.fmtMinutes(d.minutes) : "no study");

            nodes.weekBars.appendChild(col);
        });

        var total = days.reduce(function (sum, d) { return sum + d.minutes; }, 0);

        setText(nodes.weekNote, ui.fmtMinutes(Math.round(total / 7)) + " avg");
    }


    /* =========================================
       STUDY STREAK
       ========================================= */

    function renderStreak() {

        if (!nodes.streakNum) { return; }

        var streak = M.study.streak();
        var best = Math.max(bestStreak(), streak);

        nodes.streakNum.textContent = String(streak);

        setText(nodes.streakLink, streak + (streak === 1 ? " day 🔥" : " days 🔥"));

        if (nodes.streakSub) {
            nodes.streakSub.textContent = streak === 0
                ? "start your streak today"
                : streak + (streak === 1 ? " day in a row" : " days in a row") +
                    " — personal best: " + best;
        }

        if (nodes.streakBest) {
            nodes.streakBest.textContent = best + (best === 1 ? " day" : " days");
        }

        /* 7-day strip for the current week, Monday first */
        if (nodes.streakWeek) {

            ui.clear(nodes.streakWeek);

            var letters = ["M", "T", "W", "T", "F", "S", "S"];
            var today = ui.todayISO();
            var monday = ui.addDays(today, -((new Date().getDay() + 6) % 7));
            var thisWeek = 0;

            for (var i = 0; i < 7; i++) {

                var iso = ui.addDays(monday, i);
                var minutes = M.study.minutesOn(iso);
                var cls = "d";

                if (iso <= today && minutes > 0) {
                    cls += " ok";
                    thisWeek++;
                }

                if (iso === today) { cls += " today"; }
                if (iso > today) { cls += " future"; }

                var cell = el("span", { class: cls, text: letters[i] });
                cell.title = ui.fmtDateLong(iso) + " · " +
                    (minutes ? ui.fmtMinutes(minutes) : "no study");

                nodes.streakWeek.appendChild(cell);
            }

            setText(nodes.streakWeekCount, thisWeek + " / 7");
        }

        /* progress to the next badge */
        var next = null;

        for (var m = 0; m < STREAK_MILESTONES.length; m++) {
            if (STREAK_MILESTONES[m] > streak) {
                next = STREAK_MILESTONES[m];
                break;
            }
        }

        if (next === null) {
            next = STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
        }

        setText(nodes.streakNextLabel, next > streak
            ? "Next badge · " + next + " days"
            : "Top badge reached 🏆");

        setText(nodes.streakNextVal, streak + " / " + next);

        if (nodes.streakBar) {
            var pct = Math.max(0, Math.min(100, Math.round((streak / next) * 100)));
            nodes.streakBar.style.width = "0%";
            setTimeout(function () {
                nodes.streakBar.style.width = pct + "%";
            }, 120);
        }
    }


    /* =========================================
       OVERDUE BANNER
       ========================================= */

    function renderOverdue() {

        if (!nodes.alertBar) { return; }

        var overdue = M.taskView.overdue().length;

        ui.clear(nodes.alertBar);

        if (overdue > 0) {
            nodes.alertBar.className = "alert-bar c12";
            nodes.alertBar.appendChild(el("span", { text: "⚠️" }));
            nodes.alertBar.appendChild(
                el("span", {
                    text: overdue + " task(s) are past their due date. Clear them before adding more."
                })
            );
            nodes.alertBar.style.display = "flex";
        } else {
            nodes.alertBar.style.display = "none";
        }
    }


    /* =========================================
       HEATMAP (last 12 weeks)
       ========================================= */

    function renderHeat() {

        if (!nodes.heatHome) { return; }

        ui.clear(nodes.heatHome);

        var goal = dailyGoal();
        var today = ui.todayISO();
        var now = new Date();

        /* 26 weeks (6 months), back to the Sunday that starts that week */
        var WEEKS = 26;
        var start = ui.addDays(today, -((WEEKS - 1) * 7) - now.getDay());

        for (var i = 0; i < WEEKS * 7; i++) {

            var iso = ui.addDays(start, i);
            var cell = el("i");

            if (iso <= today) {

                var minutes = M.study.minutesOn(iso);

                if (minutes > 0) {
                    cell.className = "l" + (
                        minutes < goal * 0.3 ? 1 :
                            minutes < goal * 0.7 ? 2 :
                                minutes < goal ? 3 : 4
                    );
                }

                cell.title = ui.fmtDateLong(iso) + " · " +
                    (minutes ? ui.fmtMinutes(minutes) : "no study");
            }

            cell.style.animationDelay = (i * 5) + "ms";
            nodes.heatHome.appendChild(cell);
        }

        setText(nodes.heatNote, ui.fmtMinutes(M.study.totalMinutes()) + " total");
    }


    /* =========================================
       EXAM COUNTDOWNS
       ========================================= */

    function examSubject(exam) {

        var title = String(exam.title || "").toLowerCase();
        var match = null;
        var matchLen = 0;

        M.subjects.all().forEach(function (s) {

            var short = shortSubject(s.name).toLowerCase();

            if (short && title.indexOf(short) > -1 && short.length > matchLen) {
                match = s.name;
                matchLen = short.length;
            }
        });

        return match;
    }

    function renderExams() {

        if (!nodes.examList) { return; }

        ui.clear(nodes.examList);

        var exams = M.examView.upcoming().slice(0, 3);

        if (!exams.length) {
            nodes.examList.appendChild(
                el("p", {
                    class: "hint",
                    text: "No upcoming exams. Add them in Study Plan to see countdowns."
                })
            );
            return;
        }

        exams.forEach(function (ex) {

            var left = M.examView.daysLeft(ex);
            var color = ui.subjectColor(examSubject(ex) || "General");
            var cls = left <= 7 ? " soon" : left <= 14 ? " mid" : "";

            nodes.examList.appendChild(
                el("div", { class: "exam" }, [
                    el("span", {
                        class: "swatch",
                        style: { background: "linear-gradient(" + color + ", color-mix(in srgb, " + color + " 55%, #fff))" }
                    }),
                    el("span", {}, [
                        el("span", { class: "nm", text: ex.title }),
                        doc.createElement("br"),
                        el("span", {
                            class: "dt",
                            text: ui.fmtDate(ex.date) + (ex.venue ? " · " + ex.venue : "")
                        })
                    ]),
                    el("span", { class: "left" + cls }, [
                        el("b", { class: "num", text: String(left) }),
                        el("small", { text: left === 1 ? "day" : "days" })
                    ])
                ])
            );
        });
    }


    /* =========================================
       SMART TIP
       ========================================= */

    var STATIC_TIPS = [
        ["Spacing your revision across days beats one long night — your notes page even has flashcards for that.",
            "Open notes", "notes.html"],
        ["Two pomodoros of active recall (close the notes, write what you remember) beat an hour of re-reading.",
            "Start focus", "#pomoCard"],
        ["Stuck on one subject for too long? A 5-minute walk resets attention better than scrolling the phone.",
            "Study plan", "study-plan.html"],
        ["Quiz yourself before bed — sleep consolidates what your brain tested that day.",
            "Take a quiz", "quiz.html"]
    ];

    function renderTip() {

        if (!nodes.tipText || !nodes.tipBtn) { return; }

        var text = null;
        var btnText = null;
        var btnHref = null;

        var overdue = M.taskView.overdue().length;
        var upcoming = M.examView.upcoming();
        var streak = M.study.streak();
        var leftToday = Math.max(0, dailyGoal() - M.study.todayMinutes());

        if (overdue > 0) {
            text = overdue + " task" + (overdue === 1 ? " is" : "s are") +
                " overdue. Finishing the oldest one first keeps the pile small.";
            btnText = "Open tasks";
            btnHref = "tasks.html";
        } else if (upcoming.length && M.examView.daysLeft(upcoming[0]) <= 7) {
            var ex = upcoming[0];
            var left = M.examView.daysLeft(ex);

            text = ex.title + (left === 0 ? " is today" : " is in " + left + " day(s)") +
                ". Give its subject one focused revision block tonight.";
            btnText = "Plan it";
            btnHref = "study-plan.html";
        } else if (leftToday > 0) {
            text = ui.fmtMinutes(leftToday) + " more hits today's focus goal — one pomodoro gets you there.";
            btnText = "Start focus";
            btnHref = "#pomoCard";
        } else if (streak >= 2) {
            text = "You're on a " + streak + "-day streak. Even 25 minutes today keeps it alive.";
            btnText = "Start focus";
            btnHref = "#pomoCard";
        } else {
            var best = M.study.bestHours(1);

            if (best.length) {
                var hour = best[0].hour;
                var label = (hour % 12 || 12) + (hour < 12 ? "am" : "pm");

                text = "Your focus peaks around " + label + ". Park your toughest subject there tomorrow.";
                btnText = "Study plan";
                btnHref = "study-plan.html";
            } else {
                var pick = STATIC_TIPS[new Date().getDate() % STATIC_TIPS.length];

                text = pick[0];
                btnText = pick[1];
                btnHref = pick[2];
            }
        }

        nodes.tipText.textContent = text;
        nodes.tipBtn.textContent = btnText;
        nodes.tipBtn.setAttribute("href", btnHref);
    }


    /* =========================================
       AI INSIGHTS
       ========================================= */

    function renderInsights() {

        if (!nodes.insightList) { return; }

        ui.clear(nodes.insightList);

        var subs = subjectStats().filter(function (s) {
            return s.total > 0 || s.minutes > 0;
        });

        var items = [];

        if (subs.length) {

            var sorted = subs.slice().sort(function (a, b) { return b.mastery - a.mastery; });
            var strong = sorted[0];
            var weak = sorted[sorted.length - 1];

            items.push({
                ico: "📈",
                t: strong.short + " is your strongest subject",
                d: strong.mastery + "% mastery · " + strong.done + "/" + strong.total + " tasks done"
            });

            if (sorted.length > 1 && weak.mastery < strong.mastery) {
                items.push({
                    ico: "⚠️",
                    t: weak.short + " needs attention",
                    d: (weak.pending || 0) + " task(s) pending · " + weak.mastery + "% mastery"
                });
            }
        }

        var bestHours = M.study.bestHours(1);

        if (bestHours.length) {
            var hour = bestHours[0].hour;
            var label = (hour % 12 || 12) + (hour < 12 ? "am" : "pm");

            items.push({
                ico: "⏰",
                t: "You focus best around " + label,
                d: ui.fmtMinutes(bestHours[0].minutes) + " logged in that hour."
            });
        }

        var up = M.examView.upcoming();

        if (up.length) {
            var left = M.examView.daysLeft(up[0]);

            items.push({
                ico: "🎯",
                t: up[0].title + (left === 0 ? " is today" : " in " + left + " day(s)"),
                d: "Nearest exam on your list — block a revision session."
            });
        }

        if (!items.length) {
            items.push({
                ico: "🌱",
                t: "Log a focus session to unlock insights",
                d: "Your strongest subject, best hours and exam readiness will show here."
            });
        }

        items.slice(0, 3).forEach(function (it) {
            nodes.insightList.appendChild(
                el("div", { class: "ins" }, [
                    el("span", { class: "ico", text: it.ico }),
                    el("span", {}, [
                        el("span", { class: "t", text: it.t }),
                        doc.createElement("br"),
                        el("span", { class: "d", text: it.d })
                    ])
                ])
            );
        });
    }


    /* =========================================
       TASK BOARD (kanban)
       ========================================= */

    function tagFor(task, kind) {

        if (kind === "done") {
            return { text: "Done", style: { color: "#6ee7b7", background: "rgba(52,211,153,.14)" } };
        }

        if (M.taskView.isOverdue(task)) {
            return { text: "Overdue", style: { color: "#fca5a5", background: "rgba(248,113,113,.14)" } };
        }

        if (task.date === ui.todayISO()) {
            return { text: "Today", style: { color: "#fde68a", background: "rgba(251,191,36,.14)" } };
        }

        var p = task.priority || "medium";

        if (p === "high") {
            return { text: "High", style: { color: "#fca5a5", background: "rgba(248,113,113,.14)" } };
        }

        if (p === "low") {
            return { text: "Low", style: { color: "#6ee7b7", background: "rgba(52,211,153,.14)" } };
        }

        return { text: "Med", style: { color: "#fde68a", background: "rgba(251,191,36,.14)" } };
    }

    function taskCard(task, kind) {

        var color = ui.subjectColor(task.subject);
        var tag = tagFor(task, kind);
        var initial = (shortSubject(task.subject)[0] || "G").toUpperCase();

        return el("button", {
            class: "tk" + (kind === "done" ? " finished" : ""),
            type: "button",
            title: kind === "done" ? "Reopen this task" : "Mark as done",
            onclick: function () {

                if (task.completed) {
                    M.reopenTask(task.id);
                    ui.toast("Task reopened", "info");
                } else {
                    var spawned = M.completeTask(task.id);

                    if (spawned) {
                        ui.toast("Done — next one on " + ui.fmtDate(spawned.date), "success");
                    } else {
                        ui.toast("Task completed ✅", "success");
                    }
                }

                renderAll();
            }
        }, [
            el("div", { class: "t", text: (kind === "done" ? "✓ " : "") + task.title }),
            el("div", { class: "meta" }, [
                el("span", { class: "tag", style: tag.style, text: tag.text }),
                el("span", { class: "mini", style: { background: color }, text: initial })
            ])
        ]);
    }

    function fillColumn(host, countNode, list, kind, limit) {

        if (!host) { return; }

        ui.clear(host);

        if (countNode) { countNode.textContent = String(list.length); }

        if (!list.length) {
            host.appendChild(el("p", {
                class: "empty",
                text: kind === "todo" ? "Nothing waiting 🎉"
                    : kind === "doing" ? "Nothing in progress."
                        : "Nothing finished yet."
            }));
            return;
        }

        list.slice(0, limit).forEach(function (t) {
            host.appendChild(taskCard(t, kind));
        });

        if (list.length > limit) {
            host.appendChild(el("p", {
                class: "empty",
                text: "+ " + (list.length - limit) + " more"
            }));
        }
    }

    function renderBoard() {

        var logged = minutesByTask();
        var open = M.taskView.open();

        var todo = open.filter(function (t) { return !logged[t.title]; });
        var doing = open.filter(function (t) { return Boolean(logged[t.title]); });

        todo.sort(function (a, b) {

            var ao = M.taskView.isOverdue(a) ? 0 : 1;
            var bo = M.taskView.isOverdue(b) ? 0 : 1;

            if (ao !== bo) { return ao - bo; }

            return String(a.date || "9999").localeCompare(String(b.date || "9999"));
        });

        doing.sort(function (a, b) {
            return (logged[b.title] || 0) - (logged[a.title] || 0);
        });

        var done = M.taskView.completed().sort(function (a, b) {
            return (Number(b.completedAt) || 0) - (Number(a.completedAt) || 0);
        });

        fillColumn(nodes.boardTodo, nodes.countTodo, todo, "todo", 8);
        fillColumn(nodes.boardDoing, nodes.countDoing, doing, "doing", 6);
        fillColumn(nodes.boardDone, nodes.countDone, done, "done", 6);
    }


    /* =========================================
       SUBJECT MASTERY RINGS
       ========================================= */

    function renderSubjects() {

        if (!nodes.subjGrid) { return; }

        ui.clear(nodes.subjGrid);

        var subs = subjectStats();

        setText(nodes.subjRingsCount, String(subs.length));

        var C = 157; /* 2 * pi * 25 */
        var sum = 0;

        subs.forEach(function (s) {

            sum += s.mastery;

            var off = (C * (1 - s.mastery / 100)).toFixed(1);

            var progress = svg("circle", {
                class: "pr",
                cx: 31,
                cy: 31,
                r: 25,
                stroke: s.color,
                "stroke-dashoffset": off
            });

            progress.style.setProperty("--off", off);

            nodes.subjGrid.appendChild(
                el("div", { class: "s" }, [
                    svg("svg", { viewBox: "0 0 62 62" }, [
                        svg("circle", { class: "tr", cx: 31, cy: 31, r: 25 }),
                        progress
                    ]),
                    el("div", { class: "pct num", text: s.mastery + "%" }),
                    el("div", { class: "nm", text: s.short })
                ])
            );
        });

        setText(nodes.subjNote, "Overall " + (subs.length ? Math.round(sum / subs.length) : 0) + "%");
    }


    /* =========================================
       POMODORO EXTRAS (dots + header note)
       ========================================= */

    function renderPomoExtras() {

        var today = ui.todayISO();
        var todaySessions = M.sessions.all().filter(function (s) {
            return s.mode === "focus" && s.date === today;
        }).length;

        setText(nodes.pomoHeadNote, "Session #" + (todaySessions + 1));

        if (nodes.pomoDots) {

            ui.clear(nodes.pomoDots);

            var shown = Math.min(6, todaySessions);

            for (var i = 0; i < 6; i++) {
                var cls = i < shown ? "done" : (i === shown ? "now" : "");
                nodes.pomoDots.appendChild(el("i", { class: cls }));
            }
        }
    }


    /* =========================================
       QUICK ADD
       ========================================= */

    function quickAdd() {

        if (!nodes.quickInput) { return; }

        var value = nodes.quickInput.value.trim();

        if (!value) {
            ui.toast("Type a task first", "warn");
            nodes.quickInput.focus();
            return;
        }

        M.tasks.add({
            title: value,
            subject: "General",
            date: ui.todayISO(),
            priority: "medium",
            completed: false,
            repeat: "none"
        });

        nodes.quickInput.value = "";
        ui.toast("Task added for today ✅", "success");

        renderAll();
    }


    /* =========================================
       RENDER ALL + INIT
       ========================================= */

    function renderAll() {
        renderHero();
        renderKpis();
        renderWeekBars();
        renderStreak();
        renderOverdue();
        renderHeat();
        renderExams();
        renderTip();
        renderInsights();
        renderBoard();
        renderSubjects();
        renderPomoExtras();
    }

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.greetName = doc.getElementById("greetName");
        nodes.greetMeta = doc.getElementById("greetMeta");
        nodes.alertBar = doc.getElementById("overdueAlert");
        nodes.quickInput = doc.getElementById("quickTaskInput");

        nodes.kpiFocusVal = doc.getElementById("kpiFocusVal");
        nodes.kpiFocusDelta = doc.getElementById("kpiFocusDelta");
        nodes.kpiFocusSpark = doc.getElementById("kpiFocusSpark");
        nodes.kpiTasksVal = doc.getElementById("kpiTasksVal");
        nodes.kpiTasksDelta = doc.getElementById("kpiTasksDelta");
        nodes.kpiTasksSpark = doc.getElementById("kpiTasksSpark");
        nodes.kpiScoreVal = doc.getElementById("kpiScoreVal");
        nodes.kpiScoreDelta = doc.getElementById("kpiScoreDelta");
        nodes.kpiScoreSpark = doc.getElementById("kpiScoreSpark");
        nodes.kpiStreakVal = doc.getElementById("kpiStreakVal");
        nodes.kpiStreakDelta = doc.getElementById("kpiStreakDelta");
        nodes.kpiStreakSpark = doc.getElementById("kpiStreakSpark");

        nodes.weekBars = doc.getElementById("weekBars");
        nodes.weekNote = doc.getElementById("weekNote");

        nodes.streakNum = doc.getElementById("streakNum");
        nodes.streakSub = doc.getElementById("streakSub");
        nodes.streakLink = doc.getElementById("streakLink");
        nodes.streakWeek = doc.getElementById("streakWeek");
        nodes.streakWeekCount = doc.getElementById("streakWeekCount");
        nodes.streakBest = doc.getElementById("streakBest");
        nodes.streakNextLabel = doc.getElementById("streakNextLabel");
        nodes.streakNextVal = doc.getElementById("streakNextVal");
        nodes.streakBar = doc.getElementById("streakBar");

        nodes.examList = doc.getElementById("examList");

        nodes.heatHome = doc.getElementById("heatHome");
        nodes.heatNote = doc.getElementById("heatNote");

        nodes.tipText = doc.getElementById("tipText");
        nodes.tipBtn = doc.getElementById("tipBtn");
        nodes.insightList = doc.getElementById("insightList");

        nodes.boardTodo = doc.getElementById("boardTodo");
        nodes.boardDoing = doc.getElementById("boardDoing");
        nodes.boardDone = doc.getElementById("boardDone");
        nodes.countTodo = doc.getElementById("countTodo");
        nodes.countDoing = doc.getElementById("countDoing");
        nodes.countDone = doc.getElementById("countDone");

        nodes.subjGrid = doc.getElementById("subjGrid");
        nodes.subjNote = doc.getElementById("subjNote");
        nodes.subjRingsCount = doc.getElementById("subjRingsCount");

        nodes.pomoHeadNote = doc.getElementById("pomoHeadNote");
        nodes.pomoDots = doc.getElementById("pomoDots");

        renderAll();

        /* hero focus button jumps to the timer */
        var heroFocus = doc.getElementById("heroFocus");
        if (heroFocus && nodes.pomoHeadNote) {
            heroFocus.addEventListener("click", function () {
                var card = doc.getElementById("pomoCard");
                if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); }
            });
        }

        if (nodes.quickInput) {
            nodes.quickInput.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    quickAdd();
                }
            });
        }

        var quickBtn = doc.getElementById("quickAddBtn");
        if (quickBtn) {
            quickBtn.addEventListener("click", quickAdd);
        }

        /* refresh widgets when a pomodoro session ends */
        doc.addEventListener("smartstudy:refresh", renderAll);
    }


    global.SS = global.SS || {};
    global.SS.dashboard = { init: init, refresh: renderAll };

    doc.addEventListener("DOMContentLoaded", init);


}(window));
