/* =========================================
   SMART STUDY - POMODORO TIMER
   Focus / short break / long break cycles,
   task linking, notifications, sound and
   logged history that feeds the charts.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var ui = global.SS.ui;
    var Store = global.SS.store;
    var M = global.SS.models;

    var el = ui.el;

    var KEY = "pomo";

    var timer = null;
    var nodes = {};

    var cycle = {
        mode: "focus",
        remaining: 25 * 60,
        endAt: 0,
        running: false,
        taskTitle: "",
        focusDone: 0
    };

    var MODE_LABEL = {
        focus: "Focus",
        short: "Short break",
        long: "Long break"
    };


    /* =========================================
       SETTINGS
       ========================================= */

    function settings() {
        return Store.settings.all();
    }

    function lengthFor(mode) {
        var s = settings();

        if (mode === "short") { return Number(s.shortBreak) * 60; }
        if (mode === "long") { return Number(s.longBreak) * 60; }

        return Number(s.focus) * 60;
    }


    /* ---------- persistence ---------- */

    function save() {
        Store.set(KEY, {
            mode: cycle.mode,
            remaining: cycle.remaining,
            endAt: cycle.endAt,
            running: cycle.running,
            taskTitle: cycle.taskTitle,
            focusDone: cycle.focusDone
        });
    }

    function restore() {

        var saved = Store.get(KEY);

        if (!saved || typeof saved !== "object") { return; }

        cycle.mode = MODE_LABEL[saved.mode] ? saved.mode : "focus";
        cycle.focusDone = Number(saved.focusDone) || 0;
        cycle.taskTitle = saved.taskTitle || "";

        if (saved.running && saved.endAt) {

            var left = Math.round((saved.endAt - Date.now()) / 1000);

            if (left > 0) {
                cycle.running = true;
                cycle.endAt = saved.endAt;
                cycle.remaining = left;
            } else {
                /* finished while the tab was closed */
                cycle.running = false;
                cycle.remaining = lengthFor(cycle.mode);
                logSession(true);
            }

        } else {
            cycle.remaining = Number(saved.remaining) || lengthFor(cycle.mode);
            cycle.running = false;
        }
    }


    /* =========================================
       RENDER
       ========================================= */

    function render() {

        if (!nodes.time) { return; }

        var total = lengthFor(cycle.mode);
        var pct = total ? ((total - cycle.remaining) / total) * 100 : 0;

        nodes.time.textContent = ui.fmtClock(cycle.remaining);

        if (nodes.ring) {
            nodes.ring.style.background =
                "conic-gradient(var(--brand) " + Math.max(0, Math.min(100, pct)) +
                "%, var(--surface-3) 0)";
        }

        if (nodes.modeLabel) {
            nodes.modeLabel.textContent = MODE_LABEL[cycle.mode];
        }

        if (nodes.taskLabel) {
            nodes.taskLabel.textContent = cycle.taskTitle
                ? "Focusing on: " + cycle.taskTitle
                : "No task selected — pure focus time";
        }

        ui.$$("[data-mode]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.mode === cycle.mode);
            b.setAttribute("aria-pressed", b.dataset.mode === cycle.mode ? "true" : "false");
        });

        if (nodes.start) { nodes.start.disabled = cycle.running; }
        if (nodes.pause) { nodes.pause.disabled = !cycle.running; }
        if (nodes.reset) { nodes.reset.disabled = cycle.running && cycle.remaining === lengthFor(cycle.mode); }

        if (nodes.wrap) {
            nodes.wrap.classList.toggle("running", cycle.running);
        }

        if (nodes.roundLabel) {
            var every = Number(settings().longEvery) || 4;
            nodes.roundLabel.textContent = cycle.focusDone % every;
        }

        doc.title = cycle.running
            ? ui.fmtClock(cycle.remaining) + " · " + MODE_LABEL[cycle.mode]
            : "Smart Study - Student Productivity";

        renderStats();
    }

    function renderStats() {

        if (nodes.statToday) {
            nodes.statToday.textContent = ui.fmtMinutes(M.study.todayMinutes());
        }
        if (nodes.statSessions) {
            nodes.statSessions.textContent = String(M.sessions.count());
        }
        if (nodes.statStreak) {
            nodes.statStreak.textContent = M.study.streak() + "d";
        }
    }


    /* =========================================
       TIMER LOGIC
       ========================================= */

    function tick() {

        var left = Math.round((cycle.endAt - Date.now()) / 1000);

        if (left <= 0) {
            left = 0;
            cycle.remaining = 0;
            stop();
            complete();
            return;
        }

        cycle.remaining = left;
        render();
    }

    function start() {

        if (cycle.running) { return; }

        if (cycle.remaining <= 0) {
            cycle.remaining = lengthFor(cycle.mode);
        }

        cycle.running = true;
        cycle.endAt = Date.now() + cycle.remaining * 1000;

        clearInterval(timer);
        timer = setInterval(tick, 250);

        save();
        render();

        if (cycle.mode === "focus") {
            ui.toast("Focus session started. Stay with it! 💪", "info");
        }
    }

    function pause() {

        if (!cycle.running) { return; }

        clearInterval(timer);
        timer = null;
        cycle.running = false;
        cycle.remaining = Math.max(0, Math.round((cycle.endAt - Date.now()) / 1000));

        save();
        render();

        ui.toast("Paused", "warn");
    }

    function stop() {
        clearInterval(timer);
        timer = null;
        cycle.running = false;
    }

    function reset() {

        stop();

        cycle.remaining = lengthFor(cycle.mode);

        save();
        render();

        ui.toast("Timer reset", "info");
    }

    function skip() {
        stop();
        complete();
    }

    function switchMode(mode) {

        stop();

        cycle.mode = mode;
        cycle.remaining = lengthFor(mode);

        save();
        render();
    }

    function complete() {

        var s = settings();
        var finishedMode = cycle.mode;

        /* sound + notification */
        if (s.sound !== false) {
            ui.beep(finishedMode === "focus"
                ? [880, 1180, 880]
                : [660, 880]);
        }

        notify(
            finishedMode === "focus"
                ? "🎉 Focus session done! Take a break."
                : "☕ Break over. Back to work!",
            "Smart Study"
        );

        logSession(true, finishedMode);

        /* move to the next mode automatically */
        var every = Number(s.longEvery) || 4;

        if (finishedMode === "focus") {
            cycle.focusDone++;
            switchMode(cycle.focusDone % every === 0 ? "long" : "short");
        } else {
            switchMode("focus");
        }

        ui.toast(
            finishedMode === "focus" ? "Session logged. Nice work! 🎉" : "Break finished ⏰",
            "success"
        );

        save();
        render();
    }

    /* resolve the subject of the linked task so focus time can be
   grouped per subject on the dashboard */
