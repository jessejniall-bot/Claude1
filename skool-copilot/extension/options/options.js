/* Skool Community Copilot — options page (backend + BYOK settings) */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var AI_SETTINGS_KEY = "sc_ai_settings";

  function fillModels(provider) {
    var meta = SC.PROVIDERS[provider];
    var sel = $("opt-model");
    sel.innerHTML = "";
    (meta.models || []).forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m + (m === meta.defaultModel ? " (default)" : "");
      sel.appendChild(opt);
    });
    sel.value = meta.defaultModel;
    $("opt-api-key").placeholder = meta.keyHint || "";
  }

  async function boot() {
    // Providers dropdown
    var sel = $("opt-provider");
    Object.keys(SC.PROVIDERS).forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p;
      opt.textContent = SC.PROVIDERS[p].label;
      sel.appendChild(opt);
    });

    var cfg = await SC.loadConfig();
    $("opt-supabase-url").value = cfg.supabaseUrl || "";
    $("opt-supabase-key").value = cfg.supabaseAnonKey || "";

    var ai = (await SC.storage.get(AI_SETTINGS_KEY)) || {};
    var provider = ai.provider || "anthropic";
    sel.value = provider;
    fillModels(provider);
    if (ai.model) $("opt-model").value = ai.model;

    var stored = await SC.vault.loadApiKey(provider);
    if (stored) $("opt-ai-status").textContent = "A key is saved for this provider.";
  }

  $("opt-provider").addEventListener("change", async function (e) {
    fillModels(e.target.value);
    $("opt-api-key").value = "";
    var stored = await SC.vault.loadApiKey(e.target.value);
    $("opt-ai-status").textContent = stored ? "A key is saved for this provider." : "";
  });

  $("opt-test-backend").addEventListener("click", async function () {
    $("opt-backend-status").textContent = "Testing…";
    var result = await SC.verifyBackend(
      $("opt-supabase-url").value, $("opt-supabase-key").value
    );
    $("opt-backend-status").textContent = result.ok
      ? "✅ Backend reachable and schema installed."
      : "❌ " + result.error;
  });

  $("opt-save-backend").addEventListener("click", async function () {
    $("opt-backend-status").textContent = "Checking…";
    var result = await SC.verifyBackend(
      $("opt-supabase-url").value, $("opt-supabase-key").value
    );
    if (!result.ok) {
      $("opt-backend-status").textContent = "❌ " + result.error;
      return;
    }
    await SC.saveConfig({
      supabaseUrl: $("opt-supabase-url").value,
      supabaseAnonKey: $("opt-supabase-key").value,
    });
    $("opt-backend-status").textContent = "✅ Saved. Sign in from the side panel.";
  });

  $("opt-save-ai").addEventListener("click", async function () {
    var provider = $("opt-provider").value;
    var key = $("opt-api-key").value.trim();
    if (!key) {
      $("opt-ai-status").textContent = "Paste a key first.";
      return;
    }
    await SC.vault.saveApiKey(provider, key);
    await SC.storage.set(AI_SETTINGS_KEY, {
      provider: provider,
      model: $("opt-model").value,
    });
    $("opt-api-key").value = "";
    $("opt-ai-status").textContent = "Key saved (encrypted, local to this browser).";
  });

  $("opt-test").addEventListener("click", async function () {
    var provider = $("opt-provider").value;
    var key = $("opt-api-key").value.trim() || (await SC.vault.loadApiKey(provider));
    if (!key) {
      $("opt-ai-status").textContent = "No key to test — paste one first.";
      return;
    }
    $("opt-ai-status").textContent = "Testing…";
    try {
      await SC.testConnection(provider, key, $("opt-model").value);
      $("opt-ai-status").textContent = "✅ Connection works.";
    } catch (e) {
      $("opt-ai-status").textContent = "❌ " + String((e && e.message) || e);
    }
  });

  boot();
})();
