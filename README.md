# 📚 Smart Study

**Organize. Focus. Achieve.**

Smart Study is a zero-configuration student productivity app — a website made of plain
HTML, CSS and vanilla JavaScript. There is no backend, no build step, no package manager
and no third-party scripts. Everything runs in the browser and every byte of your data
stays in that browser's `localStorage`, scoped per account.

---

## ✨ Features

| Area | What it does |
| --- | --- |
| **Dashboard** | Time-aware greeting, stats, dependency-free charts, today's tasks, goal snapshots, quick add |
| **Global search** | `Ctrl+K` (or `⌘K`) anywhere jumps to a matching task, note, goal, exam or study-plan slot — a box lives in every signed-in page's navbar |
| **Tasks** | Add / edit / delete with priorities, subject + status filters, search, smart grouping by due date, recurring tasks (daily / weekly), streaks |
| **Notes** | Full-text search, tags, pinning, autosaving editor, split list + detail layout |
| **Goals** | Category goals with progress tracking, quick stepper, deadlines and streaks |
| **Study Planner** | Weekly timetable, per-subject hour targets, exam countdowns |
| **Pomodoro** | Focus / short break / long break cycles, task linking, notifications, sound, and focus history that feeds the charts |
| **Study Assistant** | AI doubt-answering, grounded in *your own notes* — plus offline tools (notes search, flashcards, summaries, daily briefing) |
| **AI Quiz** | Subject-wise and chapter-wise practice quizzes — AI-written questions, or offline MCQs built from your own notes. Instant grading with explanations and a saved, per-subject history |
| **Analytics** | Charts built from pure CSS `conic-gradient` — zero chart libraries |
| **Settings** | Profile, appearance (light/dark), focus timer defaults, export/import backup, account wipe |
| **Themes & motion** | CSS token system with a dark mode toggle and a shared motion/micro-animation system |

### 🤖 Study Assistant — three modes

1. **Free mode (default, no key needed)** — asks a free public endpoint for text answers.
   Instant, but it is *public and rate-limited*: your question and any matching notes go to a
   third-party server. This trade-off is disclosed inside the app.
2. **AI mode** — bring your own API key from **OpenAI-compatible** services (OpenAI, Groq,
   OpenRouter, Ollama, …), **Anthropic** (Claude) or **Gemini**. Answers are grounded in your
   top matching notes; everything is streamed token-by-token.
3. **Study mode** — no model at all: the assistant searches your notes, builds flashcards,
   summarises topics and gives you a daily briefing. Fully offline.

### 🧠 AI Quiz Generator

The **Quiz** page turns a subject + chapter (+ optional topic) into a practice quiz.

- **With a provider** it asks the model for multiple-choice and true/false questions, grounded
  in any matching notes, and returns strict JSON that is parsed and validated before use.
- **Without one**, the "From my notes" button builds questions offline from definition-style
  note lines (`Term: definition`, `X is what…`), plus fill-in-the-blank fallbacks — no network.
- Every question is auto-graded; the score, correct answers and one-line explanations are shown,
  and each attempt is saved to a history grouped subject-wise and chapter-wise.
- **Your own subject shelf** — subjects are editable right on the Quiz page ("⚙️ Manage subjects"):
  add or delete any subject by hand; the list is saved per account and starts from a built-in set
  of your own subjects. "Reset to defaults" restores that built-in set at any time.

---

## 🛡️ Privacy & security

- **Client-side demo auth** — passwords are salted + hashed before storage, but this is
  **not real security**. A production deployment needs a real backend with server-side
  sessions. Treat the accounts as per-device profiles.
- **Per-user namespacing** — data is stored as `smartStudy:<email>:<collection>`, so two
  accounts on one browser never mix.
- **AI key handling** — the key is stored only in your browser, is sent only to the provider
  you pick, and is **never included in exports/backups**. Exports carry chat history and all
  study data, but never the key.
- **XSS-safe rendering** — user data (and AI markdown) is always rendered via `textContent`
  and DOM APIs, never `innerHTML`.

---

## 🧱 Tech stack

- 100% static: **HTML + CSS + vanilla JS**, no frameworks, no build step, no `<script src>` CDNs
- `localStorage` as the data store, with a thin namespaced wrapper and corrupt-data recovery
- Automatic one-time migration from the app's former `studySync:` key prefix
- CSS custom-property tokens for theme + motion; charts are CSS/SVG only
- Works from `file://` or any static host (a local server is recommended)

---

## 📁 Project structure

```
smart study/
├── index.html                  Landing page (login/signup, live hero stats)
├── login.html / signup.html    Demo auth pages
├── dashboard.html              Overview, analytics, quick add + pomodoro timer
├── tasks.html                  Task list with filters and search
├── notes.html                  Notes library + editor
├── goals.html                  Goal tracking
├── study-plan.html             Weekly timetable + exam countdowns + charts
├── settings.html               Profile, theme, backups, AI key
├── assistant.html              AI study assistant chat
├── quiz.html                   AI quiz generator (subject/chapter-wise, offline fallback)
├── preview.html                Dev-only visual wireframe map of every screen (noindex; safe to delete)
├── css/
│   ├── style.css               Design tokens, core components, motion
│   └── pages.css               Page-specific layouts
├── js/
│   ├── storage.js              Namespaced localStorage wrapper + export/import
│   ├── models.js               Shared CRUD layer for every collection
│   ├── ui.js                   DOM helpers, toasts, modals, theme, date utils
│   ├── auth.js                 Accounts, sessions, hashing, guest mode
│   ├── app.js                  Shared page chrome (navbar, guard, theme)
│   ├── ai.js                   AI engine: providers, streaming, retrieval, markdown
│   ├── assistant.js            Assistant page wiring (chat, quick actions)
│   ├── quiz.js                 AI quiz generator + offline question builder
│   ├── landing.js              Landing hero behaviour
│   ├── authpage.js             Login/signup form logic
│   ├── dashboard.js            Dashboard aggregation + stats
│   ├── tasks.js                Tasks page
│   ├── pomodoro.js             Focus timer + session log (shown on the dashboard)
│   ├── notes.js                Notes page
│   ├── goals.js                Goals page
│   ├── studyplan.js            Study plan page
│   ├── charts.js               Dependency-free chart helpers
│   └── settings.js             Settings page
└── archive/                    Old versions kept for reference (not loaded)
```

---

## ▶️ Running it

Open `index.html` directly in a browser, or serve the folder (recommended):

```bash
# any of these work
npx serve .
python -m http.server 8080
```

Visit `http://localhost:8080`, sign up (or continue as guest), and you're in.

---

## 💾 Data you own

- **Export / import** — full JSON backup of every collection (minus the AI key), restored
  through Settings. Great for moving between browsers.
- **Wipe** — clears all data for the signed-in account.

## 🔒 Known limits

- Accounts are local demo profiles — there is no cloud sync and no real server-side security.
- The free AI endpoint is public, rate-limited and may occasionally be slow or unavailable.
- All data is tied to one browser's `localStorage` — clear site data and it's gone unless exported.

---

Made with care for students. 📚