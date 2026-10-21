/* =========================================
   SMART STUDY - SERVER AUTH HELPERS
   Passwords: scrypt (node:crypto) with a
   per-user salt. Tokens: 32 random bytes.

   NOTE: this is still a classroom-grade
   setup (no HTTPS, no rate limiting) - fine
   on a LAN or localhost, not for the real
   internet without a reverse proxy.
   ========================================= */

"use strict";

var crypto = require("crypto");

var SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;   /* 30 days absolute */
/* A session also dies after this much inactivity - a real server-side
   session, not just a token that lives forever. Overridable for tests. */
var SESSION_IDLE_MS = Number(process.env.SMART_STUDY_SESSION_IDLE_MS) || 1000 * 60 * 30;
var KEY_LEN = 64;

function makeSalt() {
    return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
    /* deterministic: same (password, salt) always gives the same hash,
       which is what "verify" needs. scryptSync keeps the API simple. */
    return crypto
        .scryptSync(String(password), String(salt), KEY_LEN)
        .toString("hex");
}

function verifyPassword(password, user) {
    var given = hashPassword(password, user.salt);
    var stored = String(user.hash);

    /* constant-time compare so the check itself leaks nothing */
    return given.length === stored.length &&
        crypto.timingSafeEqual(Buffer.from(given), Buffer.from(stored));
}

function makeToken() {
    return crypto.randomBytes(32).toString("hex");
}


module.exports = {
    SESSION_TTL_MS: SESSION_TTL_MS,
    SESSION_IDLE_MS: SESSION_IDLE_MS,
    makeSalt: makeSalt,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    makeToken: makeToken
};
