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

        global.SS.ui.initChrome();
    });


}(window));