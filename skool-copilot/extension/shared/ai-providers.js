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

  SC.DRAFT_SYSTEM_PROMPT =
    "You are a ghostwriter for a Skool community owner. You write posts that sound " +
    "like the owner, match the requested content pillar, and are built to spark " +
    "member replies. You never mention that you are an AI, never use hashtags, and " +
    "you follow the voice profile exactly.";

  /* ------------------ single comment reply draft ------------------- */
  // One-tap "suggest a reply" to a specific incoming comment. Reuses the
  // voice profile — no second voice system. Returns plain reply text, no JSON.

  SC.COMMENT_REPLY_SYSTEM_PROMPT =
    "You are a Skool community owner replying to one member's comment. Write a " +
    "single reply in the owner's voice: warm, specific to what the member " +
    "actually said, short, and human. Address the member by first name when it " +
    "is known. Never generic praise, never mention AI, no hashtags, no sign-off " +
    "signature. Output only the reply text — no quotes, no preamble.";

  // buildCommentReplyPrompt({communityName, voice, postText, comment:{author,text},
  //                          thread:[{author,text}]})
  SC.buildCommentReplyPrompt = function (ctx) {
    var voice = ctx.voice || {};
    var comment = ctx.comment || {};
    var lines = [];
    lines.push("Community: " + (ctx.communityName || "my community"));
    if (voice.tone_notes) lines.push("Owner's voice: " + voice.tone_notes);
    if (voice.formatting_rules) lines.push("Formatting rules: " + voice.formatting_rules);
    if (voice.banned_words && voice.banned_words.length) {
      lines.push("Never use these words: " + voice.banned_words.join(", "));
    }
    if (ctx.postText) {
      lines.push("");
      lines.push("The post this conversation is under:");
      lines.push(String(ctx.postText).replace(/\s+/g, " ").slice(0, 500));
    }
    if (ctx.thread && ctx.thread.length) {
      lines.push("");
      lines.push("Earlier in the thread (oldest first):");
      ctx.thread.slice(-6).forEach(function (t) {
        lines.push("- " + (t.author || "member") + ": " +
          String(t.text || "").replace(/\s+/g, " ").slice(0, 200));
      });
    }
    lines.push("");
    lines.push("Reply to this comment from " + (comment.author || "a member") + ":");
    lines.push(String(comment.text || "").replace(/\s+/g, " ").slice(0, 600));
    lines.push("");
    lines.push("Write only the owner's reply. One to three sentences. If the member " +
      "asked a question, answer it directly; if they shared something, respond to " +
      "the specific thing they shared.");
    return lines.join("\n");
  };

  /* --------------------- thread summarization ---------------------- */
  // Collapse a long comment chain into a few lines so the owner can catch up
  // without reading top to bottom. One AI call.

  /* -------------- standalone reply drafts (few-shot voice) --------- */
  // Backend-free: draft N reply options to a post/comment, learning the
  // owner's voice from their own pasted sample replies (few-shot). Returns
  // a JSON array of strings.

  SC.LOCAL_REPLY_SYSTEM_PROMPT =
    "You are drafting reply options for a Skool community owner, in THEIR voice. " +
    "You are shown a few of their real past replies as the gold standard for tone, " +
    "length, and phrasing — match them closely. Replies must be specific to the " +
    "post, warm, human, and short. Never generic praise, never mention AI, no " +
    "hashtags, no sign-off signature. Respond with raw JSON only — an array of " +
    "strings, no prose, no code fences.";

  // buildLocalReplyPrompt({post:{author,title,body}, comments:[{authorName,body}],
  //                        replyTo:{authorName,body}|null, voice:{styleNote,samples},
  //                        count})
  // With replyTo set, drafts target that specific COMMENT (the post is context);
  // otherwise they reply to the post itself.
  SC.buildLocalReplyPrompt = function (ctx) {
    var voice = ctx.voice || {};
    var post = ctx.post || {};
    var replyTo = ctx.replyTo || null;
    var count = ctx.count || 3;
    var lines = [];
    if (voice.styleNote) { lines.push("The owner describes their voice as: " + voice.styleNote); lines.push(""); }
    if (voice.samples && voice.samples.length) {
      lines.push("Here are real replies the owner has written — copy this voice:");
      voice.samples.slice(0, 10).forEach(function (s, i) {
        lines.push((i + 1) + ". " + String(s).replace(/\s+/g, " ").trim());
      });
      lines.push("");
    } else {
      lines.push("(No sample replies provided — keep it warm, brief, and specific.)");
      lines.push("");
    }
    lines.push((replyTo ? "The post under discussion" : "Draft replies to this post") +
      (post.author ? " by " + post.author : "") + ":");
    if (post.title) lines.push("Title: " + post.title);
    if (post.body) lines.push(String(post.body).replace(/\s+/g, " ").slice(0, 900));
    if (!post.title && !post.body) lines.push("(post text unavailable — reply to the discussion generally)");
    if (ctx.comments && ctx.comments.length) {
      lines.push("");
      lines.push(replyTo ? "The comment thread so far:" : "Recent comments on it (for context):");
      ctx.comments.slice(0, 10).forEach(function (c) {
        lines.push("- " + (c.authorName || "member") + ": " +
          String(c.body || "").replace(/\s+/g, " ").slice(0, 200));
      });
    }
    if (replyTo) {
      lines.push("");
      lines.push("Draft replies TO THIS COMMENT from " + (replyTo.authorName || "a member") + ":");
      lines.push(String(replyTo.body || "").replace(/\s+/g, " ").slice(0, 600));
      lines.push("");
      lines.push("Address " + (replyTo.authorName ? replyTo.authorName.split(" ")[0] : "them") +
        " directly and respond to the specific thing they said. If they asked a " +
        "question, answer it.");
    }
    lines.push("");
    lines.push("Return exactly " + count + " distinct reply options as a JSON array of " +
      "strings, e.g. [\"first reply\", \"second reply\"]. Vary the angle across them " +
      "(one warm/short, one that asks a follow-up question, one more substantive).");
    return lines.join("\n");
  };

  // Tolerant parser: JSON array of strings, else a numbered/bulleted list.
  SC.parseReplyDrafts = function (text, count) {
    if (!text) return [];
    var s = String(text).replace(/```(?:json)?/gi, "").trim();
    var start = s.indexOf("["), end = s.lastIndexOf("]");
    if (start !== -1 && end > start) {
      try {
        var arr = JSON.parse(s.slice(start, end + 1));
        if (Array.isArray(arr)) {
          var out = arr.map(function (x) { return String(x).trim(); }).filter(Boolean);
          if (out.length) return count ? out.slice(0, count) : out;
        }
      } catch (e) { /* fall through to list parse */ }
    }
    // Fallback: split a numbered/bulleted list.
    var items = s.split(/\n/).map(function (l) {
      return l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim();
    }).filter(function (l) { return l.length > 1; });
    return count ? items.slice(0, count) : items;
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
