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


    /* ---------- helpers ---------- */

    /* Disables a form while its request is in flight, so a slow server
       never gets the same submission twice. */
    function busy(form, on, label) {

        var button = form.querySelector("button[type=submit]");

        form.querySelectorAll("input, button").forEach(function (node) {
            node.disabled = on;
        });

        if (button && on) {
            button.dataset.label = button.textContent;
            button.textContent = label || "Please wait…";
        } else if (button && button.dataset.label) {
            button.textContent = button.dataset.label;
        }
    }

    /* Auth.signup / Auth.login resolve to {ok, error}; a redirect only
       happens once the result is actually back. */
    function finish(result, errorNode, onSuccess) {

        if (result.ok) { onSuccess(); return; }

        errorNode.textContent = result.error || "Something went wrong. Please try again.";
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
            busy(form, true, "Logging in…");

            Auth.login(
                doc.getElementById("email").value,
                doc.getElementById("password").value
            ).then(function (result) {

                busy(form, false);

                finish(result, error, function () {

                    if (result.offline) {
                        ui.toast("Signed in on this device only (server offline)", "warn");
                    } else {
                        ui.toast("Welcome back! 🎓", "success");
                    }

                    setTimeout(function () {
                        global.location.href = Auth.nextUrl();
                    }, 400);
                });
            });
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
            busy(form, true, "Creating account…");

            Auth.signup({
                name: doc.getElementById("name").value,
                email: doc.getElementById("email").value,
                password: pwInput.value,
                confirm: doc.getElementById("confirm").value
            }).then(function (result) {

                busy(form, false);

                finish(result, error, function () {

                    if (result.offline) {
                        ui.toast("Account created on this device (server offline)", "warn");
                    } else {
                        ui.toast("Account created 🎉", "success");
                    }

                    setTimeout(function () {
                        global.location.href = "dashboard.html";
                    }, 500);
                });
            });
        });
    }


    doc.addEventListener("DOMContentLoaded", function () {
        ui.initChrome();
        initPasswordToggles();
        initLogin();
        initSignup();
    });


}(window));