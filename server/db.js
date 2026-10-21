/* =========================================
   SMART STUDY - SERVER DATABASE
   Uses node:sqlite (built into Node 22.5+),
   so the backend needs ZERO npm packages.

   Tables
     users    - registered accounts
     sessions - bearer tokens (login sessions)
     data     - one JSON blob per user per collection
   ========================================= */

"use strict";

var fs = require("fs");
var path = require("path");
var sqlite = require("node:sqlite");
var Auth = require("./auth");

var DATA_DIR = path.join(__dirname, "data");
/* Tests point this at a throwaway file so a suite run never touches the
   real database (and can rely on being the only account on its server). */
var DB_FILE = process.env.SMART_STUDY_DB_FILE
    ? path.resolve(process.env.SMART_STUDY_DB_FILE)
    : path.join(DATA_DIR, "smartstudy.db");


/* ---------- open / migrate ---------- */

function open() {

    fs.mkdirSync(DATA_DIR, { recursive: true });

    var db = new sqlite.DatabaseSync(DB_FILE);

    /* Wait for a concurrent writer (e.g. a second server process, which
       the test suite spins up) instead of throwing "database is locked"
       the instant another connection holds the file. Without this a
       single busy write crashed the whole server. */
    db.exec("PRAGMA busy_timeout = 5000");

    db.exec(
        "CREATE TABLE IF NOT EXISTS users (" +
        "  email    TEXT PRIMARY KEY," +
        "  name     TEXT NOT NULL," +
        "  salt     TEXT NOT NULL," +
        "  hash     TEXT NOT NULL," +
        "  theme    TEXT NOT NULL DEFAULT 'light'," +
        "  joinedAt INTEGER NOT NULL" +
        ");" +
        "CREATE TABLE IF NOT EXISTS sessions (" +
        "  token     TEXT PRIMARY KEY," +
        "  email     TEXT NOT NULL," +
        "  createdAt INTEGER NOT NULL," +
        "  expiresAt INTEGER NOT NULL," +
        "  lastSeen  INTEGER NOT NULL DEFAULT 0" +
        ");" +
        "CREATE TABLE IF NOT EXISTS data (" +
        "  email      TEXT NOT NULL," +
        "  collection TEXT NOT NULL," +
        "  value      TEXT NOT NULL," +
        "  updatedAt  INTEGER NOT NULL," +
        "  PRIMARY KEY (email, collection)" +
        ");"
    );

    /* databases made before idle sessions existed: add the column.
       lastSeen = 0 means "never seen since the upgrade" and is
       treated as now by findSession, so nobody is logged out by
       the migration itself. */
    try {
        db.exec("ALTER TABLE sessions ADD COLUMN lastSeen INTEGER NOT NULL DEFAULT 0");
    } catch (e) {
        /* column already there - fine */
    }

    return db;
}

var db = open();

/* Keep disk writes sane: at most one lastSeen update per session per
   window. Never more than a quarter of the idle window, so the stored
   lastSeen is always fresh enough to judge liveness against it. */
var TOUCH_EVERY_MS = Math.min(60 * 1000, Math.floor(Auth.SESSION_IDLE_MS / 4));


/* ---------- users ---------- */

function findUser(email) {
    return db.prepare("SELECT * FROM users WHERE email = ?").get(email) || null;
}

/* The oldest account on the server. Created first = the owner = the
   admin, so the admin console can be opened with that Gmail + password.
   Ordered by insertion order (rowid), not joinedAt: accounts created in
   the same millisecond - which the test suite and demo seeding do - can
   share a joinedAt, and only rowid is truly the insert order. */
function firstUser() {
    return db.prepare(
        "SELECT * FROM users ORDER BY rowid ASC LIMIT 1"
    ).get() || null;
}

