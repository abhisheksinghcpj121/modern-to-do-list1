/* =========================================
   SMART STUDY - NOTES PAGE
   Search, tags, pinning and autosaving
   editor. Split list + detail layout.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var ui = global.SS.ui;
    var M = global.SS.models;

    var el = ui.el;

    var COLORS = ["", "#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

    var state = {
        query: "",
        tag: "all",
        activeId: null
    };

    var nodes = {};


    /* =========================================
       HELPERS
       ========================================= */

    function tagsOf(note) {
        return Array.isArray(note.tags) ? note.tags : [];
    }

    function parseTags(raw) {
        return String(raw || "")
            .split(",")
            .map(function (t) { return t.trim().toLowerCase(); })
            .filter(function (t, i, a) { return t && a.indexOf(t) === i; })
            .slice(0, 8);
    }

    function allTags() {
        var set = {};

        M.notes.all().forEach(function (n) {
            tagsOf(n).forEach(function (t) { set[t] = (set[t] || 0) + 1; });
        });

        return Object.keys(set).sort();
    }

    function matches(note) {

        if (state.tag !== "all" && tagsOf(note).indexOf(state.tag) === -1) {
            return false;
        }

        if (!state.query) {
            return true;
        }

        var q = state.query.toLowerCase();

        return [note.title, note.content, tagsOf(note).join(" ")]
            .join(" ").toLowerCase().indexOf(q) !== -1;
    }

    function preview(text) {
        return String(text || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 90) || "Empty note";
    }


    /* =========================================
       LIST RENDER
       ========================================= */

    function noteCard(note) {

        var foot = el("div", { class: "foot" }, [
            el("span", { text: ui.fmtDate(note.createdAt ? ui.toISO(new Date(note.createdAt)) : ui.todayISO()) })
        ]);

        if (note.pinned) {
            foot.insertBefore(el("span", { text: "📌 pinned" }), foot.firstChild);
        }

        return el("button", {
            class: "note-card" + (state.activeId === note.id ? " active" : ""),
            type: "button",
            onclick: function () { select(note.id); }
        }, [
            el("strong", { text: note.title || "Untitled note" }),
            el("p", { text: preview(note.content) }),
            tagsOf(note).length
                ? el("div", { class: "tag-row" }, tagsOf(note).map(function (t) {
                    return el("span", { class: "tag", text: "#" + t });
                }))
                : null,
            foot
        ]);
    }

    function renderList() {

        ui.clear(nodes.list);

        var notes = M.notes.all()
            .filter(matches)
            .sort(function (a, b) {

                if (Boolean(b.pinned) !== Boolean(a.pinned)) {
                    return b.pinned ? 1 : -1;
                }

                return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
            });

        nodes.count.textContent = M.notes.count() + " notes";

        if (!notes.length) {
            nodes.list.appendChild(
                ui.emptyState(
                    "📝",
                    state.query || state.tag !== "all" ? "No matching notes" : "No notes yet",
                    state.query || state.tag !== "all"
                        ? "Try another keyword or clear the tag filter."
                        : "Capture lecture notes, formulas and summaries here.",
                    "Write a note",
                    function () {
                        state.query = "";
                        state.tag = "all";
                        nodes.search.value = "";
                        renderTagFilter();
                        newNote();
                    }
                )
            );
            return;
        }

        notes.forEach(function (n) {
            nodes.list.appendChild(noteCard(n));
        });

        ui.revealOnce(nodes.list);
    }

    function renderTagFilter() {

        ui.clear(nodes.tagRow);

        function chip(value, label) {
            var on = state.tag === value;

            return el("button", {
                class: "chip" + (on ? " active" : ""),
                type: "button",
                "aria-pressed": on ? "true" : "false",
                text: label,
                onclick: function () {
                    state.tag = value;
                    renderTagFilter();
                    renderList();
                }
            });
        }

        nodes.tagRow.appendChild(chip("all", "All tags"));

        allTags().forEach(function (t) {
            nodes.tagRow.appendChild(chip(t, "#" + t));
        });
    }


    /* =========================================
       EDITOR
       ========================================= */

    function setSaveState(text, ok) {
        nodes.saveState.textContent = text;
        nodes.saveState.classList.toggle("saved", Boolean(ok));
    }

    function select(id) {

        var note = M.notes.find(id);

        if (!note) { return; }

        state.activeId = id;

        nodes.title.value = note.title || "";
        nodes.body.value = note.content || "";
        nodes.tags.value = tagsOf(note).join(", ");

        ui.$$("[data-color]").forEach(function (b) {
            b.classList.toggle("active", b.dataset.color === (note.color || ""));
        });

        nodes.deleteBtn.disabled = false;
        setSaveState("Loaded", true);

        renderList();
    }

    var autosave = ui.debounce(function () {
        persist(true);
    }, 700);

    function collect() {
        return {
            title: nodes.title.value.trim() || "Untitled note",
            content: nodes.body.value,
            tags: parseTags(nodes.tags.value),
            color: (ui.$("[data-color].active") || {}).dataset
                ? ui.$("[data-color].active").dataset.color
                : ""
        };
    }

    function persist(quiet) {

        if (!state.activeId) { return; }

        setSaveState("Saving…", false);

        M.notes.update(state.activeId, collect());

        if (!quiet) {
            ui.toast("Note saved 📝", "success");
        }

        renderList();
        renderTagFilter();

        setTimeout(function () {
            setSaveState("All changes saved ✓", true);
        }, 250);
    }

    function newNote() {

        /* a brand new note must never be hidden behind an active filter */
        state.query = "";
        state.tag = "all";
        nodes.search.value = "";
        renderTagFilter();

        var note = M.notes.add({
            title: "Untitled note",
            content: "",
            tags: [],
            pinned: false,
            color: ui.subjectColor("general")
        });

        state.activeId = note.id;

        select(note.id);
        nodes.title.focus();
        nodes.title.select();

        ui.toast("New note created", "success");
    }

    function deleteActive() {

        if (!state.activeId) { return; }

        var note = M.notes.find(state.activeId);

        ui.confirmBox({
            title: "Delete note?",
            message: "\"" + (note ? note.title : "This note") + "\" will be removed permanently.",
            confirmText: "Delete",
            danger: true
        }).then(function (ok) {

            if (!ok) { return; }

            M.notes.remove(state.activeId);

            state.activeId = null;

            ui.clear(nodes.title);
            ui.clear(nodes.body);
            ui.clear(nodes.tags);
            nodes.deleteBtn.disabled = true;
            setSaveState("", false);

            renderList();
            renderTagFilter();

            ui.toast("Note deleted", "info");
        });
    }

    function togglePin() {

        if (!state.activeId) { return; }

        var note = M.notes.find(state.activeId);

        M.notes.update(state.activeId, { pinned: !note.pinned });

        ui.toast(note.pinned ? "Unpinned" : "📌 Pinned to top", "info");

        select(state.activeId);
    }


    /* =========================================
       INIT
       ========================================= */

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.list = doc.getElementById("noteList");
        nodes.title = doc.getElementById("noteTitle");
        nodes.body = doc.getElementById("noteBody");
        nodes.tags = doc.getElementById("noteTags");
        nodes.search = doc.getElementById("noteSearch");
        nodes.tagRow = doc.getElementById("noteTagFilter");
        nodes.count = doc.getElementById("noteCount");
        nodes.saveState = doc.getElementById("noteSaveState");
        nodes.deleteBtn = doc.getElementById("deleteNoteBtn");

        nodes.title.addEventListener("input", autosave);
        nodes.body.addEventListener("input", autosave);
        nodes.tags.addEventListener("input", autosave);

        /* Ctrl/Cmd + S saves immediately */
        doc.addEventListener("keydown", function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                persist(false);
            }
        });

        nodes.search.addEventListener("input", ui.debounce(function () {
            state.query = nodes.search.value;
            renderList();
        }, 180));

        doc.getElementById("newNoteBtn").addEventListener("click", newNote);
        nodes.deleteBtn.addEventListener("click", deleteActive);

        var pinBtn = doc.getElementById("pinNoteBtn");
        if (pinBtn) {
            pinBtn.addEventListener("click", togglePin);
        }

        /* colour swatches */
        var swatchHost = doc.getElementById("noteColors");

        if (swatchHost) {
            COLORS.forEach(function (c) {
                swatchHost.appendChild(
                    el("button", {
                        class: "mini-btn" + (c ? "" : ""),
                        type: "button",
                        "data-color": c,
                        "aria-label": c ? "Colour " + c : "Default colour",
                        title: c || "Default",
                        style: c
                            ? { background: c, borderColor: c }
                            : { background: "var(--surface-3)" },
                        onclick: function () {
                            ui.$$("[data-color]").forEach(function (b) {
                                b.classList.remove("active");
                            });
                            swatchHost.querySelector('[data-color="' + (c || "") + '"]')
                                .classList.add("active");
                            persist(true);
                        }
                    })
                );
            });
        }

        renderTagFilter();
        renderList();

        /* auto open most recent note */
        var first = M.notes.all().sort(function (a, b) {
            if (Boolean(b.pinned) !== Boolean(a.pinned)) { return b.pinned ? 1 : -1; }
            return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
        })[0];

        if (first) {
            select(first.id);
        } else {
            nodes.deleteBtn.disabled = true;
        }
    }


    global.SS = global.SS || {};
    global.SS.notes = { init: init, newNote: newNote };

    doc.addEventListener("DOMContentLoaded", init);


}(window));