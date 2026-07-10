/* =====================================================================
   Skool Community Copilot — side panel logic
   ---------------------------------------------------------------------
   Compact mirror of the PWA's core screens: sign in, pick a community,
   see health, generate a draft without leaving Skool.
   ===================================================================== */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var client = null;
  var communities = [];
  var current = null; // selected community row
  var pillars = [];
  var posts = [];
  var comments = [];

  /* ----------------------------- boot ------------------------------ */

  async function boot() {
    // The standalone reply drafter needs no account, so the panel is never
    // blocked on a backend: show the shell + drafter first, then layer the
    // account features on top only if a backend is configured + signed in.
    $("sp-auth").classList.add("hidden");
    $("sp-main").classList.remove("hidden");
    initStandalone();
    try {
      client = await SC.getClient();
      var solo = client ? await SC.isSolo() : false;
      var user = client && !solo ? await client.getUser() : null;
      if (client && (solo || user)) {
        backendMode(true);
        await showMain();
      } else if (client) {
        // Backend is configured but we're signed out — offer to skip
        // sign-in for good, right here, or sign in with email.
        backendMode(false);
        $("sp-backend-note").innerHTML =
          "Signed out. The reply drafter below works as-is; " +
          "<button id=\"sp-connect\" class=\"link\" type=\"button\">skip sign-in for good</button> " +
          "to also track community health with zero sign-in.";
        wireBackendNote();
      } else {
        // No backend configured at all yet — that's the real first step.
        backendMode(false);
        $("sp-backend-note").innerHTML =
          "No account connected — the reply drafter below works as-is. Add your " +
          "Supabase project in " +
          "<button id=\"sp-open-settings\" class=\"link\" type=\"button\">Settings</button> " +
          "(free, a couple minutes) to also track community health, or just set your AI key there.";
        wireBackendNote();
      }
    } catch (e) {
      backendMode(false);
      $("sp-backend-note").textContent =
        "Account features are off (" + String((e && e.message) || e) +
        "). The reply drafter below still works.";
    }
  }

  // Toggle the account-only cards; the standalone drafter is always visible.
  function backendMode(on) {
    document.querySelectorAll(".needs-backend").forEach(function (el) {
      el.classList.toggle("hidden", !on);
    });
    $("sp-backend-note").classList.toggle("hidden", on);
  }

  function wireBackendNote() {
    var connect = $("sp-connect");
    if (connect) {
      connect.addEventListener("click", function () {
        showAuth("Skip sign-in for good below — or use the \"Prefer an account\" link " +
          "if you'd rather sign in with email.");
      });
    }
    var settings = $("sp-open-settings");
    if (settings) settings.addEventListener("click", function () { chrome.runtime.openOptionsPage(); });
  }

  function showAuth(note) {
    $("sp-auth").classList.remove("hidden");
    $("sp-main").classList.add("hidden");
    $("sp-auth-note").textContent = note;
  }

  async function showMain() {
    $("sp-auth").classList.add("hidden");
    $("sp-main").classList.remove("hidden");
    backendMode(true); // entering the full experience — reveal account cards
    communities = await client
      .from("communities")
      .select("id,name,skool_url,slug")
      .order("created_at");
    var sel = $("sp-community");
    sel.innerHTML = "";
    (communities || []).forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    var none = !communities || !communities.length;
    $("sp-add").classList.toggle("hidden", !none);
    $("sp-health").classList.toggle("hidden", none);
    if (none) {
      $("sp-stats").innerHTML = "";
      await prefillAddFromActiveTab();
      return;
    }
    await selectCommunity(communities[0].id);
  }

  // If the user is looking at their Skool community right now, prefill it.
  async function prefillAddFromActiveTab() {
    try {
      var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      var url = tabs && tabs[0] && tabs[0].url;
      if (url && /skool\.com\//.test(url) && SC.skoolSlug(url)) {
        $("sp-add-url").value = "https://www.skool.com/" + SC.skoolSlug(url);
        if (!$("sp-add-name").value) {
          $("sp-add-name").value = SC.skoolSlug(url)
            .replace(/-/g, " ")
            .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        }
      }
    } catch (e) { /* tabs unavailable — leave fields empty */ }
  }

  async function addCommunity() {
    $("sp-add-error").textContent = "";
    try {
      var name = $("sp-add-name").value.trim();
      var url = $("sp-add-url").value.trim();
      if (!name || !url) throw new Error("Name and URL are required.");
      if (!SC.skoolSlug(url)) throw new Error("That doesn't look like a Skool community URL.");
      if (!$("sp-add-own").checked) {
        throw new Error("Confirm that you own or admin this community.");
      }
      var user = await client.getUser();
      var payload = { name: name, skool_url: url };
      if (user && user.id) payload.user_id = user.id; // absent in solo mode
      await client.from("communities").insert(payload);
      chrome.runtime.sendMessage({ type: "REFRESH_COMMUNITIES" }, function () {
        void chrome.runtime.lastError;
      });
      await showMain();
    } catch (e) {
      $("sp-add-error").textContent = String((e && e.message) || e);
    }
  }

  async function selectCommunity(id) {
    current = communities.find(function (c) { return c.id === id; }) || null;
    if (!current) return;
    // Manual admin-override switch for this community.
    var slug = current.slug || SC.skoolSlug(current.skool_url);
    var overrides = (await SC.storage.get("sc_admin_override")) || {};
    $("sp-override-row").classList.remove("hidden");
    $("sp-override").checked = !!overrides[slug];
    var results = await Promise.all([
      client.from("pillars").select("*").eq("community_id", id).order("position"),
      client.from("scraped_posts").select("*").eq("community_id", id)
        .order("posted_at", { ascending: false }).limit(500),
      client.from("scraped_comments").select("*").eq("community_id", id)
        .order("commented_at", { ascending: false }).limit(1000),
    ]);
    pillars = results[0] || [];
    posts = results[1] || [];
    comments = results[2] || [];
    renderHealth();
  }

  /* ---------------------------- health ----------------------------- */

  function renderHealth() {
    var cad = SC.health.cadence(posts);
    var trend = SC.health.engagementTrend(posts);
    var balance = SC.health.pillarBalance(posts, pillars);
    var overdue = SC.health.mostOverduePillar(balance);
    var cstats = SC.health.commentStats(comments, posts);

    var score = SC.health.score(posts, comments, pillars);
    $("sp-score").innerHTML = posts.length
      ? '<span class="num ' + score.level + '">' + score.total + '</span>' +
        '<span class="verdict">/ 100 · ' + score.label + "</span>"
      : '<span class="verdict">Waiting for scraped data…</span>';

    var stats = [
      {
        l: "Posts / 30 days",
        v: String(cad.postsLast30),
      },
      {
        l: "Avg gap between posts",
        v: cad.avgGapDays == null ? "—" : cad.avgGapDays + "d",
      },
      {
        l: "Engagement trend",
        v: trend.trendPct == null
          ? "—"
          : '<span class="' + (trend.trendPct >= 0 ? "up" : "down") + '">' +
            (trend.trendPct >= 0 ? "▲ " : "▼ ") + Math.abs(trend.trendPct) + "%</span>",
      },
      {
        l: "Comments / post (30d)",
        v: cstats.commentsPerPost == null ? "—" : String(cstats.commentsPerPost),
      },
    ];
    $("sp-stats").innerHTML = stats
      .map(function (s) {
        return '<div class="stat"><div class="v">' + s.v + '</div><div class="l">' +
          s.l + "</div></div>";
      })
      .join("");

    var flags = SC.health.flags(posts, pillars);
    $("sp-flags").innerHTML = flags
      .map(function (f) {
        return '<li class="' + f.level + '">' + escapeHtml(f.message) + "</li>";
      })
      .join("");

    $("sp-overdue").textContent = overdue
      ? "Most overdue pillar: " + overdue.name + " (" + overdue.actualPct +
        "% actual vs " + overdue.targetPct + "% target)"
      : "No pillar data yet — browse your community with the extension active to collect posts.";

    renderInbox();
  }

  /* ------------------------ needs-response inbox ------------------- */

  function ownerNamesFromData() {
    var names = {};
    (comments || []).forEach(function (c) { if (c.is_owner && c.author) names[c.author] = true; });
    return Object.keys(names);
  }

  function renderInbox() {
    var host = $("sp-inbox");
    var status = $("sp-inbox-status");
    if (!current) { host.innerHTML = ""; return; }
    var items = SC.health.needsResponse(posts, comments, {
      thresholdHours: 24, ownerNames: ownerNamesFromData(),
    });
    if (!items.length) {
      status.textContent = comments.length
        ? "✅ Nothing waiting — you're caught up."
        : "No comments scraped yet. Open individual posts on Skool to collect threads.";
      host.innerHTML = "";
      return;
    }
    status.textContent = items.length + " waiting.";
    host.innerHTML = "";
    items.slice(0, 15).forEach(function (item) {
      var div = document.createElement("div");
      div.className = "sugg";
      div._item = item;
      var wait = item.waitingHours >= 48
        ? Math.round(item.waitingHours / 24) + "d" : item.waitingHours + "h";
      div.innerHTML =
        '<div class="head"><span class="who">' + escapeHtml(item.author || "Member") +
        '</span><span class="counts">waiting ' + wait + "</span></div>" +
        '<div class="snippet">' + escapeHtml((item.text || "").slice(0, 140)) + "</div>" +
        '<div class="row"><button class="btn small" data-act="suggest">✨ Suggest</button></div>' +
        '<div class="reply-wrap hidden">' +
        '<textarea class="reply-text" rows="3" autocapitalize="sentences" autocorrect="off"></textarea>' +
        '<div class="row">' +
        '<button class="btn small primary" data-act="post">📤 Post on Skool</button>' +
        '<button class="btn small" data-act="copy">📋 Copy</button>' +
        "</div><p class='muted inbox-item-status'></p></div>";
      host.appendChild(div);
    });
  }

  async function draftReplyFor(item) {
    var settings = (await SC.storage.get("sc_ai_settings")) || {};
    if (!settings.provider) throw new Error("No AI provider configured. Open Settings.");
    var apiKey = await SC.vault.loadApiKey(settings.provider);
    if (!apiKey) throw new Error("No API key stored for " + settings.provider + ". Open Settings.");
    var voiceRows = await client.from("voice_profiles").select("*")
      .eq("community_id", current.id).limit(1);
    var voice = (voiceRows && voiceRows[0]) || {};
    var post = posts.find(function (p) { return p.post_key === item.post_key; });
    return SC.generateDraft({
      provider: settings.provider, apiKey: apiKey, model: settings.model,
      system: SC.COMMENT_REPLY_SYSTEM_PROMPT, maxTokens: 1200,
      prompt: SC.buildCommentReplyPrompt({
        communityName: current.name, voice: voice,
        postText: post ? post.post_text : "",
        comment: { author: item.author, text: item.text },
      }),
    });
  }

  function postReplyOnPage(item, text) {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (!tab || !tab.url || tab.url.indexOf("skool.com") === -1) {
          resolve({ ok: false, code: "no_tab" }); return;
        }
        chrome.tabs.sendMessage(tab.id, {
          type: "SUBMIT_ON_PAGE_REPLY", text: text,
          postKey: item.post_key, parentCommentKey: item.comment_key || "",
        }, function (res) {
          if (chrome.runtime.lastError) { resolve({ ok: false, code: "no_tab" }); return; }
          resolve(res || { ok: false, error: "No response from page." });
        });
      });
    });
  }

  function communityBase() {
    var slug = current && (current.slug || SC.skoolSlug(current.skool_url));
    return "https://www.skool.com/" + (slug || "");
  }
  function postDeepLink(item) {
    var post = posts.find(function (p) { return p.post_key === item.post_key; });
    return post && post.post_name ? communityBase() + "/" + post.post_name : communityBase();
  }

  async function onInboxClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var card = btn.closest(".sugg");
    if (!card) return;
    var item = card._item;
    var wrap = card.querySelector(".reply-wrap");
    var ta = card.querySelector(".reply-text");
    var st = card.querySelector(".inbox-item-status");
    var act = btn.dataset.act;

    if (act === "suggest") {
      wrap.classList.remove("hidden");
      btn.disabled = true;
      var old = btn.textContent; btn.textContent = "Drafting…";
      try { ta.value = (await draftReplyFor(item)).trim(); }
      catch (err) { if (st) st.textContent = "❌ " + err.message; }
      finally { btn.disabled = false; btn.textContent = old; }
    } else if (act === "copy") {
      navigator.clipboard.writeText(ta.value).then(function () { if (st) st.textContent = "✅ Copied"; });
    } else if (act === "post") {
      if (!ta.value.trim()) { if (st) st.textContent = "Write a reply first."; return; }
      btn.disabled = true; if (st) st.textContent = "Posting…";
      var res = await postReplyOnPage(item, ta.value);
      if (res.ok) {
        if (st) st.textContent = "✅ Posted to Skool.";
      } else if (res.code === "no_template" || res.code === "not_active" || res.code === "no_tab") {
        // Fall back to copy + open the post so it's paste-and-send.
        try { await navigator.clipboard.writeText(ta.value); } catch (e2) {}
        window.open(postDeepLink(item), "_blank", "noopener");
        if (st) st.textContent = res.code === "no_template"
          ? "Copied — reply to one comment manually on Skool once so I can learn how to post, then this posts directly."
          : "Copied & opened Skool — paste and send.";
      } else {
        if (st) st.textContent = "❌ " + (res.error || "Couldn't post.");
      }
      btn.disabled = false;
    }
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  /* --------------------------- generation -------------------------- */

  async function generate() {
    $("sp-gen-error").textContent = "";
    var btn = $("sp-generate");
    btn.disabled = true;
    btn.textContent = "Generating…";
    try {
      if (!current) throw new Error("Pick a community first.");
      var settings = (await SC.storage.get("sc_ai_settings")) || {};
      var provider = settings.provider;
      if (!provider) throw new Error("No AI provider configured. Open Settings.");
      var apiKey = await SC.vault.loadApiKey(provider);
      if (!apiKey) throw new Error("No API key stored for " + provider + ". Open Settings.");

      var voiceRows = await client
        .from("voice_profiles").select("*").eq("community_id", current.id).limit(1);
      var voice = (voiceRows && voiceRows[0]) || {};

      var balance = SC.health.pillarBalance(posts, pillars);
      var overdue = SC.health.mostOverduePillar(balance) ||
        { name: "Engagement Question", slug: "question", description: "", deficit: 0, targetPct: 0 };

      var recentTitles = posts.slice(0, 8).map(function (p) {
        return (p.post_text || "").split("\n")[0].slice(0, 90);
      });

      var prompt = SC.buildDraftPrompt({
        communityName: current.name,
        pillarName: overdue.name,
        pillarDescription: overdue.description,
        reason: overdue.deficit > 0
          ? "This pillar is " + overdue.deficit + " points under its target share of recent posts."
          : "",
        healthDigest: SC.health.digest(posts, comments, pillars),
        voice: voice,
        seed: $("sp-seed").value.trim(),
        recentTitles: recentTitles,
        style: { maxChars: 500, emoji: "auto" },
      });

      var text = await SC.generateDraft({
        provider: provider,
        apiKey: apiKey,
        model: settings.model,
        system: SC.DRAFT_SYSTEM_PROMPT,
        prompt: prompt,
      });

      var parts = text.split(/\n\s*\n/);
      var title = (parts.shift() || "").replace(/^#+\s*/, "").trim();
      if ($("sp-unicode").checked && !SC.uni.isStyled(title)) {
        title = SC.uni.style(title, "bold");
      }
      $("sp-draft-title").value = title;
      $("sp-draft-body").value = parts.join("\n\n").trim();
      $("sp-draft").classList.remove("hidden");
      $("sp-draft").dataset.pillar = overdue.slug;
      $("sp-draft").dataset.provider = provider;
      $("sp-draft").dataset.model = settings.model || SC.PROVIDERS[provider].defaultModel;
    } catch (e) {
      $("sp-gen-error").textContent = String((e && e.message) || e);
    } finally {
      btn.disabled = false;
      btn.textContent = "⚡ Generate draft";
    }
  }

  async function saveDraft() {
    if (!current) return;
    var box = $("sp-draft");
    await client.from("drafts").insert({
      community_id: current.id,
      pillar_slug: box.dataset.pillar || null,
      title: $("sp-draft-title").value,
      body: $("sp-draft-body").value,
      ai_provider: box.dataset.provider || null,
      ai_model: box.dataset.model || null,
    });
    flash($("sp-save"), "✅ Saved");
  }

  function copyDraft() {
    var text = $("sp-draft-title").value + "\n\n" + $("sp-draft-body").value;
    navigator.clipboard.writeText(text).then(function () {
      flash($("sp-copy"), "✅ Copied");
    });
  }

  function flash(btn, label) {
    var original = btn.textContent;
    btn.textContent = label;
    setTimeout(function () { btn.textContent = original; }, 1400);
  }

  /* ------------------------ page report capture --------------------- */

  async function capturePageReport() {
    $("sp-report-error").textContent = "";
    var btn = $("sp-report");
    btn.disabled = true;
    btn.textContent = "Capturing…";
    try {
      var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      var tab = tabs && tabs[0];
      if (!tab || !tab.url || tab.url.indexOf("skool.com") === -1) {
        throw new Error("Switch to your Skool community tab first, then try again.");
      }
      var res = await new Promise(function (resolve, reject) {
        chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_PAGE_REPORT" }, function (r) {
          if (chrome.runtime.lastError) {
            reject(new Error("Couldn't reach the page — reload your Skool tab once, then retry."));
          } else if (!r || !r.ok) {
            reject(new Error((r && r.error) || "Couldn't capture a report."));
          } else {
            resolve(r);
          }
        });
      });
      $("sp-report-output").value = JSON.stringify(res.report, null, 2);
      $("sp-report-box").classList.remove("hidden");
    } catch (e) {
      $("sp-report-error").textContent = String((e && e.message) || e);
    } finally {
      btn.disabled = false;
      btn.textContent = "🔬 Capture page report";
    }
  }

  /* ------------------ standalone reply drafter --------------------- */
  // Works with NO backend: reads the current Skool tab via the content
  // script's class-free extractor and drafts replies from the LOCAL voice
  // profile. Suggestion-only — copy what you like; nothing is posted.

  var saSlug = null;      // slug of the last page read (for the override toggle)
  var saInited = false;

  async function initStandalone() {
    if (saInited) return;
    saInited = true;
    $("sp-sa-read").addEventListener("click", standaloneRead);
    $("sp-sa-posts").addEventListener("click", onStandaloneClick);
    $("sp-sa-override").addEventListener("change", async function (e) {
      if (!saSlug) return;
      var overrides = (await SC.storage.get("sc_admin_override")) || {};
      if (e.target.checked) overrides[saSlug] = true; else delete overrides[saSlug];
      await SC.storage.set("sc_admin_override", overrides);
      $("sp-sa-status").textContent = "Saved — reload your Skool tab, then Read again.";
    });
    refreshVoiceNote();
  }

  async function refreshVoiceNote() {
    var v = await SC.localVoice.load();
    var note = $("sp-sa-voice-note");
    if (v.samples && v.samples.length) {
      note.innerHTML = "Voice: " + v.samples.length + " sample reply(ies) saved. " +
        "<button id=\"sp-sa-voice-link\" class=\"link\" type=\"button\">Edit</button>";
    } else {
      note.innerHTML = "No voice set — drafts are generic until you " +
        "<button id=\"sp-sa-voice-link\" class=\"link\" type=\"button\">add sample replies</button>.";
    }
    var link = $("sp-sa-voice-link");
    if (link) link.addEventListener("click", function () { chrome.runtime.openOptionsPage(); });
  }

  function queryActiveSkoolTab() {
    return new Promise(function (resolve, reject) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (!tab || !tab.url || tab.url.indexOf("skool.com") === -1) {
          reject(new Error("Switch to your Skool community tab first, then try again."));
        } else resolve(tab);
      });
    });
  }

  async function standaloneRead() {
    $("sp-sa-error").textContent = "";
    $("sp-sa-status").textContent = "";
    $("sp-sa-posts").innerHTML = "";
    var btn = $("sp-sa-read");
    btn.disabled = true; btn.textContent = "Reading…";
    try {
      var tab = await queryActiveSkoolTab();
      var limit = Number($("sp-sa-limit").value) || 40;
      var res = await new Promise(function (resolve, reject) {
        chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE_DRAFTS_SOURCE", limit: limit }, function (r) {
          if (chrome.runtime.lastError) reject(new Error("Couldn't reach the page — reload your Skool tab once, then retry."));
          else resolve(r);
        });
      });
      if (res && res.slug) { saSlug = res.slug; }
      if (!res || !res.ok) {
        if (res && res.code === "not_admin") {
          $("sp-sa-override-row").classList.remove("hidden");
          var ov = (await SC.storage.get("sc_admin_override")) || {};
          $("sp-sa-override").checked = !!(saSlug && ov[saSlug]);
        }
        throw new Error((res && res.error) || "Couldn't read the page.");
      }
      $("sp-sa-override-row").classList.add("hidden");
      renderStandaloneSource(res);
    } catch (e) {
      $("sp-sa-error").textContent = String((e && e.message) || e);
    } finally {
      btn.disabled = false; btn.textContent = "📥 Read this page";
    }
  }

  function renderStandaloneSource(res) {
    var host = $("sp-sa-posts");
    host.innerHTML = "";
    var items = res.mode === "detail" ? [res.post] : (res.posts || []);
    items = items.filter(function (p) { return p && (p.title || p.body); });
    var comments = res.mode === "detail" ? (res.comments || []) : [];
    if (!items.length && !comments.length) {
      $("sp-sa-status").textContent = res.mode === "detail"
        ? "Couldn't read this post — scroll it into view and retry."
        : "No posts found on this page — scroll the feed a little and retry.";
      return;
    }
    $("sp-sa-status").textContent = res.mode === "detail"
      ? "On a post with " + comments.length + " comment(s) visible" +
        (comments.length ? " — scroll the thread and re-read to load more." : ".")
      : "Found " + items.length + " post(s). Draft replies to any of them.";

    // The post itself (feed: each post).
    items.forEach(function (post) {
      var div = document.createElement("div");
      div.className = "sugg";
      div._post = post;
      div._comments = comments;
      var fullText = (post.title ? post.title + " — " : "") + (post.body || "");
      var snippet = fullText.slice(0, 120) + (fullText.length > 120 ? "…" : "");
      div.innerHTML =
        '<div class="head"><span class="who">' + escapeHtml(post.author || "Post") + "</span></div>" +
        '<div class="snippet">' + escapeHtml(snippet) + "</div>" +
        '<div class="row"><button class="btn small primary" data-act="draft">✍️ Draft 3 replies</button></div>' +
        '<p class="muted sa-item-status"></p><div class="sa-drafts"></div>';
      host.appendChild(div);
    });

    // Detail mode: the comment feed itself — visible, copyable, answerable.
    if (res.mode === "detail" && comments.length) {
      var head = document.createElement("div");
      head.className = "sa-comments-head";
      head.innerHTML =
        '<span class="who">💬 Comment feed (' + comments.length + ")</span>" +
        '<button class="btn small" data-act="copy-thread" type="button">📋 Copy all</button>';
      host.appendChild(head);
      host._post = items[0] || res.post || null;
      host._comments = comments;
      comments.forEach(function (c, i) {
        var div = document.createElement("div");
        div.className = "sugg sa-comment";
        div._comment = c;
        div._post = host._post;
        div._comments = comments;
        div.innerHTML =
          '<div class="head"><span class="who">' + escapeHtml(c.authorName || "Member") + "</span></div>" +
          '<div class="snippet sa-comment-body">' + escapeHtml(c.body || "") + "</div>" +
          '<div class="row">' +
          '<button class="btn small primary" data-act="draft-comment">💬 Suggest answers</button>' +
          '<button class="btn small" data-act="copy-comment">📋</button>' +
          "</div>" +
          '<p class="muted sa-item-status"></p><div class="sa-drafts"></div>';
        host.appendChild(div);
      });
    }
  }

  function threadAsText(post, comments) {
    var lines = [];
    if (post && (post.title || post.body)) {
      lines.push("POST" + (post.author ? " by " + post.author : "") + ":");
      if (post.title) lines.push(post.title);
      if (post.body) lines.push(post.body);
      lines.push("");
    }
    lines.push("COMMENTS:");
    (comments || []).forEach(function (c) {
      lines.push("- " + (c.authorName || "member") + ": " + (c.body || ""));
    });
    return lines.join("\n");
  }

  async function onStandaloneClick(e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var act = btn.dataset.act;

    // Copy the whole visible comment feed as plain text.
    if (act === "copy-thread") {
      var hostEl = $("sp-sa-posts");
      navigator.clipboard.writeText(threadAsText(hostEl._post, hostEl._comments || []))
        .then(function () { flash(btn, "✅ Copied"); });
      return;
    }

    var card = btn.closest(".sugg");
    if (!card) return;
    var st = card.querySelector(".sa-item-status");

    if (act === "draft" || act === "draft-comment") {
      btn.disabled = true; var old = btn.textContent; btn.textContent = "Drafting…";
      if (st) st.textContent = "";
      try {
        var drafts = await standaloneDraft(card._post, card._comments,
          act === "draft-comment" ? card._comment : null);
        renderStandaloneDrafts(card.querySelector(".sa-drafts"), drafts);
      } catch (err) {
        if (st) st.textContent = "❌ " + err.message;
      } finally { btn.disabled = false; btn.textContent = old; }
    } else if (act === "copy-comment") {
      var c = card._comment || {};
      navigator.clipboard.writeText((c.authorName || "member") + ": " + (c.body || ""))
        .then(function () { flash(btn, "✅"); });
    } else if (act === "copy") {
      var ta = card.querySelector('textarea[data-draft="' + btn.dataset.i + '"]');
      if (ta) navigator.clipboard.writeText(ta.value).then(function () { flash(btn, "✅"); });
    }
  }

  async function standaloneDraft(post, comments, replyTo) {
    var settings = (await SC.storage.get("sc_ai_settings")) || {};
    if (!settings.provider) throw new Error("No AI provider set. Open Settings and add your key.");
    var apiKey = await SC.vault.loadApiKey(settings.provider);
    if (!apiKey) throw new Error("No API key stored for " + settings.provider + ". Open Settings.");
    var voice = await SC.localVoice.load();
    var text = await SC.generateDraft({
      provider: settings.provider, apiKey: apiKey, model: settings.model,
      system: SC.LOCAL_REPLY_SYSTEM_PROMPT, maxTokens: 2000,
      prompt: SC.buildLocalReplyPrompt({
        post: post, comments: comments, replyTo: replyTo || null,
        voice: voice, count: 3,
      }),
    });
    var drafts = SC.parseReplyDrafts(text, 3);
    if (!drafts.length) throw new Error("Couldn't parse a reply from the model — try again.");
    return drafts;
  }

  function renderStandaloneDrafts(host, drafts) {
    host.innerHTML = "";
    drafts.forEach(function (d, i) {
      var wrap = document.createElement("div");
      wrap.className = "sa-draft";
      var ta = document.createElement("textarea");
      ta.rows = 3; ta.value = d; ta.setAttribute("data-draft", String(i));
      ta.setAttribute("autocapitalize", "sentences"); ta.setAttribute("autocorrect", "off");
      wrap.appendChild(ta);
      var row = document.createElement("div");
      row.className = "row";
      var copy = document.createElement("button");
      copy.className = "btn small"; copy.type = "button";
      copy.textContent = "📋 Copy"; copy.dataset.act = "copy"; copy.dataset.i = String(i);
      row.appendChild(copy);
      wrap.appendChild(row);
      host.appendChild(wrap);
    });
  }

  /* ------------------------- skip sign-in (solo) -------------------- */
  // Enables solo mode directly from the panel — no trip to the web app
  // required. Mirrors the PWA's probe: an insert only succeeds without a
  // session once the solo-mode SQL has opened the tables to the anon key.

  function copySoloSql() {
    navigator.clipboard.writeText(SC.SOLO_MODE_SQL || "").then(function () {
      flash($("sp-solo-copy-sql"), "✅ Copied");
    });
  }

  async function enableSolo() {
    $("sp-solo-status").textContent = "Checking whether the setup script has been run…";
    var btn = $("sp-solo-enable");
    btn.disabled = true;
    try {
      if (!client) throw new Error("Add your Supabase URL + key in Settings first.");
      var probe = await client.from("communities").insert({
        name: "__solo_probe__",
        skool_url: "https://www.skool.com/__solo-probe__",
      });
      if (probe && probe[0] && probe[0].id) {
        await client.from("communities").delete().eq("id", probe[0].id);
      }
      await SC.enableSolo();
      $("sp-solo-status").textContent = "✅ Sign-in is off for good — loading…";
      chrome.runtime.sendMessage({ type: "REFRESH_COMMUNITIES" }, function () {
        void chrome.runtime.lastError;
      });
      location.reload();
    } catch (e) {
      $("sp-solo-status").textContent =
        "❌ Not yet — the database still requires sign-in. Copy the setup script above, " +
        "paste it into Supabase → SQL Editor → Run, then click Enable again. " +
        "(Details: " + String((e && e.message) || e) + ")";
    } finally {
      btn.disabled = false;
    }
  }

  /* ----------------------------- auth ------------------------------ */

  async function signIn(isSignUp) {
    $("sp-auth-error").textContent = "";
    try {
      if (!client) throw new Error("Add your Supabase URL + key in Settings first. " +
        "(Or skip accounts: the Read & reply features above need no sign-in.)");
      var email = $("sp-email").value.trim();
      var password = $("sp-password").value;
      if (isSignUp) {
        await client.signUp(email, password);
        var session = await client.ensureSession();
        if (!session) {
          $("sp-auth-error").textContent =
            "Account created, but Supabase wants an email confirmation (its free email " +
            "sender is rate-limited). Easiest fix: in Supabase turn OFF Authentication → " +
            "Sign In / Providers → Email → \"Confirm email\", then sign in.";
          return;
        }
      } else {
        await client.signIn(email, password);
      }
      chrome.runtime.sendMessage({ type: "REFRESH_COMMUNITIES" }, function () {
        void chrome.runtime.lastError;
      });
      await showMain();
    } catch (e) {
      $("sp-auth-error").textContent = SC.friendlyAuthError(e);
    }
  }

  /* ---------------------------- wiring ----------------------------- */

  $("sp-settings").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });
  $("sp-signin").addEventListener("click", function () { signIn(false); });
  $("sp-signup").addEventListener("click", function () { signIn(true); });
  $("sp-solo-copy-sql").addEventListener("click", copySoloSql);
  $("sp-solo-enable").addEventListener("click", enableSolo);
  $("sp-community").addEventListener("change", function (e) {
    selectCommunity(e.target.value);
  });
  $("sp-generate").addEventListener("click", generate);
  $("sp-inbox").addEventListener("click", onInboxClick);
  $("sp-report").addEventListener("click", capturePageReport);
  $("sp-report-copy").addEventListener("click", function () {
    navigator.clipboard.writeText($("sp-report-output").value).then(function () {
      flash($("sp-report-copy"), "✅ Copied");
    });
  });
  $("sp-copy").addEventListener("click", copyDraft);
  $("sp-save").addEventListener("click", saveDraft);
  $("sp-add-save").addEventListener("click", addCommunity);
  $("sp-override").addEventListener("change", async function (e) {
    if (!current) return;
    var slug = current.slug || SC.skoolSlug(current.skool_url);
    var overrides = (await SC.storage.get("sc_admin_override")) || {};
    if (e.target.checked) overrides[slug] = true;
    else delete overrides[slug];
    await SC.storage.set("sc_admin_override", overrides);
    // Takes effect on the community's next pageview — prompt a reload.
    e.target.parentElement.title = "Saved — reload your Skool tab to apply.";
  });

  boot();
})();
