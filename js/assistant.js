/* =========================================
   SMART STUDY - ASSISTANT PAGE
   Chat surface for the AI engine in ai.js.

   Two modes, chosen by whether a provider key
   is saved:
     AI mode    - streams a real answer grounded in the
                  student's notes (ai.ask)
     Study mode - offline fallback: matching notes,
                  flashcards, summaries and a daily briefing

   Nothing here talks to the network directly; it all goes
   through SS.ai so the engine stays the only caller.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var ui = global.SS.ui;
    var M = global.SS.models;

    var el = ui.el;

    var CHAT_KEY = "aiChat";
    var MAX_STORED = 24;
    var MAX_HISTORY = 8;

    var state = {
        messages: [],
        busy: false,
        controller: null
    };

    var nodes = {};


    /* =========================================
       MESSAGE STORE
       ========================================= */

    function loadChat() {
        var saved = global.SS.store.get(CHAT_KEY);

        state.messages = Array.isArray(saved) ? saved.slice(-MAX_STORED) : [];
    }

    function persistChat() {
        global.SS.store.set(CHAT_KEY, state.messages.slice(-MAX_STORED));
    }

    function push(message) {
        state.messages.push(message);
        persistChat();
        return message;
    }

    /* Only plain text turns feed the model's memory. Notes, cards and
       briefings are UI, and replaying them as "assistant said" would
       just pollute the prompt. */
    function historyForModel() {
        return state.messages
            .filter(function (m) {
                return m.kind === "text" && (m.role === "user" || m.role === "assistant");
            })
            .slice(-MAX_HISTORY)
            .map(function (m) {
                return { role: m.role, content: m.text };
            });
    }


    /* =========================================
       RENDERING
       ========================================= */

    function bubbleFor(message, streaming) {

        var bubble = el("div", {
            class: "bubble" + (streaming ? " streaming" : "")
        });

        if (message.kind === "error") {
            bubble.classList.add("bubble-error");
        }

        return bubble;
    }

    function fillMarkdown(bubble, text) {
        ui.clear(bubble);
        bubble.appendChild(global.SS.ai.renderMarkdown(text));
    }

    function noteRow(note, index) {

        return el("div", { class: "ai-note" }, [
            el("div", { class: "ai-note-head" }, [
                el("strong", { text: (index + 1) + ". " + (note.title || "Untitled") }),
                el("span", { class: "pill pill-brand", text: "#" + (note.tags && note.tags[0] || "note") })
            ]),
            el("p", {
                class: "text-sm text-muted",
                text: String(note.content || "").replace(/\s+/g, " ").slice(0, 160) || "Empty note"
            }),
            el("div", { class: "ai-note-actions" }, [
                el("button", {
                    class: "mini-btn",
                    type: "button",
                    text: "Make flashcards",
                    onclick: function () { runFlashcards(note); }
                }),
                el("a", {
                    class: "mini-btn",
                    href: "notes.html",
                    text: "Open notes"
                })
            ])
        ]);
    }

    function cardList(payload) {

        var wrap = el("div", { class: "ai-cards" });

        payload.cards.forEach(function (card) {
            var answer = el("div", { class: "ai-card-a", hidden: true, text: card.a });
            var cardNode = el("div", { class: "ai-card" }, [
                el("div", { class: "ai-card-q", text: card.q }),
                answer
            ]);

            cardNode.addEventListener("click", function () {
                var open = !answer.hidden;
                answer.hidden = open;
                cardNode.classList.toggle("revealed", !open);
            });

            wrap.appendChild(cardNode);
        });

        return wrap;
    }

    function briefingBlock(brief) {

        var wrap = el("div", { class: "ai-brief" });

        function line(label, value) {
            return el("div", { class: "ai-brief-line" }, [
                el("span", { class: "ai-brief-label", text: label }),
                el("span", { class: "ai-brief-value", text: value })
            ]);
        }

        var pct = brief.goalMinutes
            ? Math.min(100, Math.round((brief.doneMinutes / brief.goalMinutes) * 100))
            : 0;

        wrap.appendChild(line("Focus today", ui.fmtMinutes(brief.doneMinutes) +
            " of " + ui.fmtMinutes(brief.goalMinutes) + "  (" + pct + "%)"));
        wrap.appendChild(line("Current streak", brief.streak + " day(s)"));
        wrap.appendChild(line("Due today", String(brief.dueToday.length)));
        wrap.appendChild(line("Overdue", String(brief.overdue.length)));

        if (brief.overdue.length) {
            wrap.appendChild(el("ul", { class: "md-list" }, brief.overdue.slice(0, 5).map(function (task) {
                return el("li", { text: task.title + "  (" + ui.fmtDate(task.date) + ")" });
            })));
        }

        if (brief.plan.length) {
            wrap.appendChild(el("div", { class: "ai-brief-sub", text: "Your plan for today" }));
            wrap.appendChild(el("ul", { class: "md-list" }, brief.plan.map(function (slot) {
                return el("li", {
                    text: slot.start + " · " + slot.subject + " — " + (slot.topic || "study") +
                        " (" + slot.minutes + " min)"
                });
            })));
        }

        if (brief.exams.length) {
            wrap.appendChild(el("div", { class: "ai-brief-sub", text: "Next exams" }));
            wrap.appendChild(el("ul", { class: "md-list" }, brief.exams.map(function (exam) {
                return el("li", {
                    text: exam.title + " — " + M.examView.daysLeft(exam) + " day(s) left"
                });
            })));
        }

        return wrap;
    }

    function bodyFor(message) {

        if (message.kind === "cards" && message.data) {
            return cardList(message.data);
        }

        if (message.kind === "briefing" && message.data) {
            return briefingBlock(message.data);
        }

        if (message.kind === "notes" && message.data && message.data.length) {
            return el("div", { class: "ai-notes" }, message.data.map(noteRow));
        }

        var bubble = el("div", { class: "bubble" + (message.kind === "error" ? " bubble-error" : "") });
        fillMarkdown(bubble, message.text || "");
        return bubble;
    }

    /* Appends one message to the thread and returns its node, so a
       streaming reply can keep writing into the same bubble. */
    function appendMessage(message, streaming) {

        var row = el("div", {
            class: "ai-msg " + (message.role === "user" ? "user" : "bot")
        });

        if (message.kind === "cards" || message.kind === "briefing" || message.kind === "notes") {
            row.appendChild(el("div", { class: "ai-avatar", text: "📚" }));
            var body = el("div", { class: "ai-body" });

            if (message.text) {
                var lead = el("div", { class: "bubble" });
                fillMarkdown(lead, message.text);
                body.appendChild(lead);
            }

            body.appendChild(bodyFor(message));
            row.appendChild(body);
            nodes.thread.appendChild(row);
            return null;
        }

        var bubble = bubbleFor(message, streaming);
        fillMarkdown(bubble, message.text || "");

        row.appendChild(bubble);
        nodes.thread.appendChild(row);

        return bubble;
    }

    function renderThread() {

        ui.clear(nodes.thread);

        state.messages.forEach(function (message) {
            appendMessage(message, false);
        });

        ui.revealOnce(nodes.thread);
        scrollToEnd();
    }

    function renderWelcome() {

        if (state.messages.length) { return; }

        var intro = global.SS.ai.hasKey()
            ? "Hi! Ask me any study doubt. I'll answer using your own notes where they help."
            : "Hi! Add an API key in Settings for full AI answers. Until then I can still search your "
                + "notes, build flashcards and summarise a topic. Try a button below.";

        push({
            role: "assistant",
            kind: "text",
            text: intro,
            at: Date.now()
        });
    }


    /* =========================================
       MODE + CHROME
       ========================================= */

    function syncMode() {

        var ai = global.SS.ai;
        var ready = ai.hasKey();
        var keyless = ai.isKeyless();
        var provider = ai.activeProvider();

        var badge = !ready ? "Study mode" : (keyless ? "Free mode" : "AI mode");

        nodes.modeBadge.textContent = badge;
        nodes.modeBadge.dataset.mode = !ready ? "study" : (keyless ? "free" : "ai");
        nodes.modeBadge.className = "pill " + (!ready ? "pill-medium" : "pill-ok");

        nodes.banner.hidden = ready && !keyless;

        if (!ready) {
            nodes.bannerTitle.textContent = "Study mode — no API key";
            nodes.bannerText.textContent =
                "I can search your notes, build flashcards and summarise without one. " +
                "Add your own key to unlock full AI answers.";
            nodes.bannerAction.textContent = "Add API key";

        } else if (keyless) {
            nodes.bannerTitle.textContent = "Free mode — public endpoint";
            nodes.bannerText.textContent =
                "Answers come from a free shared server, so your question and any matching notes are " +
                "handled by a third party. Add your own key in Settings for a private setup.";
            nodes.bannerAction.textContent = "Use my own key";
        }

        nodes.hint.textContent = ready
            ? provider.label + " · " + (ai.config().model || provider.defaultModel)
            : "Offline tools: notes search, flashcards, summaries";

        nodes.subtitle.textContent = !ready
            ? "Ask a doubt — without a key I search your own notes and build study tools."
            : (keyless
                ? "Free AI answers, grounded in your notes. No key needed."
                : "Answers are grounded in your notes and sent straight to your own provider.");

        ui.revealOnce(nodes.quick);
    }

    function buildQuickActions() {

        ui.clear(nodes.quick);

        [
            { label: "💬 Ask a doubt", hint: "Focus the box below", run: focusInput },
            { label: "🃏 Make flashcards", hint: "From your notes", run: function () { runFlashcards(null); } },
            { label: "📅 What should I study today?", hint: "Your day at a glance", run: runToday },
            { label: "✂️ Summarise a note", hint: "Best matching note", run: runSummarize }
        ].forEach(function (action) {

            nodes.quick.appendChild(
                el("button", {
                    class: "chip ai-quick-btn",
                    type: "button",
                    title: action.hint,
                    text: action.label,
                    onclick: action.run
                })
            );
        });

        ui.revealOnce(nodes.quick);
    }

    function focusInput() {
        nodes.input.focus();
    }

    function scrollToEnd() {
        if (nodes.thread) {
            nodes.thread.scrollTop = nodes.thread.scrollHeight;
        }
    }

    function setBusy(on) {

        state.busy = on;
        nodes.sendBtn.disabled = on;
        nodes.sendBtn.textContent = on ? "Stop" : "Send";
        nodes.input.disabled = false;
    }


    /* =========================================
       REQUEST PLUMBING
       ========================================= */

    function streamAnswer(question, leadText) {

        var message = push({
            role: "assistant",
            kind: "text",
            text: leadText || "",
            at: Date.now()
        });

        var bubble = appendMessage(message, true);
        var buffer = leadText || "";
        var lastPaint = 0;

        setBusy(true);
        state.controller = (typeof global.AbortController === "function")
            ? new global.AbortController()
            : null;

        scrollToEnd();

        return global.SS.ai.ask(question, {
            history: historyForModel().slice(0, -1),
            signal: state.controller ? state.controller.signal : undefined,
            onDelta: function (chunk) {

                buffer += chunk;

                var now = Date.now();

                /* Rebuilding the markdown tree on every token is wasteful;
                   a repaint every ~70ms still looks instant. */
                if (now - lastPaint > 70) {
                    lastPaint = now;
                    fillMarkdown(bubble, buffer);
                    scrollToEnd();
                }
            }
        }).then(function (result) {

            message.text = result.text || buffer;
            fillMarkdown(bubble, message.text || "(empty reply)");
            bubble.classList.remove("streaming");
            persistChat();

        }).catch(function (error) {

            var aborted = error && (error.name === "AbortError" ||
                /abort/i.test(String(error.message || "")));

            if (aborted) {
                message.text = buffer || "_Stopped._";
                message.kind = "text";
            } else {
                message.kind = "error";
                message.text = (buffer ? buffer + "\n\n" : "") +
                    "**Could not reach the model.**\n\n" + String(error.message || error);
            }

            fillMarkdown(bubble, message.text);
            bubble.classList.remove("streaming");
            persistChat();

        }).then(function () {
            state.controller = null;
            setBusy(false);
            scrollToEnd();
        });
    }


    /* =========================================
       INTENTS
       ========================================= */

    function answerQuestion(question) {

        var text = String(question || "").trim();

        if (!text) { return; }

        push({ role: "user", kind: "text", text: text, at: Date.now() });
        appendMessage(state.messages[state.messages.length - 1], false);
        persistChat();
        scrollToEnd();

        if (global.SS.ai.hasKey()) {
            streamAnswer(text);
            return;
        }

        /* Study mode: no model, so show what the notes do contain. */
        var hits = global.SS.ai.retrieve(text, 4);

        if (!hits.length) {
            push({
                role: "assistant",
                kind: "text",
                text: "I could not find that in your notes, and no API key is set so I cannot look it up.\n\n"
                    + "Two options:\n"
                    + "- Add your own API key in Settings for full AI answers.\n"
                    + "- Write a note about this topic so it is searchable next time.",
                at: Date.now()
            });
            appendMessage(state.messages[state.messages.length - 1], false);
            persistChat();
            scrollToEnd();
            return;
        }

        push({
            role: "assistant",
            kind: "notes",
            text: "Here is what your own notes say about that:",
            data: hits.map(function (hit) { return hit.note; }),
            at: Date.now()
        });
        appendMessage(state.messages[state.messages.length - 1], false);
        persistChat();
        scrollToEnd();
    }

    function latestNote() {
        return M.notes.all().sort(function (a, b) {
            return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
        })[0] || null;
    }

    function runFlashcards(preferred) {

        var source = preferred;

        if (!source) {
            var probe = nodes.input.value.trim();
            var hits = probe ? global.SS.ai.retrieve(probe, 1) : [];
            source = (hits[0] && hits[0].note) || latestNote();
        }

        push({ role: "user", kind: "text", text: "Make flashcards", at: Date.now() });
        appendMessage(state.messages[state.messages.length - 1], false);

        if (!source) {
            push({
                role: "assistant",
                kind: "text",
                text: "You do not have any notes yet. Write one on the Notes page and I will turn it into cards.",
                at: Date.now()
            });
            appendMessage(state.messages[state.messages.length - 1], false);
            persistChat();
            return;
        }

        var cards = global.SS.ai.flashcards(source, 8);

        push({
            role: "assistant",
            kind: "cards",
            text: "Tap a card to reveal the answer. Made from **" + (source.title || "your note") + "**.",
            data: { title: source.title || "Untitled", cards: cards },
            at: Date.now()
        });
        appendMessage(state.messages[state.messages.length - 1], false);
        persistChat();
        scrollToEnd();
    }

    function runSummarize() {

        push({ role: "user", kind: "text", text: "Summarise my latest note", at: Date.now() });
        appendMessage(state.messages[state.messages.length - 1], false);

        var probe = nodes.input.value.trim();
        var hits = probe ? global.SS.ai.retrieve(probe, 1) : [];
        var note = (hits[0] && hits[0].note) || latestNote();

        if (!note) {
            push({
                role: "assistant",
                kind: "text",
                text: "There is no note to summarise yet.",
                at: Date.now()
            });
            appendMessage(state.messages[state.messages.length - 1], false);
            persistChat();
            return;
        }

        if (global.SS.ai.hasKey()) {
            streamAnswer(
                "Summarise this note in 3-5 short bullet points, keeping the key facts:\n\n" +
                (note.title || "Untitled") + "\n" + String(note.content || ""),
                "Summarising **" + (note.title || "Untitled") + "**…\n\n"
            );
            return;
        }

        var summary = global.SS.ai.summarize(note.content, 3);

        push({
            role: "assistant",
            kind: "text",
            text: "### " + (note.title || "Untitled") + "\n\n" + (summary || "This note is too short to summarise.") +
                "\n\n_Offline extractive summary. Add an API key for a written explanation._",
            at: Date.now()
        });
        appendMessage(state.messages[state.messages.length - 1], false);
        persistChat();
        scrollToEnd();
    }

    function runToday() {

        push({ role: "user", kind: "text", text: "What should I study today?", at: Date.now() });
        appendMessage(state.messages[state.messages.length - 1], false);

        if (global.SS.ai.hasKey()) {
            streamAnswer("Look at my tasks, plan and upcoming exams. What should I study today, and in what order?");
            return;
        }

        push({
            role: "assistant",
            kind: "briefing",
            text: "Here is your day. Add an API key and I will turn this into a study order.",
            data: global.SS.ai.todayBriefing(),
            at: Date.now()
        });
        appendMessage(state.messages[state.messages.length - 1], false);
        persistChat();
        scrollToEnd();
    }


    /* =========================================
       COMPOSER
       ========================================= */

    function onSubmit(event) {

        event.preventDefault();

        /* the button doubles as Stop while a reply is streaming */
        if (state.busy) {
            if (state.controller) { state.controller.abort(); }
            return;
        }

        var text = nodes.input.value.trim();

        if (!text) { return; }

        nodes.input.value = "";
        answerQuestion(text);
    }

    function onKeydown(event) {

        /* Enter sends, Shift+Enter makes a new line */
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit(event);
        }
    }

    function clearChat() {

        state.messages = [];
        persistChat();
        renderWelcome();
        renderThread();
        ui.toast("Chat cleared", "info");
    }


    /* =========================================
       INIT
       ========================================= */

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.thread = doc.getElementById("aiThread");
        nodes.quick = doc.getElementById("aiQuick");
        nodes.form = doc.getElementById("aiForm");
        nodes.input = doc.getElementById("aiInput");
        nodes.sendBtn = doc.getElementById("aiSendBtn");
        nodes.banner = doc.getElementById("aiBanner");
        nodes.bannerTitle = doc.getElementById("aiBannerTitle");
        nodes.bannerText = doc.getElementById("aiBannerText");
        nodes.bannerAction = doc.getElementById("aiBannerAction");
        nodes.modeBadge = doc.getElementById("aiModeBadge");
        nodes.subtitle = doc.getElementById("aiSubtitle");
        nodes.hint = doc.getElementById("aiHint");

        if (!nodes.thread || !nodes.form) { return; }

        loadChat();
        syncMode();
        buildQuickActions();
        renderWelcome();
        renderThread();

        nodes.form.addEventListener("submit", onSubmit);
        nodes.input.addEventListener("keydown", onKeydown);

        var clearBtn = doc.getElementById("aiClearChatBtn");
        if (clearBtn) { clearBtn.addEventListener("click", clearChat); }

        /* a key saved in another tab should switch the page over */
        global.addEventListener("storage", function () {
            syncMode();
        });
    }


    global.SS = global.SS || {};
    global.SS.assistant = {
        init: init,
        answer: answerQuestion,
        flashcards: runFlashcards,
        briefing: runToday
    };

    doc.addEventListener("DOMContentLoaded", init);


}(window));
