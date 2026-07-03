/* =====================================================================
   Skool Community Copilot — config + storage adapter
   ---------------------------------------------------------------------
   Plain-script module: attaches to the SC global so the same file runs
   in the MV3 service worker (importScripts), content scripts, extension
   pages, and the PWA (<script> tag). Load this file before the others.
   ===================================================================== */
(function (SC) {
  "use strict";

  var hasChromeStorage =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  // Unified async key/value storage: chrome.storage.local inside the
  // extension, localStorage in the PWA. Values are JSON-serializable.
  SC.storage = {
    get: function (key) {
      if (hasChromeStorage) {
        return chrome.storage.local.get(key).then(function (obj) {
          return obj[key] === undefined ? null : obj[key];
        });
      }
      try {
        var raw = localStorage.getItem(key);
        return Promise.resolve(raw === null ? null : JSON.parse(raw));
      } catch (e) {
        return Promise.resolve(null);
      }
    },
    set: function (key, value) {
      if (hasChromeStorage) {
        var obj = {};
        obj[key] = value;
        return chrome.storage.local.set(obj);
      }
      localStorage.setItem(key, JSON.stringify(value));
      return Promise.resolve();
    },
    remove: function (key) {
      if (hasChromeStorage) return chrome.storage.local.remove(key);
      localStorage.removeItem(key);
      return Promise.resolve();
    },
  };

  var CONFIG_KEY = "sc_supabase_config";

  // Users paste their own Supabase project URL + anon key in Settings;
  // nothing is hardcoded so the repo ships with no credentials.
  SC.loadConfig = function () {
    return SC.storage.get(CONFIG_KEY).then(function (stored) {
      return {
        supabaseUrl: (stored && stored.supabaseUrl) || "",
        supabaseAnonKey: (stored && stored.supabaseAnonKey) || "",
      };
    });
  };

  SC.saveConfig = function (cfg) {
    return SC.storage.set(CONFIG_KEY, {
      supabaseUrl: (cfg.supabaseUrl || "").trim().replace(/\/+$/, ""),
      supabaseAnonKey: (cfg.supabaseAnonKey || "").trim(),
    });
  };

  // Normalize any Skool URL / slug input to a canonical community slug.
  SC.skoolSlug = function (input) {
    if (!input) return "";
    var s = String(input).trim();
    var m = s.match(/skool\.com\/([^\/?#]+)/i);
    if (m) s = m[1];
    return s.replace(/^\/+|\/+$/g, "").toLowerCase();
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
