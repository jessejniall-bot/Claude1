/* =====================================================================
   Skool Community Copilot — Community Health Engine
   ---------------------------------------------------------------------
   Pure calculation over scraped_posts rows. Zero AI cost, zero I/O:
   every function takes plain arrays and returns plain objects, so the
   same code powers the PWA dashboard, the extension side panel, and
   tests. Post shape (from scraped_posts):
     { post_text, likes, comments, posted_at, author,
       pillar_guess, is_question, first_comment_at }
   ===================================================================== */
(function (SC) {
  "use strict";

  var DAY_MS = 24 * 60 * 60 * 1000;

  function ts(value) {
    var t = value ? new Date(value).getTime() : NaN;
    return isNaN(t) ? null : t;
  }

  function datedPosts(posts) {
    return (posts || [])
      .map(function (p) {
        return { post: p, t: ts(p.posted_at) };
      })
      .filter(function (x) { return x.t !== null; })
      .sort(function (a, b) { return a.t - b.t; });
  }

  function engagement(p) {
    return (Number(p.likes) || 0) + (Number(p.comments) || 0);
  }

  /* ---------------- engagement rate over time ---------------------- */
  // Weekly buckets of avg (likes + comments) per post, plus a trend:
  // percent change of the last-half average vs the first-half average.
  SC.health = SC.health || {};

  SC.health.engagementTrend = function (posts, opts) {
    var weeks = (opts && opts.weeks) || 8;
    var now = (opts && opts.now) || Date.now();
    var series = [];
    for (var i = weeks - 1; i >= 0; i--) {
      var end = now - i * 7 * DAY_MS;
      var start = end - 7 * DAY_MS;
      series.push({ start: start, end: end, posts: 0, total: 0 });
    }
    datedPosts(posts).forEach(function (x) {
      for (var j = 0; j < series.length; j++) {
        if (x.t >= series[j].start && x.t < series[j].end) {
          series[j].posts += 1;
          series[j].total += engagement(x.post);
          break;
        }
      }
    });
    var points = series.map(function (b) {
      return {
        weekStart: new Date(b.start).toISOString(),
        posts: b.posts,
        avgEngagement: b.posts ? +(b.total / b.posts).toFixed(2) : 0,
      };
    });

    var withData = points.filter(function (p) { return p.posts > 0; });
    var trendPct = null;
    if (withData.length >= 2) {
      var half = Math.floor(withData.length / 2);
      var avg = function (arr) {
        return arr.reduce(function (s, p) { return s + p.avgEngagement; }, 0) / arr.length;
      };
      var first = avg(withData.slice(0, half));
      var last = avg(withData.slice(half));
      if (first > 0) trendPct = +(((last - first) / first) * 100).toFixed(1);
    }
    return { points: points, trendPct: trendPct };
  };

  /* ---------------------- posting cadence -------------------------- */
  SC.health.cadence = function (posts, opts) {
    var now = (opts && opts.now) || Date.now();
    var dated = datedPosts(posts);
    if (dated.length === 0) {
      return { avgGapDays: null, lastPostDaysAgo: null, postsLast30: 0 };
    }
    var gaps = [];
    for (var i = 1; i < dated.length; i++) {
      gaps.push((dated[i].t - dated[i - 1].t) / DAY_MS);
    }
    var avgGap = gaps.length
      ? +(gaps.reduce(function (s, g) { return s + g; }, 0) / gaps.length).toFixed(1)
      : null;
    var last = dated[dated.length - 1].t;
    var last30 = dated.filter(function (x) { return now - x.t <= 30 * DAY_MS; }).length;
    return {
      avgGapDays: avgGap,
      lastPostDaysAgo: +((now - last) / DAY_MS).toFixed(1),
      postsLast30: last30,
    };
  };

  /* ----------------------- pillar balance -------------------------- */
  // Actual % per pillar over the trailing window vs target_ratio.
  // Unclassified posts are excluded from the denominator.
  SC.health.pillarBalance = function (posts, pillars, opts) {
    var windowDays = (opts && opts.windowDays) || 30;
    var now = (opts && opts.now) || Date.now();
    var cutoff = now - windowDays * DAY_MS;

    var recent = datedPosts(posts).filter(function (x) { return x.t >= cutoff; });
    var classified = recent.filter(function (x) { return x.post.pillar_guess; });
    var counts = {};
    classified.forEach(function (x) {
      counts[x.post.pillar_guess] = (counts[x.post.pillar_guess] || 0) + 1;
    });
    var total = classified.length;

    var rows = (pillars || []).map(function (p) {
      var n = counts[p.slug] || 0;
      var actual = total ? +((n / total) * 100).toFixed(1) : 0;
      var target = Number(p.target_ratio) || 0;
      return {
        slug: p.slug,
        name: p.name,
        description: p.description,
        posts: n,
        actualPct: actual,
        targetPct: target,
        deficit: +(target - actual).toFixed(1), // positive = underfed pillar
      };
    });
    return {
      windowDays: windowDays,
      totalClassified: total,
      totalRecent: recent.length,
      rows: rows,
    };
  };

  // The pillar the generator should fill next: largest positive deficit;
  // ties broken by higher target (more important pillar first).
  SC.health.mostOverduePillar = function (balance) {
    var rows = (balance && balance.rows) || [];
    var best = null;
    rows.forEach(function (r) {
      if (!best || r.deficit > best.deficit ||
          (r.deficit === best.deficit && r.targetPct > best.targetPct)) {
        best = r;
      }
    });
    return best;
  };

  /* --------------------- dormant member flags ---------------------- */
  // Authors who posted at least `activeMin` times historically but have
  // been quiet for `quietDays`. (Scraping only sees post authors, not
  // commenters — so this flags previously-active *posters*.)
  SC.health.dormantMembers = function (posts, opts) {
    var quietDays = (opts && opts.quietDays) || 21;
    var activeMin = (opts && opts.activeMin) || 2;
    var now = (opts && opts.now) || Date.now();
    var byAuthor = {};
    datedPosts(posts).forEach(function (x) {
      var a = x.post.author;
      if (!a) return;
      if (!byAuthor[a]) byAuthor[a] = { author: a, posts: 0, lastAt: 0 };
      byAuthor[a].posts += 1;
      if (x.t > byAuthor[a].lastAt) byAuthor[a].lastAt = x.t;
    });
    return Object.keys(byAuthor)
      .map(function (a) { return byAuthor[a]; })
      .filter(function (m) {
        return m.posts >= activeMin && now - m.lastAt > quietDays * DAY_MS;
      })
      .map(function (m) {
        return {
          author: m.author,
          posts: m.posts,
          quietDays: Math.floor((now - m.lastAt) / DAY_MS),
        };
      })
      .sort(function (a, b) { return b.quietDays - a.quietDays; });
  };

  /* ---------------------- response latency ------------------------- */
  // Avg hours from a question post to its first reply, where the feed
  // exposed first_comment_at. Also counts unanswered questions older
  // than 24h — a concrete "go reply to these" signal.
  SC.health.responseLatency = function (posts, opts) {
    var now = (opts && opts.now) || Date.now();
    var latencies = [];
    var unanswered = 0;
    datedPosts(posts).forEach(function (x) {
      var p = x.post;
      if (!p.is_question) return;
      var first = ts(p.first_comment_at);
      if (first && first > x.t) {
        latencies.push((first - x.t) / (60 * 60 * 1000));
      } else if ((Number(p.comments) || 0) === 0 && now - x.t > DAY_MS) {
        unanswered += 1;
      }
    });
    var avg = latencies.length
      ? +(latencies.reduce(function (s, h) { return s + h; }, 0) / latencies.length).toFixed(1)
      : null;
    return { avgFirstReplyHours: avg, sampled: latencies.length, unansweredQuestions: unanswered };
  };

  /* ------------------------ health flags ---------------------------- */
  // Human-readable flags, also usable as generator seeds.
  SC.health.flags = function (posts, pillars, opts) {
    var flags = [];
    var cad = SC.health.cadence(posts, opts);
    var trend = SC.health.engagementTrend(posts, opts);
    var balance = SC.health.pillarBalance(posts, pillars, opts);
    var overdue = SC.health.mostOverduePillar(balance);
    var latency = SC.health.responseLatency(posts, opts);
    var dormant = SC.health.dormantMembers(posts, opts);

    if (cad.lastPostDaysAgo !== null && cad.avgGapDays !== null &&
        cad.lastPostDaysAgo > Math.max(2, cad.avgGapDays * 1.5)) {
      flags.push({
        level: "warning",
        kind: "cadence",
        message: "It has been " + Math.round(cad.lastPostDaysAgo) +
          " days since the last post (your average gap is " + cad.avgGapDays + " days).",
      });
    }
    if (trend.trendPct !== null && trend.trendPct < -20) {
      flags.push({
        level: "serious",
        kind: "engagement",
        message: "Engagement per post is down " + Math.abs(trend.trendPct) + "% over the trend window.",
      });
    }
    if (overdue && overdue.deficit > 5 && balance.totalClassified >= 5) {
      flags.push({
        level: "warning",
        kind: "pillar",
        pillar: overdue.slug,
        message: "\"" + overdue.name + "\" is " + overdue.deficit +
          " points under its " + overdue.targetPct + "% target over the last " +
          balance.windowDays + " days.",
      });
    }
    if (latency.unansweredQuestions > 0) {
      flags.push({
        level: "warning",
        kind: "latency",
        message: latency.unansweredQuestions +
          " member question(s) have sat over 24h with no reply.",
      });
    }
    if (dormant.length > 0) {
      flags.push({
        level: "good",
        kind: "dormant",
        message: dormant.length + " previously active member(s) have gone quiet — " +
          "a welcome-back or shoutout post could re-engage them.",
      });
    }
    return flags;
  };

  /* ------------------------ comment insights ------------------------ */
  // Participation math over scraped_comments rows:
  //   { comment_text, author, likes, commented_at }
  SC.health.commentStats = function (comments, posts, opts) {
    var windowDays = (opts && opts.windowDays) || 30;
    var now = (opts && opts.now) || Date.now();
    var cutoff = now - windowDays * DAY_MS;

    var recent = (comments || []).filter(function (c) {
      var t = ts(c.commented_at);
      return t !== null && t >= cutoff;
    });
    var postsRecent = datedPosts(posts).filter(function (x) { return x.t >= cutoff; }).length;

    var byAuthor = {};
    var totalLen = 0;
    recent.forEach(function (c) {
      totalLen += (c.comment_text || "").length;
      var a = c.author || "(unknown)";
      byAuthor[a] = (byAuthor[a] || 0) + 1;
    });
    var authors = Object.keys(byAuthor).map(function (a) {
      return { author: a, comments: byAuthor[a] };
    }).sort(function (a, b) { return b.comments - a.comments; });

    var top3 = authors.slice(0, 3).reduce(function (s, a) { return s + a.comments; }, 0);
    return {
      windowDays: windowDays,
      totalComments: recent.length,
      totalAllTime: (comments || []).length,
      postsInWindow: postsRecent,
      commentsPerPost: postsRecent ? +(recent.length / postsRecent).toFixed(1) : null,
      uniqueCommenters: authors.length,
      top3SharePct: recent.length ? +((top3 / recent.length) * 100).toFixed(0) : null,
      avgCommentChars: recent.length ? Math.round(totalLen / recent.length) : null,
      topCommenters: authors.slice(0, 5),
    };
  };

  /* ------------------- overall community health -------------------- */
  // A 0-100 verdict built from five weighted components. Neutral scores
  // are used where there isn't enough data yet, so a fresh community
  // isn't branded "at risk" before anything has been scraped.
  SC.health.score = function (posts, comments, pillars, opts) {
    var clamp = function (v) { return Math.max(0, Math.min(100, v)); };
    var cad = SC.health.cadence(posts, opts);
    var trend = SC.health.engagementTrend(posts, opts);
    var balance = SC.health.pillarBalance(posts, pillars, opts);
    var latency = SC.health.responseLatency(posts, opts);
    var cstats = SC.health.commentStats(comments, posts, opts);

    // Cadence: ~3 posts/week is full marks; going silent bleeds points.
    var cadence;
    if (cad.postsLast30 === 0) cadence = 0;
    else {
      cadence = clamp((cad.postsLast30 / 12) * 100);
      if (cad.lastPostDaysAgo !== null && cad.lastPostDaysAgo > 7) cadence *= 0.6;
    }

    // Engagement direction: flat = 60, +20% = 100, -30% = 0.
    var engagement = trend.trendPct === null ? 60 : clamp(60 + trend.trendPct * 2);

    // Pillar balance: each point of unmet target costs 2.
    var bal;
    if (balance.totalClassified < 5) bal = 60;
    else {
      var missed = balance.rows.reduce(function (s, r) {
        return s + Math.max(r.deficit, 0);
      }, 0);
      bal = clamp(100 - missed * 2);
    }

    // Responsiveness to questions.
    var resp = 100 - latency.unansweredQuestions * 15;
    if (latency.avgFirstReplyHours !== null) {
      if (latency.avgFirstReplyHours > 24) resp -= 30;
      else if (latency.avgFirstReplyHours > 6) resp -= 10;
    }
    resp = clamp(resp);

    // Participation: 3+ comments per post is full marks; a conversation
    // carried by the same 3 people gets docked.
    var part;
    if (cstats.totalAllTime === 0) part = 50;
    else {
      part = cstats.commentsPerPost === null ? 50 : clamp((cstats.commentsPerPost / 3) * 100);
      if (cstats.top3SharePct !== null && cstats.top3SharePct > 70 && cstats.uniqueCommenters > 3) {
        part = clamp(part - 20);
      }
    }

    var components = [
      { key: "cadence", label: "Posting cadence", score: Math.round(cadence), weight: 0.25 },
      { key: "engagement", label: "Engagement trend", score: Math.round(engagement), weight: 0.2 },
      { key: "balance", label: "Pillar balance", score: Math.round(bal), weight: 0.2 },
      { key: "responsiveness", label: "Responsiveness", score: Math.round(resp), weight: 0.15 },
      { key: "participation", label: "Participation", score: Math.round(part), weight: 0.2 },
    ];
    var total = Math.round(components.reduce(function (s, c) {
      return s + c.score * c.weight;
    }, 0));
    var label =
      total >= 80 ? "Thriving" :
      total >= 60 ? "Healthy" :
      total >= 40 ? "Needs attention" : "At risk";
    var level =
      total >= 80 ? "good" :
      total >= 60 ? "good" :
      total >= 40 ? "warning" : "critical";
    return { total: total, label: label, level: level, components: components };
  };

  /* -------------------- improvement suggestions -------------------- */
  // Concrete, numbers-grounded suggestions. Free (no AI call); the AI
  // deep review builds on top of these plus the raw comments.
  SC.health.improvements = function (posts, comments, pillars, opts) {
    var out = [];
    var cad = SC.health.cadence(posts, opts);
    var trend = SC.health.engagementTrend(posts, opts);
    var balance = SC.health.pillarBalance(posts, pillars, opts);
    var overdue = SC.health.mostOverduePillar(balance);
    var latency = SC.health.responseLatency(posts, opts);
    var cstats = SC.health.commentStats(comments, posts, opts);
    var dormant = SC.health.dormantMembers(posts, opts);

    if (cad.postsLast30 < 8) {
      out.push({
        area: "Cadence",
        level: cad.postsLast30 < 4 ? "serious" : "warning",
        text: "Only " + cad.postsLast30 + " post(s) in the last 30 days. Communities " +
          "compound on rhythm — aim for 2-3 posts a week; use the queue to batch them.",
      });
    }
    if (trend.trendPct !== null && trend.trendPct < -10) {
      out.push({
        area: "Engagement",
        level: "serious",
        text: "Engagement per post is trending down " + Math.abs(trend.trendPct) +
          "%. Lead with questions and stories for a week and watch whether replies recover.",
      });
    }
    if (overdue && overdue.deficit > 5 && balance.totalClassified >= 5) {
      out.push({
        area: "Content mix",
        level: "warning",
        text: "\"" + overdue.name + "\" is " + overdue.deficit + " points under its " +
          overdue.targetPct + "% target — the generator below will fill it first.",
      });
    }
    if (latency.unansweredQuestions > 0) {
      out.push({
        area: "Responsiveness",
        level: "warning",
        text: latency.unansweredQuestions + " member question(s) have waited 24h+ with no " +
          "reply. Answering those is the cheapest engagement win available today.",
      });
    }
    if (latency.avgFirstReplyHours !== null && latency.avgFirstReplyHours > 12) {
      out.push({
        area: "Responsiveness",
        level: "warning",
        text: "Questions wait " + latency.avgFirstReplyHours + "h on average for a first " +
          "reply. Faster first replies train members that posting here gets a response.",
      });
    }
    if (cstats.commentsPerPost !== null && cstats.commentsPerPost < 2 && cstats.postsInWindow >= 4) {
      out.push({
        area: "Participation",
        level: "warning",
        text: "Posts average only " + cstats.commentsPerPost + " comment(s). End every post " +
          "with one specific, easy-to-answer question instead of a generic \"thoughts?\".",
      });
    }
    if (cstats.top3SharePct !== null && cstats.top3SharePct > 70 && cstats.uniqueCommenters > 3) {
      out.push({
        area: "Participation",
        level: "warning",
        text: "Your top 3 commenters produce " + cstats.top3SharePct + "% of all comments. " +
          "Name-drop quieter members in posts and reply to first-time commenters within hours.",
      });
    }
    if (dormant.length > 0) {
      out.push({
        area: "Retention",
        level: "good",
        text: dormant.length + " previously active member(s) have gone quiet (e.g. " +
          dormant.slice(0, 3).map(function (m) { return m.author; }).join(", ") +
          "). A shoutout or check-in post can pull them back before they churn.",
      });
    }
    if (!out.length) {
      out.push({
        area: "Overall",
        level: "good",
        text: "No obvious weak spots in the data. Keep the cadence and keep answering fast.",
      });
    }
    return out;
  };

  /* ------------------------- stats digest --------------------------- */
  // Compact text summary of everything above — injected into generation
  // prompts so drafts are grounded in the scraped stats, and into the
  // AI deep-review prompt.
  SC.health.digest = function (posts, comments, pillars, opts) {
    var cad = SC.health.cadence(posts, opts);
    var trend = SC.health.engagementTrend(posts, opts);
    var balance = SC.health.pillarBalance(posts, pillars, opts);
    var overdue = SC.health.mostOverduePillar(balance);
    var latency = SC.health.responseLatency(posts, opts);
    var cstats = SC.health.commentStats(comments, posts, opts);
    var score = SC.health.score(posts, comments, pillars, opts);

    var lines = [];
    lines.push("Health score: " + score.total + "/100 (" + score.label + ")");
    lines.push("Posts in last 30 days: " + cad.postsLast30 +
      (cad.avgGapDays !== null ? " (avg " + cad.avgGapDays + " days between posts)" : ""));
    if (trend.trendPct !== null) {
      lines.push("Engagement per post trend: " + (trend.trendPct >= 0 ? "+" : "") + trend.trendPct + "%");
    }
    if (overdue && balance.totalClassified >= 5) {
      lines.push("Most underfed pillar: " + overdue.name + " (" + overdue.actualPct +
        "% actual vs " + overdue.targetPct + "% target)");
    }
    if (cstats.commentsPerPost !== null) {
      lines.push("Comments per post: " + cstats.commentsPerPost + " from " +
        cstats.uniqueCommenters + " unique commenters" +
        (cstats.top3SharePct !== null ? " (top 3 write " + cstats.top3SharePct + "%)" : ""));
    }
    if (latency.unansweredQuestions > 0) {
      lines.push("Unanswered member questions older than 24h: " + latency.unansweredQuestions);
    }
    if (latency.avgFirstReplyHours !== null) {
      lines.push("Average time to first reply on questions: " + latency.avgFirstReplyHours + "h");
    }
    return lines;
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
