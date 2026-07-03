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

  // Builds the single generation prompt from pillar + voice + optional seed.
  SC.buildDraftPrompt = function (ctx) {
    var voice = ctx.voice || {};
    var lines = [];
    lines.push(
      "Write one post for the Skool community \"" + (ctx.communityName || "my community") + "\"."
    );
    lines.push("");
    lines.push("Content pillar to fill: " + ctx.pillarName + ".");
    if (ctx.pillarDescription) lines.push("Pillar description: " + ctx.pillarDescription);
    if (ctx.reason) lines.push("Why this pillar: " + ctx.reason);
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
    lines.push(
      "Output format: first line is the post title (plain text, no markdown heading), " +
      "then a blank line, then the post body. End with a question or call-to-action " +
      "that invites replies. Keep it ready to copy-paste into Skool."
    );
    return lines.join("\n");
  };

  SC.DRAFT_SYSTEM_PROMPT =
    "You are a ghostwriter for a Skool community owner. You write posts that sound " +
    "like the owner, match the requested content pillar, and are built to spark " +
    "member replies. You never mention that you are an AI, never use hashtags, and " +
    "you follow the voice profile exactly.";
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
