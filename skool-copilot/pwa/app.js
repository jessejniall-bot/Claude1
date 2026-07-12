/* =====================================================================
   Skool Community Copilot — companion PWA
   ---------------------------------------------------------------------
   Mobile-friendly dashboard over the same Supabase backend the
   extension writes to. Views: configure -> auth -> setup -> dashboard /
   ideas / drafts / queue / settings, routed by location.hash.
   ===================================================================== */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var AI_SETTINGS_KEY = "sc_ai_settings";

  var state = {
    client: null,
    user: null,
    communities: [],
    currentId: null,
    pillars: [],
    voice: null,
    posts: [],
    comments: [],
    ideas: [],
    drafts: [],
    queue: [],
  };

  /* ------------------------------ boot ----------------------------- */

  async function boot() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
    wireStaticHandlers();
    // connect.js runs at document_idle, after us. Update the instant it
    // announces itself, and re-check on a couple of timers as a fallback.
    document.addEventListener("sc-extension-ready", renderExtensionStatus);
    setTimeout(renderExtensionStatus, 600);
    setTimeout(renderExtensionStatus, 2500);
    if (await SC.isDemo()) {
      state.client = new SC.DemoClient();
      state.user = await state.client.getUser();
      await loadCommunities();
      document.querySelector(".brand").textContent = "🧭 Skool Copilot — demo";
      route();
      return;
    }
    state.client = await SC.getClient();
    if (!state.client) return show("view-configure");
    if (await SC.isSolo()) {
      // Solo mode: no accounts. The anon key alone is the credential
      // (requires the one-time supabase/solo-mode.sql).
      state.user = { id: null, solo: true };
      document.querySelector(".brand").textContent = "🧭 Skool Copilot — solo";
    } else {
      state.user = await state.client.getUser();
      if (!state.user) return show("view-auth");
    }
    await loadCommunities();
    if (!state.communities.length) return show("view-setup");
    route();
  }

  function show(viewId) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("hidden", v.id !== viewId);
    });
    var inApp = ["view-dashboard", "view-inbox", "view-ideas", "view-drafts", "view-queue", "view-settings"]
      .indexOf(viewId) !== -1;
    $("tabs").classList.toggle("hidden", !inApp);
    $("community-picker").classList.toggle("hidden", !inApp || state.communities.length < 2);
    document.querySelectorAll("#tabs a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === "#/" + viewId.replace("view-", ""));
    });
  }

  function route() {
    var name = (location.hash || "#/dashboard").replace("#/", "") || "dashboard";
    var viewId = "view-" + name;
    if (!document.getElementById(viewId)) { viewId = "view-dashboard"; name = "dashboard"; }
    show(viewId);
    if (name === "dashboard") renderDashboard();
    else if (name === "inbox") renderInbox();
    else if (name === "ideas") renderIdeas();
    else if (name === "drafts") renderDrafts();
    else if (name === "queue") renderQueue();
    else if (name === "settings") renderSettings();
  }

  window.addEventListener("hashchange", route);

  /* --------------------------- data loads -------------------------- */

  async function loadCommunities() {
    state.communities = (await state.client
      .from("communities").select("id,name,skool_url,slug").order("created_at")) || [];
    var picker = $("community-picker");
    picker.innerHTML = "";
    state.communities.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      picker.appendChild(opt);
    });
    if (!state.currentId && state.communities.length) {
      state.currentId = state.communities[0].id;
    }
    if (state.currentId) picker.value = state.currentId;
  }

  async function loadCommunityData() {
    var id = state.currentId;
    var c = state.client;
    var results = await Promise.all([
      c.from("pillars").select("*").eq("community_id", id).order("position"),
      c.from("voice_profiles").select("*").eq("community_id", id).limit(1),
      c.from("scraped_posts").select("*").eq("community_id", id)
        .order("posted_at", { ascending: false }).limit(1000),
      c.from("ideas").select("*").eq("community_id", id)
        .order("created_at", { ascending: false }).limit(200),
      c.from("drafts").select("*").eq("community_id", id)
        .order("updated_at", { ascending: false }).limit(100),
      c.from("queue").select("*").eq("community_id", id)
        .order("scheduled_for").limit(100),
      c.from("scraped_comments").select("*").eq("community_id", id)
        .order("commented_at", { ascending: false }).limit(2000),
    ]);
    state.pillars = results[0] || [];
    state.voice = (results[1] && results[1][0]) || null;
    state.posts = results[2] || [];
    state.ideas = results[3] || [];
    state.drafts = results[4] || [];
    state.queue = results[5] || [];
    state.comments = results[6] || [];
  }

  function currentCommunity() {
    return state.communities.find(function (c) { return c.id === state.currentId; }) || null;
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s == null ? "" : String(s);
    return div.innerHTML;
  }

  /* ---------------------------- dashboard -------------------------- */

  async function renderDashboard() {
    await loadCommunityData();
    var posts = state.posts;
    $("dash-empty").classList.toggle("hidden", posts.length > 0);

    var cad = SC.health.cadence(posts);
    var trend = SC.health.engagementTrend(posts);
    var latency = SC.health.responseLatency(posts);
    var balance = SC.health.pillarBalance(posts, state.pillars);
    var overdue = SC.health.mostOverduePillar(balance);

    // Overall health verdict
    var score = SC.health.score(posts, state.comments, state.pillars);
    var scoreEl = $("score-total");
    scoreEl.textContent = posts.length ? String(score.total) : "—";
    scoreEl.className = "score-num " + score.level;
    $("score-label").textContent = posts.length
      ? score.label + " · community health score"
      : "Waiting for data";
    $("score-components").innerHTML = score.components.map(function (c) {
      return '<div class="score-part"><span class="n">' + c.label + "</span>" +
        '<span class="track"><span class="fill" style="width:' + c.score + '%"></span></span>' +
        '<span class="v">' + c.score + "</span></div>";
    }).join("");

    // Where to improve (computed, free)
    var improvements = SC.health.improvements(posts, state.comments, state.pillars);
    $("dash-improvements").innerHTML = improvements.map(function (s) {
      return '<li class="' + s.level + '"><strong>' + escapeHtml(s.area) + ":</strong> " +
        escapeHtml(s.text) + "</li>";
    }).join("");

    var cstats = SC.health.commentStats(state.comments, posts);

    var tiles = [
      { l: "Posts in last 30 days", v: String(cad.postsLast30) },
      { l: "Avg days between posts", v: cad.avgGapDays == null ? "—" : String(cad.avgGapDays) },
      {
        l: "Engagement trend",
        v: trend.trendPct == null ? "—"
          : '<span class="' + (trend.trendPct >= 0 ? "up" : "down") + '">' +
            (trend.trendPct >= 0 ? "▲ " : "▼ ") + Math.abs(trend.trendPct) + "%</span>",
      },
      {
        l: "Comments per post (30d)",
        v: cstats.commentsPerPost == null ? "—" : String(cstats.commentsPerPost),
      },
      {
        l: "Avg first reply (questions)",
        v: latency.avgFirstReplyHours == null ? "—" : latency.avgFirstReplyHours + "h",
        href: "#/inbox",
        sub: latency.unansweredQuestions > 0
          ? latency.unansweredQuestions + " waiting →" : "Open inbox →",
      },
    ];
    var silent = SC.health.silentPosts(posts);
    var voices = SC.health.newVoices(state.comments);
    var best = SC.health.bestDay(posts);
    var streak = SC.health.streak(posts);
    tiles.push(
      { l: "Silent posts (0 comments, 30d)",
        v: silent.silentPct == null ? "\u2014" : silent.silentPct + "%" },
      { l: "New voices (30d)",
        v: voices.activeCommenters ? String(voices.newCommenters) : "\u2014" },
      { l: "Best day to post",
        v: best ? best.day : "\u2014" },
      { l: "Posting streak",
        v: streak.weeks ? streak.weeks + "w" : "\u2014" }
    );
    $("dash-stats").innerHTML = tiles.map(function (t) {
      var inner = '<div class="v">' + t.v + '</div><div class="l">' + t.l + "</div>" +
        (t.sub ? '<div class="l link-sub">' + escapeHtml(t.sub) + "</div>" : "");
      return t.href
        ? '<a class="stat stat-link" href="' + t.href + '">' + inner + "</a>"
        : '<div class="stat">' + inner + "</div>";
    }).join("");

    SCCharts.lineChart($("chart-engagement"), trend.points);
    SCCharts.pillarBars($("chart-pillars"), balance.rows);

    renderPillarTracker();
    fillGenPillarSelect();

    var flags = SC.health.flags(posts, state.pillars);
    $("dash-flags").innerHTML = flags.length
      ? flags.map(function (f) {
          return '<li class="' + f.level + '">' + escapeHtml(f.message) + "</li>";
        }).join("")
      : '<li class="good">No flags — looking healthy.</li>';

    var dormant = SC.health.dormantMembers(posts);
    $("dash-dormant").innerHTML = dormant.length
      ? dormant.slice(0, 8).map(function (m) {
          return "<li><span class='grow'>" + escapeHtml(m.author) + "</span>" +
            "<span class='meta'>" + m.posts + " posts · quiet " + m.quietDays + "d</span></li>";
        }).join("")
      : '<li><span class="meta">No previously active members have gone quiet.</span></li>';

    $("gen-overdue").textContent = overdue && balance.totalClassified > 0
      ? "Most overdue pillar: " + overdue.name + " — " + overdue.actualPct +
        "% of recent posts vs " + overdue.targetPct + "% target."
      : "Not enough classified posts yet; the generator will default to your highest-target pillar.";
  }

  /* ------------------------------ inbox ---------------------------- */
  // Needs-response list + threaded conversations, with per-comment AI reply
  // drafting, queue-to-Skool, copy-and-open, and thread summarization.


  function communityBaseUrl() {
    var c = currentCommunity();
    if (!c) return "https://www.skool.com";
    var slug = c.slug || SC.skoolSlug(c.skool_url);
    return "https://www.skool.com/" + slug;
  }

  // Deep link to the exact post when we scraped its URL slug, else the
  // community feed (the documented "at minimum" fallback).
  function postDeepLink(postKey) {
    var post = state.posts.find(function (p) { return p.post_key === postKey; });
    if (post && post.post_name) return communityBaseUrl() + "/" + post.post_name;
    return communityBaseUrl();
  }

  async function renderInbox() {
    await loadCommunityData();
    var threshold = Number($("inbox-threshold").value) || 24;
    var ownerNames = ownerNamesFromData();

    var items = SC.health.needsResponse(state.posts, state.comments, {
      thresholdHours: threshold,
      ownerNames: ownerNames,
    });

    $("inbox-reply-caps").textContent = state.comments.length
      ? "Open each on Skool to reply \u2014 fast answers train members to post."
      : "";

    var host = $("inbox-list");
    if (!items.length) {
      host.innerHTML = '<p class="muted good-note">✅ Nothing waiting — every member ' +
        "comment past your window has a reply. Nice.</p>";
    } else {
      host.innerHTML = "";
      items.forEach(function (item, i) {
        host.appendChild(inboxItemEl(item, i));
      });
    }

    // Threaded conversations.
    var groups = SC.threads.byPost(state.comments, state.posts);
    $("inbox-empty").classList.toggle("hidden", groups.length > 0);
    var thost = $("threads-host");
    thost.innerHTML = "";
    groups.slice(0, 30).forEach(function (g) { thost.appendChild(threadGroupEl(g)); });
  }

  // Best-effort owner display names: authors of comments already flagged
  // is_owner, so older data without the flag still resolves the owner.
  function ownerNamesFromData() {
    var names = {};
    (state.comments || []).forEach(function (c) {
      if (c.is_owner && c.author) names[c.author] = true;
    });
    return Object.keys(names);
  }

  function inboxItemEl(item, idx) {
    var el = document.createElement("div");
    el.className = "inbox-item";
    var who = escapeHtml(item.author || (item.kind === "post" ? "A member (post)" : "A member"));
    var wait = item.waitingHours >= 48
      ? Math.round(item.waitingHours / 24) + "d"
      : item.waitingHours + "h";
    el.innerHTML =
      '<div class="head"><span class="who">' + who + "</span>" +
      '<span class="counts">waiting ' + wait + "</span></div>" +
      '<div class="snippet">' + escapeHtml(item.text || "") + "</div>" +
      '<div class="row inbox-actions">' +
      '<button class="btn small primary" data-act="open">\u2197 Open on Skool</button>' +
      '<button class="btn small" data-act="copy-ctx">\ud83d\udccb Copy</button>' +
      "</div>";
    el._item = item;
    return el;
  }

  function threadGroupEl(g) {
    var el = document.createElement("div");
    el.className = "thread-group";
    el._group = g;
    var title = g.post ? (g.post.post_text || "").split("\n")[0].slice(0, 90) : "(post not scraped)";
    el.innerHTML =
      '<div class="thread-head">' +
      '<button class="thread-toggle" data-act="toggle">▸</button>' +
      '<span class="thread-title">' + escapeHtml(title) + "</span>" +
      '<span class="meta">' + g.count + " comment" + (g.count === 1 ? "" : "s") + "</span>" +
      '<button class="btn small" data-act="summarize">📝 Summarize</button>' +
      "</div>" +
      '<div class="thread-summary hidden"></div>' +
      '<div class="thread-body hidden"></div>';
    return el;
  }

  function renderThreadBody(g) {
    var lines = [];
    (function walk(nodes, depth) {
      nodes.forEach(function (n) {
        lines.push(
          '<div class="tc" style="margin-left:' + (depth * 16) + 'px">' +
          '<div class="tc-head"><span class="who">' +
          escapeHtml(n.author || "Member") + (n.is_owner ? ' <span class="owner-tag">you</span>' : "") +
          '</span></div>' +
          '<div class="tc-text">' + escapeHtml(n.comment_text || "") + "</div>" +
          "</div>"
        );
        if (n.replies && n.replies.length) walk(n.replies, depth + 1);
      });
    })(g.roots, 0);
    return lines.join("");
  }

  // Flatten a thread group into ordered {author,text,depth} for summarization.
  function flattenThread(g) {
    var out = [];
    (function walk(nodes, depth) {
      nodes.forEach(function (n) {
        out.push({ author: n.author, text: n.comment_text, depth: depth });
        if (n.replies && n.replies.length) walk(n.replies, depth + 1);
      });
    })(g.roots, 0);
    return out;
  }

  async function onInboxClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var act = btn.dataset.act;
    var itemEl = btn.closest(".inbox-item");
    var groupEl = btn.closest(".thread-group");

    if (itemEl && itemEl._item) {
      var item = itemEl._item;
      if (act === "open") {
        window.open(postDeepLink(item.post_key), "_blank", "noopener");
      } else if (act === "copy-ctx") {
        try {
          await navigator.clipboard.writeText((item.author || "member") + ": " + (item.text || ""));
          flash(btn, "\u2705 Copied");
        } catch (e2) { /* clipboard unavailable */ }
      }
      return;
    }

    if (groupEl) {
      var g = groupEl._group;
      if (act === "toggle") {
        var body = groupEl.querySelector(".thread-body");
        var open = body.classList.toggle("hidden");
        btn.textContent = open ? "\u25b8" : "\u25be";
        if (!open && !body.dataset.rendered) {
          body.innerHTML = renderThreadBody(g);
          body.dataset.rendered = "1";
        }
      } else if (act === "summarize") {
        var sum = groupEl.querySelector(".thread-summary");
        sum.classList.remove("hidden");
        sum.textContent = "Summarizing\u2026";
        btn.disabled = true;
        try {
          sum.textContent = (await summarizeThread(g)).trim();
        } catch (err) { sum.textContent = "\u274c " + err.message; }
        finally { btn.disabled = false; }
      }
    }
  }

  async function summarizeThread(g) {
    var demo = await SC.isDemo();
    var settings = (await SC.storage.get(AI_SETTINGS_KEY)) || {};
    var apiKey = settings.provider ? await SC.vault.loadApiKey(settings.provider) : null;
    var flat = flattenThread(g);
    if (!flat.length) return "This thread has no comments yet.";
    if (!apiKey) {
      if (demo) return SC.demoThreadSummary(flat);
      if (!settings.provider) throw new Error("Configure an AI provider in Settings first.");
      throw new Error("No API key stored for " + settings.provider + ".");
    }
    return SC.generateDraft({
      provider: settings.provider,
      apiKey: apiKey,
      model: settings.model,
      system: SC.THREAD_SUMMARY_SYSTEM_PROMPT,
      maxTokens: 800,
      prompt: SC.buildThreadSummaryPrompt({
        postText: g.post ? g.post.post_text : "",
        comments: flat,
      }),
    });
  }

  /* ------------------------- pillar tracker ------------------------ */

  var PILLAR_STATUS_META = {
    ok:      { icon: "\u2705", label: "on track" },
    due:     { icon: "\u23f3", label: "due" },
    overdue: { icon: "\ud83d\udd34", label: "drought" },
    never:   { icon: "\u26aa", label: "never posted" },
    none:    { icon: "\u2796", label: "no target" },
  };

  function renderPillarTracker() {
    var host = $("dash-pillar-tracker");
    if (!host) return;
    if (!state.pillars.length) {
      host.innerHTML = '<p class="muted">No pillars yet \u2014 set them up in Settings.</p>';
      return;
    }
    var coverage = SC.health.pillarCoverage(state.posts, state.pillars);
    host.innerHTML = coverage.map(function (c) {
      var meta = PILLAR_STATUS_META[c.status] || PILLAR_STATUS_META.none;
      var since = c.daysSinceLast === null ? "never posted"
        : c.daysSinceLast === 0 ? "posted today"
        : "last " + c.daysSinceLast + "d ago";
      var pct = Math.min(100, c.targetPct > 0 ? (c.actualPct / c.targetPct) * 100 : 0);
      return '<div class="pillar-line ' + c.status + '">' +
        '<div class="pl-head"><span class="pl-name">' + meta.icon + " " + escapeHtml(c.name) + "</span>" +
        '<span class="pl-meta">' + c.actualPct + "% of " + c.targetPct + "% target \u00b7 " +
        c.postsInWindow + " post(s) \u00b7 " + since + "</span></div>" +
        '<div class="pl-track"><div class="pl-fill" style="width:' + pct.toFixed(0) + '%"></div></div>' +
        "</div>";
    }).join("");
  }

  function fillGenPillarSelect() {
    var sel = $("gen-pillar");
    if (!sel) return;
    var keep = sel.value || "auto";
    sel.innerHTML = '<option value="auto">Auto (most overdue)</option>';
    state.pillars.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.slug;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === keep; })
      ? keep : "auto";
  }

  /* --------------------------- generation -------------------------- */

  async function generateDraft() {
    $("gen-error").textContent = "";
    var btn = $("gen-go");
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      var demo = await SC.isDemo();
      var settings = (await SC.storage.get(AI_SETTINGS_KEY)) || {};
      var apiKey = settings.provider ? await SC.vault.loadApiKey(settings.provider) : null;
      if (!demo) {
        if (!settings.provider) throw new Error("Configure an AI provider in Settings first.");
        if (!apiKey) throw new Error("No API key stored for " + settings.provider + ". Add it in Settings.");
      }

      var balance = SC.health.pillarBalance(state.posts, state.pillars);
      var overdue = SC.health.mostOverduePillar(balance);
      // Manual pillar choice from the dropdown beats the auto pick.
      var chosen = $("gen-pillar") ? $("gen-pillar").value : "auto";
      if (chosen && chosen !== "auto") {
        var manual = state.pillars.find(function (p) { return p.slug === chosen; });
        if (manual) {
          var bal = (balance.rows || []).find(function (r) { return r.slug === chosen; });
          overdue = { slug: manual.slug, name: manual.name, description: manual.description,
            deficit: bal ? bal.deficit : 0, targetPct: manual.target_ratio };
        }
      }
      if (!overdue) {
        var byTarget = state.pillars.slice().sort(function (a, b) {
          return (b.target_ratio || 0) - (a.target_ratio || 0);
        });
        overdue = byTarget[0]
          ? { slug: byTarget[0].slug, name: byTarget[0].name,
              description: byTarget[0].description, deficit: 0, targetPct: byTarget[0].target_ratio }
          : { slug: "question", name: "Engagement Question", description: "", deficit: 0, targetPct: 0 };
      }

      var community = currentCommunity();
      var recentTitles = state.posts.slice(0, 8).map(function (p) {
        return (p.post_text || "").split("\n")[0].slice(0, 90);
      });

      var text;
      if (!apiKey) {
        // demo mode without a key: canned draft so the flow still works
        text = SC.demoDraft(overdue.name, $("gen-seed").value.trim());
      } else {
        text = await SC.generateDraft({
          provider: settings.provider,
          apiKey: apiKey,
          model: settings.model,
          system: SC.DRAFT_SYSTEM_PROMPT,
          prompt: SC.buildDraftPrompt({
            communityName: community ? community.name : "",
            pillarName: overdue.name,
            pillarDescription: overdue.description,
            reason: overdue.deficit > 0
              ? "This pillar is " + overdue.deficit + " points under its target share of recent posts."
              : "",
            healthDigest: SC.health.digest(state.posts, state.comments, state.pillars),
            voice: state.voice || {},
            seed: $("gen-seed").value.trim(),
            recentTitles: recentTitles,
            style: {
              maxChars: Number($("gen-length").value) || 500,
              emoji: $("gen-emoji").value,
            },
          }),
        });
      }

      var parts = text.split(/\n\s*\n/);
      var title = (parts.shift() || "").replace(/^#+\s*/, "").trim();
      if ($("gen-unicode").checked && !SC.uni.isStyled(title)) {
        title = SC.uni.style(title, "bold");
      }
      $("gen-title").value = title;
      $("gen-body").value = parts.join("\n\n").trim();
      updateGenCount();
      $("gen-result").classList.remove("hidden");
      $("gen-result").dataset.pillar = overdue.slug;
      $("gen-result").dataset.provider = apiKey ? settings.provider : "demo";
      $("gen-result").dataset.model = apiKey
        ? (settings.model || SC.PROVIDERS[settings.provider].defaultModel)
        : "sample";
    } catch (e) {
      $("gen-error").textContent = String((e && e.message) || e);
    } finally {
      btn.disabled = false;
      btn.textContent = "⚡ Generate draft";
    }
  }

  function updateGenCount() {
    var total = $("gen-title").value.length + $("gen-body").value.length;
    $("gen-count").textContent = total + " chars";
  }

  /* ------------------------ AI deep review ------------------------- */

  async function analyzeCommunity() {
    $("analyze-error").textContent = "";
    var btn = $("analyze-go");
    var out = $("analyze-output");
    btn.disabled = true;
    try {
      var demo = await SC.isDemo();
      var settings = (await SC.storage.get(AI_SETTINGS_KEY)) || {};
      var apiKey = settings.provider ? await SC.vault.loadApiKey(settings.provider) : null;
      if (!demo) {
        if (!settings.provider) throw new Error("Configure an AI provider in Settings first.");
        if (!apiKey) throw new Error("No API key stored for " + settings.provider + ". Add it in Settings.");
      }

      out.classList.remove("hidden");
      out.classList.add("loading");
      out.textContent = "Reading your stats and comments…";

      var digestLines = SC.health.digest(state.posts, state.comments, state.pillars);
      var text;
      if (!apiKey) {
        text = SC.demoReview(digestLines);
      } else {
        var sampleComments = state.comments.slice(0, 40).map(function (c) {
          return (c.author || "member") + ": " +
            (c.comment_text || "").replace(/\s+/g, " ").slice(0, 200);
        });
        var samplePosts = state.posts.slice(0, 10).map(function (p) {
          return (p.post_text || "").split("\n")[0].slice(0, 90);
        });
        text = await SC.generateDraft({
          provider: settings.provider,
          apiKey: apiKey,
          model: settings.model,
          system: SC.ANALYSIS_SYSTEM_PROMPT,
          maxTokens: 1500,
          prompt: SC.buildAnalysisPrompt({
            communityName: currentCommunity() ? currentCommunity().name : "",
            digestLines: digestLines,
            pillars: state.pillars,
            samplePosts: samplePosts,
            sampleComments: sampleComments,
          }),
        });
      }
      out.classList.remove("loading");
      out.textContent = text.trim();
    } catch (e) {
      out.classList.add("hidden");
      $("analyze-error").textContent = String((e && e.message) || e);
    } finally {
      btn.disabled = false;
    }
  }

  async function saveGenerated() {
    var box = $("gen-result");
    await state.client.from("drafts").insert({
      community_id: state.currentId,
      pillar_slug: box.dataset.pillar || null,
      title: $("gen-title").value,
      body: $("gen-body").value,
      ai_provider: box.dataset.provider || null,
      ai_model: box.dataset.model || null,
    });
    flash($("gen-save"), "✅ Saved");
  }

  /* ------------------------------ ideas ---------------------------- */

  async function renderIdeas() {
    await loadCommunityData();
    var list = $("ideas-list");
    var inbox = state.ideas.filter(function (i) { return i.status !== "archived"; });
    list.innerHTML = inbox.length
      ? inbox.map(function (i) {
          return "<li data-id='" + i.id + "'>" +
            "<span class='grow'>" + escapeHtml(i.content) +
            " <span class='meta'>(" + i.source + (i.status === "used" ? " · used" : "") + ")</span></span>" +
            "<button class='btn small' data-act='use'>Draft it</button>" +
            "<button class='btn small' data-act='archive'>✕</button></li>";
        }).join("")
      : '<li><span class="meta">Nothing captured yet. Use 💡 on skool.com or add one above.</span></li>';
  }

  async function onIdeaClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var li = btn.closest("li[data-id]");
    var idea = state.ideas.find(function (i) { return i.id === li.dataset.id; });
    if (!idea) return;
    if (btn.dataset.act === "archive") {
      await state.client.from("ideas").update({ status: "archived" }).eq("id", idea.id);
      renderIdeas();
    } else if (btn.dataset.act === "use") {
      await state.client.from("ideas").update({ status: "used" }).eq("id", idea.id);
      location.hash = "#/dashboard";
      setTimeout(function () {
        $("gen-seed").value = idea.content;
        $("gen-seed").scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }

  async function addIdea() {
    var input = $("idea-input");
    var content = input.value.trim();
    if (!content) return;
    await state.client.from("ideas").insert({
      community_id: state.currentId,
      source: "manual",
      content: content,
    });
    input.value = "";
    renderIdeas();
  }

  /* ------------------------------ drafts --------------------------- */

  async function renderDrafts() {
    await loadCommunityData();
    var host = $("drafts-list");
    if (!state.drafts.length) {
      host.innerHTML = '<div class="card"><p class="muted">No drafts yet — generate one from the dashboard.</p></div>';
      return;
    }
    host.innerHTML = state.drafts.map(function (d) {
      return '<div class="card draft-card" data-id="' + d.id + '">' +
        '<div class="row" style="justify-content:space-between">' +
        '<span class="status ' + d.status + '">' + d.status + "</span>" +
        '<span class="meta">' + (d.pillar_slug ? escapeHtml(d.pillar_slug) + " · " : "") +
        escapeHtml(d.ai_model || "") + "</span></div>" +
        '<label class="field">Title <input data-f="title" value="' +
        escapeHtml(d.title).replace(/"/g, "&quot;") + '"></label>' +
        '<label class="field">Body <textarea data-f="body" rows="8">' +
        escapeHtml(d.body) + "</textarea></label>" +
        '<div class="row">' +
        '<button class="btn small" data-act="bold" title="Unicode-bold selected text">𝗕</button>' +
        '<button class="btn small" data-act="copy">📋 Copy</button>' +
        '<button class="btn small" data-act="save">💾 Save edits</button>' +
        (d.status === "draft" ? '<button class="btn small" data-act="ready">Mark ready</button>' : "") +
        '<input type="date" data-f="date" style="max-width:150px">' +
        '<button class="btn small" data-act="queue">📅 Queue</button>' +
        '<button class="btn small danger" data-act="delete">Delete</button>' +
        "</div></div>";
    }).join("");
  }

  async function onDraftClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var card = btn.closest(".draft-card");
    var id = card.dataset.id;
    var title = card.querySelector('[data-f="title"]').value;
    var body = card.querySelector('[data-f="body"]').value;
    var act = btn.dataset.act;

    if (act === "bold") {
      var field = card._lastField || card.querySelector('[data-f="body"]');
      SC.uni.styleSelection(field, "bold");
    } else if (act === "copy") {
      navigator.clipboard.writeText(title + "\n\n" + body);
      flash(btn, "✅");
    } else if (act === "save") {
      await state.client.from("drafts").update({ title: title, body: body }).eq("id", id);
      flash(btn, "✅");
    } else if (act === "ready") {
      await state.client.from("drafts").update({ status: "ready" }).eq("id", id);
      renderDrafts();
    } else if (act === "delete") {
      await state.client.from("drafts").delete().eq("id", id);
      renderDrafts();
    } else if (act === "queue") {
      var date = card.querySelector('[data-f="date"]').value;
      if (!date) { flash(btn, "Pick a date"); return; }
      await state.client.from("queue").insert({
        community_id: state.currentId,
        draft_id: id,
        scheduled_for: date,
      });
      flash(btn, "✅ Queued");
    }
  }

  /* ------------------------------ queue ---------------------------- */

  async function renderQueue() {
    await loadCommunityData();
    var list = $("queue-list");
    var open = state.queue.filter(function (q) { return q.status === "queued"; });
    if (!open.length) {
      list.innerHTML = '<li><span class="meta">Queue is empty.</span></li>';
      return;
    }
    var draftsById = {};
    state.drafts.forEach(function (d) { draftsById[d.id] = d; });
    list.innerHTML = open.map(function (q) {
      var d = draftsById[q.draft_id];
      var title = d ? d.title || d.body.slice(0, 60) : "(draft deleted)";
      return "<li data-id='" + q.id + "' data-draft='" + q.draft_id + "'>" +
        "<span class='grow'><strong>" + escapeHtml(q.scheduled_for) + "</strong> — " +
        escapeHtml(title) + "</span>" +
        "<button class='btn small' data-act='copy'>📋</button>" +
        "<button class='btn small' data-act='posted'>✅ Posted</button>" +
        "<button class='btn small' data-act='skip'>Skip</button></li>";
    }).join("");
  }

  async function onQueueClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var li = btn.closest("li[data-id]");
    var act = btn.dataset.act;
    if (act === "copy") {
      var d = state.drafts.find(function (x) { return x.id === li.dataset.draft; });
      if (d) navigator.clipboard.writeText(d.title + "\n\n" + d.body);
      flash(btn, "✅");
      return;
    }
    var status = act === "posted" ? "posted" : "skipped";
    await state.client.from("queue").update({ status: status }).eq("id", li.dataset.id);
    if (act === "posted") {
      await state.client.from("drafts").update({ status: "posted" }).eq("id", li.dataset.draft);
    }
    renderQueue();
  }

  /* ----------------------------- settings -------------------------- */

  function fillModels(provider) {
    var meta = SC.PROVIDERS[provider];
    var sel = $("set-model");
    sel.innerHTML = "";
    meta.models.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m + (m === meta.defaultModel ? " (default)" : "");
      sel.appendChild(opt);
    });
    sel.value = meta.defaultModel;
    $("set-api-key").placeholder = meta.keyHint || "";
  }

  async function renderSettings() {
    await loadCommunityData();

    // AI
    var sel = $("set-provider");
    if (!sel.options.length) {
      Object.keys(SC.PROVIDERS).forEach(function (p) {
        var opt = document.createElement("option");
        opt.value = p;
        opt.textContent = SC.PROVIDERS[p].label;
        sel.appendChild(opt);
      });
    }
    var ai = (await SC.storage.get(AI_SETTINGS_KEY)) || {};
    sel.value = ai.provider || "anthropic";
    fillModels(sel.value);
    if (ai.model) $("set-model").value = ai.model;
    var stored = await SC.vault.loadApiKey(sel.value);
    $("set-ai-status").textContent = stored ? "A key is saved for this provider." : "";

    // Pillars
    var tsel = $("pillar-template");
    if (tsel && !tsel.options.length) {
      var ph = document.createElement("option");
      ph.value = ""; ph.textContent = "Pick a community type\u2026";
      tsel.appendChild(ph);
      (SC.PILLAR_TEMPLATES || []).forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t.id; opt.textContent = t.label;
        tsel.appendChild(opt);
      });
    }
    var host = $("pillars-editor");
    host.innerHTML = "";
    state.pillars.forEach(function (p) { host.appendChild(pillarRow(p)); });

    // Voice
    var v = state.voice || {};
    $("voice-tone").value = v.tone_notes || "";
    $("voice-banned").value = (v.banned_words || []).join(", ");
    $("voice-format").value = v.formatting_rules || "";

    // Communities
    $("communities-list").innerHTML = state.communities.map(function (c) {
      return "<li data-id='" + c.id + "'><span class='grow'>" + escapeHtml(c.name) +
        " <span class='meta'>" + escapeHtml(c.skool_url) + "</span></span>" +
        "<button class='btn small danger' data-act='remove'>Remove</button></li>";
    }).join("");

    // Backend
    var cfg = await SC.loadConfig();
    $("set-supabase-url").value = cfg.supabaseUrl;
    $("set-supabase-key").value = cfg.supabaseAnonKey;
    renderExtensionStatus();
  }

  function pillarRow(p) {
    var row = document.createElement("div");
    row.className = "pillar-row";
    row.dataset.id = p.id || "";
    row.dataset.slug = p.slug || "";
    row.innerHTML =
      '<input data-f="name" placeholder="Name" value="' + escapeHtml(p.name).replace(/"/g, "&quot;") + '">' +
      '<input data-f="description" placeholder="Description" value="' + escapeHtml(p.description).replace(/"/g, "&quot;") + '">' +
      '<input data-f="target" type="number" min="0" max="100" value="' + (p.target_ratio || 0) + '">' +
      '<button class="btn small danger" data-act="del">✕</button>';
    row.querySelector('[data-act="del"]').addEventListener("click", function () {
      row.remove();
    });
    return row;
  }

  async function savePillars() {
    var rows = Array.from(document.querySelectorAll("#pillars-editor .pillar-row"));
    var keepIds = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var name = row.querySelector('[data-f="name"]').value.trim();
      if (!name) continue;
      var payload = {
        community_id: state.currentId,
        slug: row.dataset.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
        name: name,
        description: row.querySelector('[data-f="description"]').value.trim(),
        target_ratio: Number(row.querySelector('[data-f="target"]').value) || 0,
        position: i,
      };
      if (row.dataset.id) {
        await state.client.from("pillars").update(payload).eq("id", row.dataset.id);
        keepIds.push(row.dataset.id);
      } else {
        var inserted = await state.client.from("pillars").insert(payload);
        if (inserted && inserted[0]) keepIds.push(inserted[0].id);
      }
    }
    // Delete pillars removed from the editor.
    for (var j = 0; j < state.pillars.length; j++) {
      if (keepIds.indexOf(state.pillars[j].id) === -1) {
        await state.client.from("pillars").delete().eq("id", state.pillars[j].id);
      }
    }
    $("pillars-status").textContent = "Saved.";
    renderSettings();
  }

  async function saveVoice() {
    var banned = $("voice-banned").value
      .split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var payload = {
      community_id: state.currentId,
      tone_notes: $("voice-tone").value.trim(),
      banned_words: banned,
      formatting_rules: $("voice-format").value.trim(),
      updated_at: new Date().toISOString(),
    };
    if (state.voice && state.voice.id) {
      await state.client.from("voice_profiles").update(payload).eq("id", state.voice.id);
    } else {
      await state.client.from("voice_profiles").insert(payload);
    }
    $("voice-status").textContent = "Saved.";
  }

  async function addCommunity() {
    $("setup-error").textContent = "";
    try {
      var name = $("setup-name").value.trim();
      var url = $("setup-url").value.trim();
      if (!name || !url) throw new Error("Name and URL are required.");
      if (!SC.skoolSlug(url)) throw new Error("That doesn't look like a Skool community URL.");
      if (!$("setup-own").checked) {
        throw new Error("Confirm that you own or admin this community.");
      }
      var payload = { name: name, skool_url: url };
      if (state.user && state.user.id) payload.user_id = state.user.id; // absent in solo mode
      var rows = await state.client.from("communities").insert(payload);
      await loadCommunities();
      if (rows && rows[0]) state.currentId = rows[0].id;
      $("setup-name").value = "";
      $("setup-url").value = "";
      $("setup-own").checked = false;
      location.hash = "#/dashboard";
      route();
    } catch (e) {
      $("setup-error").textContent = String((e && e.message) || e);
    }
  }

  /* ------------------------------ misc ------------------------------ */

  function flash(btn, label) {
    var original = btn.textContent;
    btn.textContent = label;
    setTimeout(function () { btn.textContent = original; }, 1400);
  }

  // The extension's connect.js content script (if installed) listens for
  // this event and mirrors saved settings into extension storage.
  function notifyExtension() {
    document.dispatchEvent(new CustomEvent("sc-sync"));
  }

  function renderExtensionStatus() {
    var connected = document.documentElement.hasAttribute("data-sc-extension");
    var msg = connected
      ? "🧩 Extension detected — backend + AI settings sync to it automatically."
      : "🧩 Extension not detected on this page. Install it and reload — settings will sync over automatically.";
    ["ext-status-cfg", "ext-status-set"].forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = msg;
    });
  }

  /* ----------------------------- wiring ----------------------------- */

  function wireStaticHandlers() {
    // Configure
    $("cfg-save").addEventListener("click", async function () {
      $("cfg-error").textContent = "";
      var url = $("cfg-url").value.trim();
      var key = $("cfg-key").value.trim();
      if (!url || !key) { $("cfg-error").textContent = "Both fields are required."; return; }
      $("cfg-error").textContent = "Checking the project…";
      var result = await SC.verifyBackend(url, key);
      if (!result.ok) { $("cfg-error").textContent = "❌ " + result.error; return; }
      await SC.saveConfig({ supabaseUrl: url, supabaseAnonKey: key });
      notifyExtension();
      state.client = await SC.getClient();
      show("view-auth");
    });

    // Copy schema.sql to the clipboard for pasting into Supabase.
    $("cfg-copy-schema").addEventListener("click", async function () {
      try {
        var res = await fetch("../supabase/schema.sql");
        if (!res.ok) throw new Error("fetch failed");
        await navigator.clipboard.writeText(await res.text());
        flash($("cfg-copy-schema"), "✅ Copied");
      } catch (e) {
        $("cfg-error").textContent =
          "Couldn't load schema.sql from this host — copy it from the repo instead.";
      }
    });

    // Auth
    $("auth-signin").addEventListener("click", function () { auth(false); });
    $("auth-signup").addEventListener("click", function () { auth(true); });
    async function auth(isSignUp) {
      $("auth-error").textContent = "";
      try {
        var email = $("auth-email").value.trim();
        var password = $("auth-password").value;
        if (isSignUp) {
          await state.client.signUp(email, password);
          if (!(await state.client.ensureSession())) {
            $("auth-error").textContent =
              "Account created, but Supabase wants an email confirmation. Its free " +
              "email sender is rate-limited, so the easiest fix is to turn confirmation " +
              "OFF: in Supabase go to Authentication → Sign In / Providers → Email and " +
              "switch off \"Confirm email\", then sign in here. (No email needed after that.)";
            return;
          }
        } else {
          await state.client.signIn(email, password);
        }
        state.user = await state.client.getUser();
        await loadCommunities();
        if (!state.communities.length) show("view-setup");
        else { location.hash = "#/dashboard"; route(); }
      } catch (e) {
        $("auth-error").textContent = SC.friendlyAuthError(e);
      }
    }

    $("auth-signout").addEventListener("click", async function () {
      var wasDemo = await SC.isDemo();
      var wasSolo = await SC.isSolo();
      if (wasSolo) await SC.disableSolo();
      await state.client.signOut(); // in demo mode this clears the flag + sample db
      notifyExtension();
      location.hash = "";
      if (wasDemo || wasSolo) location.reload();
      else show("view-auth");
    });

    // Solo mode: copy the one-time SQL, then enable after it has been run.
    $("solo-copy-sql").addEventListener("click", async function () {
      try {
        var res = await fetch("../supabase/solo-mode.sql");
        if (!res.ok) throw new Error("fetch failed");
        await navigator.clipboard.writeText(await res.text());
        flash($("solo-copy-sql"), "✅ Copied");
      } catch (e) {
        $("solo-status").textContent =
          "Couldn't load solo-mode.sql from this host — copy it from the repo instead.";
      }
    });
    $("solo-enable").addEventListener("click", async function () {
      $("solo-status").textContent = "Checking that the solo-mode SQL has been run…";
      try {
        // Probe: without a session, an insert only succeeds once the solo
        // policies exist. Clean up the probe row immediately.
        var probe = await state.client.from("communities").insert({
          name: "__solo_probe__",
          skool_url: "https://www.skool.com/__solo-probe__",
        });
        if (probe && probe[0] && probe[0].id) {
          await state.client.from("communities").delete().eq("id", probe[0].id);
        }
        await SC.enableSolo();
        notifyExtension();
        $("solo-status").textContent = "✅ Solo mode on — loading…";
        location.reload();
      } catch (e) {
        $("solo-status").textContent =
          "❌ Not yet: the database still requires sign-in. Copy the solo-mode SQL " +
          "(step 1), run it in Supabase → SQL Editor, then click Enable again. " +
          "(Details: " + String((e && e.message) || e) + ")";
      }
    });

    // Demo mode
    $("demo-go").addEventListener("click", async function () {
      await SC.enableDemo();
      location.reload();
    });

    // Setup
    $("setup-save").addEventListener("click", addCommunity);
    $("community-add").addEventListener("click", function () { show("view-setup"); });

    // Community picker
    $("community-picker").addEventListener("change", function (e) {
      state.currentId = e.target.value;
      route();
    });

    // Dashboard generator
    $("gen-go").addEventListener("click", generateDraft);
    $("gen-save").addEventListener("click", saveGenerated);
    $("gen-copy").addEventListener("click", function () {
      navigator.clipboard.writeText($("gen-title").value + "\n\n" + $("gen-body").value);
      flash($("gen-copy"), "✅ Copied");
    });
    $("gen-title").addEventListener("input", updateGenCount);
    $("gen-body").addEventListener("input", updateGenCount);
    var lastGenField = null;
    ["gen-title", "gen-body"].forEach(function (id) {
      $(id).addEventListener("focus", function () { lastGenField = $(id); });
    });
    $("gen-bold").addEventListener("mousedown", function (e) {
      e.preventDefault(); // keep the field's selection alive
      SC.uni.styleSelection(lastGenField || $("gen-title"), "bold");
      updateGenCount();
    });
    $("analyze-go").addEventListener("click", analyzeCommunity);

    // Inbox
    $("inbox-list").addEventListener("click", onInboxClick);
    $("threads-host").addEventListener("click", onInboxClick);
    $("inbox-threshold").addEventListener("change", renderInbox);

    // Ideas
    $("idea-add").addEventListener("click", addIdea);
    $("ideas-list").addEventListener("click", onIdeaClick);

    // Drafts / queue
    $("drafts-list").addEventListener("click", onDraftClick);
    $("drafts-list").addEventListener("focusin", function (e) {
      var card = e.target.closest && e.target.closest(".draft-card");
      if (card && e.target.matches("input, textarea")) card._lastField = e.target;
    });
    $("queue-list").addEventListener("click", onQueueClick);

    // Settings
    $("set-provider").addEventListener("change", async function (e) {
      fillModels(e.target.value);
      $("set-api-key").value = "";
      var stored = await SC.vault.loadApiKey(e.target.value);
      $("set-ai-status").textContent = stored ? "A key is saved for this provider." : "";
    });
    $("set-save-ai").addEventListener("click", async function () {
      var provider = $("set-provider").value;
      var key = $("set-api-key").value.trim();
      if (key) await SC.vault.saveApiKey(provider, key);
      await SC.storage.set(AI_SETTINGS_KEY, { provider: provider, model: $("set-model").value });
      $("set-api-key").value = "";
      notifyExtension();
      $("set-ai-status").textContent = key
        ? "Key saved (encrypted, local to this browser — syncs to the extension if installed)."
        : "Provider preference saved.";
    });
    $("set-test").addEventListener("click", async function () {
      var provider = $("set-provider").value;
      var key = $("set-api-key").value.trim() || (await SC.vault.loadApiKey(provider));
      if (!key) { $("set-ai-status").textContent = "No key to test — paste one first."; return; }
      $("set-ai-status").textContent = "Testing…";
      try {
        await SC.testConnection(provider, key, $("set-model").value);
        $("set-ai-status").textContent = "✅ Connection works.";
      } catch (e) {
        $("set-ai-status").textContent = "❌ " + String((e && e.message) || e);
      }
    });
    // Load a pillar set (template or AI suggestion) into the editor.
    // Rows matching an existing pillar's slug carry its id so saving
    // UPDATES it (avoiding unique-slug collisions); everything else
    // inserts, and pillars missing from the editor get deleted on save.
    function slugify(name) {
      return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "").slice(0, 40);
    }
    function editorLoadPillars(list) {
      var host = $("pillars-editor");
      host.innerHTML = "";
      (list || []).forEach(function (p) {
        var slug = p.slug || slugify(p.name);
        var existing = state.pillars.find(function (e) { return e.slug === slug; });
        host.appendChild(pillarRow({
          id: existing ? existing.id : "",
          slug: slug,
          name: p.name,
          description: p.description || "",
          target_ratio: p.target_ratio || 0,
        }));
      });
      $("pillars-status").textContent =
        "Loaded \u2014 review the rows, then click Save pillars to make it real.";
    }

    $("pillar-template").addEventListener("change", function (e) {
      var t = SC.pillarTemplateById(e.target.value);
      $("pillar-template-blurb").textContent = t ? t.blurb : "";
    });
    $("pillar-template-apply").addEventListener("click", function () {
      var t = SC.pillarTemplateById($("pillar-template").value);
      if (!t) { $("pillars-status").textContent = "Pick a community type first."; return; }
      editorLoadPillars(t.pillars);
    });

    $("pillar-suggest").addEventListener("click", async function () {
      var btn = $("pillar-suggest");
      btn.disabled = true;
      $("pillars-status").textContent = "Thinking about your community\u2026";
      try {
        var demo = await SC.isDemo();
        var settings = (await SC.storage.get(AI_SETTINGS_KEY)) || {};
        var apiKey = settings.provider ? await SC.vault.loadApiKey(settings.provider) : null;
        var suggested;
        if (!apiKey) {
          if (!demo) throw new Error("Add an AI key in Settings above first \u2014 suggestions are one BYOK call.");
          suggested = SC.demoPillarSuggestion();
        } else {
          var titles = state.posts.slice(0, 12).map(function (p) {
            return (p.post_text || "").split("\n")[0].slice(0, 90);
          });
          var about = window.prompt(
            "One sentence: what is your community about, and for whom?", "") || "";
          var text = await SC.generateDraft({
            provider: settings.provider, apiKey: apiKey, model: settings.model,
            system: SC.PILLAR_SUGGEST_SYSTEM_PROMPT, maxTokens: 1200,
            prompt: SC.buildPillarSuggestPrompt({
              communityName: currentCommunity() ? currentCommunity().name : "",
              about: about, recentTitles: titles,
            }),
          });
          suggested = SC.parsePillarSuggestions(text);
          if (!suggested) throw new Error("Couldn\u0027t parse the suggestion \u2014 try again.");
        }
        editorLoadPillars(suggested);
      } catch (err) {
        $("pillars-status").textContent = "\u274c " + err.message;
      } finally {
        btn.disabled = false;
      }
    });

    $("pillar-add").addEventListener("click", function () {
      $("pillars-editor").appendChild(
        pillarRow({ name: "", description: "", target_ratio: 0 })
      );
    });
    $("pillars-save").addEventListener("click", savePillars);
    $("voice-save").addEventListener("click", saveVoice);
    $("communities-list").addEventListener("click", async function (e) {
      var btn = e.target.closest("button[data-act='remove']");
      if (!btn) return;
      if (!confirm("Remove this community and all its data?")) return;
      var li = btn.closest("li[data-id]");
      await state.client.from("communities").delete().eq("id", li.dataset.id);
      state.currentId = null;
      await loadCommunities();
      if (!state.communities.length) show("view-setup");
      else renderSettings();
    });
    $("set-save-backend").addEventListener("click", async function () {
      await SC.saveConfig({
        supabaseUrl: $("set-supabase-url").value,
        supabaseAnonKey: $("set-supabase-key").value,
      });
      notifyExtension();
      location.reload();
    });
  }

  boot();
})();
