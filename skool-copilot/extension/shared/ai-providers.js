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
    var res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": opts.apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        generationConfig: { maxOutputTokens: opts.maxTokens },
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

  /* ------------------ page engagement suggestions ------------------ */
  // "Read & suggest": given the posts currently on screen, recommend how
  // the owner should engage with each — suggestion only, never automated.

  SC.ENGAGE_SYSTEM_PROMPT =
    "You are the engagement copilot for a Skool community owner. For each " +
    "member post you are shown, you recommend how the owner should engage " +
    "and, when a comment is warranted, you draft it in the owner's voice. " +
    "Replies must sound like a human community owner: specific to the post, " +
    "warm, short, never generic praise, never mentioning AI, no hashtags. " +
    "You respond with raw JSON only — no prose, no code fences.";

  // buildEngagementPrompt({communityName, voice, posts})
  // posts: [{author, post_text, likes, comments}]
  SC.buildEngagementPrompt = function (ctx) {
    var voice = ctx.voice || {};
    var lines = [];
    lines.push("Community: " + (ctx.communityName || "my community"));
    if (voice.tone_notes) lines.push("Owner's voice: " + voice.tone_notes);
    if (voice.formatting_rules) lines.push("Formatting rules: " + voice.formatting_rules);
    if (voice.banned_words && voice.banned_words.length) {
      lines.push("Never use these words: " + voice.banned_words.join(", "));
    }
    lines.push("");
    lines.push("Here are the posts currently on the owner's screen:");
    (ctx.posts || []).forEach(function (p, i) {
      lines.push("");
      lines.push("POST " + (i + 1) + " — by " + (p.author || "a member") +
        " (" + (p.likes || 0) + " likes, " + (p.comments || 0) + " comments):");
      lines.push(String(p.post_text || "").replace(/\s+/g, " ").slice(0, 500));
    });
    lines.push("");
    lines.push(
      "For EACH post, decide the best engagement from the owner. Output ONLY a JSON " +
      "array with one object per post, same order, using exactly these fields:\n" +
      '  "post": the post number,\n' +
      '  "action": one of "detailed_reply" (member asked something or shared something ' +
      'substantial), "quick_comment" (a short human touch is enough), "like_only" ' +
      '(acknowledge without commenting), "skip" (owner engagement adds nothing),\n' +
      '  "reason": why, in at most 15 words,\n' +
      '  "reply": the suggested comment text (empty string for like_only and skip). ' +
      "Address the member by first name when known. Detailed replies: 2-4 sentences. " +
      "Quick comments: one sentence."
    );
    return lines.join("\n");
  };

  // Tolerant parser for the model's JSON (strips fences, finds the array).
  // Returns an array of suggestion objects, or null if unparseable.
  SC.parseEngagementSuggestions = function (text) {
    if (!text) return null;
    var s = String(text).replace(/```(?:json)?/gi, "");
    var start = s.indexOf("[");
    var end = s.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      var arr = JSON.parse(s.slice(start, end + 1));
      if (!Array.isArray(arr)) return null;
      return arr.map(function (item) {
        return {
          post: Number(item.post) || 0,
          action: String(item.action || "skip"),
          reason: String(item.reason || ""),
          reply: String(item.reply || ""),
        };
      });
    } catch (e) {
      return null;
    }
  };

  SC.DRAFT_SYSTEM_PROMPT =
    "You are a ghostwriter for a Skool community owner. You write posts that sound " +
    "like the owner, match the requested content pillar, and are built to spark " +
    "member replies. You never mention that you are an AI, never use hashtags, and " +
    "you follow the voice profile exactly.";
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
