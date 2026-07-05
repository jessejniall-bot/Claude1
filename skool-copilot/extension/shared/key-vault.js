/* =====================================================================
   Skool Community Copilot — API key vault
   ---------------------------------------------------------------------
   BYOK keys are never sent to the backend. They are encrypted with
   AES-GCM using a randomly generated device key and kept in local
   browser storage (chrome.storage.local / localStorage). This protects
   keys at rest against casual reads and accidental sync/export; it is
   not a defense against code running with full access to this profile.
   Requires config.js (SC.storage).
   ===================================================================== */
(function (SC) {
  "use strict";

  var VAULT_KEY = "sc_vault_key";
  var KEYS_KEY = "sc_ai_keys";

  function bufToB64(buf) {
    var bytes = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function b64ToBuf(b64) {
    var s = atob(b64);
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes.buffer;
  }

  async function getCryptoKey() {
    var jwk = await SC.storage.get(VAULT_KEY);
    if (!jwk) {
      var key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      jwk = await crypto.subtle.exportKey("jwk", key);
      await SC.storage.set(VAULT_KEY, jwk);
    }
    return crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  async function encryptString(plaintext) {
    var key = await getCryptoKey();
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      new TextEncoder().encode(plaintext)
    );
    return { iv: bufToB64(iv.buffer), data: bufToB64(data) };
  }

  async function decryptString(cipher) {
    var key = await getCryptoKey();
    var data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(cipher.iv)) },
      key,
      b64ToBuf(cipher.data)
    );
    return new TextDecoder().decode(data);
  }

  SC.vault = {
    saveApiKey: async function (provider, plaintext) {
      var all = (await SC.storage.get(KEYS_KEY)) || {};
      all[provider] = await encryptString(plaintext);
      await SC.storage.set(KEYS_KEY, all);
    },
    loadApiKey: async function (provider) {
      var all = (await SC.storage.get(KEYS_KEY)) || {};
      if (!all[provider]) return null;
      try {
        return await decryptString(all[provider]);
      } catch (e) {
        return null; // vault key rotated or storage corrupted
      }
    },
    removeApiKey: async function (provider) {
      var all = (await SC.storage.get(KEYS_KEY)) || {};
      delete all[provider];
      await SC.storage.set(KEYS_KEY, all);
    },
    listProviders: async function () {
      var all = (await SC.storage.get(KEYS_KEY)) || {};
      return Object.keys(all);
    },
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
