/* =====================================================================
   Skool Community Copilot — page-world network observer  (world: MAIN)
   ---------------------------------------------------------------------
   Runs in the PAGE's JS world (not the isolated content-script world) so
   it can see and reuse the page's own fetch/XHR — the only way to both
   LEARN Skool's real comment-create request and REPLAY it authenticated
   as the logged-in user, without ever storing a session token.

   It holds no privileges (no chrome.* here) and talks to the isolated
   content script purely via window.postMessage:

     MAIN  -> isolated : { __sc:"net", kind:"candidate", template }
                         { __sc:"net", kind:"submit-result", id, ok, ... }
     isolated -> MAIN  : { __sc:"ctrl", kind:"submit", id, template, values }

   Observation is read-only: requests are inspected, never modified. The
   template posted out is already REDACTED by reply-template.js (shape
   only, no captured text or ids).
   ===================================================================== */
(function () {
  "use strict";

  var RT = (typeof SC !== "undefined" && SC.replyTemplate) || null;
  if (!RT) return; // reply-template.js must load first in this world

  function post(msg) {
    try { window.postMessage(Object.assign({ __sc: "net" }, msg), "*"); } catch (e) {}
  }

  function bodyToObject(body) {
    if (body == null) return null;
    if (typeof body === "string") {
      try { return JSON.parse(body); } catch (e) { return null; }
    }
    // URLSearchParams / FormData: shallow object of string fields.
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      var o1 = {}; body.forEach(function (v, k) { o1[k] = v; }); return o1;
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      var o2 = {}; body.forEach(function (v, k) { if (typeof v === "string") o2[k] = v; }); return o2;
    }
    return null;
  }

  // Inspect one outbound request; if it looks like a comment-create, post a
  // redacted template out. Wrapped so a throw can never break the page.
  function inspect(method, url, body, contentType) {
    try {
      var obj = bodyToObject(body);
      if (!obj) return;
      var analysis = RT.recognize(method, url, obj);
      if (!analysis) return;
      var template = RT.makeTemplate(
        { method: method, url: url, contentType: contentType || "application/json", body: obj },
        analysis
      );
      post({ kind: "candidate", confidence: analysis.confidence, template: template });
    } catch (e) { /* never interfere with the page */ }
  }

  /* ------------------------------ fetch ---------------------------- */
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var method = (init && init.method) || (input && input.method) || "GET";
        var ct = init && init.headers && pickContentType(init.headers);
        if (init && init.body) inspect(method, url, init.body, ct);
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  function pickContentType(headers) {
    try {
      if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get("content-type");
      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i++) {
          if (String(headers[i][0]).toLowerCase() === "content-type") return headers[i][1];
        }
        return null;
      }
      if (headers && typeof headers === "object") {
        for (var k in headers) if (k.toLowerCase() === "content-type") return headers[k];
      }
    } catch (e) {}
    return null;
  }

  /* ------------------------------- XHR ----------------------------- */
  var XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (XP) {
    var origOpen = XP.open;
    var origSend = XP.send;
    var origSetHeader = XP.setRequestHeader;
    XP.open = function (method, url) {
      this.__sc_m = method; this.__sc_u = url; this.__sc_ct = null;
      return origOpen.apply(this, arguments);
    };
    XP.setRequestHeader = function (name, value) {
      try { if (String(name).toLowerCase() === "content-type") this.__sc_ct = value; } catch (e) {}
      return origSetHeader.apply(this, arguments);
    };
    XP.send = function (body) {
      try { if (body) inspect(this.__sc_m || "GET", this.__sc_u || "", body, this.__sc_ct); } catch (e) {}
      return origSend.apply(this, arguments);
    };
  }

  /* --------------------------- replay path ------------------------- */
  // The isolated world asks us to submit a filled reply using the page's own
  // fetch (so the live session cookie applies). We report the outcome back.
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__sc !== "ctrl" || d.kind !== "submit") return;
    var id = d.id;
    var filled;
    try {
      filled = RT.fill(d.template, d.values || {});
    } catch (e) { filled = null; }
    if (!filled) { post({ kind: "submit-result", id: id, ok: false, error: "template could not be filled" }); return; }

    var fetchFn = origFetch || window.fetch;
    fetchFn(filled.url, {
      method: filled.method,
      headers: { "content-type": filled.contentType },
      body: filled.body,
      credentials: "include",
    }).then(function (res) {
      post({ kind: "submit-result", id: id, ok: res.ok, status: res.status,
        error: res.ok ? null : "Skool returned HTTP " + res.status });
    }).catch(function (e) {
      post({ kind: "submit-result", id: id, ok: false, error: String((e && e.message) || e) });
    });
  });

  post({ kind: "observer-ready" });
})();
