/* =====================================================================
   Skool Community Copilot — multi-provider AI layer (BYOK)
   ---------------------------------------------------------------------
   One internal generateDraft() that routes to the provider the user
   picked, calling that provider's native HTTP API directly from the
   client with the user's own key. No SDKs, no proxy, keys never leave
   the browser except to the provider itself.
   ===================================================================== */
(function (SC) {
  "use strict";

  SC.PROVIDERS = {
    anthropic: {
      label: "Anthropic (Claude)",
      defaultModel: "claude-opus-4-8",
      models: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"],
      keyHint: "sk-ant-...",
    },
    openai: {
      label: "OpenAI",
      defaultModel: "gpt-4o",
      models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
      keyHint: "sk-...",
    },
    google: {
      label: "Google Gemini",
      defaultModel: "gemini-2.5-flash",
      models: ["gemini-2.5-flash", "gemini-2.5-pro"],
      keyHint: "AIza...",
    },
    grok: {
      label: "xAI Grok",
      defaultModel: "grok-4",
      models: ["grok-4", "grok-3"],
      keyHint: "xai-...",
    },
  };

  async function readError(res) {
    var text = await res.text();
    try {
      var body = JSON.parse(text);
      var e = body.error || body;
      return e.message || e.msg || text;
    } catch (err) {
      return text || String(res.status);
    }
  }

  /* --------------------- per-provider adapters --------------------- */

  async function callAnthropic(opts) {
    var res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
        // Required opt-in for direct browser (CORS) calls with a user key.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.prompt }],
      }),
    });
    if (!res.ok) throw new Error("Anthropic: " + (await readError(res)));
    var data = await res.json();
    if (data.stop_reason === "refusal") {
      throw new Error("Anthropic declined this request (safety refusal). Try rephrasing the seed.");
    }
    return (data.content || [])
      .filter(function (b) { return b.type === "text"; })
      .map(function (b) { return b.text; })
      .join("");
  }

  async function callOpenAICompatible(baseUrl, providerLabel, opts) {
    var res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + opts.apiKey,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(providerLabel + ": " + (await readError(res)));
    var data = await res.json();
    var choice = data.choices && data.choices[0];
    return (choice && choice.message && choice.message.content) || "";
  }

  async function callGoogle(opts) {
    var url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(opts.model) +
      ":generateContent";
    var generationConfig = { maxOutputTokens: opts.maxTokens };
    // Gemini 2.5 Flash silently spends the SAME output budget on internal
    // "thinking" before writing, which truncates answers mid-sentence at
    // small caps. Flash allows disabling it; Pro does not (min budget), so
    // only apply to flash models.
    if (/2\.5-flash/i.test(opts.model)) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    var res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": opts.apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig: generationConfig,
      }),
    });
    if (!res.ok) throw new Error("Google: " + (await readError(res)));
    var data = await res.json();
    var cand = data.candidates && data.candidates[0];
    if (!cand || !cand.content || !cand.content.parts) return "";
    return cand.content.parts
      .map(function (p) { return p.text || ""; })
      .join("");
  }

  /* --------------------------- public API -------------------------- */

  // generateDraft({provider, apiKey, model?, system, prompt, maxTokens?}) -> string
  SC.generateDraft = async function (opts) {
    var meta = SC.PROVIDERS[opts.provider];
    if (!meta) throw new Error("Unknown provider: " + opts.provider);
    var full = {
      apiKey: opts.apiKey,
      model: opts.model || meta.defaultModel,
      system: opts.system || "",
      prompt: opts.prompt,
      maxTokens: opts.maxTokens || 2048,
    };
    switch (opts.provider) {
      case "anthropic":
        return callAnthropic(full);
      case "openai":
        return callOpenAICompatible("https://api.openai.com/v1", "OpenAI", full);
      case "grok":
        return callOpenAICompatible("https://api.x.ai/v1", "Grok", full);
      case "google":
        return callGoogle(full);
      default:
        throw new Error("Unknown provider: " + opts.provider);
    }
  };

  // Cheap end-to-end check used by the settings "Test connection" button.
  SC.testConnection = async function (provider, apiKey, model) {
    var text = await SC.generateDraft({
      provider: provider,
      apiKey: apiKey,
      model: model,
      system: "You are a connection test. Reply with exactly: OK",
      prompt: "Reply with exactly: OK",
      maxTokens: 16,
    });
    return typeof text === "string";
  };

  /* --------------------- draft prompt assembly --------------------- */

  // Builds the single generation prompt from pillar + voice + health
  // stats + optional seed. ctx.style: { maxChars, emoji: "auto"|"none" }.
  SC.buildDraftPrompt = function (ctx) {
    var voice = ctx.voice || {};
    var style = ctx.style || {};
    var maxChars = style.maxChars || 500;
    var lines = [];
    lines.push(
      "Write one post for the Skool community \"" + (ctx.communityName || "my community") + "\"."
    );
    lines.push("");
    lines.push("Content pillar to fill: " + ctx.pillarName + ".");
    if (ctx.pillarDescription) lines.push("Pillar description: " + ctx.pillarDescription);
    if (ctx.reason) lines.push("Why this pillar: " + ctx.reason);
    if (ctx.healthDigest && ctx.healthDigest.length) {
      lines.push("");
      lines.push("Current community health stats (write a post that helps these numbers):");
      ctx.healthDigest.forEach(function (l) { lines.push("- " + l); });
    }
    lines.push("");
    if (voice.tone_notes) lines.push("Voice and tone: " + voice.tone_notes);
    if (voice.formatting_rules) lines.push("Formatting rules: " + voice.formatting_rules);
    if (voice.banned_words && voice.banned_words.length) {
      lines.push("Never use these words or phrases: " + voice.banned_words.join(", "));
    }
    if (ctx.seed) {
      lines.push("");
      lines.push("Use this as the seed / starting material:");
      lines.push(ctx.seed);
    }
    if (ctx.recentTitles && ctx.recentTitles.length) {
      lines.push("");
      lines.push("Recent posts in the community (do not repeat these topics):");
      ctx.recentTitles.slice(0, 8).forEach(function (t) {
        lines.push("- " + t);
      });
    }
    lines.push("");
    lines.push("Length: keep the whole post (title + body) under " + maxChars +
      " characters. Short, punchy posts get read and replied to.");
    if (style.emoji === "none") {
      lines.push("Do not use any emojis.");
    } else {
      lines.push("Use a few emojis where they genuinely add energy or clarity — " +
        "never more than one per line, never decoration for its own sake.");
    }
    lines.push(
      "Output format: first line is the post title (plain text, no markdown heading), " +
      "then a blank line, then the post body. End with a question or call-to-action " +
      "that invites replies. Keep it ready to copy-paste into Skool."
    );
    return lines.join("\n");
  };

  /* ------------------- community deep-review prompt ----------------- */

  SC.ANALYSIS_SYSTEM_PROMPT =
    "You are a community growth coach for Skool community owners. You are given " +
    "computed health stats plus real (scraped) posts and member comments from the " +
    "owner's own community. Be direct and specific: quote or paraphrase actual " +
    "comments as evidence, never invent data, and give advice the owner can act " +
    "on this week.";

  // buildAnalysisPrompt({communityName, digestLines, pillars, samplePosts,
  //                      sampleComments})
  SC.buildAnalysisPrompt = function (ctx) {
    var lines = [];
    lines.push("Review the health of the Skool community \"" +
      (ctx.communityName || "my community") + "\".");
    lines.push("");
    lines.push("Computed stats:");
    (ctx.digestLines || []).forEach(function (l) { lines.push("- " + l); });
    if (ctx.pillars && ctx.pillars.length) {
      lines.push("");
      lines.push("Content pillars and targets: " + ctx.pillars.map(function (p) {
        return p.name + " " + (p.target_ratio || 0) + "%";
      }).join(", "));
    }
    if (ctx.samplePosts && ctx.samplePosts.length) {
      lines.push("");
      lines.push("Recent post titles:");
      ctx.samplePosts.forEach(function (t) { lines.push("- " + t); });
    }
    if (ctx.sampleComments && ctx.sampleComments.length) {
      lines.push("");
      lines.push("Recent member comments (author: text):");
      ctx.sampleComments.forEach(function (c) { lines.push("- " + c); });
    }
    lines.push("");
    lines.push(
      "Respond with:\n" +
      "1. VERDICT — one or two sentences: is this community healthy, and the single " +
      "biggest reason why or why not.\n" +
      "2. WHAT'S WORKING — 2-3 bullet points grounded in the comments/stats above.\n" +
      "3. WHERE TO IMPROVE — 3-5 numbered, concrete actions for this week, each tied " +
      "to a specific stat or quoted comment.\n" +
      "Keep the whole response under 350 words. Plain text, no markdown headers."
    );
    return lines.join("\n");
  };

  SC.DRAFT_SYSTEM_PROMPT =
    "You are a ghostwriter for a Skool community owner. You write posts that sound " +
    "like the owner, match the requested content pillar, and are built to spark " +
    "member replies. You never mention that you are an AI, never use hashtags, and " +
    "you follow the voice profile exactly.";

  /* ------------------ pillar suggestions (AI) ---------------------- */
  // "What pillars fit MY community?" — one BYOK call that reads the
  // community's name, the owner's description, and recent post titles, and
  // proposes a tailored pillar set. Output is JSON; parsing is tolerant and
  // truncation-aware (complete objects only).

  SC.PILLAR_SUGGEST_SYSTEM_PROMPT =
    "You design content-pillar systems for Skool community owners. Given what " +
    "a community is about, propose 4-6 content pillars that would keep it " +
    "healthy: clear names, one-sentence descriptions of what qualifies, and " +
    "target percentages that sum to 100. Favor pillars that drive member " +
    "replies and belonging, not just broadcasting. Respond with raw JSON only " +
    "- an array of objects with exactly these keys: name, description, target " +
    "(a number). No prose, no code fences.";

  // buildPillarSuggestPrompt({communityName, about, recentTitles})
  SC.buildPillarSuggestPrompt = function (ctx) {
    var lines = [];
    lines.push("Community name: " + (ctx.communityName || "(unnamed)"));
    if (ctx.about) {
      lines.push("The owner describes it as: " + String(ctx.about).slice(0, 400));
    }
    if (ctx.recentTitles && ctx.recentTitles.length) {
      lines.push("");
      lines.push("Recent post titles (what actually gets posted):");
      ctx.recentTitles.slice(0, 12).forEach(function (t) { lines.push("- " + t); });
    }
    lines.push("");
    lines.push("Propose 4-6 pillars as a JSON array of {\"name\", \"description\", " +
      "\"target\"} objects. Targets are whole numbers summing to 100. Base them on " +
      "what this specific community is about - not a generic list.");
    return lines.join("\n");
  };

  // Tolerant, truncation-aware parser for the pillar-suggestion JSON.
  // Extracts complete {...} objects one by one, so a token-capped tail is
  // dropped instead of breaking the whole parse. Normalizes targets to
  // integers; if they do not sum to ~100, rescales proportionally.
  SC.parsePillarSuggestions = function (text) {
    if (!text) return null;
    var s = String(text).replace(/```(?:json)?/gi, "");
    var out = [];
    var depth = 0, objStart = -1, inStr = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inStr) {
        if (ch === "\\") { i++; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{") { if (depth === 0) objStart = i; depth++; }
      else if (ch === "}") {
        depth--;
        if (depth === 0 && objStart !== -1) {
          try {
            var o = JSON.parse(s.slice(objStart, i + 1));
            var name = String(o.name || "").trim();
            var target = Math.round(Number(o.target ?? o.target_ratio ?? o.percent ?? 0));
            if (name) {
              out.push({
                name: name.slice(0, 60),
                description: String(o.description || "").trim().slice(0, 200),
                target_ratio: isNaN(target) ? 0 : Math.max(0, Math.min(100, target)),
              });
            }
          } catch (e) { /* skip malformed object */ }
          objStart = -1;
        }
      }
    }
    if (!out.length) return null;
    // Rescale targets to sum to 100 when they are close but not exact.
    var sum = out.reduce(function (t, p) { return t + p.target_ratio; }, 0);
    if (sum > 0 && sum !== 100) {
      var acc = 0;
      out.forEach(function (p, idx) {
        if (idx === out.length - 1) { p.target_ratio = Math.max(0, 100 - acc); return; }
        p.target_ratio = Math.round((p.target_ratio / sum) * 100);
        acc += p.target_ratio;
      });
    }
    return out.slice(0, 8);
  };

  SC.THREAD_SUMMARY_SYSTEM_PROMPT =
    "You summarize a Skool comment thread for the community owner so they can " +
    "catch up fast. Be concise and concrete. Surface any direct questions to the " +
    "owner and anything that needs a response. Plain text, no markdown headers.";

  // buildThreadSummaryPrompt({postText, comments:[{author,text,depth}]})
  SC.buildThreadSummaryPrompt = function (ctx) {
    var lines = [];
    if (ctx.postText) {
      lines.push("Post:");
      lines.push(String(ctx.postText).replace(/\s+/g, " ").slice(0, 600));
      lines.push("");
    }
    lines.push("Comment thread (oldest first, indentation shows replies):");
    (ctx.comments || []).forEach(function (c) {
      var indent = "  ".repeat(Math.min(Number(c.depth) || 0, 4));
      lines.push(indent + "- " + (c.author || "member") + ": " +
        String(c.text || "").replace(/\s+/g, " ").slice(0, 240));
    });
    lines.push("");
    lines.push("Summarize in at most 5 short lines: the gist of the discussion, any " +
      "open questions aimed at the owner, and whether the owner still needs to reply. " +
      "If nothing needs a response, say so.");
    return lines.join("\n");
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
