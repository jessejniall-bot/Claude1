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
    state.user = await state.client.getUser();
    if (!state.user) return show("view-auth");
    await loadCommunities();
    if (!state.communities.length) return show("view-setup");
    route();
  }

  function show(viewId) {
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("hidden", v.id !== viewId);
    });
    var inApp = ["view-dashboard", "view-ideas", "view-drafts", "view-queue", "view-settings"]
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
      },
    ];
    $("dash-stats").innerHTML = tiles.map(function (t) {
      return '<div class="stat"><div class="v">' + t.v + '</div><div class="l">' + t.l + "</div></div>";
    }).join("");

    SCCharts.lineChart($("chart-engagement"), trend.points);
    SCCharts.pillarBars($("chart-pillars"), balance.rows);

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
      var rows = await state.client.from("communities").insert({
        user_id: state.user.id,
        name: name,
        skool_url: url,
      });
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

  /* ----------------------------- wiring ----------------------------- */

  function wireStaticHandlers() {
    // Configure
    $("cfg-save").addEventListener("click", async function () {
      $("cfg-error").textContent = "";
      var url = $("cfg-url").value.trim();
      var key = $("cfg-key").value.trim();
      if (!url || !key) { $("cfg-error").textContent = "Both fields are required."; return; }
      await SC.saveConfig({ supabaseUrl: url, supabaseAnonKey: key });
      state.client = await SC.getClient();
      show("view-auth");
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
            $("auth-error").textContent = "Account created — confirm your email, then sign in.";
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
        $("auth-error").textContent = String((e && e.message) || e);
      }
    }

    $("auth-signout").addEventListener("click", async function () {
      var wasDemo = await SC.isDemo();
      await state.client.signOut(); // in demo mode this clears the flag + sample db
      location.hash = "";
      if (wasDemo) location.reload();
      else show("view-auth");
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
      $("set-ai-status").textContent = key
        ? "Key saved (encrypted, local to this browser)."
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
      location.reload();
    });
  }

  boot();
})();
