/* =====================================================================
   Skool Community Copilot — web-app ↔ extension settings bridge
   ---------------------------------------------------------------------
   Runs ONLY on the Copilot web app's own pages (see manifest matches)
   and only when the page carries the <meta name="sc-copilot"> marker.
   It mirrors the app's saved settings from the page's localStorage into
   chrome.storage.local, so configuring the web app once configures the
   extension too:
     - Supabase URL + anon key       (sc_supabase_config)
     - AI provider preference        (sc_ai_settings)
     - encrypted AI keys + vault key (sc_ai_keys, sc_vault_key)
   Sessions are deliberately NOT mirrored — Supabase rotates refresh
   tokens, and two surfaces sharing one token sign each other out. You
   sign in once in the side panel instead.
   ===================================================================== */
(function () {
  "use strict";

  if (!document.querySelector('meta[name="sc-copilot"]')) return;

  var KEYS = ["sc_supabase_config", "sc_ai_settings", "sc_vault_key", "sc_ai_keys"];

  function readLocal() {
    var out = {};
    KEYS.forEach(function (k) {
      try {
        var raw = localStorage.getItem(k);
        if (raw !== null) out[k] = JSON.parse(raw);
      } catch (e) { /* skip unparseable */ }
    });
    return out;
  }

  var lastSnapshot = "";

  function sync() {
    var data = readLocal();
    var snapshot = JSON.stringify(data);
    if (snapshot === lastSnapshot || snapshot === "{}") return;
    lastSnapshot = snapshot;
    try {
      chrome.storage.local.set(data, function () {
        if (chrome.runtime.lastError) return;
        chrome.runtime.sendMessage({ type: "REFRESH_COMMUNITIES" }, function () {
          void chrome.runtime.lastError;
        });
      });
    } catch (e) { /* extension context gone (reloaded) */ }
  }

  // Tell the web app the extension is here so it can show "connected".
  document.documentElement.setAttribute("data-sc-extension", chrome.runtime.id || "1");

  sync();
  // The app dispatches "sc-sync" after saving settings; also re-check
  // when the tab regains focus.
  document.addEventListener("sc-sync", sync);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) sync();
  });
})();
