/* =====================================================================
   Skool Community Copilot — dashboard charts (vanilla SVG)
   ---------------------------------------------------------------------
   Two forms, chosen for the data's job:
     - engagement over time  -> single-series line with hover crosshair
     - pillar balance        -> horizontal bars (actual %) vs target tick
   Single hue for the single measure; ink/grid/text come from CSS custom
   properties so light/dark both use their validated palette steps.
   ===================================================================== */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  function css(el, name) {
    return getComputedStyle(el).getPropertyValue(name).trim();
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function makeTooltip(container) {
    var tip = container.querySelector(".sc-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "sc-tooltip";
      container.appendChild(tip);
    }
    return tip;
  }

  function fmtWeek(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  /* -------------------- engagement line chart ---------------------- */
  // points: [{weekStart, avgEngagement, posts}]
  function lineChart(container, points) {
    clear(container);
    container.classList.add("sc-chart");
    var W = Math.max(container.clientWidth || 320, 280);
    var H = 180;
    var pad = { t: 14, r: 12, b: 26, l: 34 };

    var series = css(container, "--series-1") || "#2a78d6";
    var grid = css(container, "--line") || "#e1e0d9";
    var axis = css(container, "--baseline") || "#c3c2b7";
    var muted = css(container, "--muted") || "#898781";

    var svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + H,
      width: "100%",
      height: H,
      role: "img",
      "aria-label": "Average engagement per post by week",
    });

    var maxY = Math.max.apply(null, points.map(function (p) { return p.avgEngagement; }).concat([1]));
    maxY = Math.ceil(maxY * 1.15);

    var x = function (i) {
      return pad.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
    };
    var y = function (v) {
      return pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
    };

    // hairline grid: 3 horizontal lines + y labels
    for (var g = 0; g <= 3; g++) {
      var gv = (maxY / 3) * g;
      var gy = y(gv);
      svg.appendChild(svgEl("line", {
        x1: pad.l, x2: W - pad.r, y1: gy, y2: gy,
        stroke: g === 0 ? axis : grid, "stroke-width": 1,
      }));
      var lbl = svgEl("text", {
        x: pad.l - 6, y: gy + 3, "text-anchor": "end",
        "font-size": 10, fill: muted,
      });
      lbl.textContent = String(Math.round(gv));
      svg.appendChild(lbl);
    }

    // x labels: first / middle / last week
    [0, Math.floor((points.length - 1) / 2), points.length - 1].forEach(function (i, idx, arr) {
      if (i < 0 || (idx > 0 && i === arr[idx - 1])) return;
      var t = svgEl("text", {
        x: x(i), y: H - 8, "text-anchor": "middle", "font-size": 10, fill: muted,
      });
      t.textContent = fmtWeek(points[i].weekStart);
      svg.appendChild(t);
    });

    // the line (2px, rounded joins) + point markers
    var d = points.map(function (p, i) {
      return (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(p.avgEngagement).toFixed(1);
    }).join(" ");
    svg.appendChild(svgEl("path", {
      d: d, fill: "none", stroke: series, "stroke-width": 2,
      "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
    points.forEach(function (p, i) {
      svg.appendChild(svgEl("circle", {
        cx: x(i), cy: y(p.avgEngagement), r: 3, fill: series,
      }));
    });

    // hover layer: crosshair + tooltip, hit target = whole plot
    var crosshair = svgEl("line", {
      x1: 0, x2: 0, y1: pad.t, y2: H - pad.b,
      stroke: axis, "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0,
    });
    svg.appendChild(crosshair);
    var hoverDot = svgEl("circle", { r: 5, fill: series, opacity: 0 });
    svg.appendChild(hoverDot);

    var tip = makeTooltip(container);

    function onMove(evt) {
      var rect = svg.getBoundingClientRect();
      var px = ((evt.clientX - rect.left) / rect.width) * W;
      var best = 0;
      var bestDist = Infinity;
      points.forEach(function (_, i) {
        var dist = Math.abs(x(i) - px);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      var p = points[best];
      crosshair.setAttribute("x1", x(best));
      crosshair.setAttribute("x2", x(best));
      crosshair.setAttribute("opacity", 1);
      hoverDot.setAttribute("cx", x(best));
      hoverDot.setAttribute("cy", y(p.avgEngagement));
      hoverDot.setAttribute("opacity", 1);
      tip.innerHTML =
        "<strong>Week of " + fmtWeek(p.weekStart) + "</strong><br>" +
        p.avgEngagement + " avg engagement · " + p.posts + " post" + (p.posts === 1 ? "" : "s");
      tip.style.opacity = 1;
      var tx = (x(best) / W) * rect.width;
      tip.style.left = Math.min(Math.max(tx, 60), rect.width - 60) + "px";
      tip.style.top = ((y(p.avgEngagement) / H) * rect.height - 8) + "px";
    }
    function onLeave() {
      crosshair.setAttribute("opacity", 0);
      hoverDot.setAttribute("opacity", 0);
      tip.style.opacity = 0;
    }
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);

    container.appendChild(svg);
  }

  /* --------------------- pillar balance bars ----------------------- */
  // rows: [{name, actualPct, targetPct, posts, deficit}]
  function pillarBars(container, rows) {
    clear(container);
    container.classList.add("sc-chart");
    var W = Math.max(container.clientWidth || 320, 280);
    var rowH = 34;
    var pad = { t: 6, r: 44, b: 18, l: 4 };
    var labelH = 13;
    var H = pad.t + rows.length * rowH + pad.b;

    var series = css(container, "--series-1") || "#2a78d6";
    var grid = css(container, "--line") || "#e1e0d9";
    var ink = css(container, "--ink") || "#0b0b0b";
    var ink2 = css(container, "--ink-2") || "#52514e";
    var muted = css(container, "--muted") || "#898781";

    var maxPct = Math.max.apply(null, rows.map(function (r) {
      return Math.max(r.actualPct, r.targetPct);
    }).concat([10]));
    maxPct = Math.ceil(maxPct / 10) * 10;

    var svg = svgEl("svg", {
      viewBox: "0 0 " + W + " " + H,
      width: "100%",
      height: H,
      role: "img",
      "aria-label": "Share of recent posts per pillar versus target",
    });

    var xw = function (pct) { return (pct / maxPct) * (W - pad.l - pad.r); };
    var tip = makeTooltip(container);

    rows.forEach(function (r, i) {
      var top = pad.t + i * rowH;
      var barY = top + labelH + 3;
      var barH = 10;

      // pillar name (text token, not series color)
      var name = svgEl("text", {
        x: pad.l, y: top + labelH - 2, "font-size": 11.5, fill: ink2,
      });
      name.textContent = r.name;
      svg.appendChild(name);

      // track
      svg.appendChild(svgEl("rect", {
        x: pad.l, y: barY, width: W - pad.l - pad.r, height: barH,
        rx: 4, fill: grid, opacity: 0.5,
      }));
      // actual bar — 4px rounded data end, anchored at baseline
      if (r.actualPct > 0) {
        svg.appendChild(svgEl("rect", {
          x: pad.l, y: barY, width: Math.max(xw(r.actualPct), 3), height: barH,
          rx: 4, fill: series,
        }));
      }
      // target tick
      svg.appendChild(svgEl("line", {
        x1: pad.l + xw(r.targetPct), x2: pad.l + xw(r.targetPct),
        y1: barY - 3, y2: barY + barH + 3,
        stroke: ink, "stroke-width": 2,
      }));
      // direct value label
      var val = svgEl("text", {
        x: W - pad.r + 6, y: barY + barH - 1, "font-size": 11,
        fill: ink, "font-weight": 600,
      });
      val.textContent = r.actualPct + "%";
      svg.appendChild(val);

      // hover hit target = the whole row
      var hit = svgEl("rect", {
        x: 0, y: top, width: W, height: rowH, fill: "transparent",
      });
      hit.addEventListener("mousemove", function (evt) {
        var rect = svg.getBoundingClientRect();
        tip.innerHTML =
          "<strong>" + r.name + "</strong><br>" +
          r.actualPct + "% actual vs " + r.targetPct + "% target · " +
          r.posts + " post" + (r.posts === 1 ? "" : "s") +
          (r.deficit > 0 ? "<br>" + r.deficit + " pts under target" : "");
        tip.style.opacity = 1;
        tip.style.left = Math.min(evt.clientX - rect.left, rect.width - 80) + "px";
        tip.style.top = ((top / H) * rect.height) + "px";
      });
      hit.addEventListener("mouseleave", function () { tip.style.opacity = 0; });
      svg.appendChild(hit);
    });

    // legend for the target tick (the one non-obvious mark)
    var legend = svgEl("text", {
      x: pad.l, y: H - 5, "font-size": 10, fill: muted,
    });
    legend.textContent = "▐ target share";
    svg.appendChild(legend);

    container.appendChild(svg);
  }

  global.SCCharts = { lineChart: lineChart, pillarBars: pillarBars };
})(typeof globalThis !== "undefined" ? globalThis : window);
