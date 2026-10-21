/* =========================================
   SMART STUDY - AI QUIZ GENERATOR
   Turns a subject + chapter (+ topic) into a
   practice quiz.

   With an AI provider it asks the model for
   questions; with none it builds them offline
   from the student's own notes. Either way the
   questions are graded instantly and saved to a
   history that is grouped subject-wise and
   chapter-wise.

   Nothing here calls the network directly - it
   all goes through SS.ai, so the engine stays the
   only caller (and the only place a key is used).

   Exposed as SS.quiz.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var ui = global.SS.ui;
    var M = global.SS.models;

    var el = ui.el;

    var STORE_KEY = "quizzes";
    var SUBJECT_KEY = "quizSubjects";
    var SUBJECT_VERSION_KEY = "quizSubjectsVersion";
    /* v3: the shelf now also picks up subjects tracked on the Study Plan
       page, so every stale or emptied list is reseeded once. */
    var SUBJECT_VERSION = 3;
    var MAX_STORED = 12;
    var MAX_COUNT = 20;
    var MIN_COUNT = 3;

    var ANSWER_LETTERS = ["a", "b", "c", "d", "e", "f"];

    /* The student's own subject shelf. Always offered as suggestions so a
       quiz can be started even before any notes or plan slots exist. */
    var DEFAULT_SUBJECTS = [
        "DBMS (Database Management System)",
        "Web Technology",
        "DAA (Design & Analysis of Algorithms)",
        "Compiler Design",
        "Application of Soft Computing",
        "Constitution of India",
        "Computer Graphics",
        "Image Processing"
    ];

    var state = {
        busy: false,
        current: null,
        history: []
    };

    var nodes = {};


    /* =========================================
       SMALL HELPERS
       ========================================= */

    function clean(text) {
        return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    }

    function clip(text, max) {
        var value = clean(text);
        return value.length > max ? value.slice(0, max - 1) + "…" : value;
    }

    function pick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function shuffle(list) {
        var out = list.slice();
        var i;
        var j;
        var tmp;

        for (i = out.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            tmp = out[i];
            out[i] = out[j];
            out[j] = tmp;
        }

        return out;
    }

    function unique(list) {
        var seen = {};

        return list.filter(function (value) {
            var key = String(value || "").toLowerCase();

            if (!key || seen[key]) { return false; }

            seen[key] = true;
            return true;
        });
    }

    function level(pct) {
        return pct >= 80 ? "ok" : (pct >= 50 ? "warn" : "bad");
    }


    /* =========================================
       SUBJECTS + CHAPTERS
       The subject shelf starts as exactly the built-in
       list and is fully editable from there; chapters
       come from whatever the student already has
       (plan topics, exams, note titles).
       ========================================= */

    function subjectList() {

        var saved = global.SS.store.get(SUBJECT_KEY);
        var version = global.SS.store.get(SUBJECT_VERSION_KEY);

        if (Array.isArray(saved) && saved.length && version === SUBJECT_VERSION) {
            return saved.slice();
        }

        /* First visit, an emptied shelf, or a list from an older build:
           start from the built-in shelf plus every subject the student
           already tracks on the Study Plan page. From then on the list is
           the student's own - edits are saved as they make them. */
        var shelf = M.subjects.all().map(function (s) { return s.name; });
        var seed = unique(DEFAULT_SUBJECTS.concat(shelf));

        saveSubjects(seed);

        return seed;
    }

    /* The student's editable shelf lives in one store key, so subjects
       can be added and removed by hand without touching any code. */
    function saveSubjects(list) {
        global.SS.store.set(SUBJECT_KEY, unique(list.map(clean).filter(Boolean)));
        global.SS.store.set(SUBJECT_VERSION_KEY, SUBJECT_VERSION);
    }

    function addSubject(name) {

        var value = clean(name);
        if (!value) { return false; }

        var list = subjectList();
        var exists = list.some(function (s) {
            return s.toLowerCase() === value.toLowerCase();
        });

        if (exists) { return false; }

        list.push(value);
        list.sort();
        saveSubjects(list);

        /* Mirror onto the shared shelf, so a subject added here also
           shows up on Study Plan, Tasks, Notes and Goals right away. */
        var onShelf = M.subjects.all().some(function (s) {
            return s.name.toLowerCase() === value.toLowerCase();
        });

        if (!onShelf) {
            M.subjects.add({ name: value, targetHours: 5 });
        }

        return true;
    }

    function removeSubject(name) {

        var value = clean(name).toLowerCase();

        var list = subjectList().filter(function (s) {
            return s.toLowerCase() !== value;
        });

        saveSubjects(list);

        return list;
    }

    /* Put the shelf back to the built-in subjects (plus anything tracked
       on the Study Plan page, so the two shelves stay in step). */
    function resetSubjects() {
        var shelf = M.subjects.all().map(function (s) { return s.name; });

        saveSubjects(unique(DEFAULT_SUBJECTS.concat(shelf)));

        return subjectList();
    }

    function chapterSuggestions(subject) {

        var sub = clean(subject).toLowerCase();
        var out = [];

        M.plan.all().forEach(function (p) {
            if (!sub || clean(p.subject).toLowerCase() === sub) {
                if (p.topic) { out.push(clip(p.topic, 70)); }
            }
        });

        M.exams.all().forEach(function (e) {
            if (!sub || clean(e.subject).toLowerCase() === sub) {
                if (e.title) { out.push(clip(e.title, 70)); }
            }
        });

        M.notes.all().forEach(function (n) {
            var tags = (n.tags || []).map(function (t) { return clean(t).toLowerCase(); });
            var hit = !sub || tags.indexOf(sub) !== -1 ||
                clean(n.title).toLowerCase().indexOf(sub) !== -1;

            if (hit && n.title) {
                out.push(clip(n.title, 70));
            }
        });

        return unique(out).slice(0, 40);
    }


    /* =========================================
       AI PATH
       ========================================= */

    var QUIZ_SYSTEM = [
        "You are an exam question setter inside Smart Study, an app for students.",
        "Write a practice quiz on the subject and chapter you are given.",
        "",
        "Return ONLY valid JSON. No markdown, no code fences, no commentary before or after.",
        "",
        "Use exactly this shape:",
        "{",
        '  "questions": [',
        '    { "type": "mcq", "question": "...", "options": ["...", "...", "...", "..."], "answer": 0, "explanation": "..." },',
        '    { "type": "tf",  "question": "...", "options": ["True", "False"], "answer": 1, "explanation": "..." }',
        "  ]",
        "}",
        "",
        "Rules:",
        "- Produce exactly the number of questions asked for.",
        "- \"answer\" is the 0-based index of the correct option.",
        "- mcq questions have exactly 4 options; tf questions have exactly [\"True\", \"False\"].",
        "- Wrong options must be plausible but clearly wrong; never repeat an option.",
        "- explanation: one short sentence saying why the answer is right.",
        "- Stay inside the given chapter and topic. Use simple, clear language.",
        "- Do not number the questions and do not add any extra keys."
    ].join("\n");

    function buildPrompt(opts) {

        var typeText = opts.type === "tf"
            ? "true/false only"
            : (opts.type === "mixed" ? "a mix of mcq and true/false" : "mcq only");

        var lines = [
            "Subject: " + (opts.subject || "General"),
            "Chapter / unit: " + (opts.chapter || "the whole subject"),
            "Difficulty: " + opts.difficulty,
            "Number of questions: " + opts.count,
            "Question types: " + typeText
        ];

        if (opts.topic) {
            lines.splice(2, 0, "Topic focus: " + opts.topic);
        }

        return lines.join("\n");
    }

    /* Ground the questions in the student's own notes when they overlap. */
    function systemWithNotes(opts) {

        var query = clean([opts.subject, opts.chapter, opts.topic].join(" "));
        var hits = query ? global.SS.ai.retrieve(query, 3) : [];
        var system = QUIZ_SYSTEM;

        if (hits.length) {
            var parts = [
                "",
                "The student's own notes on this area are below. Align the questions with what they have " +
                "studied and never contradict these notes."
            ];

            hits.forEach(function (hit, index) {
                parts.push("");
                parts.push("[Note " + (index + 1) + "] " + (hit.note.title || "Untitled"));
                parts.push(clip(hit.note.content, 1200));
            });

            system += "\n" + parts.join("\n");
        }

        return system;
    }

    function tryParse(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    /* Models love wrapping JSON in prose or code fences. Pull the
       outermost object/array out and parse that. */
    function extractJSON(text) {

        var raw = String(text == null ? "" : text).trim();

        if (!raw) { return null; }

        raw = raw.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();

        var direct = tryParse(raw);
        if (direct) { return direct; }

        var first = raw.indexOf("{");
        var firstArr = raw.indexOf("[");
        var start;

        if (first === -1) { start = firstArr; }
        else if (firstArr === -1) { start = first; }
        else { start = Math.min(first, firstArr); }

        if (start === -1) { return null; }

        var close = raw.charAt(start) === "{" ? "}" : "]";
        var end = raw.lastIndexOf(close);

        if (end <= start) { return null; }

        return tryParse(raw.slice(start, end + 1));
    }

    /* Turn the model's answer value into an option index. */
    function answerIndex(value, options) {

        var i;

        if (typeof value === "number" && isFinite(value)) {
            var n = Math.round(value);
            return n >= 0 && n < options.length ? n : -1;
        }

        if (typeof value === "boolean") {
            return value ? 0 : 1;
        }

        var text = clean(value).toLowerCase();

        if (!text) { return -1; }

        /* exact option text wins over a leading letter */
        for (i = 0; i < options.length; i++) {
            if (clean(options[i]).toLowerCase() === text) { return i; }
        }

        var letter = /^(?:option\s*)?([a-f])(?:\b|$)/.exec(text);

        if (letter) {
            var li = ANSWER_LETTERS.indexOf(letter[1]);
            if (li > -1 && li < options.length) { return li; }
        }

        for (i = 0; i < options.length; i++) {
            var opt = clean(options[i]).toLowerCase();
            if (opt && (text.indexOf(opt) !== -1 || opt.indexOf(text) !== -1)) { return i; }
        }

        return -1;
    }

    function normalizeQuestions(payload) {

        var list = Array.isArray(payload)
            ? payload
            : (payload && Array.isArray(payload.questions) ? payload.questions : []);

        var out = [];

        list.forEach(function (item) {

            if (!item || typeof item !== "object") { return; }

            var question = clean(item.question || item.q || item.text);
            if (!question) { return; }

            var type = clean(item.type).toLowerCase();
            var options = unique((Array.isArray(item.options) ? item.options : []).map(clean).filter(Boolean));
            var explanation = clean(item.explanation || item.why || item.reason);

            var isTF = type === "tf" || type === "truefalse" || type === "true-false" || type === "boolean";

            if (isTF) {
                options = ["True", "False"];
                type = "tf";
            } else if (options.length >= 2) {
                type = "mcq";
                options = options.slice(0, 4);
            } else {
                return;   /* no usable options - drop it */
            }

            var answer = answerIndex(item.answer != null ? item.answer : item.correct, options);
            if (answer < 0) { return; }

            out.push({
                type: type,
                question: question,
                options: options,
                answer: answer,
                explanation: explanation
            });
        });

        return out;
    }

    function generateWithAI(opts) {

        return global.SS.ai.complete(buildPrompt(opts), {
            system: systemWithNotes(opts),
            stream: false
        }).then(function (result) {
            return normalizeQuestions(extractJSON(result && result.text));
        });
    }


    /* =========================================
       OFFLINE PATH
       Build MCQ / true-false from the student's
       own notes - no network, nothing invented.
       ========================================= */

    function relevantNotes(opts) {

        var query = clean([opts.subject, opts.chapter, opts.topic].join(" "));
        var hits = query ? global.SS.ai.retrieve(query, 8) : [];
        var notes = hits.map(function (hit) { return hit.note; });

        return notes.length ? notes : M.notes.all().slice(0, 8);
    }

    /* "Term: definition" and "X is Y" lines make the clearest questions. */
    function pairsFrom(notes) {

        var pairs = [];
        var seen = {};

        notes.forEach(function (note) {
            String(note.content || "").split(/\n+/).forEach(function (raw) {

                var line = raw.trim().replace(/^[-*+\u2022]\s*/, "").replace(/^\d+[.)]\s*/, "");
                if (!line) { return; }

                var term = "";
                var def = "";

                var pair = /^([^:：]{3,60})[:\-–—]\s*(.+)$/.exec(line);

                if (pair && pair[2].length > 3) {
                    term = clean(pair[1]);
                    def = clean(pair[2]);
                } else {
                    var isA = /^(.{4,70}?)\s+(?:is|are|means|refers to)\s+(.+)$/i.exec(line);

                    if (isA && isA[2].length > 3) {
                        term = clean(isA[1]);
                        def = clean(isA[2]);
                    }
                }

                if (!term || !def) { return; }

                var key = term.toLowerCase();
                if (seen[key]) { return; }

                seen[key] = true;
                pairs.push({ term: term, def: def });
            });
        });

        return pairs;
    }

    /* Fill-in-the-blank fallback for notes without clear definitions. */
    function clozesFrom(notes) {

        var out = [];

        notes.forEach(function (note) {
            String(note.content || "").split(/\n+/).forEach(function (raw) {

                var line = raw.trim().replace(/^[-*+\u2022]\s*/, "").replace(/^\d+[.)]\s*/, "");
                if (line.length < 44) { return; }

                var words = global.SS.ai.terms(line);
                if (words.length < 5) { return; }

                var target = words.slice().sort(function (a, b) {
                    return b.length - a.length;
                })[0];

                var blanked = line.replace(new RegExp("\\b" + target + "\\b", "i"), "_____");
                if (blanked === line) { return; }

                out.push({ line: blanked, answer: target });
            });
        });

        return out;
    }

    function offlineQuestions(opts) {

        var notes = relevantNotes(opts);
        var pairs = pairsFrom(notes);
        var questions = [];

        function wantsTF() { return opts.type === "tf"; }
        function wantsMCQ() { return opts.type !== "tf"; }

        /* --- true / false from term-definition pairs --- */
        if (wantsTF() && pairs.length >= 2) {
            shuffle(pairs).forEach(function (pair) {
                if (questions.length >= opts.count) { return; }

                var truthful = Math.random() < 0.5;
                var other = pick(pairs.filter(function (p) { return p !== pair; }));
                var shown = truthful ? pair.def : other.def;

                questions.push({
                    type: "tf",
                    question: pair.term + " — " + clip(shown, 160),
                    options: ["True", "False"],
                    answer: truthful ? 0 : 1,
                    explanation: "“" + pair.term + "” means " + clip(pair.def, 200)
                });
            });
        }

        /* --- MCQ: which definition fits the term --- */
        if (wantsMCQ() && pairs.length >= 3) {
            var defs = pairs.map(function (p) { return clip(p.def, 90); });

            shuffle(pairs).forEach(function (pair) {
                if (questions.length >= opts.count) { return; }

                var correct = clip(pair.def, 90);
                var others = shuffle(defs.filter(function (d) { return d !== correct; })).slice(0, 3);

                if (others.length < 2) { return; }

                var options = shuffle([correct].concat(others));

                questions.push({
                    type: "mcq",
                    question: "Which of these best describes “" + pair.term + "”?",
                    options: options,
                    answer: options.indexOf(correct),
                    explanation: "“" + pair.term + "” — " + clip(pair.def, 200)
                });
            });
        }

        /* --- MCQ: which term matches the definition (reverse) --- */
        if (wantsMCQ() && questions.length < opts.count && pairs.length >= 3) {
            var terms = pairs.map(function (p) { return p.term; });

            shuffle(pairs).forEach(function (pair) {
                if (questions.length >= opts.count) { return; }

                var others = shuffle(terms.filter(function (t) { return t !== pair.term; })).slice(0, 3);
                if (others.length < 2) { return; }

                var options = shuffle([pair.term].concat(others));

                questions.push({
                    type: "mcq",
                    question: "Which term is described here: “" + clip(pair.def, 130) + "”?",
                    options: options,
                    answer: options.indexOf(pair.term),
                    explanation: "The term is “" + pair.term + "”."
                });
            });
        }

        /* --- last resort: fill in the blank --- */
        if (wantsMCQ() && questions.length < opts.count) {
            var blanks = clozesFrom(notes);
            var answers = unique(blanks.map(function (b) { return b.answer; }));

            if (answers.length >= 4) {
                shuffle(blanks).forEach(function (blank) {
                    if (questions.length >= opts.count) { return; }

                    var others = shuffle(answers.filter(function (a) { return a !== blank.answer; })).slice(0, 3);
                    if (others.length < 2) { return; }

                    var options = shuffle([blank.answer].concat(others));

                    questions.push({
                        type: "mcq",
                        question: "Fill in the blank: " + clip(blank.line, 200),
                        options: options,
                        answer: options.indexOf(blank.answer),
                        explanation: "The missing word is “" + blank.answer + "”."
                    });
                });
            }
        }

        return questions.slice(0, opts.count);
    }


    /* =========================================
       SETUP FORM
       ========================================= */

    function collectOptions() {

        var count = Number(nodes.count.value) || 10;
        count = Math.max(MIN_COUNT, Math.min(MAX_COUNT, count));

        return {
            subject: clean(nodes.subject.value) || "General",
            chapter: clean(nodes.chapter.value),
            topic: clean(nodes.topic.value),
            difficulty: nodes.difficulty.value,
            type: nodes.type.value,
            count: count
        };
    }

    function fillSubjectList() {

        var list = subjectList();

        ui.clear(nodes.subjectList);
        list.forEach(function (name) {
            nodes.subjectList.appendChild(el("option", { value: name }));
        });

        if (!nodes.subject.value && list.length) {
            nodes.subject.value = list[0];
        }

        fillChapterList();
    }

    function fillChapterList() {

        var list = chapterSuggestions(nodes.subject.value);

        ui.clear(nodes.chapterList);
        list.forEach(function (name) {
            nodes.chapterList.appendChild(el("option", { value: name }));
        });
    }


    /* =========================================
       SUBJECT MANAGER
       Add or remove subjects by hand. The list is
       saved per account the moment it changes.
       ========================================= */

    function renderSubjectChips() {

        var list = subjectList();

        ui.clear(nodes.subjectChips);

        if (!list.length) {
            nodes.subjectChips.appendChild(
                el("span", { class: "quiz-subject-empty", text: "No subjects yet — add one below." })
            );
        }

        list.forEach(function (name) {
            nodes.subjectChips.appendChild(
                el("span", { class: "quiz-subject-chip" }, [
                    el("span", { text: name }),
                    el("button", {
                        type: "button",
                        text: "✕",
                        "aria-label": "Remove " + name,
                        title: "Remove " + name,
                        onclick: function () { dropSubject(name); }
                    })
                ])
            );
        });

        if (nodes.subjectsCount) {
            nodes.subjectsCount.textContent = list.length + " subject" + (list.length === 1 ? "" : "s");
        }
    }

    function dropSubject(name) {

        removeSubject(name);
        renderSubjectChips();
        fillSubjectList();

        if (clean(nodes.subject.value).toLowerCase() === clean(name).toLowerCase()) {
            nodes.subject.value = subjectList()[0] || "";
            fillChapterList();
        }

        ui.toast("Removed “" + name + "”", "info");
    }

    function addSubjectFromInput() {

        var value = nodes.subjectNew.value;

        if (!clean(value)) { return; }

        if (addSubject(value)) {
            nodes.subjectNew.value = "";
            renderSubjectChips();
            fillSubjectList();
            ui.toast("Added “" + clean(value) + "”", "success");
        } else {
            ui.toast("“" + clean(value) + "” is already in the list", "warn");
        }
    }

    function toggleSubjectsPanel() {

        var open = nodes.subjectsPanel.hidden;

        nodes.subjectsPanel.hidden = !open;
        nodes.manageBtn.setAttribute("aria-expanded", String(open));

        if (open) {
            renderSubjectChips();
            nodes.subjectNew.focus();
        }
    }

    function restoreSubjects() {

        resetSubjects();
        renderSubjectChips();
        fillSubjectList();
        ui.toast("Subjects reset to your defaults", "info");
    }


    /* =========================================
       MODE BANNER
       ========================================= */

    function syncMode() {

        if (!nodes.modeBadge) { return; }

        var ai = global.SS.ai;
        var ready = ai.hasKey();
        var keyless = ai.isKeyless();
        var provider = ai.activeProvider();

        var badge = !ready ? "Notes mode" : (keyless ? "Free mode" : "AI mode");

        nodes.modeBadge.textContent = badge;
        nodes.modeBadge.className = "pill " + (!ready ? "pill-medium" : "pill-ok");

        nodes.banner.hidden = ready && !keyless;

        if (!ready) {
            nodes.bannerTitle.textContent = "Notes mode — no API key";
            nodes.bannerText.textContent =
                "Quizzes will be written from your own notes. Add your own key in Settings to get AI questions.";
            nodes.bannerAction.textContent = "Add API key";

        } else if (keyless) {
            nodes.bannerTitle.textContent = "Free mode — public endpoint";
            nodes.bannerText.textContent =
                "Questions come from a free shared server, so your subject and matching notes are handled " +
                "by a third party. Add your own key in Settings for a private setup.";
            nodes.bannerAction.textContent = "Use my own key";
        }

        nodes.hint.textContent = ready
            ? provider.label + " · " + (ai.config().model || provider.defaultModel)
            : "No key — “From my notes” works fully offline";

        nodes.generateBtn.textContent = aiLabel();
    }

    function aiLabel() {
        return global.SS.ai.hasKey() ? "Generate with AI" : "Generate from notes";
    }

    function setBusy(on) {

        state.busy = on;

        if (nodes.generateBtn) {
            nodes.generateBtn.disabled = on;
            nodes.generateBtn.textContent = on ? "Writing…" : aiLabel();
        }

        if (nodes.notesBtn) {
            nodes.notesBtn.disabled = on;
        }
    }


    /* =========================================
       RENDERING - QUIZ
       ========================================= */

    function showSetup(on) {
        if (nodes.setup) {
            nodes.setup.hidden = !on;
        }
    }

    function renderEmpty(reason) {

        ui.clear(nodes.area);

        var icon = "🧠";
        var title = "Make a quiz";
        var message = "Pick a subject and chapter above, then generate a practice quiz. " +
            "Questions are graded instantly and saved to your history, subject-wise and chapter-wise.";

        if (reason === "notes") {
            icon = "📝";
            title = "No matching notes";
            message = "I could not build questions from your notes for this topic. Write a few lines like " +
                "“Photosynthesis: how plants make food”, or add an API key for AI-written questions.";
        } else if (reason === "error") {
            icon = "⚠️";
            title = "Quiz not created";
            message = "Something went wrong. Try again, add more notes, or check your AI settings in Settings.";
        }

        nodes.area.appendChild(ui.emptyState(icon, title, message));
    }

    function renderLoading(opts) {

        ui.clear(nodes.area);

        nodes.area.appendChild(
            el("div", { class: "card quiz-loading" }, [
                el("span", { class: "quiz-spinner", "aria-hidden": "true", text: "🧠" }),
                el("div", {}, [
                    el("strong", { text: "Writing your quiz…" }),
                    el("p", {
                        class: "card-sub",
                        text: opts.subject + (opts.chapter ? " · " + opts.chapter : "") +
                            " · " + opts.count + " questions"
                    })
                ])
            ])
        );
    }

    function questionCard(item, index) {

        var quiz = state.current;
        var chosen = quiz.answers[index];

        var card = el("div", { class: "quiz-q", dataset: { index: String(index) } });

        card.appendChild(el("div", { class: "quiz-q-head" }, [
            el("span", { class: "quiz-q-num", text: "Q" + (index + 1) }),
            el("span", { class: "pill pill-brand", text: item.type === "tf" ? "True / False" : "MCQ" })
        ]));

        card.appendChild(el("p", { class: "quiz-q-text", text: item.question }));

        var options = el("div", { class: "quiz-options" });

        item.options.forEach(function (option, oi) {

            var button = el("button", {
                class: "quiz-option",
                type: "button",
                dataset: { oi: String(oi) },
                text: option,
                onclick: function () { choose(index, oi); }
            });

            if (quiz.submitted) {
                button.disabled = true;

                if (oi === item.answer) {
                    button.classList.add("correct");
                } else if (oi === chosen) {
                    button.classList.add("wrong");
                }
            } else if (chosen === oi) {
                button.classList.add("chosen");
            }

            options.appendChild(button);
        });

        card.appendChild(options);

        if (quiz.submitted) {

            var mark = chosen == null
                ? "— Skipped"
                : (chosen === item.answer ? "✅ Correct" : "❌ Not quite");

            card.appendChild(el("div", { class: "quiz-explain" }, [
                el("strong", { text: mark }),
                el("p", {
                    text: item.explanation || ("Correct answer: " + item.options[item.answer])
                })
            ]));
        }

        return card;
    }

    function resultBanner(quiz) {

        var pct = quiz.questions.length
            ? Math.round((quiz.correct / quiz.questions.length) * 100)
            : 0;

        var grade = pct >= 80 ? "Great work! 🎉"
            : (pct >= 50 ? "Good effort 👍" : "Keep practising 💪");

        var score = el("div", { class: "quiz-score", dataset: { level: level(pct) } }, [
            el("strong", { text: pct + "%" }),
            el("small", { text: quiz.correct + " / " + quiz.questions.length })
        ]);

        score.style.setProperty("--pct", pct);

        return el("div", { class: "quiz-result" }, [
            score,
            el("div", { class: "quiz-result-body" }, [
                el("h3", { text: grade }),
                el("p", {
                    class: "card-sub",
                    text: "Saved to your quiz history: " + quiz.subject +
                        (quiz.chapter ? " · " + quiz.chapter : "")
                }),
                el("div", { class: "quiz-result-actions" }, [
                    el("button", {
                        class: "secondary-btn btn-sm",
                        type: "button",
                        text: "Retry",
                        onclick: retryQuiz
                    }),
                    el("button", {
                        class: "ghost-btn btn-sm",
                        type: "button",
                        text: "New quiz",
                        onclick: newQuiz
                    })
                ])
            ])
        ]);
    }

    function renderRunner() {

        var quiz = state.current;

        ui.clear(nodes.area);

        if (!quiz) {
            renderEmpty();
            return;
        }

        if (quiz.submitted) {
            nodes.area.appendChild(resultBanner(quiz));
        }

        nodes.area.appendChild(
            el("div", { class: "quiz-run-head" }, [
                el("div", { class: "quiz-run-title" }, [
                    el("h2", { text: quiz.subject + (quiz.chapter ? " · " + quiz.chapter : "") }),
                    el("p", {
                        class: "card-sub",
                        text: (quiz.topic ? "Topic: " + quiz.topic + " · " : "") +
                            quiz.questions.length + " questions · " + quiz.difficulty + " · " +
                            (quiz.source === "ai" ? "AI generated" : "from your notes")
                    })
                ]),
                el("button", {
                    class: "ghost-btn btn-sm",
                    type: "button",
                    text: "New quiz",
                    onclick: newQuiz
                })
            ])
        );

        var form = el("div", { class: "quiz-form" });

        quiz.questions.forEach(function (item, index) {
            form.appendChild(questionCard(item, index));
        });

        nodes.area.appendChild(form);

        var submit = el("button", {
            class: "primary-btn",
            type: "button",
            id: "quizSubmitBtn",
            text: "Submit answers",
            onclick: submitQuiz
        });

        if (quiz.submitted) {
            submit.disabled = true;
            submit.textContent = "Submitted";
        }

        var progress = el("span", { class: "hint" });

        nodes.area.appendChild(
            el("div", { class: "quiz-foot" }, [
                progress,
                submit
            ])
        );

        nodes.progress = progress;
        updateProgress();
        ui.revealOnce(nodes.area);
    }

    function updateProgress() {

        var quiz = state.current;

        if (!quiz || !nodes.progress) { return; }

        var node = nodes.progress;

        if (node) {
            if (quiz.submitted) {
                node.textContent = "Scored " + quiz.correct + " / " + quiz.questions.length +
                    " · review the answers below";
            } else {
                var answered = quiz.answers.filter(function (a) {
                    return a !== null && a !== undefined;
                }).length;

                node.textContent = answered + " of " + quiz.questions.length + " answered";
            }
        }
    }

    function choose(index, oi) {

        var quiz = state.current;

        if (!quiz || quiz.submitted) { return; }

        quiz.answers[index] = oi;

        var card = nodes.area.querySelector('.quiz-q[data-index="' + index + '"]');

        if (card) {
            ui.$$(".quiz-option", card).forEach(function (button) {
                button.classList.toggle("chosen", Number(button.dataset.oi) === oi);
            });
        }

        updateProgress();
    }


    /* =========================================
       START / SUBMIT
       ========================================= */

    function startQuiz(questions, opts, source) {

        state.current = {
            subject: opts.subject,
            chapter: opts.chapter,
            topic: opts.topic,
            difficulty: opts.difficulty,
            source: source,
            questions: questions,
            answers: questions.map(function () { return null; }),
            submitted: false,
            correct: 0
        };

        showSetup(false);
        renderRunner();
        global.scrollTo({ top: 0, behavior: "smooth" });
    }

    function submitQuiz() {

        var quiz = state.current;

        if (!quiz || quiz.submitted) { return; }

        var unanswered = quiz.answers.filter(function (a) {
            return a === null || a === undefined;
        }).length;

        if (unanswered) {
            ui.toast(unanswered + " question" + (unanswered > 1 ? "s" : "") + " still unanswered", "warn");
            return;
        }

        var correct = 0;

        quiz.questions.forEach(function (item, index) {
            if (quiz.answers[index] === item.answer) { correct++; }
        });

        quiz.submitted = true;
        quiz.correct = correct;

        saveResult(quiz);
        renderRunner();

        ui.toast("Scored " + correct + " / " + quiz.questions.length,
            correct === quiz.questions.length ? "success" : "info");

        global.scrollTo({ top: 0, behavior: "smooth" });
    }

    function retryQuiz() {

        var quiz = state.current;

        if (!quiz) { return; }

        quiz.answers = quiz.questions.map(function () { return null; });
        quiz.submitted = false;
        quiz.correct = 0;

        renderRunner();
        global.scrollTo({ top: 0, behavior: "smooth" });
    }

    function newQuiz() {
        state.current = null;
        showSetup(true);
        renderEmpty();
        global.scrollTo({ top: 0, behavior: "smooth" });
    }


    /* =========================================
       HISTORY
       ========================================= */

    function loadHistory() {
        var saved = global.SS.store.get(STORE_KEY);
        state.history = Array.isArray(saved) ? saved.slice(0, MAX_STORED) : [];
    }

    function saveResult(quiz) {

        state.history.unshift({
            id: global.SS.store.uid(),
            at: Date.now(),
            subject: quiz.subject,
            chapter: quiz.chapter,
            topic: quiz.topic,
            difficulty: quiz.difficulty,
            source: quiz.source,
            total: quiz.questions.length,
            correct: quiz.correct,
            questions: quiz.questions,
            answers: quiz.answers.slice()
        });

        state.history = state.history.slice(0, MAX_STORED);
        global.SS.store.set(STORE_KEY, state.history);
        renderHistory();
    }

    function removeEntry(id) {
        state.history = state.history.filter(function (h) { return h.id !== id; });
        global.SS.store.set(STORE_KEY, state.history);
        renderHistory();
    }

    function reviewEntry(entry) {

        state.current = {
            subject: entry.subject,
            chapter: entry.chapter,
            topic: entry.topic,
            difficulty: entry.difficulty,
            source: entry.source,
            questions: entry.questions,
            answers: (entry.answers || []).slice(),
            submitted: true,
            correct: entry.correct
        };

        showSetup(false);
        renderRunner();
        global.scrollTo({ top: 0, behavior: "smooth" });
    }

    function clearHistory() {

        if (!state.history.length) { return; }

        ui.confirmBox({
            title: "Clear quiz history?",
            message: "This removes your saved quiz scores on this device.",
            confirmText: "Clear",
            danger: true
        }).then(function (ok) {
            if (!ok) { return; }

            state.history = [];
            global.SS.store.set(STORE_KEY, []);
            renderHistory();
            ui.toast("Quiz history cleared", "info");
        });
    }

    function renderHistory() {

        ui.clear(nodes.history);

        if (!state.history.length) {
            nodes.history.appendChild(
                ui.emptyState("📭", "No quizzes yet", "Your scored quizzes will collect here, grouped by subject.")
            );
            return;
        }

        var groups = {};

        state.history.forEach(function (entry) {
            var key = entry.subject || "General";
            (groups[key] = groups[key] || []).push(entry);
        });

        Object.keys(groups).sort().forEach(function (subject) {

            var list = groups[subject];

            nodes.history.appendChild(
                el("div", { class: "quiz-hist-head" }, [
                    el("h3", { text: subject }),
                    el("span", { class: "pill", text: list.length + " quiz" + (list.length > 1 ? "zes" : "") })
                ])
            );

            list.forEach(function (entry) {

                var pct = entry.total ? Math.round((entry.correct / entry.total) * 100) : 0;

                nodes.history.appendChild(
                    el("div", { class: "quiz-hist-row" }, [
                        el("div", { class: "quiz-hist-main" }, [
                            el("strong", { text: entry.chapter || entry.topic || "Whole subject" }),
                            el("span", {
                                class: "card-sub",
                                text: ui.fmtDateLong(ui.toISO(new Date(entry.at))) + " · " +
                                    entry.correct + "/" + entry.total + " · " +
                                    (entry.source === "ai" ? "AI" : "notes")
                            })
                        ]),
                        el("span", {
                            class: "quiz-hist-score",
                            dataset: { level: level(pct) },
                            text: pct + "%"
                        }),
                        el("button", {
                            class: "mini-btn",
                            type: "button",
                            text: "Open",
                            title: "Review this quiz",
                            onclick: function () { reviewEntry(entry); }
                        }),
                        el("button", {
                            class: "mini-btn danger",
                            type: "button",
                            text: "🗑",
                            "aria-label": "Delete quiz",
                            title: "Delete",
                            onclick: function () { removeEntry(entry.id); }
                        })
                    ])
                );
            });
        });

        ui.revealOnce(nodes.history);
    }


    /* =========================================
       ACTIONS
       ========================================= */

    function runAI() {

        var opts = collectOptions();

        setBusy(true);
        renderLoading(opts);

        return generateWithAI(opts).then(function (questions) {

            if (!questions.length) {
                throw new Error("The model did not return usable questions.");
            }

            startQuiz(questions.slice(0, opts.count), opts, "ai");
            ui.toast(questions.length + " questions ready 🧠", "success");

        }).catch(function () {

            ui.toast("AI quiz failed — trying your notes", "warn");

            if (!runOffline(opts, true)) {
                ui.toast("Could not build a quiz. Add notes or check your AI settings.", "error");
                renderEmpty("error");
            }

        }).then(function () {
            setBusy(false);
        });
    }

    function runOffline(opts, silent) {

        var questions = offlineQuestions(opts);

        if (!questions.length) {
            if (!silent) {
                ui.toast("Not enough matching notes for this topic", "warn");
            }
            renderEmpty("notes");
            return false;
        }

        startQuiz(questions, opts, "notes");
        ui.toast(questions.length + " questions from your notes 📝", "success");
        return true;
    }

    function onSubmit(event) {
        event.preventDefault();

        if (state.busy) { return; }

        /* no key -> skip a doomed network call and build from notes */
        if (!global.SS.ai.hasKey()) {
            runOffline(collectOptions(), false);
            return;
        }

        runAI();
    }

    function onFromNotes() {
        if (state.busy) { return; }

        runOffline(collectOptions(), false);
    }


    /* =========================================
       INIT
       ========================================= */

    function init() {

        if (!global.SS.auth.require()) { return; }

        nodes.setup = doc.getElementById("quizSetup");
        nodes.form = doc.getElementById("quizForm");
        nodes.subject = doc.getElementById("quizSubject");
        nodes.subjectList = doc.getElementById("quizSubjectList");
        nodes.chapter = doc.getElementById("quizChapter");
        nodes.chapterList = doc.getElementById("quizChapterList");
        nodes.topic = doc.getElementById("quizTopic");
        nodes.count = doc.getElementById("quizCount");
        nodes.difficulty = doc.getElementById("quizDifficulty");
        nodes.type = doc.getElementById("quizType");
        nodes.generateBtn = doc.getElementById("quizGenerateBtn");
        nodes.notesBtn = doc.getElementById("quizNotesBtn");
        nodes.newBtn = doc.getElementById("quizNewBtn");
        nodes.area = doc.getElementById("quizArea");
        nodes.history = doc.getElementById("quizHistory");
        nodes.clearHistoryBtn = doc.getElementById("quizClearHistoryBtn");
        nodes.banner = doc.getElementById("quizBanner");
        nodes.bannerTitle = doc.getElementById("quizBannerTitle");
        nodes.bannerText = doc.getElementById("quizBannerText");
        nodes.bannerAction = doc.getElementById("quizBannerAction");
        nodes.modeBadge = doc.getElementById("quizModeBadge");
        nodes.subtitle = doc.getElementById("quizSubtitle");
        nodes.hint = doc.getElementById("quizHint");
        nodes.manageBtn = doc.getElementById("quizManageBtn");
        nodes.subjectsPanel = doc.getElementById("quizSubjectsPanel");
        nodes.subjectChips = doc.getElementById("quizSubjectChips");
        nodes.subjectNew = doc.getElementById("quizSubjectNew");
        nodes.subjectAdd = doc.getElementById("quizSubjectAdd");
        nodes.subjectsCount = doc.getElementById("quizSubjectsCount");
        nodes.subjectsReset = doc.getElementById("quizSubjectsReset");

        if (!nodes.form || !nodes.area) { return; }

        fillSubjectList();
        loadHistory();
        syncMode();
        renderEmpty();
        renderHistory();
        renderSubjectChips();

        nodes.form.addEventListener("submit", onSubmit);
        nodes.notesBtn.addEventListener("click", onFromNotes);
        nodes.subject.addEventListener("input", fillChapterList);
        nodes.subject.addEventListener("change", fillChapterList);

        if (nodes.newBtn) {
            nodes.newBtn.addEventListener("click", newQuiz);
        }

        if (nodes.clearHistoryBtn) {
            nodes.clearHistoryBtn.addEventListener("click", clearHistory);
        }

        if (nodes.manageBtn) {
            nodes.manageBtn.addEventListener("click", toggleSubjectsPanel);
        }

        if (nodes.subjectAdd) {
            nodes.subjectAdd.addEventListener("click", addSubjectFromInput);
        }

        if (nodes.subjectsReset) {
            nodes.subjectsReset.addEventListener("click", restoreSubjects);
        }

        if (nodes.subjectNew) {
            nodes.subjectNew.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();   /* keep the form from submitting */
                    addSubjectFromInput();
                }
            });
        }

        /* a key saved in another tab should switch the page over */
        global.addEventListener("storage", syncMode);
    }


    global.SS = global.SS || {};
    global.SS.quiz = {
        init: init,

        /* pure helpers, exported for testing */
        subjectList: subjectList,
        addSubject: addSubject,
        removeSubject: removeSubject,
        resetSubjects: resetSubjects,
        chapterSuggestions: chapterSuggestions,
        buildPrompt: buildPrompt,
        extractJSON: extractJSON,
        answerIndex: answerIndex,
        normalizeQuestions: normalizeQuestions,
        offlineQuestions: offlineQuestions
    };

    doc.addEventListener("DOMContentLoaded", init);


}(window));
