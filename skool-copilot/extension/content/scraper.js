/* =====================================================================
   Skool Community Copilot — content script
   ---------------------------------------------------------------------
   Runs on skool.com. Scraping only activates when BOTH ownership checks
   pass for the community being viewed:
     1. Allowlist — the community's URL was added by the signed-in user
        in setup (checked against the backend via the service worker).
     2. Live admin signal — the current page shows DOM/data markers that
        Skool only renders for owners/admins.
   The status pill makes the current state visible at all times. When
   inactive, nothing is read or sent.

   Skool is a Next.js app with obfuscated class names, so scraping
   prefers the embedded __NEXT_DATA__ JSON over DOM heuristics. Skool
   can change either at any time — ADMIN_ROLE_PATHS, ADMIN_SELECTORS,
   and the post-shape heuristics below are the places to update.
   ===================================================================== */
(function () {
  "use strict";

  var RESERVED_PATHS = {
    "": 1, login: 1, signup: 1, discovery: 1, games: 1, refer: 1,
    legal: 1, support: 1, pricing: 1, magic: 1, settings: 1,
  };

  var state = {
    slug: null,
    allowed: false,
    admin: false,
    override: false, // manual "I admin this" switch from the side panel
    active: false,
    communityName: null,
    lastSyncAt: null,
    sentKeys: {},        // post_key -> true, avoids resending within this page session
    sentCommentKeys: {}, // comment_key -> true
    syncedPosts: 0,      // diagnostics, surfaced in the status pill tooltip
    syncedComments: 0,
    adminSignal: null,   // which check matched, for debugging selector drift
  };

  function debug() {
    if (!window.SC_COPILOT_DEBUG) return;
    var args = ["[Skool Copilot]"].concat([].slice.call(arguments));
    console.debug.apply(console, args);
  }

  // Keys that mark an object as a *comment* (it references a parent).
  var PARENT_REF_KEYS = ["postId", "post_id", "parentId", "parent_id", "rootId", "root_id", "parent", "root"];

  function parentRef(obj) {
    for (var i = 0; i < PARENT_REF_KEYS.length; i++) {
      var v = obj[PARENT_REF_KEYS[i]];
      if (typeof v === "string" && v) return v;
      if (v && typeof v === "object" && typeof v.id === "string") return v.id;
    }
    return null;
  }

  /* ------------------------- slug detection ------------------------ */

  function currentSlug() {
    var seg = location.pathname.split("/")[1] || "";
    seg = seg.toLowerCase();
    if (RESERVED_PATHS[seg]) return null;
    return seg || null;
  }

  /* ---------------------- admin signal check ----------------------- */

  var ADMIN_ROLE_VALUES = { admin: 1, owner: 1, "group-admin": 1, moderator: 1 };

  // Dotted paths into __NEXT_DATA__ where Skool exposes the *current*
  // user's membership role for the group being viewed.
  var ADMIN_ROLE_PATHS = [
    "props.pageProps.currentGroup.member.role",
    "props.pageProps.group.member.role",
    "props.pageProps.groupMember.role",
    "props.pageProps.currentGroupMember.role",
    "props.pageProps.self.role",
  ];

  // DOM elements Skool only renders for owners/admins of the group.
  function adminSelectors(slug) {
    return [
      'a[href*="/' + slug + '/-/settings"]',
      'a[href$="/' + slug + '/settings"]',
      'a[href*="/' + slug + '/admin"]',
    ];
  }

  var ADMIN_TEXT_LABELS = ["manage community", "group settings", "admin settings"];

  function readNextData() {
    var el = document.getElementById("__NEXT_DATA__");
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  function dig(obj, dottedPath) {
    var parts = dottedPath.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function detectAdminSignal(slug) {
    // Signal A: current-user membership role in the page data.
    var data = readNextData();
    if (data) {
      for (var i = 0; i < ADMIN_ROLE_PATHS.length; i++) {
        var role = dig(data, ADMIN_ROLE_PATHS[i]);
        if (typeof role === "string" && ADMIN_ROLE_VALUES[role.toLowerCase()]) {
          state.adminSignal = "role:" + ADMIN_ROLE_PATHS[i] + "=" + role;
          return true;
        }
      }
    }
    // Signal B: admin-only links.
    var sels = adminSelectors(slug);
    for (var j = 0; j < sels.length; j++) {
      if (document.querySelector(sels[j])) {
        state.adminSignal = "selector:" + sels[j];
        return true;
      }
    }
    // Signal C: admin-only labeled controls.
    var candidates = document.querySelectorAll("a, button");
    for (var k = 0; k < candidates.length; k++) {
      var t = (candidates[k].textContent || "").trim().toLowerCase();
      if (t && ADMIN_TEXT_LABELS.indexOf(t) !== -1) {
        state.adminSignal = "label:" + t;
        return true;
      }
    }
    state.adminSignal = null;
    return false;
  }

  /* -------------------------- status pill -------------------------- */

  var pill = null;

  function renderPill() {
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "sc-status-pill";
      document.documentElement.appendChild(pill);
    }
    var cls, text;
    if (!state.slug) {
      pill.style.display = "none";
      return;
    }
    if (state.active) {
      cls = "sc-active";
      text = state.admin
        ? "Copilot active — admin access confirmed"
        : "Copilot active — manual admin override";
      if (state.syncedPosts || state.syncedComments) {
        text += " · " + state.syncedPosts + "p / " + state.syncedComments + "c synced";
      }
    } else if (state.allowed && !state.admin) {
      cls = "sc-inactive";
      text = "No admin access detected — Copilot inactive (side panel has a force-enable switch)";
    } else {
      cls = "sc-idle";
      text = "Copilot inactive — community not in your allowlist";
    }
    pill.className = cls;
    pill.textContent = text;
    pill.title = "slug: " + state.slug +
      " | allowlisted: " + state.allowed +
      " | admin signal: " + (state.adminSignal || "none") +
      " | manual override: " + state.override +
      " | synced this visit: " + state.syncedPosts + " posts, " +
      state.syncedComments + " comments";
    pill.style.display = "block";
  }

  /* ------------------------ post extraction ------------------------ */

  function hashText(s) {
    // djb2 — stable dedupe key when a post id isn't available.
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return "h" + h.toString(36);
  }

  function toIso(value) {
    if (value == null) return null;
    var d = typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Walk __NEXT_DATA__ collecting objects that look like feed posts.
  // Skool post objects generally carry an id, created timestamp, some
  // content/title metadata, and vote/comment counts.
  function collectNextDataPosts(root) {
    var found = [];
    var seen = new Set();

    function looksLikePost(obj) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
      var meta = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : obj;
      var hasContent =
        typeof meta.content === "string" || typeof meta.title === "string" ||
        typeof obj.content === "string" || typeof obj.title === "string";
      var hasCounts =
        meta.upvotes !== undefined || meta.comments !== undefined ||
        obj.upvotes !== undefined || obj.commentsCount !== undefined ||
        meta.likes !== undefined;
      var hasTime =
        obj.createdAt !== undefined || obj.created_at !== undefined ||
        meta.createdAt !== undefined;
      // Objects referencing a parent are comments, not posts.
      return hasContent && hasCounts && hasTime && !parentRef(obj);
    }

    function extract(obj) {
      var meta = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : {};
      var title = meta.title || obj.title || "";
      var content = meta.content || obj.content || "";
      var text = (title ? title + "\n\n" : "") + content;
      if (!text.trim()) return null;
      var id = obj.id || obj.name || meta.id || hashText(text);
      if (seen.has(id)) return null;
      seen.add(id);
      var user = obj.user || obj.author || {};
      var authorName =
        user.name ||
        [user.firstName || user.first_name, user.lastName || user.last_name]
          .filter(Boolean).join(" ") ||
        null;
      // Skool sometimes exposes comments as a count, sometimes as an
      // array of comment objects — accept both.
      var rawComments = meta.comments ?? obj.commentsCount ?? obj.comments ?? 0;
      var commentCount = Array.isArray(rawComments)
        ? rawComments.length
        : Number(rawComments) || 0;
      return {
        post_key: String(id),
        post_text: text.slice(0, 8000),
        likes: Number(meta.upvotes ?? obj.upvotes ?? meta.likes ?? 0) || 0,
        comments: commentCount,
        posted_at: toIso(obj.createdAt || obj.created_at || meta.createdAt),
        author: authorName,
        first_comment_at: toIso(meta.lastComment || meta.firstCommentAt || null),
      };
    }

    var stack = [root];
    var guard = 0;
    while (stack.length && guard < 200000) {
      guard++;
      var cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (Array.isArray(cur)) {
        for (var i = 0; i < cur.length; i++) stack.push(cur[i]);
        continue;
      }
      if (looksLikePost(cur)) {
        var p = extract(cur);
        if (p) found.push(p);
      }
      for (var k in cur) {
        if (Object.prototype.hasOwnProperty.call(cur, k)) stack.push(cur[k]);
      }
    }
    return found;
  }

  // Walk __NEXT_DATA__ collecting objects that look like member comments:
  // content + timestamp + a reference to a parent post/comment. Feed pages
  // expose a few; opening a post exposes the full thread.
  function collectNextDataComments(root) {
    var found = [];
    var seen = new Set();

    function looksLikeComment(obj) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
      var meta = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : obj;
      var hasContent = typeof meta.content === "string" || typeof obj.content === "string";
      var hasTime = obj.createdAt !== undefined || obj.created_at !== undefined;
      return hasContent && hasTime && !!parentRef(obj);
    }

    function extract(obj) {
      var meta = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : {};
      var content = meta.content || obj.content || "";
      if (!String(content).trim()) return null;
      var id = obj.id || obj.name || hashText(String(content));
      if (seen.has(id)) return null;
      seen.add(id);
      var user = obj.user || obj.author || {};
      var authorName =
        user.name ||
        [user.firstName || user.first_name, user.lastName || user.last_name]
          .filter(Boolean).join(" ") ||
        null;
      return {
        comment_key: String(id),
        post_key: parentRef(obj),
        comment_text: String(content).slice(0, 4000),
        author: authorName,
        likes: Number(meta.upvotes ?? obj.upvotes ?? 0) || 0,
        commented_at: toIso(obj.createdAt || obj.created_at),
      };
    }

    var stack = [root];
    var guard = 0;
    while (stack.length && guard < 200000) {
      guard++;
      var cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (Array.isArray(cur)) {
        for (var i = 0; i < cur.length; i++) stack.push(cur[i]);
        continue;
      }
      if (looksLikeComment(cur)) {
        var c = extract(cur);
        if (c) found.push(c);
      }
      for (var k in cur) {
        if (Object.prototype.hasOwnProperty.call(cur, k)) stack.push(cur[k]);
      }
    }
    return found;
  }

  // DOM fallback: coarse, only used when __NEXT_DATA__ yields nothing
  // (e.g. after client-side navigation). Looks for feed cards that show
  // both a like and a comment count.
  function collectDomPosts() {
    var posts = [];
    var nodes = document.querySelectorAll('div[class*="PostItem"], article');
    nodes.forEach(function (node) {
      var text = (node.innerText || "").trim();
      if (text.length < 40) return;
      var counts = text.match(/(\d+)\s*(?:likes?|👍)?[\s\S]*?(\d+)\s*comments?/i);
      var body = text.split(/\n{2,}/).slice(0, 4).join("\n\n").slice(0, 2000);
      posts.push({
        post_key: hashText(body),
        post_text: body,
        likes: counts ? Number(counts[1]) : 0,
        comments: counts ? Number(counts[2]) : 0,
        posted_at: null,
        author: null,
        first_comment_at: null,
      });
    });
    return posts;
  }

  /* ----------------------------- sync ------------------------------ */

  function sendMessage(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  var scrapeTimer = null;

  function scheduleScrape() {
    if (!state.active) return;
    clearTimeout(scrapeTimer);
    scrapeTimer = setTimeout(runScrape, 1500);
  }

  async function runScrape() {
    if (!state.active) return;
    var data = readNextData();
    var posts = data ? collectNextDataPosts(data) : [];
    if (!posts.length) posts = collectDomPosts();
    posts = posts.filter(function (p) { return !state.sentKeys[p.post_key]; });

    debug("scrape pass:", posts.length, "new posts found",
      data ? "(via __NEXT_DATA__)" : "(via DOM fallback)");

    if (posts.length) {
      var res = await sendMessage({ type: "SCRAPED_POSTS", slug: state.slug, posts: posts });
      if (res && res.ok) {
        posts.forEach(function (p) { state.sentKeys[p.post_key] = true; });
        state.syncedPosts += posts.length;
        state.lastSyncAt = Date.now();
      } else {
        debug("post sync failed:", res && res.error);
      }
    }

    var comments = data ? collectNextDataComments(data) : [];
    comments = comments.filter(function (c) { return !state.sentCommentKeys[c.comment_key]; });
    debug("scrape pass:", comments.length, "new comments found");
    if (comments.length) {
      var cres = await sendMessage({
        type: "SCRAPED_COMMENTS", slug: state.slug, comments: comments,
      });
      if (cres && cres.ok) {
        comments.forEach(function (c) { state.sentCommentKeys[c.comment_key] = true; });
        state.syncedComments += comments.length;
        state.lastSyncAt = Date.now();
      } else {
        debug("comment sync failed:", cres && cres.error);
      }
    }
    renderPill(); // refresh the synced counters
  }

  /* ----------------------- idea capture button --------------------- */

  var fab = null;

  function renderFab() {
    if (!fab) {
      fab = document.createElement("button");
      fab.id = "sc-capture-fab";
      fab.type = "button";
      fab.title = "Save selection (or a note) as a post idea";
      fab.textContent = "💡";
      fab.addEventListener("click", onCapture);
      document.documentElement.appendChild(fab);
    }
    fab.style.display = state.active ? "flex" : "none";
  }

  async function onCapture() {
    var selection = String(window.getSelection() || "").trim();
    var content = selection || window.prompt("Save an idea for a future post:");
    if (!content) return;
    var res = await sendMessage({ type: "SAVE_IDEA", slug: state.slug, content: content });
    flashFab(res && res.ok ? "✅" : "⚠️");
  }

  function flashFab(emoji) {
    if (!fab) return;
    var original = "💡";
    fab.textContent = emoji;
    setTimeout(function () { fab.textContent = original; }, 1400);
  }

  /* --------------------------- lifecycle ---------------------------- */

  async function evaluatePage() {
    var slug = currentSlug();
    if (slug !== state.slug) {
      state.sentKeys = {};
      state.sentCommentKeys = {};
      state.syncedPosts = 0;
      state.syncedComments = 0;
    }
    state.slug = slug;
    state.allowed = false;
    state.admin = false;
    state.active = false;

    if (slug) {
      var res = await sendMessage({ type: "GET_COMMUNITY_STATE", slug: slug });
      state.allowed = !!(res && res.allowed);
      state.override = !!(res && res.override);
      state.communityName = res ? res.communityName : null;
      // Admin check runs on every pageview. The allowlist is always
      // required; the live admin signal can be replaced by the user's
      // explicit per-community override when Skool's markup changes.
      state.admin = detectAdminSignal(slug);
      state.active = state.allowed && (state.admin || state.override);
    }

    renderPill();
    renderFab();
    if (state.active) scheduleScrape();
  }

  // On-demand read for the side panel's "Read & suggest": returns the
  // posts currently rendered on this page. Same gate as passive scraping —
  // allowlist plus admin signal (or the explicit override).
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== "READ_PAGE_POSTS") return;
    if (!state.slug) {
      sendResponse({ ok: false, error: "This tab isn't on a Skool community page." });
      return;
    }
    if (!state.active) {
      sendResponse({
        ok: false,
        slug: state.slug,
        error: !state.allowed
          ? "This community isn't in your allowlist."
          : "No admin access detected here — tick the force-enable switch, then reload this tab.",
      });
      return;
    }
    var data = readNextData();
    var posts = data ? collectNextDataPosts(data) : [];
    if (!posts.length) posts = collectDomPosts();
    var limit = msg.limit > 0 ? msg.limit : posts.length;
    sendResponse({
      ok: true,
      slug: state.slug,
      totalOnPage: posts.length,
      posts: posts.slice(0, limit),
    });
  });

  // Normalize CSS-module-style class names (e.g. "PostCard_root__aB3dQ")
  // so a frequency count groups instances of the same component instead
  // of being fragmented by their per-build hash suffix.
  function normalizeClassName(cls) {
    return cls
      .replace(/__[a-zA-Z0-9_-]{4,10}$/, "__HASH")
      .replace(/-[a-zA-Z0-9]{5,10}$/, "-HASH");
  }

  // Structural snapshot of the current page for calibrating the scraper
  // against Skool's real, current markup — used when automatic detection
  // finds nothing. Reports shapes and counts, not member content, except
  // for capped raw samples of any React Server Component "flight" script
  // (Next.js App Router's data format), which may contain post/comment
  // text — the side panel warns about this before the user shares it.
  function collectPageReport() {
    var report = {
      url: location.href,
      slug: state.slug,
      capturedAt: new Date().toISOString(),
      readyState: document.readyState,
    };

    // 1. Classic Pages Router data island.
    var ndEl = document.getElementById("__NEXT_DATA__");
    if (ndEl) {
      try {
        var parsed = JSON.parse(ndEl.textContent);
        report.nextData = {
          present: true,
          sizeChars: ndEl.textContent.length,
          topLevelKeys: Object.keys(parsed),
          pagePropsKeys: parsed.props && parsed.props.pageProps
            ? Object.keys(parsed.props.pageProps) : [],
        };
      } catch (e) {
        report.nextData = { present: true, parseError: String(e.message) };
      }
    } else {
      report.nextData = { present: false };
    }

    // 2. App Router "flight" data — inline scripts calling self.__next_f.push(...).
    var flightScripts = Array.prototype.filter.call(
      document.querySelectorAll("script"),
      function (s) { return s.textContent && s.textContent.indexOf("__next_f.push") !== -1; }
    );
    report.nextFlight = {
      scriptCount: flightScripts.length,
      totalChars: flightScripts.reduce(function (sum, s) { return sum + s.textContent.length; }, 0),
      samples: flightScripts.slice(0, 3).map(function (s) { return s.textContent.slice(0, 1500); }),
    };

    // 3. Other common client-state globals.
    report.globals = [];
    ["__APOLLO_STATE__", "__INITIAL_STATE__", "__PRELOADED_STATE__", "__RELAY_STORE__"]
      .forEach(function (key) {
        if (window[key] !== undefined) {
          var keys = [];
          try { keys = Object.keys(window[key] || {}).slice(0, 20); } catch (e) {}
          report.globals.push({ name: key, topKeys: keys });
        }
      });

    // 4. Other JSON data islands by tag, not just __NEXT_DATA__.
    report.jsonScripts = Array.prototype.map.call(
      document.querySelectorAll("script[type='application/json']"),
      function (s) { return { id: s.id || "(no id)", length: s.textContent.length }; }
    );

    // 5. DOM census: broad selector hit-counts + most common component
    // class names (normalized), to spot the real feed/post/comment markup.
    var selectors = [
      "article", "[class*='post' i]", "[class*='feed' i]", "[class*='comment' i]",
      "[class*='reply' i]", "[class*='card' i]", "[class*='thread' i]",
      "[data-testid]", "[role='article']",
    ];
    report.selectorCounts = {};
    selectors.forEach(function (sel) {
      try { report.selectorCounts[sel] = document.querySelectorAll(sel).length; } catch (e) {}
    });

    var classFreq = {};
    Array.prototype.forEach.call(document.querySelectorAll("[class]"), function (el) {
      var cn = el.className;
      if (typeof cn !== "string" || !cn) return;
      cn.split(/\s+/).forEach(function (c) {
        var norm = normalizeClassName(c);
        classFreq[norm] = (classFreq[norm] || 0) + 1;
      });
    });
    report.topClasses = Object.keys(classFreq)
      .sort(function (a, b) { return classFreq[b] - classFreq[a]; })
      .slice(0, 40)
      .map(function (c) { return c + " (" + classFreq[c] + ")"; });

    return report;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== "CAPTURE_PAGE_REPORT") return;
    if (!/(^|\.)skool\.com$/.test(location.hostname)) {
      sendResponse({ ok: false, error: "Not a Skool page." });
      return;
    }
    try {
      sendResponse({ ok: true, report: collectPageReport() });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  });

  // Calibration helper: run SC_COPILOT_DIAGNOSE() in the page console and
  // share the output to tune admin detection for Skool's current markup.
  // It reports structure only — role values, JSON paths, and slug-related
  // link hrefs — not post contents.
  window.SC_COPILOT_DIAGNOSE = function () {
    var out = { slug: state.slug, allowed: state.allowed, adminSignal: state.adminSignal,
      override: state.override, roles: [], links: [] };
    var data = readNextData();
    if (data) {
      var seen = 0;
      (function walk(obj, path) {
        if (!obj || typeof obj !== "object" || seen > 40) return;
        for (var k in obj) {
          if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
          var v = obj[k];
          if (/role/i.test(k) && (typeof v === "string" || typeof v === "number")) {
            out.roles.push(path + "." + k + " = " + v);
            seen++;
          }
          if (v && typeof v === "object") walk(v, path + "." + k);
        }
      })(data, "$");
    } else {
      out.roles.push("(no __NEXT_DATA__ found on this page)");
    }
    document.querySelectorAll("a[href]").forEach(function (a) {
      var h = a.getAttribute("href") || "";
      if (state.slug && h.indexOf(state.slug) !== -1 &&
          /settings|admin|manage|dashboard|-\//i.test(h) && out.links.length < 20) {
        out.links.push(h + "  (text: " + (a.textContent || "").trim().slice(0, 40) + ")");
      }
    });
    console.log("=== Skool Copilot diagnostics — paste this back ===");
    console.log(JSON.stringify(out, null, 2));
    return out;
  };

  // Re-evaluate on SPA navigations (Next.js router) and feed mutations.
  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      evaluatePage();
    }
  }, 800);

  var observer = new MutationObserver(function () {
    if (state.active) scheduleScrape();
  });

  function start() {
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    evaluatePage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
