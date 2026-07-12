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

  /* -------------------- pillar coverage tracker --------------------- */
  // The heart of pillar-first health tracking: per pillar, how recently and
  // how much it's been fed, vs its target — plus a plain status the UI can
  // color. "days since last post" catches droughts that percentage balance
  // math hides (a pillar can be at target share while silent for 3 weeks).
  SC.health.pillarCoverage = function (posts, pillars, opts) {
    var windowDays = (opts && opts.windowDays) || 30;
    var now = (opts && opts.now) || Date.now();
    var cutoff = now - windowDays * DAY_MS;

    var dated = datedPosts(posts);
    var recent = dated.filter(function (x) { return x.t >= cutoff; });
    var classified = recent.filter(function (x) { return x.post.pillar_guess; });
    var totalClassified = classified.length;

    return (pillars || []).map(function (p) {
      var mine = classified.filter(function (x) { return x.post.pillar_guess === p.slug; });
      var lastAny = null; // most recent post EVER for this pillar, not just window
      dated.forEach(function (x) {
        if (x.post.pillar_guess === p.slug && (lastAny === null || x.t > lastAny)) lastAny = x.t;
      });
      var actualPct = totalClassified ? +((mine.length / totalClassified) * 100).toFixed(1) : 0;
      var target = Number(p.target_ratio) || 0;
      var daysSince = lastAny === null ? null : Math.floor((now - lastAny) / DAY_MS);
      // Expected gap from target share: at ~12 posts/month, a 25% pillar
      // should land every ~10 days. Overdue = 1.5x that; capped sanely.
      var expectedGapDays = target > 0 ? Math.min(45, Math.max(7, Math.round(windowDays / (12 * target / 100)))) : null;
      var status;
      if (target === 0) status = "none";
      else if (daysSince === null) status = "never";
      else if (expectedGapDays !== null && daysSince > expectedGapDays * 1.5) status = "overdue";
      else if (expectedGapDays !== null && daysSince > expectedGapDays) status = "due";
      else status = "ok";
      return {
        slug: p.slug, name: p.name, description: p.description,
        targetPct: target, actualPct: actualPct,
        postsInWindow: mine.length,
        daysSinceLast: daysSince,
        expectedGapDays: expectedGapDays,
        status: status, // ok | due | overdue | never | none
      };
    });
  };

  /* --------------------- consistency streak ------------------------- */
  // Consecutive weeks (ending this week) with at least one post.
  SC.health.streak = function (posts, opts) {
    var now = (opts && opts.now) || Date.now();
    var dated = datedPosts(posts);
    var weeks = 0;
    for (var w = 0; w < 52; w++) {
      var end = now - w * 7 * DAY_MS;
      var start = end - 7 * DAY_MS;
      var hit = dated.some(function (x) { return x.t >= start && x.t < end; });
      if (hit) weeks++;
      else if (w === 0) continue; // current week may just not have a post YET
      else break;
    }
    return { weeks: weeks };
  };

  /* ------------------------ silent posts ---------------------------- */
  // Share of recent posts that got zero comments — the clearest signal that
  // content isn't inviting responses.
  SC.health.silentPosts = function (posts, opts) {
    var windowDays = (opts && opts.windowDays) || 30;
    var now = (opts && opts.now) || Date.now();
    var cutoff = now - windowDays * DAY_MS;
    var recent = datedPosts(posts).filter(function (x) { return x.t >= cutoff; });
    var silent = recent.filter(function (x) { return (Number(x.post.comments) || 0) === 0; });
    return {
      windowDays: windowDays,
      total: recent.length,
      silent: silent.length,
      silentPct: recent.length ? +((silent.length / recent.length) * 100).toFixed(0) : null,
      examples: silent.slice(-3).map(function (x) {
        return (x.post.post_text || "").split("\n")[0].slice(0, 80);
      }),
    };
  };

  /* ------------------------- new voices ----------------------------- */
  // Commenters whose FIRST-ever comment falls inside the window — are new
  // members finding their voice, or is it the same circle every month?
  SC.health.newVoices = function (comments, opts) {
    var windowDays = (opts && opts.windowDays) || 30;
    var now = (opts && opts.now) || Date.now();
    var cutoff = now - windowDays * DAY_MS;
    var firstSeen = {};
    (comments || []).forEach(function (c) {
      if (!c.author || c.is_owner) return;
      var t = ts(c.commented_at);
      if (t === null) return;
      if (!(c.author in firstSeen) || t < firstSeen[c.author]) firstSeen[c.author] = t;
    });
    var authors = Object.keys(firstSeen);
    var fresh = authors.filter(function (a) { return firstSeen[a] >= cutoff; });
    var active = authors.filter(function (a) {
      // commented at all inside the window
      return (comments || []).some(function (c) {
        var t = ts(c.commented_at);
        return c.author === a && t !== null && t >= cutoff;
      });
    });
    return {
      windowDays: windowDays,
      newCommenters: fresh.length,
      activeCommenters: active.length,
      names: fresh.slice(0, 5),
    };
  };

  /* -------------------------- best day ------------------------------ */
  // Which weekday's posts earn the most engagement, so the owner can aim
  // their most important posts at it. Needs a few weeks of data to mean much.
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  SC.health.bestDay = function (posts) {
    var byDay = {};
    datedPosts(posts).forEach(function (x) {
      var d = new Date(x.t).getDay();
      if (!byDay[d]) byDay[d] = { posts: 0, total: 0 };
      byDay[d].posts++;
      byDay[d].total += engagement(x.post);
    });
    var best = null;
    Object.keys(byDay).forEach(function (d) {
      var avg = byDay[d].total / byDay[d].posts;
      if (byDay[d].posts >= 2 && (!best || avg > best.avg)) {
        best = { day: DAY_NAMES[d], posts: byDay[d].posts, avg: +avg.toFixed(1) };
      }
    });
    return best; // null until there's enough data
  };

  /* ----------------- needs-response inbox --------------------------- */
  // Turns the response-latency number into something actionable: the actual
  // member comments/questions that have sat past the response window with
  // nothing back from the owner yet. Two sources:
  //   1. Question posts with zero comments, older than the threshold.
  //   2. Member comments (not the owner's) on a post where the owner has not
  //      commented *after* them, older than the threshold.
  // `comments` rows may carry is_owner + parent_comment_key (v2 scrape); when
  // they don't (older data) we fall back to matching the owner's author name.
  SC.health.needsResponse = function (posts, comments, opts) {
    var now = (opts && opts.now) || Date.now();
    var thresholdHours = (opts && opts.thresholdHours) || 24;
    var ownerNames = (opts && opts.ownerNames) || [];
    var cutoff = thresholdHours * 60 * 60 * 1000;
    var lc = function (s) { return String(s || "").trim().toLowerCase(); };
    var ownerSet = {};
    ownerNames.forEach(function (n) { if (n) ownerSet[lc(n)] = true; });

    function isOwner(row) {
      if (row && row.is_owner) return true;
      return !!ownerSet[lc(row && row.author)];
    }

    var items = [];

    // Source 1: unanswered question posts.
    datedPosts(posts).forEach(function (x) {
      var p = x.post;
      if (!p.is_question) return;
      if ((Number(p.comments) || 0) > 0) return;
      var ageMs = now - x.t;
      if (ageMs <= cutoff) return;
      items.push({
        kind: "post",
        post_key: p.post_key || null,
        comment_key: null,
        author: p.author || null,
        text: (p.post_text || "").split("\n")[0].slice(0, 200),
        at: p.posted_at,
        waitingHours: Math.round(ageMs / 3600000),
      });
    });

    // Index comments by post so we can tell whether the owner already replied
    // somewhere after a given member comment.
    var byPost = {};
    (comments || []).forEach(function (c) {
      var key = c.post_key || "(none)";
      (byPost[key] = byPost[key] || []).push(c);
    });

    (comments || []).forEach(function (c) {
      if (isOwner(c)) return;
      var t = ts(c.commented_at);
      if (t === null) return;
      var ageMs = now - t;
      if (ageMs <= cutoff) return;
      // Has the owner replied on this post after this comment?
      var siblings = byPost[c.post_key || "(none)"] || [];
      var answered = siblings.some(function (o) {
        if (!isOwner(o)) return false;
        var ot = ts(o.commented_at);
        return ot !== null && ot >= t;
      });
      if (answered) return;
      items.push({
        kind: "comment",
        post_key: c.post_key || null,
        comment_key: c.comment_key || null,
        parent_comment_key: c.parent_comment_key || null,
        author: c.author || null,
        text: (c.comment_text || "").replace(/\s+/g, " ").slice(0, 300),
        at: c.commented_at,
        waitingHours: Math.round(ageMs / 3600000),
      });
    });

    items.sort(function (a, b) { return b.waitingHours - a.waitingHours; });
    return items;
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

    // Pillar droughts: balance percentages can look fine while a pillar has
    // been silent for weeks — days-since catches it.
    var coverage = SC.health.pillarCoverage(posts, pillars, opts);
    var droughts = coverage.filter(function (c) {
      return c.status === "overdue" && c.daysSinceLast !== null;
    }).sort(function (a, b) { return b.daysSinceLast - a.daysSinceLast; });
    if (droughts.length) {
      out.push({
        area: "Pillar drought",
        level: droughts[0].daysSinceLast > 30 ? "serious" : "warning",
        text: "\"" + droughts[0].name + "\" hasn't been posted in " +
          droughts[0].daysSinceLast + " days" +
          (droughts.length > 1 ? " (and " + (droughts.length - 1) + " other pillar(s) are overdue too)" : "") +
          ". The generator will fill it — one post ends the drought.",
      });
    }
    var neverFed = coverage.filter(function (c) { return c.status === "never"; });
    if (neverFed.length && posts.length >= 8) {
      out.push({
        area: "Pillar drought",
        level: "warning",
        text: neverFed.map(function (c) { return "\"" + c.name + "\""; }).join(", ") +
          " ha" + (neverFed.length === 1 ? "s" : "ve") + " never been posted. Either " +
          "post one this week or lower the target to 0 so the balance math reflects reality.",
      });
    }

    var silent = SC.health.silentPosts(posts, opts);
    if (silent.silentPct !== null && silent.silentPct >= 40 && silent.total >= 5) {
      out.push({
        area: "Silent posts",
        level: silent.silentPct >= 60 ? "serious" : "warning",
        text: silent.silentPct + "% of the last " + silent.total + " posts got ZERO comments. " +
          "Every silent post trains members to scroll past. End each post with one " +
          "specific question a beginner could answer in one line.",
      });
    }

    var voices = SC.health.newVoices(comments, opts);
    if (voices.activeCommenters >= 4 && voices.newCommenters === 0) {
      out.push({
        area: "New voices",
        level: "warning",
        text: "No first-time commenters in " + voices.windowDays + " days — the same circle " +
          "is carrying every conversation. Welcome-tag new members in a post, or run a " +
          "\"introduce yourself\" thread to break lurkers in.",
      });
    }

    var streak = SC.health.streak(posts, opts);
    if (streak.weeks >= 4) {
      out.push({
        area: "Consistency",
        level: "good",
        text: streak.weeks + "-week posting streak. Consistency is the single biggest " +
          "compounding factor — protect the streak.",
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

  /* ============================ threading =========================== */
  // Assemble flat scraped_comments rows into nested threads, client-side.
  // A comment nests under another when its parent_comment_key matches that
  // comment's comment_key; everything else is treated as top-level on its
  // post. Orphans (parent not present in the data) are lifted to top level so
  // nothing is ever dropped from view.
  SC.threads = SC.threads || {};

  // build(comments) -> array of roots, each: { ...comment, replies: [...] },
  // sorted oldest-first at every level.
  SC.threads.build = function (comments) {
    var byKey = {};
    var nodes = (comments || []).map(function (c) {
      var node = {};
      for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) node[k] = c[k];
      node.replies = [];
      if (node.comment_key) byKey[node.comment_key] = node;
      return node;
    });

    var roots = [];
    nodes.forEach(function (n) {
      var parentKey = n.parent_comment_key;
      if (parentKey && byKey[parentKey] && byKey[parentKey] !== n) {
        byKey[parentKey].replies.push(n);
      } else {
        roots.push(n); // top-level, or orphaned reply lifted to the top
      }
    });

    var sortByTime = function (a, b) {
      var at = a.commented_at ? new Date(a.commented_at).getTime() : 0;
      var bt = b.commented_at ? new Date(b.commented_at).getTime() : 0;
      return at - bt;
    };
    (function sortTree(list) {
      list.sort(sortByTime);
      list.forEach(function (n) { if (n.replies.length) sortTree(n.replies); });
    })(roots);
    return roots;
  };

  // Group comments by their post_key and return per-post threads, so a UI can
  // show "post → its whole conversation". posts is optional; when given, the
  // returned groups carry the matching post row for context and are ordered by
  // the post's recency.
  SC.threads.byPost = function (comments, posts) {
    var groups = {};
    (comments || []).forEach(function (c) {
      var key = c.post_key || "(none)";
      (groups[key] = groups[key] || []).push(c);
    });
    var postByKey = {};
    (posts || []).forEach(function (p) { if (p.post_key) postByKey[p.post_key] = p; });

    return Object.keys(groups).map(function (key) {
      return {
        post_key: key === "(none)" ? null : key,
        post: postByKey[key] || null,
        roots: SC.threads.build(groups[key]),
        count: groups[key].length,
      };
    }).sort(function (a, b) {
      var at = a.post && a.post.posted_at ? new Date(a.post.posted_at).getTime() : 0;
      var bt = b.post && b.post.posted_at ? new Date(b.post.posted_at).getTime() : 0;
      return bt - at;
    });
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
