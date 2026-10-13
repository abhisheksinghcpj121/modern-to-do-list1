/* =========================================
   SMART STUDY - LOGIN / SIGNUP PAGE SCRIPT
   Handles both forms plus the shared
   show/hide password toggles.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var ui = global.SS.ui;
    var Auth = global.SS.auth;


    /* ---------- password visibility ---------- */

    function initPasswordToggles() {

        ui.$$("[data-pw-toggle]").forEach(function (btn) {

            btn.addEventListener("click", function () {

                var input = doc.getElementById(btn.dataset.pwToggle);

                if (!input) { return; }

                var hidden = input.type === "password";

                input.type = hidden ? "text" : "password";
                btn.textContent = hidden ? "HIDE" : "SHOW";
            });
        });
    }


    /* ---------- login ---------- */

    function initLogin() {

        var form = doc.getElementById("loginForm");

        if (!form) { return; }

        if (Auth.redirectIfAuthed()) { return; }

        var error = doc.getElementById("loginError");

        form.addEventListener("submit", function (e) {

            e.preventDefault();
            error.textContent = "";

            var result = Auth.login(
                doc.getElementById("email").value,
                doc.getElementById("password").value
            );

            if (!result.ok) {
                error.textContent = result.error;
                return;
            }

            ui.toast("Welcome back! 🎓", "success");

            setTimeout(function () {
                global.location.href = Auth.nextUrl();
            }, 500);
        });

        var guestBtn = doc.getElementById("guestBtn");

        if (guestBtn) {
            guestBtn.addEventListener("click", function () {
                Auth.loginAsGuest();
                ui.toast("Signed in as guest", "info");
                global.location.href = Auth.nextUrl();
            });
        }
    }


    /* ---------- signup ---------- */

    function initSignup() {

        var form = doc.getElementById("signupForm");

        if (!form) { return; }

        if (Auth.redirectIfAuthed()) { return; }

        var error = doc.getElementById("signupError");
        var pwInput = doc.getElementById("password");
        var pwFill = doc.getElementById("pwFill");
        var pwLabel = doc.getElementById("pwLabel");

        /* live password strength */
        if (pwInput && pwFill) {

            pwInput.addEventListener("input", function () {

                var result = Auth.strength(pwInput.value);

                pwFill.style.width = (result.score / 4) * 100 + "%";
                pwFill.style.background = result.color;

                if (pwLabel) {
                    pwLabel.textContent = pwInput.value
                        ? "Password strength: " + result.label
                        : "Use a mix of letters, numbers and symbols.";
                    pwLabel.style.color = result.color;
                }
            });
        }

        form.addEventListener("submit", function (e) {

            e.preventDefault();
            error.textContent = "";

            var result = Auth.signup({
                name: doc.getElementById("name").value,
                email: doc.getElementById("email").value,
                password: pwInput.value,
                confirm: doc.getElementById("confirm").value
            });

            if (!result.ok) {
                error.textContent = result.error;
                return;
            }

            ui.toast("Account created 🎉", "success");

            setTimeout(function () {
                global.location.href = "dashboard.html";
            }, 600);
        });
    }


    doc.addEventListener("DOMContentLoaded", function () {
        ui.initChrome();
        initPasswordToggles();
        initLogin();
        initSignup();
    });


}(window));