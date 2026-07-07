/* =====================================================================
   Skool Community Copilot — reply request templating (pure logic)
   ---------------------------------------------------------------------
   Skool has no public write API. The only safe way to post a comment is
   to replay Skool's own internal request from inside the live, logged-in
   tab. We refuse to hardcode an undocumented endpoint that drifts — so
   instead the extension LEARNS the request shape from the owner's own
   manual reply (see content/net-observer.js), stores a redacted template,
   and fills it to replay later.

   This file is the pure, side-effect-free core of that: recognizing a
   comment-create request, turning it into a redacted template, and
   filling the template for a new reply. It touches no network and no
   storage, so it is unit-tested directly. Loaded in BOTH the isolated
   content-script world and the MAIN world (each gets its own copy).
   ===================================================================== */
(function (SC) {
  "use strict";

  // Requests we never want to mistake for a comment-create.
  var URL_DENY_RE = /(auth|login|logout|token|analytics|telemetry|event|track|upvote|like|view|read|notification|presence|typing|search|media|upload|image)/i;

  // Split a field key into lowercase tokens across camelCase and snake/kebab
  // boundaries, so "parentId", "parent_comment_id" and "inReplyTo" all reveal
  // their words.
  function keyTokens(key) {
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^a-zA-Z0-9]+/)
      .join(" ")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }
  function hasToken(key, words) {
    var toks = keyTokens(key);
    return words.some(function (w) { return toks.indexOf(w) !== -1; });
  }
  function isTextKey(key) { return hasToken(key, ["content", "body", "text", "comment", "message", "reply"]); }
  function isPostKey(key) {
    var toks = keyTokens(key);
    if (toks.indexOf("parent") !== -1) return false; // parentPostId is a parent ref
    return toks.indexOf("post") !== -1 || toks.indexOf("root") !== -1;
  }
  function isParentKey(key) {
    var toks = keyTokens(key);
    if (toks.indexOf("parent") !== -1) return true;
    if (toks.indexOf("reply") !== -1 && toks.indexOf("to") !== -1) return true;
    return false;
  }

  // A Skool internal id: hex-ish or uuid-ish, no whitespace, reasonably long.
  function looksLikeId(v) {
    return typeof v === "string" && v.length >= 8 && v.length <= 64 &&
      /^[a-zA-Z0-9_-]+$/.test(v) && !/\s/.test(v);
  }

  // A value that reads like human comment text, not a token or a flag.
  function looksLikeCommentText(v) {
    if (typeof v !== "string") return false;
    var s = v.trim();
    if (s.length < 2) return false;
    // Sentence-ish: has a space, or is clearly prose length, and isn't an id.
    if (looksLikeId(s) && !/\s/.test(s)) return false;
    return /\s/.test(s) || s.length >= 12;
  }

  SC.replyTemplate = SC.replyTemplate || {};
  SC.replyTemplate.looksLikeId = looksLikeId;
  SC.replyTemplate.looksLikeCommentText = looksLikeCommentText;

  // Shallow+one-level walk yielding { path: [k] or [k, k2], value }.
  function scalarFields(obj) {
    var out = [];
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.keys(v).forEach(function (k2) {
          if (v[k2] === null || typeof v[k2] !== "object") out.push({ path: [k, k2], value: v[k2] });
        });
      } else if (v === null || typeof v !== "object") {
        out.push({ path: [k], value: v });
      }
    });
    return out;
  }

  function keyOf(field) { return field.path[field.path.length - 1]; }

  // recognize(method, url, bodyObj[, knownText]) -> analysis or null.
  // Returns { confidence: "strong"|"medium", textPath, postIdPath, parentIdPath }.
  // knownText, when provided (the text the owner actually typed), makes the
  // text-field match exact instead of heuristic.
  SC.replyTemplate.recognize = function (method, url, bodyObj, knownText) {
    if (!/^(POST|PUT|PATCH)$/i.test(String(method || ""))) return null;
    if (!bodyObj || typeof bodyObj !== "object") return null;
    var u = String(url || "");
    if (URL_DENY_RE.test(u)) return null;

    var fields = scalarFields(bodyObj);
    if (!fields.length) return null;

    // Text field.
    var textField = null;
    if (knownText != null) {
      textField = fields.filter(function (f) {
        return typeof f.value === "string" && f.value.trim() === String(knownText).trim();
      })[0] || null;
    }
    if (!textField) {
      var textCandidates = fields.filter(function (f) {
        return isTextKey(keyOf(f)) && looksLikeCommentText(f.value);
      });
      // Prefer the longest such value (the actual comment, not a title).
      textCandidates.sort(function (a, b) { return String(b.value).length - String(a.value).length; });
      textField = textCandidates[0] || null;
    }
    if (!textField) return null;

    // Id fields (must not be the text field itself).
    function findId(pred) {
      var c = fields.filter(function (f) {
        return f !== textField && looksLikeId(f.value) && pred(keyOf(f));
      });
      return c[0] || null;
    }
    var postIdField = findId(isPostKey);
    var parentIdField = findId(isParentKey);

    var urlMentionsComment = /comment/i.test(u);
    var bodyMentionsComment = fields.some(function (f) { return keyTokens(keyOf(f)).indexOf("comment") !== -1; });
    var hasAnyId = !!(postIdField || parentIdField);

    var confidence = null;
    if (urlMentionsComment && hasAnyId) confidence = "strong";
    else if ((urlMentionsComment || bodyMentionsComment) && hasAnyId) confidence = "strong";
    else if (hasAnyId) confidence = "medium";
    else return null;

    return {
      confidence: confidence,
      textPath: textField.path,
      postIdPath: postIdField ? postIdField.path : null,
      parentIdPath: parentIdField ? parentIdField.path : null,
    };
  };

  function getPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }
  function setPath(obj, path, value) {
    var cur = obj;
    for (var i = 0; i < path.length - 1; i++) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
  }

  // makeTemplate({method,url,contentType,body}, analysis) -> template.
  // The template is REDACTED: the real text and ids are replaced with
  // placeholders, so we store the request *shape*, never the captured content.
  SC.replyTemplate.makeTemplate = function (req, analysis) {
    var body = JSON.parse(JSON.stringify(req.body)); // deep clone
    var postId = analysis.postIdPath ? getPath(body, analysis.postIdPath) : null;
    var parentId = analysis.parentIdPath ? getPath(body, analysis.parentIdPath) : null;

    setPath(body, analysis.textPath, "{{TEXT}}");
    if (analysis.postIdPath) setPath(body, analysis.postIdPath, "{{POST_ID}}");
    if (analysis.parentIdPath) setPath(body, analysis.parentIdPath, "{{PARENT_ID}}");

    var url = String(req.url || "");
    if (postId && url.indexOf(postId) !== -1) {
      url = url.split(postId).join("{{POST_ID}}");
    }
    if (parentId && url.indexOf(parentId) !== -1) {
      url = url.split(parentId).join("{{PARENT_ID}}");
    }

    return {
      version: 1,
      method: String(req.method || "POST").toUpperCase(),
      url: url,
      urlHasPostId: url.indexOf("{{POST_ID}}") !== -1,
      urlHasParentId: url.indexOf("{{PARENT_ID}}") !== -1,
      contentType: req.contentType || "application/json",
      bodyTemplate: JSON.stringify(body),
      hasParent: !!analysis.parentIdPath || url.indexOf("{{PARENT_ID}}") !== -1,
      learnedAt: Date.now(),
    };
  };

  // fill(template, { text, postId, parentId }) -> { method, url, contentType, body }.
  // Returns null if the template needs an id we weren't given.
  SC.replyTemplate.fill = function (template, values) {
    if (!template || !template.bodyTemplate) return null;
    var text = String(values.text == null ? "" : values.text);
    var postId = values.postId == null ? "" : String(values.postId);
    var parentId = values.parentId == null ? "" : String(values.parentId);

    if ((template.urlHasPostId || template.bodyTemplate.indexOf("{{POST_ID}}") !== -1) && !postId) {
      return null; // template needs a post id and none was supplied
    }

    // Text goes through JSON.stringify so quotes/newlines are escaped, then we
    // splice it into the JSON template (dropping stringify's outer quotes).
    var textJson = JSON.stringify(text);
    var body = template.bodyTemplate
      .split('"{{TEXT}}"').join(textJson)
      .split("{{POST_ID}}").join(postId)
      .split("{{PARENT_ID}}").join(parentId);

    var url = String(template.url || "")
      .split("{{POST_ID}}").join(encodeURIComponent(postId))
      .split("{{PARENT_ID}}").join(encodeURIComponent(parentId));

    return {
      method: template.method || "POST",
      url: url,
      contentType: template.contentType || "application/json",
      body: body,
    };
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
