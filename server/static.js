/* =========================================
   SMART STUDY - STATIC FILE SERVER
   Serves the app itself (the HTML/CSS/JS in
   the project root) from the same process
   as the API, so there is no CORS to fight
   when the app runs at http://localhost:3000.
   ========================================= */

"use strict";

var fs = require("fs");
var path = require("path");

var MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
};

/* folders that must never be reachable over HTTP */
var BLOCKED = ["server", "node_modules", ".git", "archive"];

function send(res, status, type, body, extraHeaders) {

    var headers = Object.assign(
        {
            "Content-Type": type,
            "Content-Length": Buffer.byteLength(body),
            "X-Content-Type-Options": "nosniff"
        },
        extraHeaders || {}
    );

    res.writeHead(status, headers);
    res.end(body);
}

function serve(root, pathname, res) {

    /* normalise and refuse anything that escapes the root or hits a
       blocked folder - "..%2f" style tricks die here */
    var clean = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    var target = path.join(root, clean);

    if (target.indexOf(root) !== 0) {
        send(res, 403, "text/plain; charset=utf-8", "Forbidden");
        return;
    }

    var rel = path.relative(root, target);

    if (BLOCKED.some(function (dir) {
        return rel === dir || rel.indexOf(dir + path.sep) === 0;
    })) {
        send(res, 404, "text/plain; charset=utf-8", "Not found");
        return;
    }

    if (pathname === "/" || pathname === "") {
        target = path.join(root, "index.html");
    }

    fs.stat(target, function (err, stat) {

        if (err || !stat.isFile()) {
            send(res, 404, "text/plain; charset=utf-8", "Not found");
            return;
        }

        var ext = path.extname(target).toLowerCase();
        var type = MIME[ext] || "application/octet-stream";

        /* html, css and js are always revalidated, so a fixed script can
           never linger in a browser cache; images and fonts can sit in
           cache briefly */
        var cache = (ext === ".html" || ext === ".js" || ext === ".css")
            ? "no-cache"
            : "public, max-age=300";

        fs.readFile(target, function (readErr, data) {
            if (readErr) {
                send(res, 500, "text/plain; charset=utf-8", "Server error");
                return;
            }

            send(res, 200, type, data, { "Cache-Control": cache });
        });
    });
}


module.exports = { serve: serve };
