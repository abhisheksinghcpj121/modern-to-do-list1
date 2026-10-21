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
| **Node backend** | Real accounts (scrypt-hashed passwords + bearer-token sessions), per-user data sync over a small REST API, and static hosting — all with **zero npm dependencies** |
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
- **One shared subject shelf** — you start with your own built-in subjects (DBMS, Web Technology,
  DAA, Compiler Design, Application of Soft Computing, Constitution of India, Computer Graphics,
  Image Processing). The *same* shelf feeds the Study Plan hour targets, the weekly timetable
  dropdown, the Tasks subject dropdown and the Quiz page, so a subject is added exactly once and
  shows up everywhere. Edit it anywhere ("⚙️ Manage subjects" on Quiz, "⋯ Manage subjects" on
  Study Plan); "Reset to defaults" restores the built-in set at any time.

---

## 🛡️ Privacy & security

- **Server accounts** — with the Node backend running, signup/login create a real account on
  the server: passwords are hashed with `scrypt` + a per-user salt, sessions are random bearer
  tokens with a **30-day lifetime and a 30-minute idle window** (leave the tab alone for half
  an hour — or log out from another device — and this one steps down to the login screen).
  Still demo-grade: there is no HTTPS or rate limiting, so run it on localhost/LAN, not on
  the open internet.
- **Works offline too** — if the server is unreachable (or you opened the files over `file://`),
  the old local-only accounts kick in automatically and nothing breaks; sync resumes at the
  next login.
- **Per-user namespacing** — data is stored as `smartStudy:<email>:<collection>`, so two
  accounts on one browser never mix.
- **AI key handling** — the key is stored only in your browser, is sent only to the provider
  you pick, and is **never included in exports/backups or server sync**. Exports carry chat
  history and all study data, but never the key.
- **XSS-safe rendering** — user data (and AI markdown) is always rendered via `textContent`
  and DOM APIs, never `innerHTML`. The static server refuses to serve its own `server/`
  folder and blocks path traversal.

---

## 🖥️ Backend (Node, zero dependencies)

One process serves the whole app — the static site *and* its API — using only Node built-ins
(`node:http`, `node:sqlite`, `node:crypto`). No `npm install` needed.

```bash
node server/server.js          # or: npm start
# App : http://localhost:3000
# API : http://localhost:3000/api
# Data: server/data/smartstudy.db   (SQLite, created on first run)
```

| Method | Route | What it does |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create an account → `{token, user}` |
| `POST` | `/api/auth/login` | Verify + start a session → `{token, user}` |
| `POST` | `/api/auth/logout` | End the current session |
| `GET` | `/api/auth/me` | The signed-in user |
| `PATCH` | `/api/auth/me` | Update name, theme, or password (`{current, next}`) |
| `GET` | `/api/data` | Every collection for the signed-in user |
| `PUT` | `/api/data/:name` | Replace one collection (tasks, notes, …) |
| `DELETE` | `/api/data` | Wipe every collection (Settings → Erase all data) |

**Sessions** are real server-side sessions, not just tokens that live forever: each has a
30-day absolute lifetime *and* a 30-minute idle window (`lastSeen` is refreshed by the tab's
once-a-minute heartbeat and every write). An expired or idle session returns `401` and the
app quietly offers the login screen. The TTL and idle window can be tuned with
`SMART_STUDY_SESSION_IDLE_MS`.

**Admin console** — `http://localhost:3000/admin.html` shows every account, its storage
footprint, live sessions and last activity, and lets the operator reset a password, delete
an account (with its sessions and data), or sweep expired sessions. It is protected by an
**admin key**, not a user login: the key lives in `server/data/admin.key`, written on the
first boot and printed in the server console on every start, so it stays the same forever.
`SMART_STUDY_ADMIN_KEY` overrides it when set. The key is
sent as the `x-admin-key` header and checked in constant time; it lives in the browser tab's
`sessionStorage` only (Lock forgets it).

| Method | Route | What it does |
| --- | --- | --- |
| `GET` | `/api/admin/stats` | Accounts, live sessions, stored bytes, uptime |
| `GET` | `/api/admin/users` | Every account with its footprint |
| `GET` | `/api/admin/users/:email` | One account: collections, sizes, sessions |
| `POST` | `/api/admin/users/:email/password` | Reset a password (signs out every device) |
| `DELETE` | `/api/admin/users/:email` | Delete an account + all of its server data |
| `POST` | `/api/admin/cleanup` | Sweep expired sessions |

