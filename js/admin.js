/* =========================================
   SMART STUDY - ADMIN CONSOLE
   Talks to /api/admin with the key printed
   in the server console. No user login is
   involved: this page never edits study
   data, only the operations overview.

   The key lives in sessionStorage (this tab
   only) and is forgotten on Lock or close.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var ui = global.SS.ui;

    var $ = ui.$;

    var KEY_MEMO = "ssAdminKey";
    var key = null;

    var state = {
        users: [],
        filter: "",
        pwTarget: null
    };


    /* ---------- boot ---------- */

    doc.addEventListener("DOMContentLoaded", function () {

        ui.theme.init();

        bind("unlockBtn", unlock);
        bind("refreshBtn", load);
        bind("cleanupBtn", cleanup);
        bind("lockBtn", lock);
        bind("pwSaveBtn", savePassword);

        $("#keyInput").addEventListener("keydown", function (e) {
            if (e.key === "Enter") { unlock(); }
        });

        $("#emailInput").addEventListener("keydown", function (e) {
            if (e.key === "Enter") { $("#keyInput").focus(); }
        });

        $("#searchInput").addEventListener("input", function (e) {
            state.filter = e.target.value;
            renderUsers();
        });

        ui.$$("[data-user-close]").forEach(function (b) {
            b.addEventListener("click", function () { ui.closeModal("userModal"); });
        });

        ui.$$("[data-pw-close]").forEach(function (b) {
            b.addEventListener("click", function () { ui.closeModal("pwModal"); });
        });

        try { key = sessionStorage.getItem(KEY_MEMO); } catch (e) { key = null; }

        if (key) { load(); } else { showLock(); }
    });


    /* ---------- server talk ---------- */

    /* The console may be previewed from Live Server or opened from
       file://, so ask storage.js where the backend lives. Served by the
       app's own server this is "" and the paths stay relative. */
    function adminOrigin() {
        return (global.SS && global.SS.store && global.SS.store.apiOrigin)
            ? global.SS.store.apiOrigin()
            : "";
    }

    function api(method, path, body) {

        /* path is relative to the admin API: "/stats" not "/api/stats" */
        var url = adminOrigin() + "/api/admin" + (path.charAt(0) === "/" ? path : "/" + path);

        /* never called with a body on GET/DELETE: fetch rejects that */
        var init = {
            method: method,
            headers: {
                "Content-Type": "application/json",
                "x-admin-key": key || ""
            }
        };

        if (body !== undefined && method !== "GET" && method !== "DELETE") {
            init.body = JSON.stringify(body);
        }

        return fetch(url, init).then(function (res) {

            return res.json().catch(function () { return null; }).then(function (data) {

                if (!res.ok) {
                    return Promise.reject({
                        status: res.status,
                        message: (data && data.error) || ("HTTP " + res.status)
                    });
                }

                return data;
            });

        }).catch(function (err) {

            if (err && err.status) { return Promise.reject(err); }
            return Promise.reject({ status: 0, message: "Server unreachable." });
        });
    }

    function showApiError(err) {

        if (err && err.status === 401) {
            showLock();
            showKeyError("That admin key was rejected - it may have changed after a server restart.");
            return;
        }

        ui.toast((err && err.message) || "Something went wrong.", "error");
    }


    /* ---------- unlock / lock ---------- */

    function unlock() {

        var email = $("#emailInput").value.trim();
        var password = $("#keyInput").value;

        if (!email || !password) {
            showKeyError("Enter the admin Gmail and password.");
            return;
        }

        fetch(adminOrigin() + "/api/admin/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-admin-email": email,
                "x-admin-password": password
            }
        }).then(function (res) {

            return res.json().catch(function () { return null; }).then(function (data) {

                if (!res.ok) {
                    return Promise.reject({
                        status: res.status,
                        message: (data && data.error) || ("HTTP " + res.status)
                    });
                }

                /* the console trades the credentials for the
                   operations key and never stores the password */
                key = data.key;

                try { sessionStorage.setItem(KEY_MEMO, key); } catch (e) { /* private mode */ }

                $("#emailInput").value = "";
                $("#keyInput").value = "";
                hideKeyError();
                load();

            });

        }).catch(function (err) {

            key = null;

            if (err && err.status === 401) {
                showKeyError("That Gmail or password is not the admin account.");
            } else if (err && err.status === 403) {
                showKeyError((err && err.message) || "This account is not the admin.");
            } else {
                showKeyError((err && err.message) || "Server unreachable.");
            }
        });
    }

    function lock() {

        key = null;

        try { sessionStorage.removeItem(KEY_MEMO); } catch (e) { /* private mode */ }

        ui.closeModal("userModal");
        ui.closeModal("pwModal");
        showLock();
        ui.toast("Signed out. The key is forgotten on this tab.", "success");
    }


    /* ---------- views ---------- */

    function showLock() {
        $("#lockView").hidden = false;
        $("#adminView").hidden = true;
    }

    function showAdmin() {
        $("#lockView").hidden = true;
        $("#adminView").hidden = false;
    }

    function showKeyError(msg) {
        var node = $("#keyError");
        node.textContent = msg;
        node.hidden = false;
    }

    function hideKeyError() {
        $("#keyError").hidden = true;
    }

    function load() {

        if (!key) { showLock(); return; }

        Promise.all([api("GET", "/stats"), api("GET", "/users")]).then(function (r) {

            showAdmin();
            renderStats(r[0]);
            state.users = r[1].users || [];
            renderUsers();

        }, function (err) {
            global.console.error("[admin] load failed:", err && err.status, err && err.message);
            showApiError(err);
        });
    }


    /* ---------- render ---------- */

    function renderStats(s) {

        $("#statUsers").textContent = s.users;
        $("#statSessions").textContent = s.sessions;
        $("#statSize").textContent = fmtBytes(s.bytes);
        $("#statUptime").textContent = fmtUptime(s.uptimeMs);
        $("#statNode").textContent = s.nodeVersion || "—";
    }

    function renderUsers() {

        var tbody = $("#userRows");
        var empty = $("#noUsers");
        var q = state.filter.trim().toLowerCase();

        ui.clear(tbody);

        var list = state.users.filter(function (u) {
            return !q ||
                String(u.name).toLowerCase().indexOf(q) !== -1 ||
                String(u.email).toLowerCase().indexOf(q) !== -1;
        });

        list.forEach(function (u) {

            var tr = el("tr", {}, []);

            tr.appendChild(cell(u.name));
            tr.appendChild(cell(u.email, "adm-mono"));
            tr.appendChild(cell(u.joinedAt ? ui.fmtDate(u.joinedAt) : "—"));
            tr.appendChild(cell(u.lastActive ? ui.fmtDate(u.lastActive) : "never"));
            tr.appendChild(cell(u.collections + " · " + fmtBytes(u.bytes)));
            tr.appendChild(cell(String(u.sessions)));

            var actions = el("td", { class: "adm-actions" }, []);

            actions.appendChild(btn("View", function () { openUser(u.email); }));
            actions.appendChild(btn("Reset password", function () { openPassword(u); }));
            actions.appendChild(btn("Delete", function () { remove(u); }, true));

            tr.appendChild(actions);
            tbody.appendChild(tr);
        });

        ui.clear(empty);
        empty.hidden = list.length > 0;

        if (!list.length) {
            empty.appendChild(ui.emptyState(
                "👥",
                state.users.length ? "No match" : "No accounts yet",
                state.users.length
                    ? "No account matches that search."
                    : "Signups appear here the moment someone creates one.",
                "Refresh",
                load
            ));
        }
    }


    /* ---------- account actions ---------- */

    function openUser(email) {

        api("GET", "/users/" + encodeURIComponent(email)).then(function (d) {

            $("#umName").textContent = d.user.name;
            $("#umEmail").textContent =
                d.user.email + " · joined " + ui.fmtDate(d.user.joinedAt);

            var table = $("#umCollections");
            ui.clear(table);

            var head = el("tr", {}, []);
            ["Collection", "Size", "Last saved"].forEach(function (t) {
                var th = el("th", {}, []);
                th.textContent = t;
                head.appendChild(th);
            });
            table.appendChild(head);

            if (!d.collections.length) {
                var tr = el("tr", {}, []);
                var td = el("td", { colspan: "3", class: "adm-hint-row" }, []);
                td.textContent = "Nothing saved on the server yet.";
                tr.appendChild(td);
                table.appendChild(tr);
            }

            d.collections.forEach(function (c) {
                var tr = el("tr", {}, []);
                tr.appendChild(cell(c.name));
                tr.appendChild(cell(fmtBytes(c.bytes)));
                tr.appendChild(cell(c.updatedAt ? ui.fmtDate(c.updatedAt) : "—"));
                table.appendChild(tr);
            });

            $("#umFooter").textContent =
                d.sessions + " live session(s). Deleting the account signs out " +
                "every device and removes all of its server data.";

            ui.openModal("userModal");

        }).catch(showApiError);
    }

    function openPassword(u) {

        state.pwTarget = u;

        $("#pwWho").textContent =
            "For " + u.name + " (" + u.email + "). Every device signed in as " +
            "them will be logged out.";

        $("#pwInput").value = "";
        ui.openModal("pwModal");
    }

    function savePassword() {

        var target = state.pwTarget;
        var next = $("#pwInput").value;

        if (!target) { return; }

        if (String(next).length < 8) {
            ui.toast("Password must be at least 8 characters.", "warn");
            return;
        }

        api("POST", "/users/" + encodeURIComponent(target.email) + "/password", {
            password: next
        }).then(function () {

            ui.closeModal("pwModal");
            ui.toast("Password reset for " + target.name + ".", "success");
            load();

        }).catch(showApiError);
    }

    function remove(u) {

        ui.confirmBox({
            title: "Delete " + u.name + "?",
            message: "Removes the account, every session and all server data for " +
                u.email + ". This cannot be undone.",
            confirmText: "Delete account"
        }).then(function (ok) {

            if (!ok) { return; }

            api("DELETE", "/users/" + encodeURIComponent(u.email)).then(function () {
                ui.toast("Account deleted.", "success");
                load();
            }).catch(showApiError);
        });
    }

    function cleanup() {

        api("POST", "/cleanup").then(function (r) {
            ui.toast("Swept " + r.swept + " expired session(s).", "success");
            load();
        }).catch(showApiError);
    }


    /* ---------- small helpers ---------- */

    function el(tag, props, children) {
        return ui.el(tag, props, children);
    }

    function cell(text, cls) {

        var td = el("td", cls ? { class: cls } : {}, []);
        td.textContent = text;

        return td;
    }

    function btn(label, fn, danger) {

        var b = el("button", { class: "mini-btn", type: "button" }, []);
        b.textContent = label;

        if (danger) { b.style.color = "var(--danger)"; }

        b.addEventListener("click", fn);
        return b;
    }

    function bind(id, fn) {

        var node = doc.getElementById(id);
        if (node) { node.addEventListener("click", fn); }
    }

    function fmtBytes(n) {

        n = Number(n) || 0;

        if (n < 1024) { return n + " B"; }
        if (n < 1024 * 1024) { return (n / 1024).toFixed(1) + " KB"; }

        return (n / (1024 * 1024)).toFixed(2) + " MB";
    }

    function fmtUptime(ms) {

        var min = Math.floor((Number(ms) || 0) / 60000);

        if (min < 60) { return min + "m"; }

        var h = Math.floor(min / 60);
        min = min % 60;

        if (h < 24) { return h + "h " + min + "m"; }

        return Math.floor(h / 24) + "d " + (h % 24) + "h";
    }


}(window));
