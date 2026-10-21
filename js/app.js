/* =========================================
   SMART STUDY - APP BOOTSTRAP
   Shared page chrome for every signed-in
   screen: theme, navbar, logout, guard.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;

    doc.addEventListener("DOMContentLoaded", function () {

        /* protected pages bounce to login when nobody is signed in */
        if (!global.SS.auth || !global.SS.auth.current()) {
            return;
        }

        /* Backfill the built-in subject shelf for accounts that were made
           before subjects existed, so Study Plan, Tasks and Quiz all show
           the same subjects without a fresh signup. */
        global.SS.models.subjects.seedDefaults();

        pullFromServer();

        /* every so often, reconcile with the server: push anything a
           tab forgot to flush, and see if the session is still alive */
        global.addEventListener("focus", refreshLoginState);
        doc.addEventListener("visibilitychange", function () {
            if (!doc.hidden) { refreshLoginState(); }
        });

        startSessionWatchdog();

        global.SS.ui.initChrome();
    });


    /* -----------------------------------------
       Keeps the local session in step with the
       server one. Idle for half an hour, or
       logged out from another device, and this
       tab steps down to the login screen -
       just like a real server-side session.
       ----------------------------------------- */

    var IDLE_LIMIT = 30 * 60 * 1000;   /* half an hour without touching anything */
    var lastActivity = Date.now();
    var watchdogTimer = null;

    function touchActivity() {
        lastActivity = Date.now();
    }

    function startSessionWatchdog() {

        ["click", "keydown", "mousemove", "touchstart"].forEach(function (evt) {
            global.addEventListener(evt, touchActivity, { passive: true });
        });

        if (watchdogTimer) { clearInterval(watchdogTimer); }

        watchdogTimer = setInterval(checkSession, 60 * 1000);
    }

    function checkSession() {

        var session = global.SS.store.session.get();
        var auth = global.SS.auth;

        if (!session || session.guest || !auth || !auth.current()) { return; }

        /* idle too long: the server has already let the session go,
           so log out here to match */
        if (Date.now() - lastActivity > IDLE_LIMIT) {
            clearInterval(watchdogTimer);
            watchdogTimer = null;
            auth.logout({ silent: true });
            return;
        }

        refreshLoginState();
    }

    /* Flushes anything waiting to be written, then asks the server
       whether we are still signed in. */
    function refreshLoginState() {

        var store = global.SS.store;
        var auth = global.SS.auth;

        if (!store.sync || !store.sync.isSyncedAccount()) { return; }

        store.sync.flush();

        auth.refreshLogin().then(function (ok) {
            if (ok === false) {
                global.SS.ui.toast("Your session ended - please log in again.", "warn");
                setTimeout(function () { auth.logout({ silent: true }); }, 800);
            }
        });
    }


    /* Bring in anything saved on the server (another tab, another
       device) and reload once if this device was behind. The reload
       guard stops a pull-then-reload loop. */
    function pullFromServer() {

        var store = global.SS.store;

        if (!store.sync || !store.sync.isSyncedAccount()) { return; }

        var hadReload = false;

        try {
            hadReload = sessionStorage.getItem("ssSyncReload") === "1";
            sessionStorage.removeItem("ssSyncReload");
        } catch (e) { /* private mode etc. */ }

        store.sync.pull().then(function (changed) {
            if (!changed || hadReload) { return; }

            try { sessionStorage.setItem("ssSyncReload", "1"); } catch (e) { /* ignore */ }
            global.location.reload();
        });
    }


}(window));