function createUser(user) {
    db.prepare(
        "INSERT INTO users (email, name, salt, hash, theme, joinedAt) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(user.email, user.name, user.salt, user.hash, user.theme || "light", user.joinedAt);

    return findUser(user.email);
}

function updateUser(email, patch) {

    var user = findUser(email);
    if (!user) { return null; }

    var merged = Object.assign({}, user, patch);

    db.prepare("UPDATE users SET name = ?, theme = ?, salt = ?, hash = ? WHERE email = ?")
        .run(merged.name, merged.theme, merged.salt, merged.hash, email);

    return findUser(email);
}


/* ---------- sessions ---------- */

function createSession(token, email, ttlMs) {
    var now = Date.now();

    db.prepare(
        "INSERT INTO sessions (token, email, createdAt, expiresAt, lastSeen) VALUES (?, ?, ?, ?, ?)"
    ).run(token, email, now, now + ttlMs, now);

    return token;
}

function findSession(token) {

    var row = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
    if (!row) { return null; }

    var now = Date.now();

    /* absolute expiry: 30 days after login */
    if (row.expiresAt < now) {
        deleteSession(token);
        return null;
    }

    /* idle expiry: nobody has used this session for a while, so the
       server has let it go even though the token looks fine. Rows
       from before lastSeen existed (0) count as fresh. */
    if (row.lastSeen > 0 && now - row.lastSeen > Auth.SESSION_IDLE_MS) {
        deleteSession(token);
        return null;
    }

    return row;
}

/* Marks a session as used. Throttled (see TOUCH_EVERY_MS) so a busy
   client does not hit the disk on every request. */
function touchSession(token) {

    var now = Date.now();

    db.prepare(
        "UPDATE sessions SET lastSeen = ? WHERE token = ? AND (lastSeen = 0 OR lastSeen < ?)"
    ).run(now, token, now - TOUCH_EVERY_MS);
}

/* Housekeeping: drop sessions past their absolute expiry. Called on
   boot so an idle server does not accumulate dead rows forever. */
function deleteExpiredSessions() {
    var info = db.prepare("DELETE FROM sessions WHERE expiresAt < ?").run(Date.now());
    return Number(info.changes) || 0;
}

function countSessions(email) {
    var row = email
        ? db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE email = ? AND expiresAt >= ?").get(email, Date.now())
        : db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE expiresAt >= ?").get(Date.now());
    return row ? row.n : 0;
}

function deleteSession(token) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function deleteSessionsFor(email) {
    db.prepare("DELETE FROM sessions WHERE email = ?").run(email);
}


/* ---------- per-user collections ---------- */

function getAllData(email) {

    var rows = db.prepare("SELECT collection, value FROM data WHERE email = ?").all(email);
    var out = {};

    rows.forEach(function (row) {
        try {
            out[row.collection] = JSON.parse(row.value);
        } catch (e) {
            /* corrupt blob - skip rather than break the whole sync */
        }
    });

    return out;
}

function setData(email, collection, value) {

    db.prepare(
        "INSERT INTO data (email, collection, value, updatedAt) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(email, collection) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt"
    ).run(email, collection, JSON.stringify(value), Date.now());
}

function wipeData(email) {
    db.prepare("DELETE FROM data WHERE email = ?").run(email);
}


/* ---------- admin ---------- */

/* One pass over the whole database for the admin dashboard. */
function adminStats() {

    var now = Date.now();

    var row = db.prepare(
        "SELECT" +
        "  (SELECT COUNT(*) FROM users) AS users," +
        "  (SELECT COUNT(*) FROM sessions WHERE expiresAt >= ?) AS sessions," +
        "  (SELECT COUNT(*) FROM data) AS collections," +
        "  (SELECT COALESCE(SUM(LENGTH(value)), 0) FROM data) AS bytes"
    ).get(now);

    var fileBytes = 0;
    try { fileBytes = fs.statSync(DB_FILE).size; } catch (e) { /* not created yet */ }

    return {
        users: row.users || 0,
        sessions: row.sessions || 0,
        collections: row.collections || 0,
        bytes: row.bytes || 0,
        fileBytes: fileBytes
    };
}

/* Every account with its footprint: how many collections, how many
   bytes, how many live sessions, and when it was last touched. */
function listUsers() {

    var now = Date.now();

    return db.prepare(
        "SELECT u.email, u.name, u.theme, u.joinedAt," +
        "  (SELECT COUNT(*) FROM data d WHERE d.email = u.email) AS collections," +
        "  (SELECT COALESCE(SUM(LENGTH(d.value)), 0) FROM data d WHERE d.email = u.email) AS bytes," +
        "  (SELECT COALESCE(MAX(d.updatedAt), 0) FROM data d WHERE d.email = u.email) AS lastActive," +
        "  (SELECT COUNT(*) FROM sessions s WHERE s.email = u.email AND s.expiresAt >= ?) AS sessions" +
        " FROM users u ORDER BY u.joinedAt DESC"
    ).all(now);
}

/* Per-collection breakdown for one account (admin detail view). */
function dataOverview(email) {

    return db.prepare(
        "SELECT collection, LENGTH(value) AS bytes, updatedAt" +
        " FROM data WHERE email = ? ORDER BY collection"
    ).all(email);
}

/* Removes an account and everything tied to it: sessions + data. */
function deleteAccount(email) {

    var gone = Boolean(findUser(email));

    db.prepare("DELETE FROM users WHERE email = ?").run(email);
    db.prepare("DELETE FROM sessions WHERE email = ?").run(email);
    db.prepare("DELETE FROM data WHERE email = ?").run(email);

    return gone;
}


module.exports = {
    findUser: findUser,
    firstUser: firstUser,
    createUser: createUser,
    updateUser: updateUser,
    createSession: createSession,
    findSession: findSession,
    touchSession: touchSession,
    deleteExpiredSessions: deleteExpiredSessions,
    countSessions: countSessions,
    deleteSession: deleteSession,
    deleteSessionsFor: deleteSessionsFor,
    getAllData: getAllData,
    setData: setData,
    wipeData: wipeData,
    adminStats: adminStats,
    listUsers: listUsers,
    dataOverview: dataOverview,
    deleteAccount: deleteAccount
};
