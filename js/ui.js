/* =========================================
   SMART STUDY - UI KIT
   DOM helpers, toasts, theme, modals,
   date + format utilities, page chrome.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var Store = global.SS.store;

    var DAY_MS = 86400000;

    var SUBJECT_COLORS = [
        "#4f46e5", "#0ea5e9", "#10b981", "#f59e0b",
        "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"
    ];

    var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


    /* =========================================
       DOM HELPERS
       ========================================= */

    function $(sel, root) {
        return (root || doc).querySelector(sel);
    }

    function $$(sel, root) {
        return Array.prototype.slice.call((root || doc).querySelectorAll(sel));
    }

    /*
       el("div", { class: "card", onclick: fn }, ["text", childNode])
       User data always goes through `text` (textContent),
       never `html`, so notes/titles cannot inject markup.
    */
    function el(tag, props, children) {
        var node = doc.createElement(tag);

        if (props) {
            Object.keys(props).forEach(function (key) {
                var value = props[key];

                if (value === null || value === undefined || value === false) {
                    return;
                }

                if (key === "class") {
                    node.className = value;
                } else if (key === "text") {
                    node.textContent = value;
                } else if (key === "dataset") {
                    Object.keys(value).forEach(function (d) {
                        node.dataset[d] = value[d];
                    });
                } else if (key === "style" && typeof value === "object") {
                    Object.assign(node.style, value);
                } else if (key.indexOf("on") === 0 && typeof value === "function") {
                    node.addEventListener(key.slice(2).toLowerCase(), value);
                } else {
                    node.setAttribute(key, value === true ? "" : value);
                }
            });
        }

        if (children) {
            children.forEach(function (child) {
                if (child === null || child === undefined || child === false) {
                    return;
                }
                node.appendChild(
                    typeof child === "string" || typeof child === "number"
                        ? doc.createTextNode(String(child))
                        : child
                );
            });
        }

        return node;
    }

    /* SVG needs its own element factory: createElement makes HTML nodes,
       which browsers refuse to render inside a <svg>. */
    var SVG_NS = "http://www.w3.org/2000/svg";

    function svg(tag, props, children) {

        var node = doc.createElementNS(SVG_NS, tag);

        if (props) {
            Object.keys(props).forEach(function (key) {

                var value = props[key];

                if (value === null || value === undefined || value === false) {
                    return;
                }

                if (key === "text") {
                    node.textContent = value;
                } else if (key === "style" && typeof value === "object") {
                    Object.assign(node.style, value);
                } else if (key.indexOf("on") === 0 && typeof value === "function") {
                    node.addEventListener(key.slice(2).toLowerCase(), value);
                } else {
                    node.setAttribute(key, value === true ? "" : value);
                }
            });
        }

        if (children) {
            children.forEach(function (child) {
                if (child === null || child === undefined || child === false) {
                    return;
                }
                node.appendChild(
                    typeof child === "string" || typeof child === "number"
                        ? doc.createTextNode(String(child))
                        : child
                );
            });
        }

        return node;
    }

    function clear(node) {
        if (!node) {
            return;
        }
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    /*
       Staggers a freshly rendered list into view.

       Only the FIRST render of a given host animates. Every later render
       is left instant on purpose: replaying an entrance animation each
       time a checkbox is ticked reads as lag, not polish. The marker is
       kept on the element itself so it survives ui.clear() rebuilding
       its children.
    */
    var REVEAL_MAX = 12;

    function revealOnce(host) {

        if (!host || host.dataset.revealed === "yes") {
            return;
        }

        host.dataset.revealed = "yes";

        var kids = host.children;
        var count = Math.min(kids.length, REVEAL_MAX);
        var i;

        for (i = 0; i < count; i++) {
            kids[i].classList.add("reveal-item");
            kids[i].style.setProperty("--reveal-i", i);
        }
    }

    function debounce(fn, wait) {
        var timer = null;

        return function () {
            var ctx = this;
            var args = arguments;

            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(ctx, args);
            }, wait || 200);
        };
    }

    function emptyState(icon, title, message, actionLabel, onAction) {
        var node = el("div", { class: "empty" }, [
            el("div", { class: "empty-icon", text: icon }),
            el("h3", { text: title }),
            el("p", { text: message })
        ]);

        if (actionLabel && onAction) {
            node.appendChild(
                el("button", {
                    class: "primary-btn btn-sm",
                    onclick: onAction,
                    text: actionLabel
                })
            );
        }

        return node;
    }


    /* =========================================
       DATE UTILS
       ========================================= */

    function pad(n) {
        return String(n).padStart(2, "0");
    }

    function toISO(date) {
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
    }

    function todayISO() {
        return toISO(new Date());
    }

    function parseISO(iso) {
        if (!iso) {
            return null;
        }

        var p = String(iso).split("-");
        var d;

        if (p.length < 3) {
            return null;
        }

        d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));

        return isNaN(d.getTime()) ? null : d;
    }

    function addDays(iso, n) {
        var d = parseISO(iso) || new Date();
        d.setDate(d.getDate() + n);
        return toISO(d);
    }

    function diffDays(fromISO, toISO_) {
        var a = parseISO(fromISO);
        var b = parseISO(toISO_);

        if (!a || !b) {
            return 0;
        }

        return Math.round((b.getTime() - a.getTime()) / DAY_MS);
    }

    function relDate(iso) {
        if (!parseISO(iso)) {
            return "No date";
        }

        var d = diffDays(todayISO(), iso);

        if (d === 0) { return "Today"; }
        if (d === 1) { return "Tomorrow"; }
        if (d === -1) { return "Yesterday"; }
        if (d > 0) { return "in " + d + " days"; }

        return Math.abs(d) + " days ago";
    }

    function fmtDate(iso) {
        var d = parseISO(iso);

        if (!d) {
            return "No date";
        }

        return d.getDate() + " " + MONTHS[d.getMonth()];
    }

    function fmtDateLong(iso) {
        var d = parseISO(iso);

        if (!d) {
            return "No date";
        }

        return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
    }

    function weekdayName(index, short) {
        return short ? WEEKDAYS_SHORT[index] : WEEKDAYS[index];
    }

    function weekdayToday() {
        return new Date().getDay();
    }

    function fmtMinutes(mins) {
        var m = Math.max(0, Math.round(mins || 0));
        var h = Math.floor(m / 60);
        var r = m % 60;

        if (h && r) { return h + "h " + r + "m"; }
        if (h) { return h + "h"; }

        return r + "m";
    }

    function fmtClock(totalSeconds) {
        var m = Math.floor(Math.max(0, totalSeconds) / 60);
        var s = Math.max(0, totalSeconds) % 60;

        return pad(m) + ":" + pad(s);
    }


    /* =========================================
       MISC FORMATTERS
       ========================================= */

    function subjectColor(name) {
        var key = String(name || "general").toLowerCase();
        var h = 0;
        var i;

        for (i = 0; i < key.length; i++) {
            h = ((h << 5) - h) + key.charCodeAt(i);
            h |= 0;
        }

        return SUBJECT_COLORS[Math.abs(h) % SUBJECT_COLORS.length];
    }

    function escapeRegExp(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function matches(haystack, needle) {
        if (!needle) {
            return true;
        }
        return new RegExp(escapeRegExp(needle), "i").test(haystack || "");
    }


    /* =========================================
       TOASTS
       ========================================= */

    var TOAST_ICON = {
        success: "✅",
        error: "⛔",
        warn: "⚠️",
        info: "ℹ️"
    };

    function toastStack() {
        var stack = $(".toast-stack");

        if (!stack) {
            stack = el("div", {
                class: "toast-stack",
                "aria-live": "polite",
                "aria-atomic": "false"
            });
            doc.body.appendChild(stack);
        }

        return stack;
    }

    function toast(message, type, ms) {
        var kind = type || "info";
        var node = el("div", { class: "toast " + kind, role: "status" }, [
            el("span", { class: "toast-icon", text: TOAST_ICON[kind] || TOAST_ICON.info }),
            el("span", { text: message })
        ]);

        toastStack().appendChild(node);

        setTimeout(function () {
            node.classList.add("out");
            setTimeout(function () {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            }, 260);
        }, ms || 2600);

        return node;
    }


    /* =========================================
       MODALS
       ========================================= */

    var openModals = [];

    function openModal(id) {
        var modal = typeof id === "string" ? doc.getElementById(id) : id;

        if (!modal) {
            return;
        }

        modal.classList.add("show");
        modal.removeAttribute("aria-hidden");
        doc.body.classList.add("no-scroll");
        openModals.push(modal);

        var focusable = modal.querySelector("input, textarea, select, button");
        if (focusable) {
            setTimeout(function () { focusable.focus(); }, 40);
        }
    }

    function closeModal(id) {
        var modal = typeof id === "string" ? doc.getElementById(id) : id;

        if (!modal) {
            return;
        }

        modal.classList.remove("show");
        modal.setAttribute("aria-hidden", "true");

        openModals = openModals.filter(function (m) {
            return m !== modal;
        });

        if (!openModals.length) {
            doc.body.classList.remove("no-scroll");
        }
    }

    /* Promise based confirm, replaces window.alert/confirm */
    function confirmBox(options) {
        var opts = options || {};

        return new Promise(function (resolve) {
            var settled = false;
            var backdrop;
            var panel;

            function finish(result) {
                if (settled) { return; }
                settled = true;

                if (backdrop && backdrop.parentNode) {
                    backdrop.parentNode.removeChild(backdrop);
                }
                doc.body.classList.remove("no-scroll");

                resolve(result);
            }

            panel = el("div", { class: "modal-content", role: "dialog", "aria-modal": "true" }, [
                el("button", {
                    class: "close-btn",
                    type: "button",
                    "aria-label": "Close",
                    text: "×",
                    onclick: function () { finish(false); }
                }),
                el("h2", { text: opts.title || "Are you sure?" }),
                el("p", { text: opts.message || "" }),
                el("div", { class: "row", style: { justifyContent: "flex-end", gap: "10px", marginTop: "6px" } }, [
                    el("button", {
                        class: "ghost-btn btn-sm",
                        type: "button",
                        text: opts.cancelText || "Cancel",
                        onclick: function () { finish(false); }
                    }),
                    el("button", {
                        class: opts.danger ? "danger-btn btn-sm" : "primary-btn btn-sm",
                        type: "button",
                        text: opts.confirmText || "Confirm",
                        onclick: function () { finish(true); }
                    })
                ])
            ]);

            backdrop = el("div", { class: "modal show" }, [panel]);

            backdrop.addEventListener("click", function (event) {
                if (event.target === backdrop) {
                    finish(false);
                }
            });

            function onKey(event) {
                if (event.key === "Escape") {
                    doc.removeEventListener("keydown", onKey);
                    finish(false);
                }
            }

            doc.addEventListener("keydown", onKey);
            doc.body.classList.add("no-scroll");
            doc.body.appendChild(backdrop);
        });
    }

    /* Promise based text prompt - same look as confirmBox but with one
       input field. Resolves with the trimmed + collapsed value, or null
       when the user cancels (Escape, backdrop click, × or Cancel). */
    function askText(options) {
        var opts = options || {};

        return new Promise(function (resolve) {
            var settled = false;
            var backdrop;
            var input;
            var error;

            function finish(result) {
                if (settled) { return; }
                settled = true;

                doc.removeEventListener("keydown", onKey);

                if (backdrop && backdrop.parentNode) {
                    backdrop.parentNode.removeChild(backdrop);
                }

                if (!doc.querySelector(".modal.show")) {
                    doc.body.classList.remove("no-scroll");
                }

                resolve(result);
            }

            function submit() {
                var value = String(input.value || "")
                    .trim()
                    .replace(/\s+/g, " ");

                if (!value) {
                    error.textContent = opts.required || "Please enter a value.";
                    input.focus();
                    return;
                }

                if (opts.validate) {
                    var problem = opts.validate(value);
                    if (problem) {
                        error.textContent = problem;
                        input.focus();
                        return;
                    }
                }

                finish(value);
            }

            input = el("input", {
                class: "input",
                type: "text",
                id: "askTextInput",
                placeholder: opts.placeholder || "",
                autocomplete: "off",
                maxlength: 80
            });

            error = el("p", { class: "error-text" });

            input.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                }
            });

            var panel = el("div", { class: "modal-content", role: "dialog", "aria-modal": "true" }, [
                el("button", {
                    class: "close-btn",
                    type: "button",
                    "aria-label": "Close",
                    text: "×",
                    onclick: function () { finish(null); }
                }),
                el("h2", { text: opts.title || "Add" }),
                el("p", { text: opts.message || "" }),
                el("div", { class: "field" }, [
                    el("label", { "for": "askTextInput", text: opts.label || "Name" }),
                    input,
                    error
                ]),
                el("div", { class: "row", style: { justifyContent: "flex-end", gap: "10px", marginTop: "6px" } }, [
                    el("button", {
                        class: "ghost-btn btn-sm",
                        type: "button",
                        text: opts.cancelText || "Cancel",
                        onclick: function () { finish(null); }
                    }),
                    el("button", {
                        class: "primary-btn btn-sm",
                        type: "button",
                        text: opts.confirmText || "Save",
                        onclick: submit
                    })
                ])
            ]);

            backdrop = el("div", { class: "modal show" }, [panel]);

            backdrop.addEventListener("click", function (event) {
                if (event.target === backdrop) {
                    finish(null);
                }
            });

            function onKey(event) {
                if (event.key === "Escape") {
                    finish(null);
                }
            }

            doc.addEventListener("keydown", onKey);
            doc.body.classList.add("no-scroll");
            doc.body.appendChild(backdrop);

            setTimeout(function () {
                input.focus();
                input.select();
            }, 40);
        });
    }


    /* =========================================
       SHARED SUBJECT DROPDOWNS
       Every subject <select> in the app is filled from the same shelf,
       and each of them can create a brand new subject on the spot: the
       "+ Add" button opens a tiny prompt, saves the name to the shared
       shelf (5 hours/week by default, adjustable on the Study Plan
       page) and selects it - so the subject instantly shows up on Study
       Plan, Tasks, Notes, Goals, Quiz and the dashboard.
       ========================================= */

    var NEW_SUBJECT_HOURS = 5;
    var subjectSelects = [];

    function subjectShelf(extra) {

        var M = (global.SS && global.SS.models) || {};
        var names = ((M.subjects && M.subjects.all()) || [])
            .map(function (s) { return s.name; });

        if (!names.length && M.DEFAULT_SUBJECTS) {
            names = M.DEFAULT_SUBJECTS.slice();
        }

        (typeof extra === "function" ? extra() : (extra || [])).forEach(function (n) {
            if (n) { names.push(n); }
        });

        return names.filter(function (n, i, a) {
            return a.indexOf(n) === i;
        });
    }

    function fillSubjectSelect(entry) {

        var select = entry.select;
        var opts = entry.opts || {};
        var keep = select.value;

        clear(select);

        if (opts.blank) {
            var blank = typeof opts.blank === "string"
                ? { value: "", text: opts.blank }
                : opts.blank;

            select.appendChild(el("option", { value: blank.value, text: blank.text }));
        }

        subjectShelf(opts.extra).forEach(function (name) {
            select.appendChild(el("option", { value: name, text: name }));
        });

        /* An explicit `selected` wins (null/"" = first option); otherwise
           the previous value is kept, so legacy subjects that left the
           shelf stay visible instead of silently snapping to the top. */
        var target = "selected" in opts ? opts.selected : keep;

        if (target) {
            select.value = target;

            if (select.value !== target) {
                select.appendChild(el("option", { value: target, text: target }));
                select.value = target;
            }
        } else if ("selected" in opts) {
            select.selectedIndex = 0;
        }
    }

    /* Register (or re-fill) a subject dropdown. Call this BEFORE
       attaching your own change listener. */
    function subjectSelect(select, opts) {
        if (!select) { return select; }

        var entry = subjectSelects.filter(function (e) { return e.select === select; })[0];

        if (entry) {
            entry.opts = opts || {};
            fillSubjectSelect(entry);
        } else {
            entry = { select: select, opts: opts || {} };
            subjectSelects.push(entry);
            fillSubjectSelect(entry);
        }

        return select;
    }

    /* Rebuild every dropdown registered on this page, so a subject
       added a second ago is immediately selectable everywhere. */
    function refreshSubjectSelects() {
        subjectSelects.forEach(fillSubjectSelect);
    }

    /* The little "+ Add" button that sits next to a subject dropdown. */
    function subjectAddButton(button, select, onAdded) {
        if (!button || !select) { return button; }

        button.addEventListener("click", function () {

            var M = (global.SS && global.SS.models) || {};

            askText({
                title: "Add a subject",
                message: "It joins your subject shelf and appears on every page.",
                label: "Subject name",
                placeholder: "e.g. Operating Systems",
                confirmText: "Add subject",
                required: "Please enter a subject name."
            }).then(function (name) {

                if (!name) { return; }

                var exists = subjectShelf().filter(function (n) {
                    return n.toLowerCase() === name.toLowerCase();
                })[0];

                if (exists) {
                    toast("“" + exists + "” is already on your shelf", "info");
                } else if (M.subjects) {
                    M.subjects.add({ name: name, targetHours: NEW_SUBJECT_HOURS });
                    toast("Subject added 📚", "success");
                }

                refreshSubjectSelects();
                select.value = exists || name;

                /* let the page react (autosave, filters, re-renders, …) */
                select.dispatchEvent(new global.Event("change"));

                if (onAdded) { onAdded(); }
            });
        });

        return button;
    }


    /* =========================================
       THEME
       ========================================= */

    var Theme = {
        apply: function (mode) {
            doc.documentElement.setAttribute("data-theme", mode);
        },

        current: function () {
            return doc.documentElement.getAttribute("data-theme") || "light";
        },

        toggle: function () {
            var next = this.current() === "dark" ? "light" : "dark";

            this.apply(next);
            Store.settings.patch({ theme: next });

            if (Store.session.get()) {
                Store.users.update(Store.session.get().email, { theme: next });
            }

            this.syncButton();
            return next;
        },

        syncButton: function () {
            $$("[data-theme-toggle]").forEach(function (btn) {
                var dark = this.current() === "dark";
                btn.textContent = dark ? "☀️" : "🌙";
                btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
                btn.title = dark ? "Light mode" : "Dark mode";
            }, this);
        },

        init: function () {
            var saved = Store.settings.all().theme;

            this.apply(saved);
            this.syncButton();

            $$("[data-theme-toggle]").forEach(function (btn) {
                var self = this;
                btn.addEventListener("click", function () {
                    self.toggle();
                });
            }, this);
        }
    };


    /* =========================================
       SOUND
       ========================================= */

    function beep(pattern) {
        var seq = pattern || [660, 880];
        var ctx;
        var i;

        try {
            var Ctx = global.AudioContext || global.webkitAudioContext;

            if (!Ctx) { return; }

            ctx = new Ctx();

            for (i = 0; i < seq.length; i++) {
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();

                osc.type = "sine";
                osc.frequency.value = seq[i];

                gain.gain.setValueAtTime(0.0001, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.3);
            }
        } catch (e) { /* audio blocked, ignore */ }
    }


    /* =========================================
       GLOBAL SEARCH
       One box, injected into the top-right of
       every signed-in page's navbar. It ranks a
       query across tasks, notes, goals, exams,
       subjects and study-plan slots, then jumps
       to the result page.
       ========================================= */

    var SEARCH_LIMIT = 8;

    function search(query, limit) {

        var M = (global.SS && global.SS.models) || {};
        var q = String(query || "").trim().toLowerCase();

        if (!q) {
            return [];
        }

        var words = q.split(/\s+/).filter(function (w) {
            return w.length > 1;
        });

        if (!words.length) {
            return [];
        }

        var results = [];

        /* substring hits on the exact phrase outrank single-word hits */
        function score(text) {
            var lower = String(text || "").toLowerCase();
            var s = 0;

            if (lower.indexOf(q) !== -1) { s += 4; }

            words.forEach(function (w) {
                if (lower.indexOf(w) !== -1) { s += 2; }
            });

            return s;
        }

        function push(kind, icon, title, meta, href, item, s) {
            if (s > 0) {
                results.push({
                    kind: kind,
                    icon: icon,
                    title: title,
                    meta: meta || "",
                    href: href,
                    item: item,
                    score: s
                });
            }
        }

        (M.tasks ? M.tasks.all() : []).forEach(function (t) {
            push("task", "✅", t.title || "Untitled task",
                t.subject || "General",
                "tasks.html", t,
                score(t.title) + score(t.subject) * 0.6 + score(t.notes) * 0.35);
        });

        (M.notes ? M.notes.all() : []).forEach(function (n) {
            var tags = (n.tags || []).join(" ");
            push("note", "📝", n.title || "Untitled note",
                tags ? "#" + tags.replace(/\s+/g, " #") : "note",
                "notes.html", n,
                score(n.title) + score(n.content) * 0.5 + score(tags) * 0.5);
        });

        (M.goals ? M.goals.all() : []).forEach(function (g) {
            push("goal", "🎯", g.title || "Untitled goal",
                g.category || "goal",
                "goals.html", g,
                score(g.title) + score(g.category) * 0.6);
        });

        (M.exams ? M.exams.all() : []).forEach(function (e) {
            push("exam", "🗓️", e.title || "Untitled exam",
                (e.subject || "Exam") + (e.date ? " · " + fmtDate(e.date) : ""),
                "study-plan.html", e,
                score(e.title) + score(e.subject) * 0.6);
        });

        (M.plan ? M.plan.all() : []).forEach(function (p) {
            push("plan", "🕐", p.topic || p.subject || "Study slot",
                String(p.subject || "") + (p.start ? " · " + p.start : ""),
                "study-plan.html", p,
                score(p.subject) + score(p.topic) * 0.6);
        });

        (M.subjects ? M.subjects.all() : []).forEach(function (sub) {
            push("subject", "📚", sub.name || "Subject",
                "subject target",
                "study-plan.html", sub,
                score(sub.name));
        });

        results.sort(function (a, b) {
            return b.score - a.score;
        });

        return results.slice(0, limit || SEARCH_LIMIT);
    }

    var searchState = { active: -1 };

    function initGlobalSearch() {

        var actions = $(".nav-actions");

        if (!actions || $(".global-search", actions)) {
            return;
        }

        var wrap = el("div", { class: "global-search", role: "search" });
        var input = el("input", {
            class: "global-search-input",
            type: "search",
            placeholder: "Search tasks, notes…",
            "aria-label": "Search tasks, notes, goals and more",
            "aria-expanded": "false",
            autocomplete: "off",
            spellcheck: "false"
        });
        var drop = el("div", { class: "global-search-drop", hidden: true });

        wrap.appendChild(el("span", { class: "global-search-icon", text: "🔍", "aria-hidden": "true" }));
        wrap.appendChild(input);
        wrap.appendChild(el("kbd", { class: "global-search-kbd", text: "Ctrl+K" }));
        wrap.appendChild(drop);

        actions.insertBefore(wrap, actions.firstChild);

        function open() {
            drop.hidden = false;
            input.setAttribute("aria-expanded", "true");
        }

        function close() {
            drop.hidden = true;
            input.setAttribute("aria-expanded", "false");
            searchState.active = -1;
        }

        function jumpTo(result) {

            var href = result.href || "dashboard.html";

            close();
            input.value = "";
            clear(drop);

            /* replace (like the auth guard) so a jump never stacks
               a history entry in front of the search */
            if (typeof global.location.replace === "function") {
                global.location.replace(href);
            } else {
                global.location.href = href;
            }
        }

        function paintActive() {

            var rows = $$(".global-search-row", drop);

            rows.forEach(function (row, index) {
                var on = index === searchState.active;

                row.classList.toggle("active", on);
                row.setAttribute("aria-selected", on ? "true" : "false");

                if (on && typeof row.scrollIntoView === "function") {
                    row.scrollIntoView({ block: "nearest" });
                }
            });
        }

        function move(step) {

            if (drop.hidden) { return; }

            var count = $$(".global-search-row", drop).length;

            if (!count) { return; }

            searchState.active = (searchState.active + step + count) % count;
            paintActive();
        }

        function render() {

            var q = input.value;

            if (!q.trim()) {
                clear(drop);
                close();
                return;
            }

            var results = search(q, SEARCH_LIMIT);

            clear(drop);
            open();
            searchState.active = results.length ? 0 : -1;

            if (!results.length) {
                drop.appendChild(el("div", {
                    class: "global-search-empty",
                    text: "No matches for \u201C" + q + "\u201D"
                }));
                return;
            }

            results.forEach(function (result, index) {

                var row = el("button", {
                    class: "global-search-row",
                    type: "button",
                    role: "option",
                    "aria-selected": index === 0 ? "true" : "false",
                    onclick: function () { jumpTo(result); }
                }, [
                    el("span", { class: "global-search-ico", text: result.icon, "aria-hidden": "true" }),
                    el("span", { class: "global-search-main" }, [
                        el("span", { class: "global-search-title", text: result.title }),
                        el("span", { class: "global-search-meta", text: result.meta })
                    ]),
                    el("span", { class: "global-search-kind", text: result.kind })
                ]);

                /* run before blur so the click survives the dropdown closing */
                row.addEventListener("mousedown", function (event) {
                    event.preventDefault();
                });

                drop.appendChild(row);
            });

            paintActive();
        }

        input.addEventListener("input", debounce(render, 120));

        input.addEventListener("keydown", function (event) {

            if (event.key === "Escape") {
                event.preventDefault();
                close();
                input.blur();

            } else if (event.key === "ArrowDown") {
                event.preventDefault();
                move(1);

            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);

            } else if (event.key === "Enter") {
                event.preventDefault();

                var rows = $$(".global-search-row", drop);
                var idx = searchState.active >= 0 ? searchState.active : 0;

                if (rows[idx]) {
                    rows[idx].click();
                }
            }
        });

        input.addEventListener("focus", function () {
            if (input.value.trim()) {
                render();
            }
        });

        /* blur waits a beat so a click on a result lands first */
        input.addEventListener("blur", function () {
            setTimeout(close, 150);
        });

        /* Ctrl+K / Cmd+K focuses the box from anywhere */
        global.addEventListener("keydown", function (event) {

            if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "k") {
                event.preventDefault();
                input.focus();
                input.select();
            }
        });
    }


    /* =========================================
       PAGE CHROME
       ========================================= */

    /* =========================================
       SYNC STATUS CHIP
       An honest little readout of the link to
       the Node backend, so "is it connected?"
       never needs guessing.
       ========================================= */

    var SYNC_STATES = {
        syncing: { text: "☁️ Syncing…", cls: "", title: "Sending your latest changes to the server" },
        synced: { text: "☁️ Synced", cls: "ok", title: "Saved to your account on the server" },
        offline: { text: "⚠️ Server offline", cls: "warn", title: "The backend is not answering - everything is safe on this device and syncs when it is back" },
        local: { text: "📱 This device only", cls: "", title: "Guest account - data never leaves this browser" }
    };

    function paintSyncChip(state) {

        var chip = $("[data-sync-status]");

        if (!chip) { return; }

        var info = SYNC_STATES[state] || SYNC_STATES.local;

        chip.textContent = info.text;
        chip.title = info.title;
        chip.classList.toggle("ok", info.cls === "ok");
        chip.classList.toggle("warn", info.cls === "warn");
    }

    /* Creates the chip next to the user name and keeps it current:
       storage.js reports every sync, plus a reachability probe. */
    function initSyncChip(session) {

        if (!session) { return; }

        var nameNode = $("[data-user-name]");
        var host = (nameNode && nameNode.parentNode) || $(".nav-actions") || $(".navbar");

        if (!host) { return; }

        var chip = $("[data-sync-status]");

        /* Guest mode: this slot is the quick way into the admin console -
           an "admin" link at the top of the page, standing where the chip
           used to read "This device only". Signed-in accounts keep the
           honest sync readout below. */
        if (session.guest) {

            if (!chip || String(chip.tagName).toLowerCase() !== "a") {

                if (chip && chip.parentNode) {
                    chip.parentNode.removeChild(chip);
                }

                chip = el("a", {
                    class: "chip",
                    href: "admin.html",
                    dataset: { syncStatus: "" },
                    title: "Admin dashboard - the operations console for this server"
                }, ["admin"]);

                host.insertBefore(chip, nameNode || null);
            }

            return;
        }

        if (chip && String(chip.tagName).toLowerCase() === "a") {
            /* signed back in - the admin link steps aside for the sync readout */
            if (chip.parentNode) { chip.parentNode.removeChild(chip); }
            chip = null;
        }

        if (!chip) {
            chip = el("span", { class: "chip", dataset: { syncStatus: "" } }, []);
            host.insertBefore(chip, nameNode || null);
        }

        if (!Store.sync || !Store.sync.isSyncedAccount()) {
            paintSyncChip("offline");
            return;
        }

        paintSyncChip("syncing");

        Store.sync.onState(paintSyncChip);

        Store.sync.probe().then(function (ok) {
            paintSyncChip(ok ? "synced" : "offline");
        });
    }


    function initChrome() {
        var toggle = $("[data-menu-toggle]");
        var nav = $("#primaryNav");

        if (toggle && nav) {
            toggle.addEventListener("click", function () {
                nav.classList.toggle("open");
                toggle.setAttribute(
                    "aria-expanded",
                    nav.classList.contains("open") ? "true" : "false"
                );
            });
        }

        /* mark active nav link */
        var file = (location.pathname.split("/").pop() || "index.html").toLowerCase();

        $$("#primaryNav a").forEach(function (a) {
            var href = (a.getAttribute("href") || "").toLowerCase();

            if (href === file) {
                a.classList.add("active");
                a.setAttribute("aria-current", "page");
            }
        });

        /* navbar shadow on scroll */
        var nav2 = $(".navbar");

        if (nav2) {
            var onScroll = function () {
                nav2.classList.toggle("scrolled", global.scrollY > 6);
            };

            global.addEventListener("scroll", onScroll, { passive: true });
            onScroll();
        }

        /* logout */
        $$("[data-logout]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                confirmBox({
                    title: "Log out?",
                    message: "Your tasks and notes stay saved on this device.",
                    confirmText: "Log out"
                }).then(function (ok) {
                    if (ok) {
                        global.SS.auth.logout();
                    }
                });
            });
        });

        /* welcome copy in navbar */
        var session = Store.session.get();
        var nameNode = $("[data-user-name]");

        if (session && nameNode) {
            nameNode.textContent = session.name || session.email;
        }

        /* cloud status next to it (no chip on the login/signup pages) */
        initSyncChip(session);

        /* footer year */
        $$("[data-year]").forEach(function (n) {
            n.textContent = new Date().getFullYear();
        });

        initGlobalSearch();

        Theme.init();
    }


    /* =========================================
       EXPORT
       ========================================= */

    global.SS = global.SS || {};
    global.SS.ui = {
        $: $,
        $$: $$,
        el: el,
        svg: svg,
        clear: clear,
        revealOnce: revealOnce,
        debounce: debounce,
        emptyState: emptyState,
        toast: toast,
        openModal: openModal,
        closeModal: closeModal,
        confirmBox: confirmBox,
        askText: askText,
        subjectSelect: subjectSelect,
        refreshSubjectSelects: refreshSubjectSelects,
        subjectAddButton: subjectAddButton,
        theme: Theme,
        beep: beep,
        initChrome: initChrome,
        search: search,
        initGlobalSearch: initGlobalSearch,
        toISO: toISO,
        todayISO: todayISO,
        parseISO: parseISO,
        addDays: addDays,
        diffDays: diffDays,
        relDate: relDate,
        fmtDate: fmtDate,
        fmtDateLong: fmtDateLong,
        weekdayName: weekdayName,
        weekdayToday: weekdayToday,
        fmtMinutes: fmtMinutes,
        fmtClock: fmtClock,
        subjectColor: subjectColor,
        matches: matches
    };


}(window));