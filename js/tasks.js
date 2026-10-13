/* =========================================
   SMART STUDY - TASKS PAGE
   Add / edit / delete, priorities,
   subject + status filters, search,
   smart grouping by due date.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var Store = global.SS.store;
    var ui = global.SS.ui;
    var M = global.SS.models;

    var el = ui.el;

    var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

    var state = {
        filter: "all",
        subject: "all",
        query: "",
        sort: "due"
    };

    var nodes = {};


    /* =========================================
       FILTERING + SORTING
       ========================================= */

    function visible() {

        var q = state.query.trim().toLowerCase();

        return M.tasks.all().filter(function (t) {

            /* status filter */
            if (state.filter === "pending" && t.completed) { return false; }
            if (state.filter === "completed" && !t.completed) { return false; }
            if (state.filter === "today" && !(t.date === ui.todayISO() && !t.completed)) { return false; }
            if (state.filter === "overdue" && !M.taskView.isOverdue(t)) { return false; }

            /* subject filter */
            if (state.subject !== "all" && (t.subject || "General") !== state.subject) { return false; }

            /* search */
            if (q) {
                var hay = [t.title, t.subject, t.notes, t.priority].join(" ").toLowerCase();
                if (hay.indexOf(q) === -1) { return false; }
            }

            return true;
        }).sort(function (a, b) {

            if (a.completed !== b.completed) {
                return a.completed ? 1 : -1;
            }

            if (state.sort === "priority") {
                var pa = PRIORITY_RANK[a.priority] === undefined ? 3 : PRIORITY_RANK[a.priority];
                var pb = PRIORITY_RANK[b.priority] === undefined ? 3 : PRIORITY_RANK[b.priority];

                if (pa !== pb) { return pa - pb; }
            }

            if (state.sort === "created") {
                return (b.createdAt || 0) - (a.createdAt || 0);
            }

            /* default: due date */
            if (!a.date && b.date) { return 1; }
            if (a.date && !b.date) { return -1; }
            if (a.date && b.date && a.date !== b.date) { return a.date.localeCompare(b.date); }

            return String(a.title).localeCompare(String(b.title));
        });
    }


    /* ---------- grouping ---------- */

    function groupOf(task) {

        if (task.completed) { return "Completed"; }
        if (M.taskView.isOverdue(task)) { return "Overdue"; }
        if (task.date === ui.todayISO()) { return "Today"; }
        if (task.date === ui.addDays(ui.todayISO(), 1)) { return "Tomorrow"; }
        if (!task.date) { return "No date"; }
        if (ui.diffDays(ui.todayISO(), task.date) <= 7) { return "This week"; }

        return "Later";
    }

    var GROUP_ORDER = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date", "Completed"];


    /* =========================================
       RENDER
       ========================================= */

    function priorityPill(priority) {
        var p = priority || "medium";

        return el("span", { class: "pill pill-" + p, text: p.toUpperCase() });
    }

    function repeatBadge(task) {

        if (!M.taskView.isRecurring(task)) { return null; }

        var short = M.taskView.repeatLabel(task);

        return el("span", {
            class: "pill pill-repeat",
            text: "REPEAT",
            title: short + " - finishing this schedules the next one automatically"
        });
    }

    function taskRow(task) {

        var check = el("button", {
            class: "check" + (task.completed ? " on" : ""),
            type: "button",
            "aria-label": task.completed ? "Mark as not done" : "Mark as done",
            text: "✓",
            onclick: function () {

                /* reopenTask also removes the occurrence that completing
                   this task generated, so the two paths must both be used */
                if (task.completed) {
                    M.reopenTask(task.id);
                    ui.toast("Task reopened", "info");
                } else {
                    var spawned = M.completeTask(task.id);

                    ui.toast(
                        spawned
                            ? "Done — next one scheduled for " + ui.fmtDate(spawned.date)
                            : "Nice work — task completed!",
                        "success"
                    );
                }

                render();
            }
        });

        var meta = el("div", { class: "meta" }, [
            el("span", {}, [
                el("i", { class: "subject-dot", style: { background: ui.subjectColor(task.subject) } }),
                " " + (task.subject || "General")
            ]),
            task.date
                ? el("span", { text: "📅 " + ui.fmtDate(task.date) })
                : null,
            priorityPill(task.priority),
            repeatBadge(task)
        ]);

        var overdue = M.taskView.isOverdue(task);

        if (overdue) {
            meta.insertBefore(
                el("span", { class: "late-flag", text: "LATE " + ui.relDate(task.date) }),
                meta.firstChild
            );
        }

        var node = el("div", { class: "task-item" + (task.completed ? " completed" : "") }, [
            check,
            el("div", { class: "info" }, [
                el("span", { class: "title", text: task.title }),
                meta
            ]),
            el("div", { class: "task-actions" }, [
                el("button", {
                    class: "mini-btn",
                    type: "button",
                    title: "Edit",
                    "aria-label": "Edit task",
                    text: "✏️",
                    onclick: function () { openEditor(task); }
                }),
                el("button", {
                    class: "mini-btn",
                    type: "button",
                    title: "Focus on this task",
                    "aria-label": "Focus on this task",
                    text: "⏱",
                    onclick: function () {
                        global.location.href = "dashboard.html?focus=" +
                            encodeURIComponent(task.title);
                    }
                }),
                el("button", {
                    class: "mini-btn danger",
                    type: "button",
                    title: "Delete",
                    "aria-label": "Delete task",
                    text: "🗑",
                    onclick: function () {
                        ui.confirmBox({
                            title: "Delete task?",
                            message: "\"" + task.title + "\" will be removed permanently.",
                            confirmText: "Delete",
                            danger: true
                        }).then(function (ok) {
                            if (ok) {
                                M.tasks.remove(task.id);
                                ui.toast("Task deleted", "info");
                                render();
                            }
                        });
                    }
                })
            ])
        ]);

        return node;
    }

    function render() {

        if (!nodes.list) { return; }

        ui.clear(nodes.list);

        var list = visible();
        var stats = M.taskView.stats();

        /* header stats */
        if (nodes.statTotal) { nodes.statTotal.textContent = stats.total; }
        if (nodes.statPending) { nodes.statPending.textContent = stats.pending; }
        if (nodes.statDone) { nodes.statDone.textContent = stats.done; }
        if (nodes.statLate) { nodes.statLate.textContent = stats.overdue; }

        if (nodes.countLabel) {
            nodes.countLabel.textContent =
                list.length + (list.length === 1 ? " task" : " tasks");
        }

        if (nodes.bar) {
            nodes.bar.style.width = stats.percent + "%";
        }

        if (nodes.pct) {
            nodes.pct.textContent = stats.percent + "%";
        }

        if (!list.length) {
            nodes.list.appendChild(
                ui.emptyState(
                    state.query ? "🔍" : "📝",
                    state.query ? "No matching tasks" : "Nothing here yet",
                    state.query
                        ? "Try a different keyword or clear the filters."
                        : "Add your first task and Smart Study will keep it sorted for you.",
                    state.query ? "Clear filters" : "Add a task",
                    function () {
                        if (state.query) {
                            state.query = "";
                            if (nodes.search) { nodes.search.value = ""; }
                            syncChips();
                            render();
                        } else {
                            openEditor(null);
                        }
                    }
                )
            );
            return;
        }

        var groups = {};

        list.forEach(function (t) {
            var g = groupOf(t);
            groups[g] = groups[g] || [];
            groups[g].push(t);
        });

        GROUP_ORDER.forEach(function (name) {
            if (!groups[name] || !groups[name].length) { return; }

            var head = el("div", { class: "task-group-head" }, [
                name,
                el("span", { class: "pill pill-brand", text: String(groups[name].length) })
            ]);

            nodes.list.appendChild(head);

            groups[name].forEach(function (t) {
                nodes.list.appendChild(taskRow(t));
            });
        });

        ui.revealOnce(nodes.list);
    }


    /* =========================================
       FILTER BAR
       ========================================= */

    var FILTERS = [
        { id: "all", label: "All", emoji: "📋" },
        { id: "today", label: "Today", emoji: "📅" },
        { id: "pending", label: "Pending", emoji: "⏳" },
        { id: "overdue", label: "Overdue", emoji: "⚠️" },
        { id: "completed", label: "Completed", emoji: "✅" }
    ];

    var SORTS = [
        { id: "due", label: "Due date" },
        { id: "priority", label: "Priority" },
        { id: "created", label: "Newest" }
    ];

    function syncChips() {
        ui.$$("[data-filter]").forEach(function (b) {
            var on = b.dataset.filter === state.filter;
            b.classList.toggle("active", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
        });

        ui.$$("[data-sort]").forEach(function (b) {
            var on = b.dataset.sort === state.sort;
            b.classList.toggle("active", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }

    function renderSubjectFilter() {
        var host = nodes.subjectRow;

        if (!host) { return; }

        ui.clear(host);

        var subjects = M.taskView.subjects();

        function chip(value, label) {
            var on = state.subject === value;

            return el("button", {
                class: "chip" + (on ? " active" : ""),
                type: "button",
                "aria-pressed": on ? "true" : "false",
                text: label,
                onclick: function () {
                    state.subject = value;
                    renderSubjectFilter();
                    render();
                }
            });
        }

        host.appendChild(chip("all", "All subjects"));

        subjects.forEach(function (s) {
            host.appendChild(chip(s, s));
        });
    }


    /* =========================================
       ADD / EDIT MODAL
       ========================================= */

    var editingId = null;

    function suggestSubjects() {
        var base = ["Mathematics", "Physics", "Chemistry", "Computer Science", "English"];
        var extra = M.taskView.subjects();

        return base.concat(extra).filter(function (v, i, a) {
            return a.indexOf(v) === i;
        });
    }

    /* Spells out what the chosen rule will actually do. A rule without a
       date is meaningless, so the hint says so too. */
    function syncRepeatHint() {

        var fRepeat = doc.getElementById("fRepeat");
        var hint = doc.getElementById("fRepeatHint");
        var date = doc.getElementById("fDate");

        if (!hint || !fRepeat || !date) { return; }

        var rule = fRepeat.value;

        if (rule === "none") {
            hint.textContent = "This task will not repeat.";
            return;
        }

        if (!date.value) {
            hint.textContent = "Add a due date first - a repeat rule needs a start day.";
            return;
        }

        var label = M.taskView.repeatLabel({ repeat: rule }).toLowerCase();

        hint.textContent = "Finishing this schedules the next " + label +
            " copy by itself (" +
            (M.taskView.nextDate({ date: date.value, repeat: rule }) || "-") +
            ").";
    }


    function openEditor(task) {

        editingId = task ? task.id : null;

        var fTitle = doc.getElementById("fTitle");
        var fSubject = doc.getElementById("fSubject");
        var fDate = doc.getElementById("fDate");
        var fPriority = doc.getElementById("fPriority");
        var fNotes = doc.getElementById("fNotes");
        var title = doc.getElementById("taskModalTitle");
        var err = doc.getElementById("taskFormError");

        /* fill subject options */
        ui.clear(fSubject);
        suggestSubjects().forEach(function (s) {
            fSubject.appendChild(el("option", { value: s, text: s }));
        });

        title.textContent = task ? "Edit task" : "New task";

        fTitle.value = task ? task.title : "";
        fSubject.value = task ? (task.subject || "Mathematics") : "Mathematics";
        fDate.value = task ? (task.date || "") : ui.todayISO();
        fPriority.value = task ? (task.priority || "medium") : "medium";
        fNotes.value = task ? (task.notes || "") : "";

        var fRepeat = doc.getElementById("fRepeat");

        if (fRepeat) {
            fRepeat.value = task && task.repeat ? task.repeat : "none";
            syncRepeatHint();
        }

        err.textContent = "";

        ui.openModal("taskModal");
    }

    function saveTask(event) {

        event.preventDefault();

        var fTitle = doc.getElementById("fTitle");
        var fSubject = doc.getElementById("fSubject");
        var fDate = doc.getElementById("fDate");
        var fPriority = doc.getElementById("fPriority");
        var fNotes = doc.getElementById("fNotes");
        var fRepeat = doc.getElementById("fRepeat");
        var err = doc.getElementById("taskFormError");

        var title = fTitle.value.trim();

        if (!title) {
            err.textContent = "Please enter a task title.";
            fTitle.focus();
            return;
        }

        /* a repeat rule is meaningless without a start date */
        var repeat = fRepeat ? fRepeat.value : "none";

        if (!fDate.value) { repeat = "none"; }

        var payload = {
            title: title,
            subject: fSubject.value || "General",
            date: fDate.value || "",
            priority: fPriority.value || "medium",
            notes: fNotes.value.trim(),
            repeat: repeat
        };

        if (editingId) {
            M.tasks.update(editingId, payload);
            ui.toast("Task updated", "success");
        } else {
            M.tasks.add(Object.assign({ completed: false }, payload));
            ui.toast("Task added ✅", "success");
        }

        ui.closeModal("taskModal");
        editingId = null;

        renderSubjectFilter();
        render();
    }


    /* =========================================
       BULK ACTIONS
       ========================================= */

    function clearCompleted() {
        var done = M.taskView.completed();

        /* Keep the finished copies of repeating series: they are the
           history that the next occurrence hangs off. */
        var clearable = done.filter(function (t) {
            return !(t.repeat && t.repeat !== "none");
        });

        if (!clearable.length) {
            ui.toast(
                done.length
                    ? "Those are repeating tasks — delete the series instead"
                    : "No completed tasks to clear",
                "warn"
            );
            return;
        }

        ui.confirmBox({
            title: "Clear completed tasks?",
            message: clearable.length + " completed task(s) will be deleted.",
            confirmText: "Clear them",
            danger: true
        }).then(function (ok) {
            if (!ok) { return; }

            var ids = clearable.map(function (t) { return t.id; });

            M.tasks.save(M.tasks.all().filter(function (t) {
                return ids.indexOf(t.id) === -1;
            }));

            ui.toast(clearable.length + " tasks cleared", "info");
            render();
        });
    }


    /* =========================================
       INIT
       ========================================= */

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.list = doc.getElementById("taskList");
        nodes.search = doc.getElementById("taskSearch");
        nodes.subjectRow = doc.getElementById("subjectFilter");
        nodes.countLabel = doc.getElementById("taskCount");
        nodes.statTotal = doc.getElementById("statTotal");
        nodes.statPending = doc.getElementById("statPending");
        nodes.statDone = doc.getElementById("statDone");
        nodes.statLate = doc.getElementById("statLate");
        nodes.bar = doc.getElementById("overallBar");
        nodes.pct = doc.getElementById("overallPct");

        /* filters */
        var filterHost = doc.getElementById("filterRow");

        if (filterHost) {
            FILTERS.forEach(function (f) {
                filterHost.appendChild(
                    el("button", {
                        class: "chip",
                        type: "button",
                        "data-filter": f.id,
                        "aria-pressed": "false",
                        text: f.emoji + " " + f.label,
                        onclick: function () {
                            state.filter = f.id;
                            syncChips();
                            render();
                        }
                    })
                );
            });
        }

        var sortHost = doc.getElementById("sortRow");

        if (sortHost) {
            SORTS.forEach(function (s) {
                sortHost.appendChild(
                    el("button", {
                        class: "chip",
                        type: "button",
                        "data-sort": s.id,
                        "aria-pressed": "false",
                        text: s.label,
                        onclick: function () {
                            state.sort = s.id;
                            syncChips();
                            render();
                        }
                    })
                );
            });
        }

        if (nodes.search) {
            nodes.search.addEventListener(
                "input",
                ui.debounce(function () {
                    state.query = nodes.search.value;
                    render();
                }, 180)
            );
        }

        /* buttons */
        var addBtn = doc.getElementById("addTaskBtn");
        if (addBtn) {
            addBtn.addEventListener("click", function () { openEditor(null); });
        }

        var clearBtn = doc.getElementById("clearDoneBtn");
        if (clearBtn) {
            clearBtn.addEventListener("click", clearCompleted);
        }

        var form = doc.getElementById("taskForm");
        if (form) {
            form.addEventListener("submit", saveTask);

            /* keep the repeat hint honest as the rule or date changes */
            ui.$$("#fRepeat, #fDate").forEach(function (field) {
                field.addEventListener("change", syncRepeatHint);
            });
        }

        var cancelBtn = doc.getElementById("taskCancelBtn");
        if (cancelBtn) {
            cancelBtn.addEventListener("click", function () {
                ui.closeModal("taskModal");
            });
        }

        syncChips();
        renderSubjectFilter();
        render();
    }


    global.SS = global.SS || {};
    global.SS.tasks = { init: init, openEditor: openEditor };

    doc.addEventListener("DOMContentLoaded", init);


}(window));