/* =========================================
   SMART STUDY - STUDY PLAN PAGE
   Weekly timetable, subject hour targets
   and exam countdowns.
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
    var editingSession = null;
    var editingSubject = null;
    var editingExam = null;


    /* =========================================
       WEEK  (simple day list: today first)
       ========================================= */

    /* Today, then tomorrow, then the rest of the week in order. */
    function dayOrder() {

        var today = ui.weekdayToday();
        var order = [today, (today + 1) % 7];

        for (var d = 0; d < 7; d++) {
            if (order.indexOf(d) === -1) { order.push(d); }
        }

        return order;
    }

    function dayLabel(day) {

        var today = ui.weekdayToday();
        var delta = (day - today + 7) % 7;

        if (delta === 0) { return "Today"; }
        if (delta === 1) { return "Tomorrow"; }

        return ui.weekdayName(day);
    }

    function sessionRow(p) {

        return el("button", {
            class: "plan-session",
            type: "button",
            title: "Click to edit",
            onclick: function () { openSession(p); }
        }, [
            el("i", { class: "subject-dot", style: { background: ui.subjectColor(p.subject) } }),
            el("strong", { text: p.start }),
            el("span", { class: "ps-subject", text: p.subject }),
            p.topic ? el("small", { class: "ps-topic", text: p.topic }) : null,
            el("small", { class: "ps-mins", text: ui.fmtMinutes(p.minutes) })
        ]);
    }

    function dayRow(day) {

        var sessions = M.planView.forDay(day);
        var isToday = day === ui.weekdayToday();

        var minutes = sessions.reduce(function (s, x) {
            return s + (Number(x.minutes) || 0);
        }, 0);

        var head = el("div", { class: "plan-day-head" }, [
            el("strong", { text: dayLabel(day) }),
            isToday ? null : el("small", { text: ui.weekdayName(day) }),
            minutes ? el("span", { class: "chip", text: ui.fmtMinutes(minutes) }) : null,
            el("button", {
                class: "mini-btn",
                type: "button",
                text: "+",
                title: "Add a session on " + ui.weekdayName(day),
                "aria-label": "Add session on " + ui.weekdayName(day),
                onclick: function () { openSession(null, day); }
            })
        ]);

        var row = el("div", { class: "plan-day" + (isToday ? " today" : "") }, [head]);

        if (!sessions.length) {
            row.appendChild(
                el("p", { class: "plan-free", text: "Free — nothing planned" })
            );
        } else {
            sessions.forEach(function (p) { row.appendChild(sessionRow(p)); });
        }

        return row;
    }

    function renderPlan() {

        ui.clear(nodes.grid);

        dayOrder().forEach(function (day) {
            nodes.grid.appendChild(dayRow(day));
        });

        ui.revealOnce(nodes.grid);
    }


    /* =========================================
       SUBJECTS
       ========================================= */

    function renderSubjects() {

        var rows = M.subjects.all().map(function (s) {
            return {
                name: s.name,
                color: ui.subjectColor(s.name),
                done: M.planView.minutesFor(s.name) / 60,
                target: Number(s.targetHours) || 0
            };
        });

        rows.sort(function (a, b) { return b.done - a.done; });

        Charts.subjectBars(nodes.subjectList, rows);

        /* one quiet summary line instead of a wall of stat cards */
        var totalPlanned = M.planView.totalMinutes() / 60;
        var totalTarget = rows.reduce(function (s, r) { return s + r.target; }, 0);

        if (nodes.weekSummary) {
            nodes.weekSummary.textContent = M.plan.count()
                ? M.plan.count() + " sessions · " + ui.fmtMinutes(totalPlanned) +
                  " planned of " + totalTarget + "h target"
                : "Nothing planned yet — add your first session above.";
        }
    }


    /* =========================================
       EXAMS
       ========================================= */

    function renderExams() {

        ui.clear(nodes.examList);

        var exams = M.examView.upcoming();

        if (!exams.length) {
            nodes.examList.appendChild(
                ui.emptyState(
                    "📆",
                    "No exams added",
                    "Add your exam dates to get a countdown for every subject.",
                    "Add an exam",
                    function () { openExam(null); }
                )
            );
            return;
        }

        exams.forEach(function (ex) {

            var left = M.examView.daysLeft(ex);

            var cls = "countdown";
            if (left < 0) { cls += " passed"; }
            else if (left <= 3) { cls += " soon"; }

            nodes.examList.appendChild(
                el("div", { class: "exam-item" }, [
                    el("div", { class: cls }, [
                        el("strong", { text: String(left) }),
                        el("small", { text: left === 1 ? "day" : "days" })
                    ]),
                    el("div", { style: { flex: "1", minWidth: "0" } }, [
                        el("strong", {
                            style: { display: "block", fontSize: "14px" },
                            text: ex.title
                        }),
                        el("small", {
                            class: "text-muted text-xs",
                            text: ui.fmtDateLong(ex.date) + (ex.venue ? " · " + ex.venue : "")
                        })
                    ]),
                    el("div", { class: "row", style: { gap: "4px" } }, [
                        el("button", {
                            class: "mini-btn",
                            type: "button",
                            "aria-label": "Edit exam",
                            title: "Edit",
                            text: "✏️",
                            onclick: function () { openExam(ex); }
                        }),
                        el("button", {
                            class: "mini-btn danger",
                            type: "button",
                            "aria-label": "Delete exam",
                            title: "Delete",
                            text: "🗑",
                            onclick: function () {
                                ui.confirmBox({
                                    title: "Delete exam?",
                                    message: ex.title + " will be removed from your countdowns.",
                                    confirmText: "Delete",
                                    danger: true
                                }).then(function (ok) {
                                    if (!ok) { return; }
                                    M.exams.remove(ex.id);
                                    ui.toast("Exam removed", "info");
                                    renderExams();
                                });
                            }
                        })
                    ])
                ])
            );
        });
    }


    /* =========================================
       MODALS
       ========================================= */

    /* ---------- session ---------- */

    function openSession(session, presetDay) {

        editingSession = session ? session.id : null;

        doc.getElementById("sessionModalTitle").textContent =
            session ? "Edit session" : "New study session";

        var subjectNode = doc.getElementById("pSubject");

        ui.subjectSelect(subjectNode, {
            selected: session ? session.subject : null
        });

        doc.getElementById("pDay").value = session ? session.day : (presetDay === undefined ? ui.weekdayToday() : presetDay);
        doc.getElementById("pStart").value = session ? session.start : "16:00";
        doc.getElementById("pTopic").value = session ? (session.topic || "") : "";
        doc.getElementById("pMinutes").value = session ? (session.minutes || 60) : 60;
        doc.getElementById("sessionFormError").textContent = "";

        ui.openModal("sessionModal");
    }

    function saveSession(event) {

        event.preventDefault();

        var err = doc.getElementById("sessionFormError");
        var topic = doc.getElementById("pTopic").value.trim();
        var minutes = Number(doc.getElementById("pMinutes").value) || 0;

        if (!topic) {
            err.textContent = "Please enter what you will study.";
            return;
        }

        if (minutes < 10) {
            err.textContent = "A session should be at least 10 minutes.";
            return;
        }

        var payload = {
            day: Number(doc.getElementById("pDay").value),
            start: doc.getElementById("pStart").value || "09:00",
            subject: doc.getElementById("pSubject").value,
            topic: topic,
            minutes: minutes
        };

        if (editingSession) {
            M.plan.update(editingSession, payload);
            ui.toast("Session updated", "success");
        } else {
            M.plan.add(payload);
            ui.toast("Session added to your week 🗓", "success");
        }

        ui.closeModal("sessionModal");
        editingSession = null;

        renderPlan();
        renderSubjects();
    }

    /* ---------- subject ---------- */

    function openSubject(subject) {

        editingSubject = subject ? subject.id : null;

        doc.getElementById("subjectModalTitle").textContent =
            subject ? "Edit subject" : "New subject";

        doc.getElementById("sName").value = subject ? subject.name : "";
        doc.getElementById("sTarget").value = subject ? (subject.targetHours || 5) : 5;
        doc.getElementById("subjectFormError").textContent = "";

        ui.openModal("subjectModal");
    }

    function saveSubject(event) {

        event.preventDefault();

        var name = doc.getElementById("sName").value.trim();
        var target = Number(doc.getElementById("sTarget").value) || 0;
        var err = doc.getElementById("subjectFormError");

        if (!name) {
            err.textContent = "Please enter a subject name.";
            return;
        }

        var exists = M.subjects.all().filter(function (s) {
            return s.name.toLowerCase() === name.toLowerCase() && s.id !== editingSubject;
        });

        if (exists.length) {
            err.textContent = "That subject already exists.";
            return;
        }

        var payload = { name: name, targetHours: target };

        if (editingSubject) {
            M.subjects.update(editingSubject, payload);
            ui.toast("Subject updated", "success");
        } else {
            M.subjects.add(payload);
            ui.toast("Subject added 📚", "success");
        }

        ui.refreshSubjectSelects();

        ui.closeModal("subjectModal");
        editingSubject = null;

        renderSubjects();
    }

    /* ---------- manage subjects list ---------- */

    function openSubjectManager() {

        var backdrop = el("div", { class: "modal show" });
        var listHost = el("div", { class: "stack" });

        function paint() {
            ui.clear(listHost);

            var list = M.subjects.all();

            if (!list.length) {
                listHost.appendChild(
                    el("p", {
                        class: "text-muted text-sm",
                        text: "No subjects yet. Add one to start planning hours."
                    })
                );
                return;
            }

            list.forEach(function (s) {
                listHost.appendChild(
                    el("div", { class: "subject-row" }, [
                        el("i", { class: "subject-dot", style: { background: ui.subjectColor(s.name) } }),
                        el("span", { class: "name", text: s.name }),
                        el("span", { class: "hrs", text: (s.targetHours || 0) + "h / week" }),
                        el("div", { class: "row", style: { gap: "4px" } }, [
                            el("button", {
                                class: "mini-btn", type: "button", text: "✏️",
                                "aria-label": "Edit " + s.name,
                                onclick: function () {
                                    backdrop.remove();
                                    doc.body.classList.remove("no-scroll");
                                    openSubject(s);
                                }
                            }),
                            el("button", {
                                class: "mini-btn danger", type: "button", text: "🗑",
                                "aria-label": "Delete " + s.name,
                                onclick: function () {
                                    ui.confirmBox({
                                        title: "Delete subject?",
                                        message: s.name + " will be removed. Planned sessions are kept.",
                                        confirmText: "Delete",
                                        danger: true
                                    }).then(function (ok) {
                                        if (!ok) { return; }
                                        M.subjects.remove(s.id);
                                        paint();
                                        renderSubjects();
                                        ui.toast("Subject deleted", "info");
                                    });
                                }
                            })
                        ])
                    ])
                );
            });
        }

        paint();

        backdrop.appendChild(
            el("div", { class: "modal-content", role: "dialog", "aria-modal": "true" }, [
                el("button", {
                    class: "close-btn", type: "button", text: "×", "aria-label": "Close",
                    onclick: function () {
                        backdrop.remove();
                        doc.body.classList.remove("no-scroll");
                    }
                }),
                el("h2", { text: "Manage subjects" }),
                el("p", { text: "Set a weekly hour target for each subject you are studying." }),
                listHost,
                el("button", {
                    class: "primary-btn btn-block",
                    type: "button",
                    style: { marginTop: "6px" },
                    text: "+ Add a subject",
                    onclick: function () {
                        backdrop.remove();
                        doc.body.classList.remove("no-scroll");
                        openSubject(null);
                    }
                })
            ])
        );

        backdrop.addEventListener("click", function (e) {
            if (e.target === backdrop) {
                backdrop.remove();
                doc.body.classList.remove("no-scroll");
            }
        });

        doc.body.classList.add("no-scroll");
        doc.body.appendChild(backdrop);
    }


    /* ---------- exam ---------- */

    function openExam(exam) {

        editingExam = exam ? exam.id : null;

        doc.getElementById("examModalTitle").textContent =
            exam ? "Edit exam" : "New exam";

        doc.getElementById("eTitle").value = exam ? exam.title : "";
        doc.getElementById("eDate").value = exam ? exam.date : ui.addDays(ui.todayISO(), 14);
        doc.getElementById("eVenue").value = exam ? (exam.venue || "") : "";
        doc.getElementById("examFormError").textContent = "";

        ui.openModal("examModal");
    }

    function saveExam(event) {

        event.preventDefault();

        var title = doc.getElementById("eTitle").value.trim();
        var date = doc.getElementById("eDate").value;
        var err = doc.getElementById("examFormError");

        if (!title) {
            err.textContent = "Please enter the exam name.";
            return;
        }

        if (!date) {
            err.textContent = "Please pick the exam date.";
            return;
        }

        var payload = {
            title: title,
            date: date,
            venue: doc.getElementById("eVenue").value.trim()
        };

        if (editingExam) {
            M.exams.update(editingExam, payload);
            ui.toast("Exam updated", "success");
        } else {
            M.exams.add(payload);
            ui.toast("Exam added 📆", "success");
        }

        ui.closeModal("examModal");
        editingExam = null;

        renderExams();
    }


    /* =========================================
       CLEAR PLAN
       ========================================= */

    function clearWeek() {
        ui.confirmBox({
            title: "Clear the whole week?",
            message: M.plan.count() + " planned sessions will be deleted.",
            confirmText: "Clear week",
            danger: true
        }).then(function (ok) {
            if (!ok) { return; }
            M.plan.clear();
            ui.toast("Weekly plan cleared", "info");
            renderPlan();
            renderSubjects();
        });
    }


    /* =========================================
       INIT
       ========================================= */

    function bindModal(modalId, formId, handler, cancelId) {
        var form = doc.getElementById(formId);
        if (form) { form.addEventListener("submit", handler); }

        var cancel = doc.getElementById(cancelId);
        if (cancel) {
            cancel.addEventListener("click", function () { ui.closeModal(modalId); });
        }
    }

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.grid = doc.getElementById("planGrid");
        if (!nodes.grid) { return; }

        nodes.subjectList = doc.getElementById("subjectList");
        nodes.examList = doc.getElementById("examList");
        nodes.weekSummary = doc.getElementById("weekSummary");

        doc.getElementById("addSessionBtn").addEventListener("click", function () {
            openSession(null, ui.weekdayToday());
        });

        doc.getElementById("addSubjectBtn").addEventListener("click", function () {
            openSubject(null);
        });

        doc.getElementById("addExamBtn").addEventListener("click", function () {
            openExam(null);
        });

        var clearBtn = doc.getElementById("clearPlanBtn");
        if (clearBtn) { clearBtn.addEventListener("click", clearWeek); }

        var manageBtn = doc.getElementById("manageSubjectsBtn");
        if (manageBtn) {
            manageBtn.addEventListener("click", openSubjectManager);
        }

        /* the session modal's subject dropdown can create one on the spot */
        ui.subjectAddButton(
            doc.getElementById("pSubjectAdd"),
            doc.getElementById("pSubject"),
            renderSubjects
        );

        bindModal("sessionModal", "sessionForm", saveSession, "sessionCancelBtn");
        bindModal("subjectModal", "subjectForm", saveSubject, "subjectCancelBtn");
        bindModal("examModal", "examForm", saveExam, "examCancelBtn");

        renderPlan();
        renderSubjects();
        renderExams();
    }


    global.SS = global.SS || {};
    global.SS.studyPlan = { init: init };

    doc.addEventListener("DOMContentLoaded", init);


}(window));