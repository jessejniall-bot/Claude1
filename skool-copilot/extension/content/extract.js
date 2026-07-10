/* =====================================================================
   Skool Community Copilot — class-free DOM scraper
   ---------------------------------------------------------------------
   Skool ships hashed styled-component class names, so we NEVER select by
   class. The reliable anchor is the permalink <a href="/{group}/{slug}?p={id}">
   — those links appear only on real feed posts (never nav items). We walk
   UP from a permalink to its post card.

   Two hard rules, kept on purpose (do not "simplify" them away):
     1. Never select by class name — they are per-build hashes.
     2. Never key anything on postId across sessions — it rotates. The
        stable key is `slug`.

   Exposed on SC.extract so the plain-script content world can call it;
   this file is deliberately the ONLY place that knows Skool's DOM shape.
   ===================================================================== */
(function (SC) {
  "use strict";

  var NAV_SLUGS = {
    classroom: 1, calendar: 1, about: 1, members: 1, map: 1,
    leaderboards: 1, community: 1,
  };

  // Parse a permalink href (relative or absolute) into its parts, or null.
  // Deliberately string-based (no `new URL(...)`) so it never depends on the
  // page's origin — robust on skool.com, in tests, and anywhere else.
  function parsePermalink(href) {
    if (!href) return null;
    var path = String(href);
    var abs = path.match(/^https?:\/\/[^/]+(\/.*)$/i);
    if (abs) path = abs[1];
    var m = path.match(/^\/([a-z0-9-]+)\/([a-z0-9-]+)\?p=([a-z0-9]+)/i);
    return m ? { group: m[1], slug: m[2], postId: m[3] } : null;
  }

  // UI chrome lines that are never content: action controls, counts, and
  // relative timestamps. Used to separate real post/comment text from the
  // buttons and metadata that share the same innerText.
  var CONTROL_LINE_RE = /^(Reply|Like|Liked|Comment|Comments?|Save|Saved|Share|Edit|Edited|Delete|Report|Follow|Pin|Pinned|See more|Show more|View \d+.*|(\d+\s+repl(?:y|ies)))$/i;
  var COUNT_LINE_RE = /^\d+$/;
  // "4h", "2d", "3 hr", "5 mins ago", optionally with a leading bullet.
  var TIME_LINE_RE = /^(?:•\s*)?\d+\s*(?:s|m|h|d|w|y|mo|min|mins|hr|hrs|sec|secs|day|days|week|weeks|month|months|year|years)(?:\s+ago)?$/i;

  // Action rows often render inline as ONE innerText line ("Reply Like 3").
  // A line is a control row when every token is a control word / count /
  // timestamp — a real sentence always has at least one token that isn't.
  function isControlRow(line) {
    if (CONTROL_LINE_RE.test(line)) return true;
    var toks = line.split(/[\s·•|]+/).filter(Boolean);
    if (!toks.length || toks.length > 6) return false;
    return toks.every(function (t) {
      return CONTROL_LINE_RE.test(t) || COUNT_LINE_RE.test(t) || TIME_LINE_RE.test(t);
    });
  }

  function isChromeLine(line, authorName) {
    if (isControlRow(line) || COUNT_LINE_RE.test(line) || TIME_LINE_RE.test(line)) return true;
    if (authorName && line === authorName) return true;
    return false;
  }

  // Walk up from a permalink anchor to the smallest element that is a post
  // card: it contains an author link (/@handle) AND a "Save" control, and
  // isn't huge (so we don't grab the whole feed).
  function findCard(permalinkEl) {
    var el = permalinkEl;
    for (var i = 0; i < 8 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      var txt = el.innerText || "";
      if (el.querySelector('a[href^="/@"]') && /Save/.test(txt) && txt.length < 3000) {
        return el;
      }
    }
    return null;
  }

  // All posts visible in the current feed.
  // Returns [{ slug, postId, group, author, title, body }]. `slug` is the
  // STABLE key; `postId` rotates per session — don't cache on it.
  SC.extract = SC.extract || {};
  SC.extract.extractFeedPosts = function () {
    var permalinks = Array.prototype.slice.call(
      document.querySelectorAll('a[href*="?p="]')
    );
    var seen = {};
    var posts = [];

    for (var i = 0; i < permalinks.length; i++) {
      var link = permalinks[i];
      var parts = parsePermalink(link.getAttribute("href") || "");
      if (!parts) continue;
      var group = parts.group, slug = parts.slug, postId = parts.postId;
      if (NAV_SLUGS[slug] || seen[slug]) continue;

      var card = findCard(link);
      if (!card) continue;
      seen[slug] = 1;

      var authorEl = card.querySelector('a[href^="/@"]');
      var authorName = authorEl ? authorEl.innerText.trim() : null;
      var titleEl = card.querySelector('a[href="/' + group + "/" + slug + '"]');
      var title = titleEl ? titleEl.innerText.trim() : null;

      // Body: everything between the title line and the "Save" line that
      // isn't UI chrome (counts, timestamps, controls, the author's name).
      // Filtering beats position math — the old `saveIdx - 1` assumed a
      // like-count line always sat before "Save" and silently dropped the
      // post's LAST body line whenever it didn't.
      var lines = card.innerText.split("\n")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      var titleIdx = title ? lines.indexOf(title) : -1;
      var saveIdx = lines.indexOf("Save");
      var body = null;
      if (titleIdx >= 0 && saveIdx > titleIdx) {
        body = lines.slice(titleIdx + 1, saveIdx)
          .filter(function (l) { return !isChromeLine(l, authorName); })
          .join("\n").trim() || null;
      }

      posts.push({
        slug: slug,
        postId: postId,
        group: group,
        author: authorEl ? authorEl.getAttribute("href").replace(/\?.*/, "") : null,
        title: title,
        body: body,
      });
    }
    return posts;
  };

  // Comments on a post-DETAIL page (url already at /{group}/{slug}?p={id}).
  // Each comment block has a /@author link + a bare "Reply" control.
  // Returns up to `limit`: [{ author, authorName, body }].
  //
  // Body extraction is anchor-based with two fallbacks, because the old
  // single strategy (find a literal "•" line, take exactly ONE line after
  // it) failed two verified ways: multi-paragraph comments lost everything
  // after their first line, and when Skool draws the bullet with CSS
  // (::before isn't in innerText) every body came back null.
  SC.extract.extractComments = function (limit) {
    limit = limit || 8;
    var all = Array.prototype.slice.call(document.querySelectorAll("*"));
    var replyEls = all.filter(function (e) {
      return e.children.length === 0 && e.textContent.trim() === "Reply";
    });

    var comments = [];
    var seen = {};

    for (var i = 0; i < replyEls.length; i++) {
      var el = replyEls[i];
      var block = null;
      for (var j = 0; j < 6 && el; j++) {
        el = el.parentElement;
        if (!el) break;
        if (el.querySelector('a[href^="/@"]')) { block = el; break; }
      }
      if (!block) continue;

      var a = block.querySelector('a[href^="/@"]');
      var authorName = a.innerText.trim() || null;
      var lines = block.innerText.split("\n")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);

      // Anchor = the last metadata line before the body starts. Try, in
      // order: a "•"/timestamp line, then the author-name line. (The old
      // code only knew "•".)
      var anchorIdx = -1;
      for (var k = 0; k < lines.length; k++) {
        if (/•/.test(lines[k]) || TIME_LINE_RE.test(lines[k])) { anchorIdx = k; break; }
      }
      if (anchorIdx === -1 && authorName) anchorIdx = lines.indexOf(authorName);

      // Body = every line after the anchor until the control row, minus
      // chrome — so multi-paragraph comments come through whole.
      var body = null;
      if (anchorIdx !== -1) {
        var bodyLines = [];
        for (var m = anchorIdx + 1; m < lines.length; m++) {
          if (isControlRow(lines[m])) break; // hit the Reply/Like action row
          if (isChromeLine(lines[m], authorName)) continue;
          bodyLines.push(lines[m]);
        }
        body = bodyLines.join("\n").trim() || null;
      }

      var author = a.getAttribute("href").replace(/\?.*/, "");
      // Dedupe on author+body; bodiless blocks get a positional key so two
      // unparsed comments by the same member don't collapse into one.
      var key = author + "|" + (body || "@" + i);
      if (seen[key]) continue;
      seen[key] = 1;

      comments.push({ author: author, authorName: authorName, body: body });
      if (comments.length >= limit) break;
    }
    return comments;
  };

  // Which post the current DETAIL page is showing (url carries ?p=), matched
  // back to a feed-post shape so the drafter has its title/body.
  SC.extract.currentDetailPost = function () {
    var here = parsePermalink(location.pathname + location.search);
    if (!here) return null;
    var posts = SC.extract.extractFeedPosts();
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].slug === here.slug) return posts[i];
    }
    // Fall back to a minimal record if the card wasn't matched.
    return { slug: here.slug, postId: here.postId, group: here.group, author: null, title: null, body: null };
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
