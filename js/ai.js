/* =========================================
   SMART STUDY - AI ASSISTANT ENGINE
   Answers study doubts using a provider key the
   student supplies themselves. The key lives only
   in this browser and is never sent anywhere except
   the chosen provider's own endpoint.

   With no key the module still works: it falls back
   to searching the student's own notes, extracting
   summaries and building flashcards. No network, no
   cost, nothing fake.

   Exposed as SS.ai.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var Store = global.SS.store;

    /* ui.js is loaded before this file, but resolving it lazily keeps
       this module safe if the order ever changes. */
    function U() {
        return global.SS.ui;
    }

    function M() {
        return global.SS.models;
    }


    /* =========================================
       CONFIG
       ========================================= */

    /* A separate store key, not part of settings, so the export
       routine can skip it and a shared backup never leaks the key. */
    var CONFIG_KEY = "ai";

    var CONFIG_DEFAULTS = {
        provider: "free",
        model: "",
        baseUrl: "",
        key: ""
    };

    function config() {
        var saved = Store.get(CONFIG_KEY);

        if (!saved || typeof saved !== "object") {
            saved = {};
        }

        var provider = PROVIDERS[saved.provider] ? saved.provider : CONFIG_DEFAULTS.provider;
        var key = String(saved.key || "");

        /* A keyed provider with no key cannot answer anything - it is a
           dead state, so fall back to the keyless default and the app
           keeps working out of the box. Save a key and the provider
           choice sticks again. */
        if (providerNeedsKey(PROVIDERS[provider]) && !key.trim()) {
            provider = CONFIG_DEFAULTS.provider;
        }

        var baseUrl = String(saved.baseUrl || "");

        /* The old public endpoint blocks browser requests, so a saved
           copy of it is dropped - every provider falls back to its own
           default address instead of a dead one. */
        if (/pollinations\.ai/i.test(baseUrl)) {
            baseUrl = "";
        }

        return {
            /* a saved provider id that no longer exists falls back to the
               default, so an old choice can never point at nothing */
            provider: provider,
            model: String(saved.model || ""),
            baseUrl: baseUrl,
            key: key
        };
    }

    function saveConfig(patch) {
        var next = Object.assign({}, config(), patch || {});
        Store.set(CONFIG_KEY, next);
        return next;
    }

    function clearKey() {
        return saveConfig({ key: "" });
    }

    function hasKey() {
        /* a keyless provider is always usable, so "has key" really means
           "could I send a request right now?" */
        if (!providerNeedsKey(activeProvider())) { return true; }
        return Boolean(config().key.trim());
    }

    function maskKey(key) {
        var k = String(key || "").trim();

        if (!k) { return ""; }
        if (k.length <= 10) { return k.charAt(0) + "•••" + k.charAt(k.length - 1); }

        return k.slice(0, 4) + "••••" + k.slice(-4);
    }

    /* The provider the user picked, or a safe fallback. */
    function activeProvider() {
        var cfg = config();
        return PROVIDERS[cfg.provider] || PROVIDERS.openai;
    }

    /* A keyless provider (the free public endpoint) is always "ready";
       everything else needs a key before it can be called. */
    function providerNeedsKey(provider) {
        return !(provider && provider.keyless === true);
    }


    /* =========================================
       PROVIDERS
       Every adapter turns one question into one HTTP
       request and knows how to pull text back out of
       the response - both streaming and whole.
       ========================================= */

    function trimSlash(url) {
        return String(url || "").replace(/\/+$/, "");
    }

    var PROVIDERS = {

        /* Keyless and instant: an OpenAI-shaped chat endpoint, so the same
           request builder works. Nothing to sign up for, but it is shared
           infrastructure - rate-limited, and the prompt (including any of
           the student's notes) is handled by a third party. That trade-off
           is spelled out in the UI.

           The public endpoint now challenges requests that carry a browser
           Origin with an anti-bot token, so the page cannot reach it
           directly. The default base below points at this app's own server,
           which forwards the call on the page's behalf (see server/api.js).
           A custom base still works for anyone running their own relay. */
        free: {
            id: "free",
            label: "Free (no key)",
            blurb: "Works instantly with no key. Public and rate-limited — your notes go to a third-party server.",
            defaultModel: "openai",
            defaultBase: "/api/ai",
            keyHint: "",
            keyless: true,
            needsBase: true,
            models: ["openai", "openai-fast"],

            build: function (cfg, system, messages, stream) {
                var model = cfg.model || this.defaultModel;
                var base = trimSlash(cfg.baseUrl || "");

                /* A saved copy of the old public endpoint only breaks
                   things now - it challenges browser requests - so free
                   mode falls back to the built-in relay. A custom
                   gateway is still honoured. */
                if (!base || /pollinations\.ai/i.test(base)) {
                    base = trimSlash(this.defaultBase);
                }

                /* the default base is a path on this app's own server -
                   keep it when this page IS that server (works over LAN
                   too), and aim at the server explicitly when the page
                   runs anywhere else (another local port, file://). The
                   API allows any origin, so the answer still arrives. */
                if (base.charAt(0) === "/") {
                    var here = global.location || {};
                    var pagePort = String(here.port || "");
                    var pageHost = String(here.hostname || "");

                    if (pagePort === "3000" && here.origin &&
                        /^https?:$/.test(String(here.protocol))) {
                        base = String(here.origin).replace(/\/+$/, "") + base;
                    } else {
                        /* a static preview (VS Code Live Server, file://)
                           still finds the relay on the same machine, and on
                           a LAN preview on the same host at port 3000 */
                        var relayHost = pageHost || "localhost";
                        var relayProto = String(here.protocol) === "https:" ? "https:" : "http:";
                        base = relayProto + "//" + relayHost + ":3000" + base;
                    }
                }

                return {
                    model: model,
                    /* note: no /v1 prefix and no Authorization header */
                    url: base + "/openai",
                    init: {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            model: model,
                            stream: stream,
                            temperature: 0.3,
                            messages: [{ role: "system", content: system }].concat(messages)
                        })
                    }
                };
            },

            /* The upstream replies with the OpenAI chunk shape. It also
               streams a separate "reasoning" field, which is deliberately
               not read here - only the final answer reaches the student. */
            delta: function (json) {
                var choice = json && json.choices && json.choices[0];
                return (choice && choice.delta && choice.delta.content) || "";
            },

            full: function (json) {
                var choice = json && json.choices && json.choices[0];
                return (choice && choice.message && choice.message.content) || "";
            },

            error: function (json) {
                var err = json && json.error;
                if (!err) { return ""; }
                return typeof err === "string" ? err : (err.message || "");
            }
        },

        /* Covers OpenAI plus every service that copies its
           /chat/completions shape: Groq, OpenRouter, Together,
           DeepSeek, Ollama, LM Studio and friends. */
        openai: {
            id: "openai",
            label: "OpenAI-compatible",
            blurb: "OpenAI, Groq, OpenRouter, Together, Ollama, LM Studio",
            defaultModel: "gpt-4o-mini",
            defaultBase: "https://api.openai.com/v1",
            keyHint: "sk-…",
            needsBase: true,
            models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],

            build: function (cfg, system, messages, stream) {
                var model = cfg.model || this.defaultModel;
                var base = trimSlash(cfg.baseUrl || this.defaultBase);

                return {
                    model: model,
                    url: base + "/chat/completions",
                    init: {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": "Bearer " + cfg.key
                        },
                        body: JSON.stringify({
                            model: model,
                            stream: stream,
                            temperature: 0.3,
                            messages: [{ role: "system", content: system }].concat(messages)
                        })
                    }
                };
            },

            delta: function (json) {
                var choice = json && json.choices && json.choices[0];
                return (choice && choice.delta && choice.delta.content) || "";
            },

            full: function (json) {
                var choice = json && json.choices && json.choices[0];
                return (choice && choice.message && choice.message.content) || "";
            },

            error: function (json) {
                var err = json && json.error;
                if (!err) { return ""; }
                return typeof err === "string" ? err : (err.message || "");
            }
        },

        anthropic: {
            id: "anthropic",
            label: "Anthropic (Claude)",
            blurb: "Claude models, direct from the browser",
            defaultModel: "claude-3-5-haiku-latest",
            defaultBase: "https://api.anthropic.com/v1",
            keyHint: "sk-ant-…",
            needsBase: false,
            models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],

            build: function (cfg, system, messages, stream) {
                var model = cfg.model || this.defaultModel;

                return {
                    model: model,
                    url: trimSlash(cfg.baseUrl || this.defaultBase) + "/messages",
                    init: {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-api-key": cfg.key,
                            "anthropic-version": "2023-06-01",
                            /* Anthropic blocks browser calls unless the client
                               opts in. This app is the client and the key belongs
                               to the person using it, so that is acceptable here. */
                            "anthropic-dangerous-direct-browser-access": "true"
                        },
                        body: JSON.stringify({
                            model: model,
                            max_tokens: 1500,
                            temperature: 0.3,
                            system: system,
                            stream: stream,
                            messages: messages.map(function (m) {
                                return {
                                    role: m.role === "assistant" ? "assistant" : "user",
                                    content: m.content
                                };
                            })
                        })
                    }
                };
            },

            delta: function (json) {
                if (json && json.type === "content_block_delta" && json.delta) {
                    return json.delta.text || "";
                }
                return "";
            },

            full: function (json) {
                if (json && Array.isArray(json.content) && json.content[0]) {
                    return json.content[0].text || "";
                }
                return "";
            },

            error: function (json) {
                var err = json && json.error;
                if (!err) { return ""; }
                return typeof err === "string" ? err : (err.message || "");
            }
        },

        gemini: {
            id: "gemini",
            label: "Google Gemini",
            blurb: "Generous free tier, good for students",
            defaultModel: "gemini-2.0-flash",
            defaultBase: "https://generativelanguage.googleapis.com/v1beta",
            keyHint: "AIza…",
            needsBase: false,
            models: ["gemini-2.0-flash", "gemini-1.5-flash"],

            build: function (cfg, system, messages, stream) {
                var model = cfg.model || this.defaultModel;
                var verb = stream ? "streamGenerateContent" : "generateContent";
                var base = trimSlash(cfg.baseUrl || this.defaultBase);

                return {
                    model: model,
                    url: base + "/models/" + encodeURIComponent(model) + ":" + verb +
                        (stream ? "?alt=sse" : ""),
                    init: {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            /* header rather than ?key=, so the key never
                               lands in a URL, a log line or a referrer */
                            "x-goog-api-key": cfg.key
                        },
                        body: JSON.stringify({
                            systemInstruction: { parts: [{ text: system }] },
                            contents: messages.map(function (m) {
                                return {
                                    role: m.role === "assistant" ? "model" : "user",
                                    parts: [{ text: m.content }]
                                };
                            }),
                            generationConfig: { temperature: 0.3 }
                        })
                    }
                };
            },

            delta: function (json) {
                var cand = json && json.candidates && json.candidates[0];
                var parts = cand && cand.content && cand.content.parts;

                if (Array.isArray(parts)) {
                    return parts.map(function (p) { return p && p.text ? p.text : ""; }).join("");
                }

                return "";
            },

            full: function (json) {
                return PROVIDERS.gemini.delta(json);
            },

            error: function (json) {
                var err = json && json.error;
                if (!err) { return ""; }
                return typeof err === "string" ? err : (err.message || "");
            }
        }
    };


    /* =========================================
       SSE PARSING  (pure - unit tested directly)
       Feeds of partial text are the norm, so this
       keeps the tail of an incomplete event and hands
       back only the events that are definitely whole.
       ========================================= */

    function parseSSE(buffer) {
        var text = String(buffer == null ? "" : buffer).replace(/\r\n/g, "\n");
        var blocks = text.split("\n\n");
        var rest = blocks.pop();
        var events = [];

        blocks.forEach(function (block) {
            var data = [];

            block.split("\n").forEach(function (line) {
                if (line.indexOf("data:") === 0) {
                    data.push(line.slice(5).replace(/^ /, ""));
                }
            });

            if (data.length) {
                events.push(data.join("\n"));
            }
        });

        return { events: events, rest: rest };
    }

    function safeJSON(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }


    /* =========================================
       TRANSPORT
       ========================================= */

    function pickFetch(opts) {
        if (opts && typeof opts.fetch === "function") {
            return opts.fetch;
        }
        if (typeof global.fetch === "function") {
            return global.fetch.bind(global);
        }
        return null;
    }

    function httpError(provider, status, json, body) {
        var msg = provider.error(json);

        if (msg) {
            return "Provider said: " + msg;
        }
        if (status === 401 || status === 403) {
            return "The API key was rejected (" + status + "). Check it in Settings.";
        }
        if (status === 429) {
            return "Rate limited (" + status + "). Wait a moment and try again.";
        }

        var snippet = String(body || "").replace(/\s+/g, " ").slice(0, 160);

        return "Request failed (" + status + ")." + (snippet ? " " + snippet : "");
    }

    /* An unreachable endpoint rejects the fetch itself, which reaches the
       page as a bare "Failed to fetch". Name the real cause instead: the
       app's own relay only answers while the local server is running, so
       that case gets the exact command to start it. A deliberate stop
       (AbortError) is passed straight through. */
    function networkError(error, provider, spec) {

        if (error && error.name === "AbortError") { return error; }

        var text = String((error && error.message) || error || "");

        var looksNetwork = (error && error.name === "TypeError") ||
            /failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(text);

        if (!looksNetwork) { return error; }

        if (/\/api\/ai\b/.test(String((spec && spec.url) || ""))) {
            return new Error(
                "The study assistant's local server is not answering. " +
                "Start it with start-server.bat (or run: node server/server.js), " +
                "keep that window open, then try again."
            );
        }

        return new Error(
            "Could not reach " + (provider && provider.label ? provider.label : "the provider") +
            ". Check your internet connection and the endpoint saved in Settings."
        );
    }

    /* Streams a response, calling onDelta for each new fragment.
       Resolves with the full text once the stream ends. */
    function streamResponse(spec, provider, onDelta, fetchFn) {

        return fetchFn(spec.url, spec.init).then(function (res) {

            if (!res.ok) {
                return res.text().then(function (body) {
                    throw new Error(httpError(provider, res.status, safeJSON(body), body));
                });
            }

            function consumeAll(body) {
                var parsed = parseSSE(body);
                var full = "";

                parsed.events.concat([parsed.rest]).forEach(function (event) {
                    if (!event || event === "[DONE]") { return; }

                    var json = safeJSON(event);
                    if (!json) { return; }

                    var err = provider.error(json);
                    if (err) { throw new Error("Provider said: " + err); }

                    var piece = provider.delta(json);
                    if (piece) {
                        full += piece;
                        if (onDelta) { onDelta(piece); }
                    }
                });

                return full;
            }

            /* Older browsers and test doubles may hand back a response
               without a readable stream, or lack TextDecoder entirely.
               Parse the whole body instead of failing - the answer still
               arrives, just not word by word. */
            var Reader = res.body && typeof res.body.getReader === "function" ? res.body : null;
            var DecoderCtor = global.TextDecoder || (typeof TextDecoder === "function" ? TextDecoder : null);

            if (!Reader || !DecoderCtor) {
                return res.text().then(function (raw) {
                    return consumeAll(raw);
                });
            }

            var reader = Reader.getReader();
            var decoder = new DecoderCtor();
            var buffer = "";
            var full = "";

            function pump() {
                return reader.read().then(function (chunk) {

                    if (chunk.done) {
                        /* flush whatever the last partial event held */
                        var tail = parseSSE(buffer + "\n\n");

                        tail.events.forEach(function (event) {
                            if (event === "[DONE]") { return; }
                            var json = safeJSON(event);
                            if (!json) { return; }
                            var piece = provider.delta(json);
                            if (piece) {
                                full += piece;
                                if (onDelta) { onDelta(piece); }
                            }
                        });

                        return full;
                    }

                    buffer += decoder.decode(chunk.value, { stream: true });

                    var parsed = parseSSE(buffer);
                    buffer = parsed.rest;

                    parsed.events.forEach(function (event) {
                        if (event === "[DONE]") { return; }

                        var json = safeJSON(event);
                        if (!json) { return; }

                        var err = provider.error(json);
                        if (err) { throw new Error("Provider said: " + err); }

                        var piece = provider.delta(json);
                        if (piece) {
                            full += piece;
                            if (onDelta) { onDelta(piece); }
                        }
                    });

                    return pump();
                });
            }

            return pump();
        });
    }


    /* =========================================
       PROMPT + CONTEXT
       Answers are much better when the model can see
       the student's own notes, so the question is used
       to pull the few notes that actually look relevant.
       ========================================= */

    var SYSTEM_PROMPT = [
        "You are the study assistant inside Smart Study, an app for students.",
        "Help the student understand ideas, work through problems and revise.",
        "",
        "How to answer:",
        "- Use clear, simple language. Short paragraphs and bullet points beat walls of text.",
        "- For maths or science, show the steps one line at a time, then give the final answer.",
        "- If the student's own notes (given below) are relevant, use them and say briefly that you are doing so.",
        "- If the notes do not cover the question, answer from general knowledge and say the notes do not cover it.",
        "- Never invent content and claim it came from the student's notes.",
        "- If the question is not about studying, answer briefly and steer back to study.",
        "- Do not pad the answer. Stop when the question is answered."
    ].join("\n");

    var STOPWORDS = {
        the: 1, a: 1, an: 1, and: 1, or: 1, but: 1, of: 1, to: 1, in: 1, on: 1,
        at: 1, by: 1, for: 1, with: 1, about: 1, from: 1, as: 1, is: 1, are: 1,
        was: 1, were: 1, be: 1, been: 1, being: 1, it: 1, its: 1, this: 1, that: 1,
        these: 1, those: 1, i: 1, me: 1, my: 1, we: 1, our: 1, you: 1, your: 1,
        he: 1, she: 1, they: 1, them: 1, his: 1, her: 1, their: 1, do: 1, does: 1,
        did: 1, how: 1, what: 1, why: 1, when: 1, where: 1, which: 1, who: 1,
        can: 1, could: 1, should: 1, would: 1, will: 1, shall: 1, may: 1, might: 1,
        must: 1, not: 1, no: 1, yes: 1, if: 1, then: 1, than: 1, so: 1, such: 1,
        explain: 1, please: 1, help: 1, tell: 1, give: 1, make: 1, need: 1,
        want: 1, know: 1, understand: 1, question: 1, doubt: 1, some: 1, any: 1
    };

    /* splits a sentence into meaningful lowercase words */
    function terms(text) {
        var out = [];

        String(text == null ? "" : text)
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .forEach(function (word) {
                if (word.length >= 3 && !STOPWORDS[word]) {
                    out.push(word);
                }
            });

        return out;
    }

    function tagsOf(note) {
        return note && Array.isArray(note.tags) ? note.tags : [];
    }

    function scoreNote(note, words) {
        var title = String(note.title || "").toLowerCase();
        var body = String(note.content || "").toLowerCase();
        var tags = tagsOf(note).join(" ").toLowerCase();
        var score = 0;

        words.forEach(function (word) {
            if (title.indexOf(word) !== -1) { score += 5; }
            if (tags.indexOf(word) !== -1) { score += 3; }

            var hits = body.split(word).length - 1;
            if (hits > 0) { score += Math.min(hits, 4); }
        });

        return score;
    }

    /* Notes that look relevant to a question, best first. */
    function retrieve(question, limit) {
        var words = terms(question);

        if (!words.length) { return []; }

        return M().notes.all()
            .map(function (note) {
                return { note: note, score: scoreNote(note, words) };
            })
            .filter(function (hit) { return hit.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, limit || 4);
    }

    function clip(text, max) {
        var value = String(text == null ? "" : text).trim();
        return value.length > max ? value.slice(0, max) + " …" : value;
    }

    /* Builds the system prompt for one question: a small study snapshot
       plus the handful of notes that scored highest. */
    function buildContext(question, opts) {

        opts = opts || {};

        var ui = U();
        var lines = [];
        var hits = opts.hits || retrieve(question, 4);

        lines.push("Today is " + ui.todayISO() + ".");

        var exams = M().examView.upcoming().slice(0, 3);

        if (exams.length) {
            lines.push("Upcoming exams: " + exams.map(function (exam) {
                return exam.title + " in " + M().examView.daysLeft(exam) + " day(s)";
            }).join("; ") + ".");
        }

        var stats = M().taskView.stats();
        lines.push("The student has " + stats.pending + " pending task(s), " +
            stats.overdue + " of them overdue.");

        var subjects = M().subjects.all();

        if (subjects.length) {
            lines.push("Subjects: " + subjects.map(function (s) { return s.name; }).join(", ") + ".");
        }

        if (hits.length) {
            lines.push("");
            lines.push("The student's own notes that may be relevant. Use them if they help; " +
                "if they do not cover the question, say so plainly:");

            hits.forEach(function (hit, index) {
                var note = hit.note;
                var tagText = tagsOf(note).map(function (t) { return "#" + t; }).join(" ");

                lines.push("");
                lines.push("[Note " + (index + 1) + "] " + (note.title || "Untitled") +
                    (tagText ? "  " + tagText : ""));
                lines.push(clip(note.content, 1400));
            });
        } else {
            lines.push("");
            lines.push("No note of the student's matched this question.");
        }

        return {
            system: SYSTEM_PROMPT + "\n\n" + lines.join("\n"),
            hits: hits
        };
    }


    /* =========================================
       ASK
       ========================================= */

    function ask(question, opts) {

        opts = opts || {};

        var cfg = config();
        var provider = activeProvider();

        if (providerNeedsKey(provider) && !cfg.key.trim()) {
            return Promise.reject(new Error(
                "No API key yet. Add one in Settings to get AI answers, or use the notes tools below."
            ));
        }

        var fetchFn = pickFetch(opts);

        if (!fetchFn) {
            return Promise.reject(new Error(
                "This browser cannot make network requests, so AI answers are unavailable."
            ));
        }

        var system = opts.system || buildContext(question, opts).system;
        var history = (opts.history || []).slice(-8);
        var messages = history.concat([{ role: "user", content: question }]);
        var stream = opts.stream !== false;
        var spec = provider.build(cfg, system, messages, stream);

        if (opts.signal) {
            spec.init.signal = opts.signal;
        }

        if (!stream) {
            return fetchFn(spec.url, spec.init).then(function (res) {
                return res.text().then(function (body) {
                    var json = safeJSON(body);

                    if (!res.ok) {
                        throw new Error(httpError(provider, res.status, json, body));
                    }

                    var err = provider.error(json);
                    if (err) { throw new Error("Provider said: " + err); }

                    return {
                        text: provider.full(json),
                        provider: provider.id,
                        model: spec.model
                    };
                });
            }).catch(function (error) {
                throw networkError(error, provider, spec);
            });
        }

        return streamResponse(spec, provider, opts.onDelta, fetchFn)
            .then(function (text) {
                return { text: text, provider: provider.id, model: spec.model };
            })
            .catch(function (error) {
                throw networkError(error, provider, spec);
            });
    }

    function complete(question, opts) {
        return ask(question, Object.assign({}, opts, { stream: false }));
    }

    /* A tiny round trip used by the "Test connection" button. */
    function testConnection(opts) {
        return complete("Reply with the single word: ready", opts)
            .then(function (res) {
                return {
                    ok: Boolean(res.text),
                    text: clip(res.text, 120),
                    provider: res.provider,
                    model: res.model
                };
            });
    }


    /* =========================================
       SAFE MARKDOWN
       Model output is untrusted text. It is parsed
       into real DOM nodes here and never handed to
       innerHTML, so a reply containing <script> or an
       onerror attribute can only ever show up as the
       characters the student sees.
       ========================================= */

    /* Source only. Every inlineNodes() call compiles its own RegExp,
       because a shared global regex carries lastIndex state, and the
       recursion for bold/italic would rewind the caller's position and
       loop forever. */
    var INLINE_SOURCE =
        "(`[^`]+`)" +                                   /* code span      */
        "|(\\*\\*[^*]+\\*\\*)" +                        /* bold           */
        "|(\\*[^*\\n]+\\*)" +                           /* italic         */
        "|(\\[[^\\]]+\\]\\(https?:[^)\\s]+\\))" +       /* safe link      */
        "|(\\[[^\\]]+\\]\\([^)]*\\))";                  /* unsafe link    */

    function inlineNodes(text, ui, el) {

        var out = [];
        var last = 0;
        var match;
        var re = new RegExp(INLINE_SOURCE, "g");

        function push(raw) {
            if (raw) { out.push(doc.createTextNode(raw)); }
        }

        while ((match = re.exec(text)) !== null) {

            push(text.slice(last, match.index));

            var token = match[0];

            if (token.charAt(0) === "`") {
                out.push(el("code", { class: "md-code-inline", text: token.slice(1, -1) }));

            } else if (token.indexOf("**") === 0) {
                out.push(el("strong", null, inlineNodes(token.slice(2, -2), ui, el)));

            } else if (token.charAt(0) === "[") {
                var cut = token.indexOf("](");
                var label = token.slice(1, cut);
                var url = token.slice(cut + 2, -1);

                /* only http(s) links become anchors; anything else
                   (javascript:, data:, file:) stays plain text */
                if (/^https?:\/\//i.test(url)) {
                    out.push(el("a", {
                        href: url,
                        target: "_blank",
                        rel: "noopener noreferrer",
                        text: label
                    }));
                } else {
                    push(label);
                }

            } else {
                out.push(el("em", null, inlineNodes(token.slice(1, -1), ui, el)));
            }

            last = re.lastIndex;
        }

        push(text.slice(last));

        return out;
    }

    function renderMarkdown(text) {

        var ui = U();
        var el = ui.el;
        var frag = doc.createDocumentFragment();
        var lines = String(text == null ? "" : text).replace(/\r\n/g, "\n").split("\n");

        function appendInline(parent, raw) {
            inlineNodes(raw, ui, el).forEach(function (node) {
                parent.appendChild(node);
            });
        }

        var paragraph = [];

        function flushParagraph() {
            if (!paragraph.length) { return; }

            var p = el("p", { class: "md-p" });
            appendInline(p, paragraph.join(" "));
            frag.appendChild(p);

            paragraph = [];
        }

        var i = 0;

        while (i < lines.length) {

            var line = lines[i];
            var trimmed = line.trim();

            if (trimmed === "") {
                flushParagraph();
                i++;
                continue;
            }

            /* fenced code block */
            if (trimmed.indexOf("```") === 0) {
                flushParagraph();

                var body = [];
                i++;

                while (i < lines.length && lines[i].trim().indexOf("```") !== 0) {
                    body.push(lines[i]);
                    i++;
                }

                i++;   /* closing fence */

                frag.appendChild(
                    el("pre", { class: "md-pre" }, [el("code", { text: body.join("\n") })])
                );
                continue;
            }

            /* heading */
            var heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);

            if (heading) {
                flushParagraph();

                var node = el(heading[1].length <= 2 ? "h3" : "h4", { class: "md-h" });
                appendInline(node, heading[2]);
                frag.appendChild(node);

                i++;
                continue;
            }

            /* horizontal rule */
            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
                flushParagraph();
                frag.appendChild(el("hr"));
                i++;
                continue;
            }

            /* blockquote */
            if (trimmed.charAt(0) === ">") {
                flushParagraph();

                var quoted = [];

                while (i < lines.length && lines[i].trim().charAt(0) === ">") {
                    quoted.push(lines[i].trim().replace(/^>\s?/, ""));
                    i++;
                }

                var quote = el("blockquote", { class: "md-quote" });
                appendInline(quote, quoted.join(" "));
                frag.appendChild(quote);
                continue;
            }

            /* unordered list */
            if (/^[-*+]\s+/.test(trimmed)) {
                flushParagraph();

                var ul = el("ul", { class: "md-list" });

                while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
                    var li = el("li");
                    appendInline(li, lines[i].trim().replace(/^[-*+]\s+/, ""));
                    ul.appendChild(li);
                    i++;
                }

                frag.appendChild(ul);
                continue;
            }

            /* ordered list */
            if (/^\d+[.)]\s+/.test(trimmed)) {
                flushParagraph();

                var ol = el("ol", { class: "md-list" });

                while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
                    var li2 = el("li");
                    appendInline(li2, lines[i].trim().replace(/^\d+[.)]\s+/, ""));
                    ol.appendChild(li2);
                    i++;
                }

                frag.appendChild(ol);
                continue;
            }

            paragraph.push(trimmed);
            i++;
        }

        flushParagraph();

        return frag;
    }


    /* =========================================
       NO-KEY STUDY TOOLS
       These run entirely offline on the student's
       own notes. Honest helpers, not pretend AI.
       ========================================= */

    /* Extractive summary: score sentences by how often their
       words recur, then keep the best few in reading order. */
    function summarize(text, maxSentences) {

        var body = String(text == null ? "" : text).replace(/\s+/g, " ").trim();

        if (!body) { return ""; }

        var sentences = body.match(/[^.!?]+[.!?]+/g) || [body];
        sentences = sentences
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length > 24; });

        if (sentences.length <= 2) {
            return clip(body, 320);
        }

        var frequency = {};

        terms(body).forEach(function (word) {
            frequency[word] = (frequency[word] || 0) + 1;
        });

        var ranked = sentences.map(function (sentence, index) {
            var words = terms(sentence);
            var total = words.reduce(function (sum, word) {
                return sum + (frequency[word] || 0);
            }, 0);

            return {
                sentence: sentence,
                index: index,
                score: words.length ? total / words.length : 0
            };
        });

        ranked.sort(function (a, b) { return b.score - a.score; });

        return ranked
            .slice(0, maxSentences || 3)
            .sort(function (a, b) { return a.index - b.index; })
            .map(function (item) { return item.sentence; })
            .join(" ");
    }

    /* Pulls question/answer pairs out of a note. Explicit
       "term: definition" lines make the best cards; the rest fall
       back to cloze deletions and, finally, to a summary card. */
    function flashcards(note, limit) {

        var max = limit || 8;
        var cards = [];
        var seen = {};

        function add(question, answer) {

            var q = String(question || "").trim();
            var a = String(answer || "").trim();

            if (!q || !a || seen[q.toLowerCase()]) { return; }

            seen[q.toLowerCase()] = true;
            cards.push({ q: q, a: a });
        }

        if (!note) { return cards; }

        var content = String(note.content || "");
        var title = String(note.title || "this note");

        content.split(/\n+/).forEach(function (raw) {

            var line = raw.trim().replace(/^[-*+\u2022]\s*/, "").replace(/^\d+[.)]\s*/, "");

            if (!line) { return; }

            /* "term: definition" - the clearest card shape */
            var pair = /^([^:：]{3,60})[:\-–—]\s*(.+)$/.exec(line);

            if (pair && pair[2].length > 3) {
                add("What is " + pair[1].trim() + "?", pair[2].trim());
                return;
            }

            /* "X is Y" / "X means Y" */
            var def = /^(.{4,70}?)\s+(?:is|are|means|refers to)\s+(.+)$/i.exec(line);

            if (def && def[2].length > 3) {
                add("What " + (/(are|were)$/i.test(def[1]) ? "are " : "is ") +
                    def[1].trim() + "?", def[2].trim());
                return;
            }

            /* cloze: hide the longest meaningful word in the line */
            var words = terms(line);

            if (line.length > 30 && words.length >= 4) {
                var target = words.slice().sort(function (a, b) {
                    return b.length - a.length;
                })[0];

                var blanked = line.replace(new RegExp("\\b" + target + "\\b", "i"), "______");

                if (blanked !== line) {
                    add("Fill in the blank: " + blanked, target);
                }
            }
        });

        if (!cards.length) {
            add("Explain: " + title, summarize(content, 2) || clip(content, 240));
        }

        return cards.slice(0, max);
    }

    /* A compact picture of the student's day, used when no key is set
       and for the "what should I study today" shortcut. */
    function todayBriefing() {

        var ui = U();
        var today = ui.todayISO();

        return {
            date: today,
            overdue: M().taskView.overdue(),
            dueToday: M().tasks.all().filter(function (task) {
                return !task.completed && task.date === today;
            }),
            plan: M().planView.forDay(new Date().getDay()),
            exams: M().examView.upcoming().slice(0, 3),
            goalMinutes: Number(Store.settings.all().dailyGoal) || 120,
            doneMinutes: M().study.todayMinutes(),
            streak: M().study.streak()
        };
    }


    /* =========================================
       EXPORT
       ========================================= */

    global.SS = global.SS || {};
    global.SS.ai = {
        PROVIDERS: PROVIDERS,
        CONFIG_DEFAULTS: CONFIG_DEFAULTS,
        SYSTEM_PROMPT: SYSTEM_PROMPT,

        config: config,
        saveConfig: saveConfig,
        clearKey: clearKey,
        hasKey: hasKey,
        maskKey: maskKey,
        activeProvider: activeProvider,
        providerNeedsKey: providerNeedsKey,
        isKeyless: function () {
            return !providerNeedsKey(activeProvider());
        },

        parseSSE: parseSSE,
        terms: terms,
        summarize: summarize,
        flashcards: flashcards,
        retrieve: retrieve,
        buildContext: buildContext,
        todayBriefing: todayBriefing,
        renderMarkdown: renderMarkdown,

        ask: ask,
        complete: complete,
        testConnection: testConnection
    };


}(window));
