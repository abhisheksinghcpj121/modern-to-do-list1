/* =========================================
   SMART STUDY - DASHBOARD
   Aggregates every model into one screen:
   greeting, quick add, stats, charts,
   today's tasks and goal snapshots.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var Store = global.SS.store;
    var ui = global.SS.ui;
    var M = global.SS.models;
    var Charts = global.SS.charts;

    var el = ui.el;

    var nodes = {};

    var state = { trendDays: 14 };


    /* =========================================
       GREETING
       ========================================= */

    function greeting() {
        var h = new Date().getHours();

        if (h < 5) { return "Still up"; }
        if (h < 12) { return "Good morning"; }
        if (h < 17) { return "Good afternoon"; }
        if (h < 21) { return "Good evening"; }

        return "Winding down";
    }

    function renderGreeting() {

        var session = global.SS.auth.require();

        if (!session || !nodes.greetName) { return; }

        var firstName = String(session.name || "").split(" ")[0];

        nodes.greetName.textContent = greeting() + ", " + firstName + " 👋";
        nodes.greetDate.textContent =
            new Date().toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            });
    }


    /* =========================================
       STATS
       ========================================= */

    function renderStats() {

        var t = M.taskView.stats();
        var s = Store.settings.all();
        var focusToday = M.study.todayMinutes();
        var goalPct = Math.min(100, Math.round((focusToday / (s.dailyGoal || 120)) * 100));

        if (nodes.statPending) { nodes.statPending.textContent = t.pending; }
        if (nodes.statDone) { nodes.statDone.textContent = t.done; }
        if (nodes.statFocus) { nodes.statFocus.textContent = ui.fmtMinutes(focusToday); }
        if (nodes.statStreak) { nodes.statStreak.textContent = M.study.streak() + "d"; }
        if (nodes.ringPct) { nodes.ringPct.textContent = goalPct + "%"; }

        if (nodes.goalNote) {
            nodes.goalNote.textContent =
                focusToday >= (s.dailyGoal || 120)
                    ? "Daily focus goal reached 🎉"
                    : ui.fmtMinutes(Math.max(0, (s.dailyGoal || 120) - focusToday)) +
                      " left to hit today's goal";
        }

        /* overdue banner */
        if (nodes.alertBar) {
            ui.clear(nodes.alertBar);

            if (t.overdue > 0) {
                nodes.alertBar.className = "alert-bar";
                nodes.alertBar.appendChild(el("span", { text: "⚠️" }));
                nodes.alertBar.appendChild(
                    el("span", {
                        text: t.overdue + " task(s) are past their due date. Clear them before adding more."
                    })
                );
                nodes.alertBar.style.display = "flex";
            } else {
                nodes.alertBar.style.display = "none";
            }
        }

        /* overall progress card */
        if (nodes.dashBar) {
            nodes.dashBar.style.width = t.percent + "%";
        }

        if (nodes.dashPct) {
            nodes.dashPct.textContent = t.percent + "%";
        }

        if (nodes.dashCounts) {
            ui.clear(nodes.dashCounts);

            nodes.dashCounts.appendChild(
                el("div", { class: "mini-stats" }, [
                    el("div", {}, [
                        el("strong", { text: String(t.total) }),
                        el("span", { text: "All tasks" })
                    ]),
                    el("div", {}, [
                        el("strong", { text: String(t.done) }),
                        el("span", { text: "Completed" })
                    ]),
                    el("div", {}, [
                        el("strong", { text: String(t.pending) }),
                        el("span", { text: "Pending" })
                    ])
                ])
            );
        }
    }


    /* =========================================
       TODAY'S TASKS
       ========================================= */

    function taskLine(task) {

        var check = el("button", {
            class: "check" + (task.completed ? " on" : ""),
            type: "button",
            "aria-label": task.completed ? "Mark as not done" : "Mark as done",
            text: "✓",
            onclick: function () {

                if (task.completed) {
                    M.reopenTask(task.id);
                } else {
                    var spawned = M.completeTask(task.id);

                    if (spawned) {
                        ui.toast("Done — next one on " + ui.fmtDate(spawned.date), "success");
                    }
                }

                renderAll();
            }
        });

        var repeat = M.taskView.isRecurring(task)
            ? el("span", { class: "pill pill-repeat", text: "REPEAT" })
            : null;

        return el("div", { class: "dash-task" + (task.completed ? " done" : "") }, [
            check,
            el("div", { class: "info" }, [
                el("strong", { text: task.title }),
                el("small", {
                    text: (task.subject || "General") +
                        (task.date ? " · " + ui.relDate(task.date) : "")
                })
            ]),
            el("span", {
                class: "pill pill-" + (task.priority || "medium"),
                text: (task.priority || "medium").toUpperCase()
            }),
            repeat
        ]);
    }

    function renderTodayTasks() {

        if (!nodes.todayTasks) { return; }

        ui.clear(nodes.todayTasks);

        var today = ui.todayISO();

        var list = M.tasks.all().filter(function (t) {
            return t.date === today || M.taskView.isOverdue(t);
        }).sort(function (a, b) {

            var ao = M.taskView.isOverdue(a) ? 0 : 1;
            var bo = M.taskView.isOverdue(b) ? 0 : 1;

            if (ao !== bo) { return ao - bo; }
            if (a.completed !== b.completed) { return a.completed ? 1 : -1; }

            return String(a.date).localeCompare(String(b.date));
        });

        if (nodes.todayCount) {
            nodes.todayCount.textContent = list.length
                ? list.filter(function (t) { return !t.completed; }).length + " open"
                : "";
        }

        if (!list.length) {
            nodes.todayTasks.appendChild(
                ui.emptyState(
                    "🌤",
                    "Nothing due today",
                    "Enjoy the free time, or add a task using the box above.",
                    null
                )
            );
            return;
        }

        list.slice(0, 7).forEach(function (t) {
            nodes.todayTasks.appendChild(taskLine(t));
        });

        if (list.length > 7) {
            nodes.todayTasks.appendChild(
                el("a", {
                    class: "btn-sm ghost-btn",
                    href: "tasks.html",
                    style: { marginTop: "14px" },
                    text: "View all " + list.length + " tasks →"
                })
            );
        }

        ui.revealOnce(nodes.todayTasks);
    }


    /* =========================================
       GOALS SNAPSHOT
       ========================================= */

    function renderGoals() {

        if (!nodes.goalList) { return; }

        ui.clear(nodes.goalList);

        var list = M.goals.all()
            .filter(function (g) { return !g.completed; })
            .sort(function (a, b) {
                return String(a.deadline || "9999").localeCompare(String(b.deadline || "9999"));
            })
            .slice(0, 4);

        if (!list.length) {
            nodes.goalList.appendChild(
                ui.emptyState(
                    "🎯",
                    "No active goals",
                    "Set a goal with a deadline and watch the progress bar move.",
                    "Add a goal",
                    function () { location.href = "goals.html"; }
                )
            );
            return;
        }

        list.forEach(function (g) {

            var pct = Math.max(0, Math.min(100, Number(g.progress) || 0));
            var left = M.goalView.daysLeft(g);

            nodes.goalList.appendChild(
                el("div", { style: { padding: "12px 0", borderBottom: "1px solid var(--border)" } }, [
                    el("div", { class: "row-between", style: { marginBottom: "7px" } }, [
                        el("strong", { style: { fontSize: "14px" }, text: g.title }),
                        el("span", {
                            class: "text-xs",
                            style: { fontWeight: "700", color: "var(--brand)" },
                            text: pct + "%"
                        })
                    ]),
                    el("div", { class: "progress-bar" }, [
                        el("div", { class: "progress-fill", style: { width: pct + "%" } })
                    ]),
                    el("small", {
                        class: "text-muted text-xs",
                        style: { display: "block", marginTop: "6px" },
                        text: g.deadline
                            ? (left < 0 ? "Deadline passed" : left + " day(s) left")
                            : "No deadline"
                    })
                ])
            );
        });

        nodes.goalList.appendChild(
            el("a", {
                class: "btn-sm ghost-btn",
                href: "goals.html",
                style: { marginTop: "14px" },
                text: "Open goals →"
            })
        );
    }


    /* =========================================
       CHARTS
       ========================================= */

    function renderCharts() {

        var s = Store.settings.all();

        /* last 7 days of focus time */
        if (nodes.weekChart) {
            var days = M.study.lastDays(7);

            Charts.bar(
                nodes.weekChart,
                days.map(function (d) {
                    var date = ui.parseISO(d.date);

                    return {
                        label: ui.weekdayName(date.getDay(), true),
                        full: ui.fmtDateLong(d.date),
                        value: d.minutes
                    };
                }),
                { format: function (v) { return ui.fmtMinutes(v); } }
            );
        }

        /* task status donut */
        if (nodes.donut) {
            var t = M.taskView.stats();

            Charts.donut(
                nodes.donut,
                [
                    { label: "Completed", value: t.done, color: "#10b981" },
                    { label: "Pending", value: t.pending - t.overdue, color: "#4f46e5" },
                    { label: "Overdue", value: t.overdue, color: "#ef4444" }
                ],
                { value: t.percent + "%", label: "complete" }
            );
        }

        /* 4 week heatmap */
        if (nodes.heat) {
            var grid = [];

            for (var i = 27; i >= 0; i--) {
                var iso = ui.addDays(ui.todayISO(), -i);
                grid.push({ date: iso, minutes: M.study.minutesOn(iso) });
            }

            Charts.heatmap(nodes.heat, grid, s.dailyGoal);
        }

        renderTrend();
        renderHourHeat();
        renderSubjectSplit();
    }


    /* focus minutes as a line, over a switchable window */
    function renderTrend() {

        if (!nodes.trend) { return; }

        var days = M.study.lastDays(state.trendDays);
        var total = days.reduce(function (sum, d) { return sum + d.minutes; }, 0);

        Charts.line(
            nodes.trend,
            days.map(function (d) {
                var date = ui.parseISO(d.date);

                return {
                    label: ui.weekdayName(date.getDay(), true),
                    full: ui.fmtDateLong(d.date),
                    value: d.minutes
                };
            }),
            {
                label: "Focus minutes over the last " + state.trendDays + " days",
                format: function (v) { return ui.fmtMinutes(v); }
            }
        );

        if (nodes.trendNote) {
            nodes.trendNote.textContent = state.trendDays + " days · " +
                ui.fmtMinutes(total) + " total";
        }
    }


    /* hourly focus concentration */
    function renderHourHeat() {

        if (!nodes.hourChart) { return; }

        var buckets = M.study.byHour();

        Charts.hourHeat(nodes.hourChart, buckets);

        if (nodes.bestHoursNote) {
            var best = M.study.bestHours(2);

            nodes.bestHoursNote.textContent = best.length
                ? "You focus best around " + best.map(function (b) {
                    var label = (b.hour % 12 || 12) + (b.hour < 12 ? "am" : "pm");
                    return label;
                }).join(" and ")
                : "Focus sessions by hour of day";
        }
    }


    /* share of logged focus time per subject */
    function renderSubjectSplit() {

        if (!nodes.subjectSplit) { return; }

        Charts.subjectSplit(nodes.subjectSplit, M.study.bySubject());
    }


    /* =========================================
       QUICK ADD
       ========================================= */

    function quickAdd() {

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
       EXAMS STRIP
       ========================================= */

    function renderExamStrip() {

        if (!nodes.examStrip) { return; }

        ui.clear(nodes.examStrip);

        var exams = M.examView.upcoming().slice(0, 3);

        if (!exams.length) {
            nodes.examStrip.appendChild(
                el("p", {
                    class: "text-muted text-sm",
                    text: "No upcoming exams. Add them in Study Plan to see countdowns."
                })
            );
            return;
        }

        exams.forEach(function (ex) {
            var left = M.examView.daysLeft(ex);

            nodes.examStrip.appendChild(
                el("div", {
                    class: "chip",
                    style: left <= 3
                        ? { borderColor: "var(--danger)", color: "var(--danger)" }
                        : null
                }, [
                    "📆 " + ex.title,
                    el("strong", { text: left === 0 ? "today" : left + "d" })
                ])
            );
        });
    }


    /* =========================================
       RENDER ALL + INIT
       ========================================= */

    function renderAll() {
        renderStats();
        renderTodayTasks();
        renderGoals();
        renderCharts();
        renderExamStrip();
    }

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.greetName = doc.getElementById("greetName");
        nodes.greetDate = doc.getElementById("greetDate");
        nodes.ringPct = doc.getElementById("ringPct");
        nodes.goalNote = doc.getElementById("focusGoalNote");
        nodes.alertBar = doc.getElementById("overdueAlert");
        nodes.quickInput = doc.getElementById("quickTaskInput");
        nodes.todayTasks = doc.getElementById("todayTasks");
        nodes.todayCount = doc.getElementById("todayCount");
        nodes.goalList = doc.getElementById("goalSnapshot");
        nodes.weekChart = doc.getElementById("weekChart");
        nodes.donut = doc.getElementById("taskDonut");
        nodes.heat = doc.getElementById("heatGrid");
        nodes.examStrip = doc.getElementById("examStrip");
        nodes.trend = doc.getElementById("trendChart");
        nodes.trendNote = doc.getElementById("trendNote");
        nodes.hourChart = doc.getElementById("hourChart");
        nodes.bestHoursNote = doc.getElementById("bestHoursNote");
        nodes.subjectSplit = doc.getElementById("subjectSplit");
        nodes.statPending = doc.getElementById("statPending");
        nodes.statDone = doc.getElementById("statDone");
        nodes.statFocus = doc.getElementById("statFocus");
        nodes.statStreak = doc.getElementById("statStreak");
        nodes.dashBar = doc.getElementById("dashBar");
        nodes.dashPct = doc.getElementById("dashPct");
        nodes.dashCounts = doc.getElementById("dashCounts");

        renderGreeting();
        renderAll();

        /* trend range switcher */
        ui.$$("[data-trend]").forEach(function (btn) {
            btn.addEventListener("click", function () {

                var days = Number(btn.dataset.trend);

                if (!days || days === state.trendDays) { return; }

                state.trendDays = days;

                ui.$$("[data-trend]").forEach(function (b) {
                    b.classList.toggle("active", b === btn);
                });

                renderTrend();
            });
        });

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

        /* refresh pomodoro stats widget when a session ends */
        doc.addEventListener("smartstudy:refresh", renderAll);
    }


    global.SS = global.SS || {};
    global.SS.dashboard = { init: init, refresh: renderAll };

    doc.addEventListener("DOMContentLoaded", init);


}(window));