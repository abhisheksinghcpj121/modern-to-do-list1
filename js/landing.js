/* =========================================
   SMART STUDY - LANDING PAGE
   Swaps the hero card between demo numbers
   and the signed-in student's real data.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var Store = global.SS.store;
    var ui = global.SS.ui;
    var M = global.SS.models;

    function demo() {

        /* static preview numbers when nobody is signed in */
        return {
            pct: 75,
            tasks: 12,
            done: 8,
            focus: "4h"
        };
    }

    function live() {

        var t = M.taskView.stats();
        var todayMin = M.study.todayMinutes();
        var s = Store.settings.all();

        var goal = Number(s.dailyGoal) || 120;
        var focusPct = Math.min(100, Math.round((todayMin / goal) * 100));

        /* blend task completion with today's focus goal */
        var pct = Math.round((t.percent + focusPct) / 2);

        return {
            pct: t.total ? pct : 0,
            tasks: t.total,
            done: t.done,
            focus: ui.fmtMinutes(todayMin),
            hasData: t.total > 0 || todayMin > 0
        };
    }

    function paintHero() {

        var session = Store.session.get();
        var data = session ? live() : demo();

        var pct = doc.getElementById("heroPct");
        var bar = doc.getElementById("heroBar");
        var circle = doc.getElementById("heroCircle");

        if (data.hasData || !session) {
            if (pct) { pct.textContent = data.pct + "%"; }
            if (bar) { bar.style.width = data.pct + "%"; }
            if (circle) { circle.textContent = data.pct >= 100 ? "🎉" : "✓"; }
        }

        [
            ["heroTasks", data.tasks],
            ["heroDone", data.done],
            ["heroFocus", data.focus]
        ].forEach(function (pair) {
            var node = doc.getElementById(pair[0]);
            if (node) { node.textContent = pair[1]; }
        });

        /* navbar button follows the login state */
        var authBtn = doc.getElementById("navAuthBtn");

        if (authBtn && session) {
            authBtn.textContent = session.name ? session.name.split(" ")[0] : "Dashboard";
            authBtn.setAttribute("href", "dashboard.html");
        }
    }

    function init() {
        ui.initChrome();
        paintHero();

        /* keep the preview honest if data changes in another tab */
        global.addEventListener("storage", paintHero);
    }

    doc.addEventListener("DOMContentLoaded", init);


}(window));