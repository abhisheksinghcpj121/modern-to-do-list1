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
       TIMETABLE
       ========================================= */

    function dayColumn(day) {

        var isToday = day === ui.weekdayToday();

        var head = el("div", { class: "day-head" }, [
            el("strong", { text: ui.weekdayName(day, true) }),
            el("small", { text: ui.weekdayName(day).slice(0, 3) })
        ]);

        var col = el("div", {
            class: "day-col" + (isToday ? " today" : ""),
            dataset: { day: String(day) }
        }, [head]);

        var sessions = M.planView.forDay(day);
        var minutes = sessions.reduce(function (s, x) {
            return s + (Number(x.minutes) || 0);
        }, 0);

        if (minutes) {
            col.appendChild(
                el("small", {
                    class: "text-xs text-muted",
                    style: { textAlign: "center", fontWeight: "700" },
                    text: ui.fmtMinutes(minutes)
                })
            );
        }

        if (!sessions.length) {
            col.appendChild(
                el("small", {
                    class: "text-xs text-muted",
                    style: { textAlign: "center", padding: "18px 0" },
                    text: "Free"
                })
            );
        }

        sessions.forEach(function (p) {
            col.appendChild(
                el("div", {
                    class: "session",
                    style: { borderLeftColor: ui.subjectColor(p.subject) },
                    title: p.subject + " — " + (p.topic || ""),
                    onclick: function () { openSession(p); }
                }, [
                    el("strong", { text: p.subject }),
                    el("small", { text: p.start + " · " + ui.fmtMinutes(p.minutes) }),
                    p.topic ? el("small", { text: p.topic }) : null
                ])
            );
        });

        col.appendChild(
            el("button", {
                class: "add-slot",
                type: "button",
                title: "Add a session on " + ui.weekdayName(day),
                "aria-label": "Add session on " + ui.weekdayName(day),
                text: "+",
                onclick: function () { openSession(null, day); }
            })
        );

        return col;
    }

    function renderPlan() {

        ui.clear(nodes.grid);

        for (var i = 0; i < 7; i++) {
            nodes.grid.appendChild(dayColumn(i));
        }

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

        var totalPlanned = M.planView.totalMinutes() / 60;
        var totalTarget = rows.reduce(function (s, r) { return s + r.target; }, 0);

        if (nodes.planStats) {
            ui.clear(nodes.planStats);

            [
                ["Sessions", String(M.plan.count())],
                ["Planned", ui.fmtMinutes(totalPlanned)],
                ["Weekly target", totalTarget + "h"],
                ["Subjects", String(rows.length)]
            ].forEach(function (pair) {
                nodes.planStats.appendChild(
                    el("div", { class: "stat-card" }, [
                        el("div", { class: "stat-icon info", text: "🗓" }),
                        el("div", {}, [
                            el("strong", { text: pair[1] }),
                            el("span", { text: pair[0] })
                        ])
                    ])
                );
            });
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

    function fillSubjectSelect(node, selected) {
        var names = M.subjects.all().map(function (s) { return s.name; });

        if (names.indexOf(selected) === -1 && selected) {
            names.push(selected);
        }

        if (!names.length) {
            names = ["Mathematics", "Physics", "Chemistry", "Computer Science", "English"];
        }

        ui.clear(node);

        names.forEach(function (n) {
            node.appendChild(el("option", { value: n, text: n }));
        });

        node.value = selected || names[0];
    }

    /* ---------- session ---------- */

    function openSession(session, presetDay) {

        editingSession = session ? session.id : null;

        doc.getElementById("sessionModalTitle").textContent =
            session ? "Edit session" : "New study session";

        var subjectNode = doc.getElementById("pSubject");

        fillSubjectSelect(subjectNode, session ? session.subject : null);

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
        nodes.planStats = doc.getElementById("planStats");

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