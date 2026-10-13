/* =========================================
   SMART STUDY - SETTINGS PAGE
   Profile, appearance, focus timer
   defaults and data backup tools.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var Store = global.SS.store;
    var ui = global.SS.ui;
    var Auth = global.SS.auth;

    var el = ui.el;


    /* =========================================
       PROFILE
       ========================================= */

    function renderProfile() {

        var session = Auth.require();

        if (!session) { return; }

        var nameNode = doc.getElementById("profileName");
        var emailNode = doc.getElementById("profileEmail");
        var metaNode = doc.getElementById("profileMeta");
        var nameInput = doc.getElementById("profileNameInput");

        if (nameNode) { nameNode.textContent = session.name || session.email; }
        if (emailNode) { emailNode.textContent = session.email; }
        if (nameInput) { nameInput.value = session.name || ""; }

        if (metaNode) {
            ui.clear(metaNode);

            if (session.guest) {
                metaNode.appendChild(
                    el("span", { class: "pill pill-medium", text: "GUEST ACCOUNT" })
                );
                metaNode.appendChild(
                    el("p", {
                        class: "text-muted text-sm",
                        style: { marginTop: "8px" },
                        text: "Guest data is saved on this device only. Create an account to keep it."
                    })
                );
            } else {
                var user = Store.users.find(session.email);

                metaNode.appendChild(el("span", { class: "pill pill-ok", text: "REGISTERED" }));

                if (user && user.joinedAt) {
                    metaNode.appendChild(
                        el("p", {
                            class: "text-muted text-sm",
                            style: { marginTop: "8px" },
                            text: "Member since " +
                                new Date(user.joinedAt).toLocaleDateString(undefined, {
                                    month: "long", year: "numeric"
                                })
                        })
                    );
                }
            }
        }
    }

    function saveName(event) {

        event.preventDefault();

        var session = Auth.require();
        var value = doc.getElementById("profileNameInput").value.trim();

        if (value.length < 2) {
            ui.toast("Please enter a valid name", "warn");
            return;
        }

        Store.session.set(Object.assign({}, session, { name: value }));

        if (!session.guest) {
            Store.users.update(session.email, { name: value });
        }

        ui.toast("Profile updated ✅", "success");

        renderProfile();
        ui.initChrome();
    }


    /* =========================================
       PASSWORD
       ========================================= */

    function changePassword(event) {

        event.preventDefault();

        var session = Auth.require();
        var current = doc.getElementById("oldPassword").value;
        var next = doc.getElementById("newPassword").value;
        var confirm = doc.getElementById("confirmPassword").value;

        if (session.guest) {
            ui.toast("Guest accounts have no password", "warn");
            return;
        }

        var user = Store.users.find(session.email);

        if (!user || Store.hashPassword(current, user.salt) !== user.hash) {
            ui.toast("Current password is incorrect", "error");
            return;
        }

        if (next.length < 6) {
            ui.toast("New password must be at least 6 characters", "warn");
            return;
        }

        if (next !== confirm) {
            ui.toast("New passwords do not match", "warn");
            return;
        }

        var salt = Store.makeSalt();

        Store.users.update(session.email, {
            salt: salt,
            hash: Store.hashPassword(next, salt)
        });

        event.target.reset();

        ui.toast("Password changed successfully 🔒", "success");
    }


    /* =========================================
       FOCUS DEFAULTS
       ========================================= */

    function renderFocusForm() {

        var s = Store.settings.all();

        [
            ["setFocus", s.focus],
            ["setShort", s.shortBreak],
            ["setLong", s.longBreak],
            ["setEvery", s.longEvery],
            ["setGoal", s.dailyGoal]
        ].forEach(function (pair) {
            var node = doc.getElementById(pair[0]);
            if (node) { node.value = pair[1]; }
        });

        var sound = doc.getElementById("setSound");
        if (sound) { sound.checked = s.sound !== false; }

        var notif = doc.getElementById("setNotify");
        if (notif) {
            notif.checked = s.notify === true;
            notif.disabled = !("Notification" in global);
            if (notif.disabled && notif.parentNode) {
                notif.parentNode.appendChild(
                    el("span", {
                        class: "hint",
                        text: " (not supported in this browser)"
                    })
                );
            }
        }
    }

    function saveFocus(event) {

        event.preventDefault();

        Store.settings.patch({
            focus: Number(doc.getElementById("setFocus").value) || 25,
            shortBreak: Number(doc.getElementById("setShort").value) || 5,
            longBreak: Number(doc.getElementById("setLong").value) || 15,
            longEvery: Number(doc.getElementById("setEvery").value) || 4,
            dailyGoal: Number(doc.getElementById("setGoal").value) || 120,
            sound: doc.getElementById("setSound").checked,
            notify: doc.getElementById("setNotify").checked
        });

        ui.toast("Focus settings saved ⏱", "success");
    }


    /* =========================================
       APPEARANCE
       ========================================= */

    function syncThemeRadios() {

        var current = ui.theme.current();

        ui.$$("[data-theme-option]").forEach(function (r) {
            r.checked = r.dataset.themeOption === current;
        });
    }

    function bindThemeRadios() {

        ui.$$("[data-theme-option]").forEach(function (r) {
            r.addEventListener("change", function () {
                if (!r.checked) { return; }

                ui.theme.apply(r.dataset.themeOption);
                Store.settings.patch({ theme: r.dataset.themeOption });

                var session = Store.session.get();
                if (session && !session.guest) {
                    Store.users.update(session.email, { theme: r.dataset.themeOption });
                }

                ui.theme.syncButton();
            });
        });
    }


    /* =========================================
       DATA TOOLS
       ========================================= */

    function exportData() {

        var payload = Store.exportData();
        var blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json"
        });

        var url = URL.createObjectURL(blob);
        var a = el("a", {
            href: url,
            download: "smartstudy-backup-" + ui.todayISO() + ".json"
        });

        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

        ui.toast("Backup file downloaded 📦", "success");
    }

    function importData(event) {

        var input = event.target;
        var file = input.files && input.files[0];

        if (!file) { return; }

        var reader = new FileReader();

        reader.onload = function () {
            var payload;

            try {
                payload = JSON.parse(reader.result);
            } catch (e) {
                ui.toast("That file is not valid JSON", "error");
                return;
            }

            if (!Store.importData(payload)) {
                ui.toast("Unsupported backup file", "error");
                return;
            }

            ui.toast("Backup restored — reloading…", "success");

            setTimeout(function () { location.reload(); }, 900);
        };

        reader.readAsText(file);
        input.value = "";
    }

    function wipeData() {

        ui.confirmBox({
            title: "Erase all data?",
            message: "Every task, note, goal, session and plan on this device will be deleted. This cannot be undone.",
            confirmText: "Erase everything",
            danger: true
        }).then(function (ok) {

            if (!ok) { return; }

            Store.wipe();

            ui.toast("All data erased", "info");

            setTimeout(function () { location.href = "index.html"; }, 700);
        });
    }


    /* =========================================
       AI ASSISTANT
       ========================================= */

    function aiNodes() {
        return {
            card: doc.getElementById("aiCard"),
            form: doc.getElementById("aiForm"),
            provider: doc.getElementById("aiProvider"),
            providerNote: doc.getElementById("aiProviderNote"),
            model: doc.getElementById("aiModel"),
            modelList: doc.getElementById("aiModelList"),
            base: doc.getElementById("aiBase"),
            baseField: doc.getElementById("aiBaseField"),
            baseHint: doc.getElementById("aiBaseHint"),
            key: doc.getElementById("aiKey"),
            keyField: doc.getElementById("aiKeyField"),
            keyState: doc.getElementById("aiKeyState"),
            testBtn: doc.getElementById("aiTestBtn"),
            removeBtn: doc.getElementById("aiRemoveBtn")
        };
    }

    function renderAiProvider() {

        var ai = global.SS.ai;
        var n = aiNodes();

        if (!n.provider || !ai) { return; }

        var cfg = ai.config();
        var ids = Object.keys(ai.PROVIDERS);

        ui.clear(n.provider);

        ids.forEach(function (id) {
            n.provider.appendChild(
                el("option", { value: id, text: ai.PROVIDERS[id].label })
            );
        });

        n.provider.value = cfg.provider;
        syncAiProviderFields();
    }

    function syncAiProviderFields(resetModel) {

        var ai = global.SS.ai;
        var n = aiNodes();

        if (!n.provider || !ai) { return; }

        var provider = ai.PROVIDERS[n.provider.value] || ai.PROVIDERS.openai;
        var keyless = ai.providerNeedsKey(provider) === false;

        /* base URL only matters for the OpenAI-compatible shape */
        n.baseField.hidden = !provider.needsBase;
        n.base.placeholder = provider.defaultBase;
        n.baseHint.textContent = provider.blurb;

        /* a keyless provider hides the key box entirely - there is nothing
           to paste, and pretending otherwise would just confuse people */
        n.keyField.hidden = keyless;
        n.removeBtn.hidden = keyless;

        if (n.providerNote) {
            n.providerNote.textContent = keyless
                ? "⚠ Free and public: prompts and any attached notes are handled by a third-party server."
                : provider.blurb;
            n.providerNote.style.color = keyless ? "var(--warn)" : "";
        }

        ui.clear(n.modelList);
        provider.models.forEach(function (model) {
            n.modelList.appendChild(el("option", { value: model }));
        });

        n.model.placeholder = "Default: " + provider.defaultModel;
        n.key.placeholder = provider.keyHint;

        n.base.value = ai.config().baseUrl;

        /* Switching provider shows the new default. On first load the
           saved model is restored instead, so an existing setup survives. */
        n.model.value = resetModel ? "" : ai.config().model;
    }

    function renderAiKeyState() {

        var ai = global.SS.ai;
        var n = aiNodes();

        if (!n.keyState || !ai) { return; }

        /* judge by the form's selection, not the saved config, so the
           hint updates the instant the provider select moves */
        var provider = ai.PROVIDERS[n.provider.value] || ai.PROVIDERS.openai;
        var keyless = ai.providerNeedsKey(provider) === false;

        if (keyless) {
            n.keyState.textContent = "No key needed — this provider is completely free.";
            n.keyState.style.color = "var(--ok)";
        } else if (ai.config().key.trim()) {
            n.keyState.textContent = "Saved key: " + ai.maskKey(ai.config().key) +
                " — leave the field blank to keep it.";
            n.keyState.style.color = "var(--ok)";
        } else {
            n.keyState.textContent = "No key saved. The assistant runs in Study mode without one.";
            n.keyState.style.color = "";
        }

        n.key.value = "";
    }

    function saveAi(event) {

        event.preventDefault();

        var ai = global.SS.ai;
        var n = aiNodes();
        var typedKey = n.key.value.trim();

        var patch = {
            provider: n.provider.value,
            model: n.model.value.trim(),
            baseUrl: n.base.value.trim()
        };

        /* an empty box means "keep the key I already have",
           so a provider-only change never wipes the key */
        if (typedKey) {
            patch.key = typedKey;
        }

        ai.saveConfig(patch);

        renderAiKeyState();
        ui.toast(typedKey ? "AI key saved 🔐" : "AI settings saved", "success");
    }

    function testAi() {

        var ai = global.SS.ai;
        var n = aiNodes();

        if (!ai.hasKey() && !n.key.value.trim()) {
            ui.toast("Add an API key first", "warn");
            return;
        }

        /* use whatever is in the form, so the key can be tested
           before it is committed to storage */
        var typed = n.key.value.trim();

        if (typed) {
            ai.saveConfig({
                provider: n.provider.value,
                model: n.model.value.trim(),
                baseUrl: n.base.value.trim(),
                key: typed
            });
            renderAiKeyState();
        }

        n.testBtn.disabled = true;
        n.testBtn.textContent = "Testing…";

        ai.testConnection().then(function (result) {
            ui.toast("Connected to " + result.provider + " ✓", "success");
        }).catch(function (error) {
            ui.toast(String(error.message || error), "error");
        }).then(function () {
            n.testBtn.disabled = false;
            n.testBtn.textContent = "Test connection";
        });
    }

    function removeAiKey() {

        ui.confirmBox({
            title: "Remove API key?",
            message: "The assistant will fall back to Study mode (notes search, flashcards, summaries).",
            confirmText: "Remove key",
            danger: true
        }).then(function (ok) {

            if (!ok) { return; }

            global.SS.ai.clearKey();
            renderAiKeyState();
            ui.toast("API key removed", "info");
        });
    }

    function initAi() {

        var n = aiNodes();

        if (!n.form || !global.SS.ai) { return; }

        renderAiProvider();
        renderAiKeyState();

        n.form.addEventListener("submit", saveAi);
        n.provider.addEventListener("change", function () {
            syncAiProviderFields(true);
            renderAiKeyState();
        });
        n.testBtn.addEventListener("click", testAi);
        n.removeBtn.addEventListener("click", removeAiKey);
    }


    /* =========================================
       INIT
       ========================================= */

    function init() {

        if (!Auth.require()) { return; }

        renderProfile();
        renderFocusForm();
        syncThemeRadios();
        bindThemeRadios();
        initAi();

        var nameForm = doc.getElementById("profileForm");
        if (nameForm) { nameForm.addEventListener("submit", saveName); }

        var pwForm = doc.getElementById("passwordForm");
        if (pwForm) { pwForm.addEventListener("submit", changePassword); }

        var focusForm = doc.getElementById("focusForm");
        if (focusForm) { focusForm.addEventListener("submit", saveFocus); }

        var exportBtn = doc.getElementById("exportBtn");
        if (exportBtn) { exportBtn.addEventListener("click", exportData); }

        var importInput = doc.getElementById("importInput");
        if (importInput) { importInput.addEventListener("change", importData); }

        var wipeBtn = doc.getElementById("wipeBtn");
        if (wipeBtn) { wipeBtn.addEventListener("click", wipeData); }

        /* live strength meter */
        var newPw = doc.getElementById("newPassword");

        if (newPw) {
            var meter = doc.getElementById("pwMeter");
            var label = doc.getElementById("pwLabel");

            newPw.addEventListener("input", function () {
                var result = Auth.strength(newPw.value);

                if (meter) {
                    meter.style.width = (result.score / 4) * 100 + "%";
                    meter.style.background = result.color;
                }

                if (label) {
                    label.textContent = result.label;
                    label.style.color = result.color;
                }
            });
        }
    }


    global.SS = global.SS || {};
    global.SS.settings = { init: init };

    doc.addEventListener("DOMContentLoaded", init);


}(window));