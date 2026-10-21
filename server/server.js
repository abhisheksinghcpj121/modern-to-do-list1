/* =========================================
   SMART STUDY - NODE SERVER
   One process serves the app AND its API:

     node server/server.js
     -> http://localhost:3000

   Zero npm dependencies: node:http for the
   server, node:sqlite for storage, node:crypto
   for passwords. No build step, same as the
   frontend.

   PORT env var changes the port.
   ========================================= */

"use strict";

var http = require("http");
var path = require("path");
var api = require("./api");
var db = require("./db");
var admin = require("./admin");
var statics = require("./static");

var PORT = Number(process.env.PORT) || 3000;
var ROOT = path.join(__dirname, "..");   /* the project folder itself */

/* housekeeping: drop sessions that passed their 30-day expiry while
   the server was not running */
var swept = db.deleteExpiredSessions();

var server = http.createServer(function (req, res) {

    var url;

    try {
        url = new URL(req.url, "http://localhost");
    } catch (e) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad request");
        return;
    }

    /* everything under /api goes to the API, the rest is the app.
       A thrown error anywhere in a handler must never take the whole
       server down - answer 500 and keep serving. */
    if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) {
        try {
            api.handle(req, res, url);
        } catch (err) {
            console.error("  API error on " + req.method + " " + url.pathname + ":", err && err.message);
            try {
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
                }
                res.end(JSON.stringify({ error: "Server error." }));
            } catch (e) { /* connection already gone */ }
        }
        return;
    }

    var pathname;

    try {
        pathname = decodeURIComponent(url.pathname);
    } catch (e) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad request");
        return;
    }

    try {
        statics.serve(ROOT, pathname, res);
    } catch (err) {
        console.error("  Static error on " + pathname + ":", err && err.message);
        try {
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            }
            res.end("Server error");
        } catch (e) { /* connection already gone */ }
    }
});

server.listen(PORT, function () {
    console.log("");
    console.log("  📚 Smart Study is running");
    console.log("     App : http://localhost:" + PORT);
    console.log("     API : http://localhost:" + PORT + "/api");
    console.log("     Data: server/data/smartstudy.db");
    console.log("     Sessions: 30-day TTL, " + Math.round(require("./auth").SESSION_IDLE_MS / 60000) + " min idle timeout");
    if (swept) { console.log("     Swept " + swept + " expired session(s)"); }
    console.log("");
    console.log("     Admin: http://localhost:" + PORT + "/admin.html");
    if (admin.keyFromEnv) {
        console.log("     Key : (from SMART_STUDY_ADMIN_KEY)");
    } else if (admin.keyFromFile) {
        console.log("     Key : " + admin.KEY);
        console.log("           (fixed in server/data/admin.key - same on every start)");
    } else {
        console.log("     Key : " + admin.KEY);
        console.log("           (random for this run - set SMART_STUDY_ADMIN_KEY to fix it)");
    }
    console.log("");
    console.log("  Press Ctrl+C to stop.");
    console.log("");
});

server.on("error", function (err) {
    if (err.code === "EADDRINUSE") {
        console.error("  Port " + PORT + " is busy. Try: PORT=3001 node server/server.js");
    } else {
        console.error("  Server error:", err.message);
    }
    process.exit(1);
});