**How the frontend uses it** — `localStorage` stays the source of truth the pages read, so
every page keeps its synchronous Store API. Writes are mirrored to the server in the
background (~0.4 s after you stop typing), and a pull on login/page start brings in anything
saved on another tab or device (the page reloads once if it was behind). Guests never touch
the server.

**Tests** — `node server/test.js` (with the server running) exercises the whole stack: API,
static serving, path traversal, and the real `storage.js` + `auth.js` running against a live
server from a fake browser sandbox.

---

## 🧱 Tech stack

- Frontend: **HTML + CSS + vanilla JS** — no frameworks, no build step, no `<script src>` CDNs
- Backend: **plain Node** (`node:http` + `node:sqlite` + `node:crypto`) — no npm packages at all
- `localStorage` as the offline-first data store, with a thin namespaced wrapper, corrupt-data
  recovery and background sync to the server
- Automatic one-time migration from the app's former `studySync:` key prefix
- CSS custom-property tokens for theme + motion; charts are CSS/SVG only
- Runs from `http://localhost:3000` (recommended) or straight from `file://` with no sync
- Static preview works too: a VS Code **Live Server** (or any other port) page still reaches the
  backend on `http://localhost:3000`, so accounts, sync, the admin console and the AI assistant
  keep working — just start `node server/server.js` alongside it. Nothing to configure.

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
├── admin.html                  Server admin console (accounts, sessions, cleanup)
├── package.json                Scripts only (start / test) - no dependencies
├── server/
│   ├── server.js               Entry point: static files + API on one port
│   ├── api.js                  REST routes (auth + data sync + admin mount)
│   ├── admin.js                Admin API (key-protected ops routes)
│   ├── auth.js                 scrypt hashing, bearer tokens, session policy
│   ├── db.js                   node:sqlite tables (users, sessions, data)
│   ├── static.js               Static file serving (MIME, traversal guard)
│   ├── test.js                 64-check end-to-end test suite
│   └── data/                   SQLite file lives here (created on first run)
├── css/
│   ├── style.css               Design tokens, core components, motion
│   ├── pages.css               Page-specific layouts
│   └── dashboard-premium.css   Premium dashboard layout (loaded by dashboard.html)
├── js/
│   ├── storage.js              Namespaced localStorage wrapper + export/import + server sync
│   ├── models.js               Shared CRUD layer for every collection
│   ├── ui.js                   DOM helpers, toasts, modals, theme, date utils
│   ├── auth.js                 Accounts, sessions, hashing, guest mode
│   ├── app.js                  Shared page chrome (navbar, guard, theme)
│   ├── ai.js                   AI engine: providers, streaming, retrieval, markdown
│   ├── assistant.js            Assistant page wiring (chat, quick actions)
│   ├── quiz.js                 AI quiz generator + offline question builder
│   ├── admin.js                Admin console page logic
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
```

---

## ▶️ Running it

**Recommended — with the backend** (accounts + sync across tabs/devices):

```bash
node server/server.js        # or: npm start
```

Visit `http://localhost:3000`, sign up (or continue as guest), and you're in.
Everything is stored in `server/data/smartstudy.db`.

**No-backend mode** still works exactly as before — open `index.html` directly or serve the
folder with anything (`python -m http.server 8080`, `npx serve .`). Accounts then live only
in that browser's `localStorage`, and the app quietly falls back to them whenever the server
is unreachable.

---

## 💾 Data you own

- **Export / import** — full JSON backup of every collection (minus the AI key), restored
  through Settings. Great for moving between browsers.
- **Wipe** — clears all data for the signed-in account.

## 🔒 Known limits

- The free AI endpoint is public, rate-limited and may occasionally be slow or unavailable.
- No HTTPS or rate limiting on the Node server — run it on localhost/LAN, put a reverse
  proxy (Caddy/nginx) in front before exposing it to the internet.
- Passwords are hashed with scrypt, but sessions are plain bearer tokens in a local SQLite
  file — fine for a class project, not for production.
- Sync is last-write-wins per collection: two devices editing the *same* collection
  simultaneously keep whichever write lands last (each collection syncs as a whole).
- Clearing `localStorage` or deleting `server/data/` loses data unless you exported a backup.

---

Made with care for students. 📚