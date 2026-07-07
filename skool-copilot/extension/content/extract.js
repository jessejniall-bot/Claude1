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
      var titleEl = card.querySelector('a[href="/' + group + "/" + slug + '"]');
      var title = titleEl ? titleEl.innerText.trim() : null;

      // Body sits between the title line and the "Save" line.
      var lines = card.innerText.split("\n")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      var titleIdx = title ? lines.indexOf(title) : -1;
      var saveIdx = lines.indexOf("Save");
      var body = null;
      if (titleIdx >= 0 && saveIdx > titleIdx) {
        // saveIdx-1 is the like count; body is everything between title and it.
        body = lines.slice(titleIdx + 1, saveIdx - 1).join(" ").trim() || null;
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
      var lines = block.innerText.split("\n")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      var tsIdx = -1;
      for (var k = 0; k < lines.length; k++) {
        if (/•/.test(lines[k])) { tsIdx = k; break; } // "• 4h" timestamp line
      }
      var body = tsIdx >= 0 ? (lines[tsIdx + 1] || null) : null;

      var author = a.getAttribute("href").replace(/\?.*/, "");
      var key = author + "|" + body;
      if (seen[key]) continue;
      seen[key] = 1;

      comments.push({ author: author, authorName: a.innerText.trim() || null, body: body });
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
