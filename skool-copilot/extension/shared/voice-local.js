/* =====================================================================
   Skool Community Copilot — local voice profile (no backend needed)
   ---------------------------------------------------------------------
   The standalone reply drafter doesn't touch Supabase, so its voice
   lives in browser storage: a short style note plus a handful of your
   OWN real replies. Those few-shot samples are what actually make drafts
   sound like you. Shape: { styleNote: string, samples: string[] }.
   Requires config.js (SC.storage).
   ===================================================================== */
(function (SC) {
  "use strict";

  var KEY = "sc_local_voice";

  SC.localVoice = {
    load: function () {
      return SC.storage.get(KEY).then(function (v) {
        return {
          styleNote: (v && v.styleNote) || "",
          samples: (v && Array.isArray(v.samples)) ? v.samples : [],
        };
      });
    },
    save: function (voice) {
      var samples = (voice.samples || [])
        .map(function (s) { return String(s).trim(); })
        .filter(Boolean)
        .slice(0, 25);
      return SC.storage.set(KEY, {
        styleNote: String(voice.styleNote || "").trim(),
        samples: samples,
      });
    },
    // Parse a textarea blob into samples: split on blank lines first (so a
    // multi-line reply stays whole), falling back to single lines.
    parseSamples: function (text) {
      var t = String(text || "").trim();
      if (!t) return [];
      var blocks = t.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (blocks.length > 1) return blocks;
      return t.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    },
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
