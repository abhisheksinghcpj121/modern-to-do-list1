/* =========================================
   SMART STUDY - CHARTS
   Tiny dependency free chart helpers built
   with CSS + conic-gradient.
   ========================================= */

(function (global) {

    "use strict";

    var doc = global.document;
    var ui = global.SS.ui;
    var el = ui.el;


    /* =========================================
       BAR CHART
       ========================================= */

    function bar(host, data, options) {

        if (!host) { return; }

        var opts = options || {};
        var max = data.reduce(function (m, d) {
            return Math.max(m, Number(d.value) || 0);
        }, 0);

        /* keep bars visible when everything is zero */
        var scale = max > 0 ? max : 1;

        ui.clear(host);

        data.forEach(function (d) {

            var value = Number(d.value) || 0;
            var color = d.color;
            var pct = value > 0 ? Math.max((value / scale) * 100, 4) : 4;

            var barStyle = { height: pct + "%" };

            if (color) {
                barStyle.background = color;
            }

            var barNode = el("div", {
                class: "bar" + (value === 0 ? " zero" : ""),
                title: (d.full || d.label) + " — " + (opts.format ? opts.format(value) : value),
                style: barStyle
            });

            if (opts.showValues && value > 0) {
                barNode.appendChild(
                    el("span", { class: "bar-val", text: opts.format ? opts.format(value) : String(value) })
                );
            }

            host.appendChild(
                el("div", { class: "bar-wrap" }, [
                    barNode,
                    el("small", { text: d.label })
                ])
            );
        });
    }


    /* =========================================
       DONUT CHART
       ========================================= */

    function donut(host, segments, center) {

        if (!host) { return; }

        var total = segments.reduce(function (s, x) {
            return s + (Number(x.value) || 0);
        }, 0);

        var stops = [];
        var acc = 0;

        segments.forEach(function (s) {
            var value = Number(s.value) || 0;
            var from = total ? (acc / total) * 360 : 0;

            acc += value;

            var to = total ? (acc / total) * 360 : 0;

            stops.push(s.color + " " + from.toFixed(2) + "deg " + to.toFixed(2) + "deg");
        });

        ui.clear(host);

        var ring = el("div", {
            class: "donut",
            style: {
                background: total
                    ? "conic-gradient(" + stops.join(",") + ")"
                    : "var(--surface-3)"
            }
        }, [
            el("div", { class: "label" }, [
                el("strong", { text: center ? center.value : String(total) }),
                el("small", { text: center ? center.label : "total" })
            ])
        ]);

        host.appendChild(ring);

        var legend = el("div", { class: "donut-legend" });

        segments.forEach(function (s) {
            legend.appendChild(
                el("div", {}, [
                    el("i", { style: { background: s.color } }),
                    el("span", { text: s.label }),
                    el("strong", { text: String(s.value) })
                ])
            );
        });

        host.appendChild(legend);
    }


    /* =========================================
       ACTIVITY HEATMAP
       ========================================= */

    function heatmap(host, days, goalMinutes) {

        if (!host) { return; }

        ui.clear(host);

        var goal = Number(goalMinutes) || 120;

        days.forEach(function (d) {
            var m = Number(d.minutes) || 0;
            var ratio = m / goal;
            var level = 0;

            if (m > 0) { level = 1; }
            if (ratio >= 0.5) { level = 2; }
            if (ratio >= 1) { level = 3; }
            if (ratio >= 1.6) { level = 4; }

            host.appendChild(
                el("div", {
                    class: "heat-cell",
                    dataset: { lv: String(level) },
                    title: ui.fmtDateLong(d.date) + " — " + ui.fmtMinutes(m)
                })
            );
        });
    }


    /* =========================================
       GOAL SUBJECT BARS
       ========================================= */

    function subjectBars(host, rows) {

        if (!host) { return; }

        ui.clear(host);

        if (!rows.length) {
            host.appendChild(
                el("p", {
                    class: "text-muted text-sm",
                    style: { padding: "10px 0" },
                    text: "Add subjects from the Study Plan page to track hours here."
                })
            );
            return;
        }

        rows.forEach(function (r) {
            var pct = r.target ? Math.min(100, (r.done / r.target) * 100) : 0;

            host.appendChild(
                el("div", { class: "subject-row" }, [
                    el("i", { class: "subject-dot", style: { background: r.color } }),
                    el("span", { class: "name", text: r.name }),
                    el("div", { class: "progress-bar" }, [
                        el("div", {
                            class: "progress-fill" + (pct >= 100 ? " ok" : ""),
                            style: { width: pct + "%" }
                        })
                    ]),
                    el("span", {
                        class: "hrs",
                        text: ui.fmtMinutes(r.done) + " / " + r.target + "h"
                    })
                ])
            );
        });
    }


    /* =========================================
   TREND LINE  (SVG)
   Focus minutes over the last N days.
   ========================================= */

    function line(host, data, options) {

        if (!host) { return; }

        var opts = options || {};
        /* Pixel space, scaled uniformly by the viewBox. Stretching a
           flattened viewBox to full width would squash the dots into
           ellipses, so the aspect ratio is left intact instead. */
        var W = 700;
        var H = 190;
        var padX = 8;
        var padTop = 16;
        var padBottom = 16;

        var values = data.map(function (d) { return Number(d.value) || 0; });
        var max = values.reduce(function (m, v) { return Math.max(m, v); }, 0);
        var sum = values.reduce(function (a, v) { return a + v; }, 0);

        /* round the top of the scale up so the peak is not glued to the top */
        var scale = max > 0 ? Math.ceil(max / 30) * 30 : 30;

        var n = data.length;

        ui.clear(host);

        if (!n) {
            host.appendChild(el("p", {
                class: "text-muted text-sm",
                text: "No data yet."
            }));
            return;
        }

        var spanX = W - padX * 2;
        var spanY = H - padTop - padBottom;

        function xAt(i) {
            return padX + (n > 1 ? (i * spanX) / (n - 1) : spanX / 2);
        }
        function yAt(v) {
            return padTop + (1 - (Number(v) || 0) / scale) * spanY;
        }

        var points = data.map(function (d, i) {
            return xAt(i).toFixed(2) + "," + yAt(d.value).toFixed(2);
        }).join(" ");

        var baseline = H - padBottom;

        var area = "M" + xAt(0).toFixed(2) + "," + baseline +
            " L" + points.split(" ").join(" L") +
            " L" + xAt(n - 1).toFixed(2) + "," + baseline + " Z";

        var gradientId = "trendFill";

        var children = [
            ui.svg("defs", {}, [
                ui.svg("linearGradient", {
                    id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1"
                }, [
                    ui.svg("stop", { offset: "0%", "stop-color": "var(--brand)", "stop-opacity": "0.35" }),
                    ui.svg("stop", { offset: "100%", "stop-color": "var(--brand)", "stop-opacity": "0" })
                ])
            ]),
            ui.svg("line", {
                x1: padX, y1: baseline, x2: W - padX, y2: baseline,
                class: "trend-axis"
            }),
            ui.svg("path", { d: area, fill: "url(#" + gradientId + ")", stroke: "none" }),
            ui.svg("polyline", {
                points: points, fill: "none", class: "trend-line"
            })
        ];

        data.forEach(function (d, i) {
            children.push(
                ui.svg("circle", {
                    cx: xAt(i).toFixed(2),
                    cy: yAt(d.value).toFixed(2),
                    r: n > 14 ? 3 : 4.5,
                    class: "trend-dot" + (d.value > 0 ? " on" : ""),
                    title: (d.full || d.label) + " — " +
                        (opts.format ? opts.format(d.value) : d.value)
                })
            );
        });

        host.appendChild(
            ui.svg("svg", {
                viewBox: "0 0 " + W + " " + H,
                class: "trend-svg",
                role: "img",
                "aria-label": opts.label || "Trend"
            }, children)
        );

        /* axis captions sit outside the SVG so they stay legible */
        var axis = el("div", { class: "trend-axis-labels" });

        var step = Math.ceil(n / 7);

        data.forEach(function (d, i) {
            if (i % step !== 0 && i !== n - 1) { return; }

            axis.appendChild(el("small", { text: d.label }));
        });

        host.appendChild(axis);

        if (max > 0) {
            var fmt = opts.format || function (v) { return String(v); };

            host.appendChild(
                el("p", {
                    class: "text-muted text-sm trend-note",
                    text: "Best day " + fmt(max) +
                        " · daily average " + fmt(Math.round(sum / n))
                })
            );
        }
    }


    /* =========================================
       BEST HOURS HEATMAP
       24 hourly buckets - reveals when the
       student actually concentrates.
       ========================================= */

    function hourHeat(host, buckets) {

        if (!host) { return; }

        var max = buckets.reduce(function (m, b) {
            return Math.max(m, Number(b.minutes) || 0);
        }, 0);

        ui.clear(host);

        buckets.forEach(function (b) {

            var m = Number(b.minutes) || 0;
            var ratio = max ? m / max : 0;
            var level = 0;

            if (m > 0) { level = 1; }
            if (ratio >= 0.25) { level = 2; }
            if (ratio >= 0.5) { level = 3; }
            if (ratio >= 0.8) { level = 4; }

            var label = (b.hour < 10 ? "0" : "") + b.hour + ":00";

            host.appendChild(
                el("div", {
                    class: "hour-cell",
                    dataset: { lv: String(level) },
                    title: label + " — " + ui.fmtMinutes(m)
                }, [
                    el("small", { text: String(b.hour) })
                ])
            );
        });
    }


    /* =========================================
       SUBJECT FOCUS SPLIT
       Where the logged focus time actually went.
       ========================================= */

    function subjectSplit(host, rows) {

        if (!host) { return; }

        ui.clear(host);

        if (!rows.length) {
            host.appendChild(
                el("p", {
                    class: "text-muted text-sm",
                    style: { padding: "10px 0" },
                    text: "Finish a focus session and it will show up here."
                })
            );
            return;
        }

        var total = rows.reduce(function (s, r) {
            return s + (Number(r.minutes) || 0);
        }, 0);

        rows.forEach(function (r) {

            var pct = total ? ((Number(r.minutes) || 0) / total) * 100 : 0;
            var color = ui.subjectColor(r.name);

            host.appendChild(
                el("div", { class: "split-row" }, [
                    el("i", { class: "subject-dot", style: { background: color } }),
                    el("span", { class: "name", text: r.name }),
                    el("div", { class: "split-track" }, [
                        el("div", {
                            class: "split-fill",
                            style: { width: pct.toFixed(1) + "%", background: color }
                        })
                    ]),
                    el("span", { class: "hrs", text: ui.fmtMinutes(r.minutes) }),
                    el("span", { class: "pct", text: Math.round(pct) + "%" })
                ])
            );
        });
    }


    global.SS = global.SS || {};
    global.SS.charts = {
        bar: bar,
        donut: donut,
        heatmap: heatmap,
        subjectBars: subjectBars,
        line: line,
        hourHeat: hourHeat,
        subjectSplit: subjectSplit
    };


}(window));