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
    try {
      client = await SC.getClient();
      if (!client) {
        showAuth("Backend not configured yet. Easiest path: open the Copilot web app " +
          "with this extension installed — settings sync over automatically. " +
          "Or open Settings here and paste your Supabase URL + anon key.");
        return;
      }
      if (await SC.isSolo()) {
        await showMain(); // solo mode: no accounts anywhere
        return;
      }
      var user = await client.getUser();
      if (!user) {
        showAuth("Sign in with the same account you use in the Copilot web app. " +
          "(Or enable solo mode in the web app — it removes sign-in here too.)");
        return;
      }
      await showMain();
    } catch (e) {
      // Never leave the panel blank — say what broke.
      showAuth("Something went wrong: " + String((e && e.message) || e) +
        " — check the backend settings, then reopen this panel.");
    }
  }

  function showAuth(note) {
    $("sp-auth").classList.remove("hidden");
    $("sp-main").classList.add("hidden");
    $("sp-auth-note").textContent = note;
  }

  async function showMain() {
    $("sp-auth").classList.add("hidden");
    $("sp-main").classList.remove("hidden");
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

  /* ---------------------- read page & suggest ---------------------- */

  var ACTION_LABELS = {
    detailed_reply: "✍️ Detailed reply",
    quick_comment: "💬 Quick comment",
    like_only: "👍 Like it",
    skip: "⏭ Skip",
  };

  function readPagePosts(limit) {
    return new Promise(function (resolve, reject) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (!tab || !tab.url || tab.url.indexOf("skool.com") === -1) {
          reject(new Error("Switch to your Skool community tab first, then try again."));
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: "READ_PAGE_POSTS", limit: limit }, function (res) {
          if (chrome.runtime.lastError) {
            reject(new Error("Couldn't reach the page — reload your Skool tab once, then retry."));
          } else if (!res || !res.ok) {
            reject(new Error((res && res.error) || "Couldn't read the page."));
          } else {
            resolve(res);
          }
        });
      });
    });
  }

  async function readAndSuggest() {
    $("sp-read-error").textContent = "";
    $("sp-read-status").textContent = "";
    var btn = $("sp-read");
    btn.disabled = true;
    btn.textContent = "Reading…";
    try {
      var settings = (await SC.storage.get("sc_ai_settings")) || {};
      if (!settings.provider) throw new Error("No AI provider configured. Open Settings.");
      var apiKey = await SC.vault.loadApiKey(settings.provider);
      if (!apiKey) throw new Error("No API key stored for " + settings.provider + ". Open Settings.");

      var limit = Number($("sp-read-count").value) || 0;
      var page = await readPagePosts(limit);

      // Keep the selected community in step with the tab being read.
      var pageCommunity = communities.find(function (c) {
        return (c.slug || SC.skoolSlug(c.skool_url)) === page.slug;
      });
      if (pageCommunity && (!current || pageCommunity.id !== current.id)) {
        $("sp-community").value = pageCommunity.id;
        await selectCommunity(pageCommunity.id);
      }
      if (!page.posts.length) {
        throw new Error("No posts found on this page — scroll the feed a little and retry.");
      }

      $("sp-read-status").textContent =
        "Read " + page.posts.length + " of " + page.totalOnPage +
        " loaded post(s). Asking " + settings.provider + " for suggestions…";
      btn.textContent = "Thinking…";

      var voiceRows = current
        ? await client.from("voice_profiles").select("*").eq("community_id", current.id).limit(1)
        : [];
      var voice = (voiceRows && voiceRows[0]) || {};

      var text = await SC.generateDraft({
        provider: settings.provider,
        apiKey: apiKey,
        model: settings.model,
        system: SC.ENGAGE_SYSTEM_PROMPT,
        maxTokens: 4000,
        prompt: SC.buildEngagementPrompt({
          communityName: current ? current.name : "",
          voice: voice,
          posts: page.posts,
        }),
      });

      var suggestions = SC.parseEngagementSuggestions(text);
      if (!suggestions) {
        // Unparseable — show the raw text rather than nothing.
        $("sp-suggestions").innerHTML =
          '<p class="muted">Couldn\'t parse structured suggestions; raw response:</p>' +
          "<textarea rows='10'>" + escapeHtml(text) + "</textarea>";
      } else {
        renderSuggestions(suggestions, page.posts);
      }
      $("sp-read-status").textContent =
        "Suggestions for " + page.posts.length + " post(s) — copy any reply and paste it on Skool.";
    } catch (e) {
      $("sp-read-error").textContent = String((e && e.message) || e);
    } finally {
      btn.disabled = false;
      btn.textContent = "📖 Read & suggest";
    }
  }

  function renderSuggestions(suggestions, posts) {
    var host = $("sp-suggestions");
    host.innerHTML = "";
    suggestions.forEach(function (s, i) {
      var post = posts[(s.post || i + 1) - 1] || posts[i] || {};
      var div = document.createElement("div");
      div.className = "sugg";
      var snippet = (post.post_text || "").replace(/\s+/g, " ").slice(0, 110);
      div.innerHTML =
        '<div class="head"><span class="who">' + escapeHtml(post.author || "Member") +
        '</span><span class="counts">' + (post.likes || 0) + " 👍 · " +
        (post.comments || 0) + " 💬</span></div>" +
        '<div class="snippet">' + escapeHtml(snippet) + "…</div>" +
        '<span class="badge ' + escapeHtml(s.action) + '">' +
        (ACTION_LABELS[s.action] || escapeHtml(s.action)) + "</span>" +
        '<span class="why">' + escapeHtml(s.reason) + "</span>";
      if (s.reply) {
        var ta = document.createElement("textarea");
        ta.rows = 3;
        ta.value = s.reply;
        div.appendChild(ta);
        var row = document.createElement("div");
        row.className = "row";
        var copy = document.createElement("button");
        copy.className = "btn small";
        copy.type = "button";
        copy.textContent = "📋 Copy reply";
        copy.addEventListener("click", function () {
          navigator.clipboard.writeText(ta.value).then(function () {
            flash(copy, "✅ Copied");
          });
        });
        row.appendChild(copy);
        div.appendChild(row);
      }
      host.appendChild(div);
    });
  }

  /* ----------------------------- auth ------------------------------ */

  async function signIn(isSignUp) {
    $("sp-auth-error").textContent = "";
    try {
      if (!client) throw new Error("Configure the backend in Settings first.");
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
  $("sp-community").addEventListener("change", function (e) {
    selectCommunity(e.target.value);
  });
  $("sp-generate").addEventListener("click", generate);
  $("sp-read").addEventListener("click", readAndSuggest);
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
