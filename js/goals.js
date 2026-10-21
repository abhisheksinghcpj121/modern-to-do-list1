/* =========================================
   SMART STUDY - GOALS PAGE
   Category goals with progress tracking,
   quick stepper, deadlines + streaks.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var ui = global.SS.ui;
    var M = global.SS.models;

    var el = ui.el;

    var CATEGORIES = ["Exams", "Skills", "Projects", "Health", "Habits", "Other"];

    var nodes = {};
    var editingId = null;


    /* =========================================
       RENDER
       ========================================= */

    function summaryCard() {

        var s = M.goalView.stats();
        var donePct = s.total ? Math.round((s.done / s.total) * 100) : 0;

        return el("div", { class: "card", style: { marginBottom: "22px" } }, [
            el("div", { class: "row-between", style: { marginBottom: "14px", flexWrap: "wrap" } }, [
                el("div", {}, [
                    el("div", { class: "card-title", text: "Goal progress overview" }),
                    el("div", { class: "card-sub", text: s.total + " goals · " + s.done + " achieved" })
                ]),
                el("div", { class: "row", style: { gap: "22px" } }, [
                    stat("Average", s.avgProgress + "%"),
                    stat("Completed", donePct + "%")
                ])
            ]),
            el("div", { class: "progress-bar" }, [
                el("div", {
                    class: "progress-fill" + (donePct === 100 ? " ok" : ""),
                    style: { width: donePct + "%" }
                })
            ])
        ]);
    }

    function stat(label, value) {
        return el("div", { style: { textAlign: "right" } }, [
            el("div", {
                style: { fontSize: "19px", fontWeight: "800", color: "var(--brand)", lineHeight: "1.2" },
                text: value
            }),
            el("div", { style: { fontSize: "11px", color: "var(--muted)" }, text: label })
        ]);
    }

    function goalCard(goal) {

        var pct = Math.max(0, Math.min(100, Number(goal.progress) || 0));
        var left = M.goalView.daysLeft(goal);

        var deadlineText = "No deadline";

        if (left !== null) {
            if (left < 0) { deadlineText = "Passed " + Math.abs(left) + "d ago"; }
            else if (left === 0) { deadlineText = "Due today"; }
            else { deadlineText = left + (left === 1 ? " day left" : " days left"); }
        }

        function bump(delta) {
            var next = Math.max(0, Math.min(100, pct + delta));

            M.goals.update(goal.id, {
                progress: next,
                completed: next === 100 ? true : goal.completed
            });

            if (next === 100) {
                ui.toast("🎯 Goal achieved! Great work!", "success");
            }

            render();
        }

        return el("div", {
            class: "goal-card" + (goal.completed ? " done" : ""),
            dataset: { cat: goal.category || "Other" }
        }, [
            el("div", { class: "row-between" }, [
                el("div", { class: "row-wrap", style: { gap: "4px" } }, [
                    el("span", { class: "pill pill-brand", text: goal.category || "Other" }),
                    goal.subject
                        ? el("span", { class: "pill pill-low", text: goal.subject })
                        : null
                ]),
                el("div", { class: "row", style: { gap: "4px" } }, [
                    el("button", {
                        class: "mini-btn",
                        type: "button",
                        title: "Edit goal",
                        "aria-label": "Edit goal",
                        text: "✏️",
                        onclick: function () { openEditor(goal); }
                    }),
                    el("button", {
                        class: "mini-btn danger",
                        type: "button",
                        title: "Delete goal",
                        "aria-label": "Delete goal",
                        text: "🗑",
                        onclick: function () {
                            ui.confirmBox({
                                title: "Delete goal?",
                                message: "\"" + goal.title + "\" will be removed permanently.",
                                confirmText: "Delete",
                                danger: true
                            }).then(function (ok) {
                                if (!ok) { return; }
                                M.goals.remove(goal.id);
                                ui.toast("Goal deleted", "info");
                                render();
                            });
                        }
                    })
                ])
            ]),

            el("h3", { text: goal.title }),

            el("div", { class: "row-between" }, [
                el("div", { class: "goal-pct" }, [
                    String(pct) + "%",
                    el("small", { text: goal.completed ? " · complete" : " · in progress" })
                ]),
                el("div", { class: "stepper" }, [
                    el("button", {
                        type: "button", "aria-label": "Decrease by 5", text: "−",
                        disabled: pct <= 0,
                        onclick: function () { bump(-5); }
                    }),
                    el("button", {
                        type: "button", "aria-label": "Increase by 5", text: "+",
                        disabled: pct >= 100,
                        onclick: function () { bump(5); }
                    })
                ])
            ]),

            el("div", { class: "progress-bar" }, [
                el("div", {
                    class: "progress-fill" + (pct === 100 ? " ok" : ""),
                    style: { width: pct + "%" }
                })
            ]),

            el("div", { class: "goal-foot" }, [
                el("span", { text: "📅 " + deadlineText }),
                el("button", {
                    class: "chip",
                    type: "button",
                    text: goal.completed ? "Reopen" : "Mark done",
                    onclick: function () {
                        M.goals.update(goal.id, {
                            completed: !goal.completed,
                            progress: !goal.completed ? 100 : pct
                        });

                        ui.toast(
                            goal.completed ? "Goal reopened" : "🎯 Goal marked complete!",
                            goal.completed ? "info" : "success"
                        );

                        render();
                    }
                })
            ])
        ]);
    }

    function render() {

        if (!nodes.grid) { return; }

        ui.clear(nodes.grid);
        ui.clear(nodes.summaryHost);

        nodes.summaryHost.appendChild(summaryCard());

        var list = M.goals.all().sort(function (a, b) {

            if (a.completed !== b.completed) { return a.completed ? 1 : -1; }

            var pa = a.deadline || "9999";
            var pb = b.deadline || "9999";

            return pa.localeCompare(pb);
        });

        if (!list.length) {
            nodes.grid.style.display = "block";
            nodes.grid.appendChild(
                ui.emptyState(
                    "🎯",
                    "No goals yet",
                    "Set a goal with a deadline and track how far you have come.",
                    "Create a goal",
                    function () { openEditor(null); }
                )
            );
            return;
        }

        nodes.grid.style.display = "grid";

        list.forEach(function (g) {
            nodes.grid.appendChild(goalCard(g));
        });

        ui.revealOnce(nodes.grid);
    }


    /* =========================================
       MODAL
       ========================================= */

    function openEditor(goal) {

        editingId = goal ? goal.id : null;

        var cat = doc.getElementById("fCategory");

        ui.clear(cat);
        CATEGORIES.forEach(function (c) {
            cat.appendChild(el("option", { value: c, text: c }));
        });

        var subj = doc.getElementById("fGoalSubject");
        var goalSubject = goal ? (goal.subject || "") : "";

        subj.value = goalSubject;
        if (goalSubject && subj.value !== goalSubject) {
            /* subject left the shelf but this goal still uses it */
            subj.appendChild(el("option", { value: goalSubject, text: goalSubject }));
            subj.value = goalSubject;
        }

        doc.getElementById("goalModalTitle").textContent = goal ? "Edit goal" : "New goal";
        doc.getElementById("fGoalTitle").value = goal ? goal.title : "";
        cat.value = goal ? (goal.category || "Other") : "Exams";
        doc.getElementById("fDeadline").value = goal ? (goal.deadline || "") : ui.addDays(ui.todayISO(), 30);
        doc.getElementById("fProgress").value = goal ? (Number(goal.progress) || 0) : 0;
        doc.getElementById("goalProgressLabel").textContent = (goal ? (Number(goal.progress) || 0) : 0) + "%";
        doc.getElementById("goalFormError").textContent = "";

        ui.openModal("goalModal");
    }

    function saveGoal(event) {

        event.preventDefault();

        var title = doc.getElementById("fGoalTitle").value.trim();
        var err = doc.getElementById("goalFormError");

        if (!title) {
            err.textContent = "Please enter a goal.";
            return;
        }

        var progress = Number(doc.getElementById("fProgress").value) || 0;

        var payload = {
            title: title,
            category: doc.getElementById("fCategory").value,
            subject: doc.getElementById("fGoalSubject").value,
            deadline: doc.getElementById("fDeadline").value || "",
            progress: progress,
            completed: progress === 100
        };

        if (editingId) {
            M.goals.update(editingId, payload);
            ui.toast("Goal updated", "success");
        } else {
            M.goals.add(payload);
            ui.toast("Goal created 🎯", "success");
        }

        ui.closeModal("goalModal");
        editingId = null;
        render();
    }


    /* =========================================
       INIT
       ========================================= */

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.grid = doc.getElementById("goalGrid");
        nodes.summaryHost = doc.getElementById("goalSummary");

        /* shared subject shelf + "+ Add", same as the other pages */
        ui.subjectSelect(doc.getElementById("fGoalSubject"), { blank: "No subject" });
        ui.subjectAddButton(
            doc.getElementById("fGoalSubjectAdd"),
            doc.getElementById("fGoalSubject")
        );

        var addBtn = doc.getElementById("addGoalBtn");
        if (addBtn) {
            addBtn.addEventListener("click", function () { openEditor(null); });
        }

        var form = doc.getElementById("goalForm");
        if (form) {
            form.addEventListener("submit", saveGoal);
        }

        var cancel = doc.getElementById("goalCancelBtn");
        if (cancel) {
            cancel.addEventListener("click", function () { ui.closeModal("goalModal"); });
        }

        var slider = doc.getElementById("fProgress");
        if (slider) {
            slider.addEventListener("input", function () {
                doc.getElementById("goalProgressLabel").textContent = slider.value + "%";
            });
        }

        render();
    }


    global.SS = global.SS || {};
    global.SS.goals = { init: init, openEditor: openEditor };

    doc.addEventListener("DOMContentLoaded", init);


}(window));