function subjectForTitle(title) {

    if (!title) { return ""; }

    var found = "";

    M.tasks.all().forEach(function (t) {
        if (t.title === title) { found = t.subject || ""; }
    });

    return found;
}

function logSession(autoCompleted, forcedMode) {

        var mode = forcedMode || cycle.mode;

        if (mode !== "focus") { return false; }

        M.sessions.add({
            mode: "focus",
            minutes: Math.round(lengthFor("focus") / 60),
            date: ui.todayISO(),
            taskTitle: cycle.taskTitle || "",
            subject: subjectForTitle(cycle.taskTitle),
            completed: autoCompleted !== false,
            finishedAt: Date.now()
        });

        renderStats();

        return true;
    }


    /* =========================================
       NOTIFICATIONS
       ========================================= */

    function notify(body, title) {

        var s = settings();

        if (s.notify === false) { return; }

        if (!("Notification" in global)) { return; }

        if (Notification.permission === "granted") {
            try {
                new Notification(title, { body: body, icon: "" });
            } catch (e) { /* ignore */ }
        }
    }

    function askNotifyPermission() {

        if (!("Notification" in global)) {
            ui.toast("This browser does not support notifications", "warn");
            return;
        }

        Notification.requestPermission().then(function (p) {
            if (p === "granted") {
                Store.settings.patch({ notify: true });
                ui.toast("Desktop notifications enabled 🔔", "success");
            } else {
                Store.settings.patch({ notify: false });
                ui.toast("Notifications blocked by the browser", "warn");
            }

            renderSettingsForm();
        });
    }


    /* =========================================
       TASK PICKER
       ========================================= */

    function fillTaskPicker() {

        if (!nodes.taskSelect) { return; }

        var open = M.taskView.open().sort(function (a, b) {

            if (!a.date && b.date) { return 1; }
            if (a.date && !b.date) { return -1; }
            if (a.date && b.date) { return a.date.localeCompare(b.date); }

            return 0;
        });

        ui.clear(nodes.taskSelect);

        nodes.taskSelect.appendChild(
            el("option", { value: "", text: "No specific task" })
        );

        open.forEach(function (t) {
            nodes.taskSelect.appendChild(
                el("option", {
                    value: t.title,
                    text: (t.subject ? t.subject + " · " : "") + t.title
                })
            );
        });

        nodes.taskSelect.value = cycle.taskTitle;

        if (nodes.taskSelect.value !== cycle.taskTitle) {
            nodes.taskSelect.value = "";
            cycle.taskTitle = "";
        }
    }


    /* =========================================
       SETTINGS PANEL
       ========================================= */

    function renderSettingsForm() {

        var s = settings();
        var map = {
            setFocus: s.focus,
            setShort: s.shortBreak,
            setLong: s.longBreak,
            setEvery: s.longEvery,
            setGoal: s.dailyGoal
        };

        Object.keys(map).forEach(function (id) {
            var node = doc.getElementById(id);
            if (node) { node.value = map[id]; }
        });

        var sound = doc.getElementById("setSound");
        if (sound) { sound.checked = s.sound !== false; }

        var notif = doc.getElementById("setNotify");
        if (notif) {
            notif.checked = s.notify === true;
            notif.disabled = !("Notification" in global);
        }
    }

    function saveSettings() {

        Store.settings.patch({
            focus: Number(doc.getElementById("setFocus").value) || 25,
            shortBreak: Number(doc.getElementById("setShort").value) || 5,
            longBreak: Number(doc.getElementById("setLong").value) || 15,
            longEvery: Number(doc.getElementById("setEvery").value) || 4,
            dailyGoal: Number(doc.getElementById("setGoal").value) || 120,
            sound: doc.getElementById("setSound").checked,
            notify: doc.getElementById("setNotify").checked
        });

        if (!cycle.running) {
            cycle.remaining = lengthFor(cycle.mode);
        }

        save();
        render();

        ui.toast("Timer settings saved", "success");
    }


    /* =========================================
       INIT
       ========================================= */

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.time = doc.getElementById("pomoTime");
        if (!nodes.time) { return; }

        nodes.ring = doc.getElementById("pomoRing");
        nodes.modeLabel = doc.getElementById("pomoModeLabel");
        nodes.taskLabel = doc.getElementById("pomoTaskLabel");
        nodes.taskSelect = doc.getElementById("pomoTaskSelect");
        nodes.start = doc.getElementById("pomoStart");
        nodes.pause = doc.getElementById("pomoPause");
        nodes.reset = doc.getElementById("pomoReset");
        nodes.skip = doc.getElementById("pomoSkip");
        nodes.wrap = doc.getElementById("pomoCard");
        nodes.roundLabel = doc.getElementById("pomoRound");
        nodes.statToday = doc.getElementById("pomoStatToday");
        nodes.statSessions = doc.getElementById("pomoStatSessions");
        nodes.statStreak = doc.getElementById("pomoStatStreak");

        restore();

        /* deep link: dashboard.html?focus=Task%20title */
        var params = new URLSearchParams(location.search);
        var preset = params.get("focus");

        if (preset) {
            cycle.taskTitle = preset;
        }

        fillTaskPicker();

        ui.$$("[data-mode]").forEach(function (b) {
            b.addEventListener("click", function () {
                if (cycle.running) {
                    ui.toast("Pause the timer before switching mode", "warn");
                    return;
                }
                switchMode(b.dataset.mode);
            });
        });

        nodes.start.addEventListener("click", start);
        nodes.pause.addEventListener("click", pause);
        nodes.reset.addEventListener("click", reset);
        nodes.skip.addEventListener("click", skip);

        if (nodes.taskSelect) {
            nodes.taskSelect.addEventListener("change", function () {
                cycle.taskTitle = nodes.taskSelect.value;
                save();
                render();
            });
        }

        var settingsBtn = doc.getElementById("pomoSettingsBtn");
        if (settingsBtn) {
            renderSettingsForm();
            settingsBtn.addEventListener("click", function () {
                ui.openModal("pomoSettingsModal");
            });
        }

        var notifBtn = doc.getElementById("pomoNotifyBtn");
        if (notifBtn) {
            notifBtn.addEventListener("click", askNotifyPermission);
        }

        /* keyboard shortcuts */
        doc.addEventListener("keydown", function (e) {

            var tag = (e.target.tagName || "").toLowerCase();
            if (tag === "input" || tag === "textarea") { return; }
            if (doc.querySelector(".modal.show")) { return; }

            if (e.code === "Space") {
                e.preventDefault();
                cycle.running ? pause() : start();
            }
        });

        render();
    }


    global.SS = global.SS || {};
    global.SS.pomodoro = {
        init: init,
        saveSettings: saveSettings,
        askNotifyPermission: askNotifyPermission,
        refreshTaskPicker: fillTaskPicker
    };

    doc.addEventListener("DOMContentLoaded", init);


}(window));