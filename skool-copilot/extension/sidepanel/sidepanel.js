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

  /* ----------------------------- boot ------------------------------ */

  async function boot() {
    client = await SC.getClient();
    if (!client) {
      showAuth("Backend not configured yet. Open Settings and paste your Supabase URL + anon key first.");
      return;
    }
    var user = await client.getUser();
    if (!user) {
      showAuth("Sign in with the same account you use in the Copilot web app.");
      return;
    }
    await showMain();
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
    if (!communities || !communities.length) {
      $("sp-stats").innerHTML =
        '<p class="muted">No communities yet. Add one in the Copilot web app, then refresh.</p>';
      return;
    }
    await selectCommunity(communities[0].id);
  }

  async function selectCommunity(id) {
    current = communities.find(function (c) { return c.id === id; }) || null;
    if (!current) return;
    var results = await Promise.all([
      client.from("pillars").select("*").eq("community_id", id).order("position"),
      client.from("scraped_posts").select("*").eq("community_id", id)
        .order("posted_at", { ascending: false }).limit(500),
    ]);
    pillars = results[0] || [];
    posts = results[1] || [];
    renderHealth();
  }

  /* ---------------------------- health ----------------------------- */

  function renderHealth() {
    var cad = SC.health.cadence(posts);
    var trend = SC.health.engagementTrend(posts);
    var balance = SC.health.pillarBalance(posts, pillars);
    var overdue = SC.health.mostOverduePillar(balance);
    var latency = SC.health.responseLatency(posts);

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
        l: "Unanswered questions",
        v: String(latency.unansweredQuestions),
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
        voice: voice,
        seed: $("sp-seed").value.trim(),
        recentTitles: recentTitles,
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
            "Account created. Confirm your email, then sign in.";
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
      $("sp-auth-error").textContent = String((e && e.message) || e);
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
  $("sp-copy").addEventListener("click", copyDraft);
  $("sp-save").addEventListener("click", saveDraft);

  boot();
})();
