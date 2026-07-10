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
      var key = PARENT_REF_KEYS[i];
      var v = obj[key];
      var id = null;
      if (typeof v === "string" && v) id = v;
      else if (v && typeof v === "object" && typeof v.id === "string") id = v.id;
      if (!id) continue;
      // Skool sets a top-level post's own rootId/root_id to its own id —
      // that's a self-pointer, not a reference to a parent.
      if ((key === "rootId" || key === "root_id") && id === obj.id) continue;
      return id;
    }
    return null;
  }

  // For a comment, resolve the POST it belongs to and (if it's a reply) the
  // parent COMMENT it replies to. Keys are separated so a top-level comment
  // (whose only ref is the post) doesn't get mistaken for a nested reply.
  var POST_REF_KEYS = ["postId", "post_id", "rootId", "root_id"];
  var COMMENT_PARENT_KEYS = ["parentId", "parent_id", "parentCommentId",
    "parent_comment_id", "replyToId", "reply_to_id", "inReplyToId"];

  function refId(v) {
    if (typeof v === "string" && v) return v;
    if (v && typeof v === "object" && typeof v.id === "string") return v.id;
    return null;
  }
  function postRefOf(obj) {
    for (var i = 0; i < POST_REF_KEYS.length; i++) {
      var id = refId(obj[POST_REF_KEYS[i]]);
      if (id && id !== obj.id) return id;
    }
    if (obj.post && typeof obj.post === "object") return refId(obj.post) || (obj.post.id || null);
    return null;
  }
  // The immediate parent comment id, or null when this is top-level. A parent
  // ref equal to the post id means "directly on the post" → not a reply.
  function commentParentOf(obj, postKey) {
    for (var i = 0; i < COMMENT_PARENT_KEYS.length; i++) {
      var id = refId(obj[COMMENT_PARENT_KEYS[i]]);
      if (id && id !== postKey && id !== obj.id) return id;
    }
    return null;
  }

  // Identity of the currently logged-in user (the owner), read from a few
  // known __NEXT_DATA__ locations, so comments the owner already left can be
  // flagged is_owner and excluded from the needs-response inbox.
  var OWNER_PATHS = [
    "props.pageProps.currentUser",
    "props.pageProps.user",
    "props.pageProps.auth.user",
    "props.pageProps.session.user",
    "props.pageProps.me",
  ];
  function detectOwnerIdent(data) {
    if (!data) return { id: null, name: null };
    for (var i = 0; i < OWNER_PATHS.length; i++) {
      var u = dig(data, OWNER_PATHS[i]);
      if (u && typeof u === "object") {
        var name = authorName(u) || u.name || null;
        if (u.id || name) return { id: u.id || null, name: name };
      }
    }
    return { id: null, name: null };
  }
  function commentIsOwner(obj, ownerIdent) {
    if (!ownerIdent) return false;
    var user = obj.user || obj.author || {};
    if (ownerIdent.id && (user.id === ownerIdent.id)) return true;
    var nm = authorName(user);
    if (ownerIdent.name && nm && nm.toLowerCase() === String(ownerIdent.name).toLowerCase()) return true;
    // Skool sometimes flags the group owner/admin inline on the comment.
    if (obj.isOwner || obj.is_owner) return true;
    var role = (obj.role || (user && user.role) || "").toString().toLowerCase();
    if (role === "owner") return true;
    return false;
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

  // Real names read better than Skool's slug-like user.name ("jesse-niall-3526"),
  // so prefer first/last when present.
  function authorName(user) {
    if (!user || typeof user !== "object") return null;
    var first = user.firstName || user.first_name;
    var last = user.lastName || user.last_name;
    if (first || last) return [first, last].filter(Boolean).join(" ");
    return user.name || null;
  }

  // Shared shape mapper for a Skool post object, whether it came from the
  // direct postTrees path or the generic heuristic walk below.
  function extractPost(obj) {
    var meta = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : {};
    var title = meta.title || obj.title || "";
    var content = meta.content || obj.content || "";
    var text = (title ? title + "\n\n" : "") + content;
    if (!text.trim()) return null;
    var id = obj.id || obj.name || meta.id || hashText(text);
    // Skool sometimes exposes comments as a count, sometimes as an
    // array of comment objects — accept both.
    var rawComments = meta.comments ?? obj.commentsCount ?? obj.comments ?? 0;
    var commentCount = Array.isArray(rawComments)
      ? rawComments.length
      : Number(rawComments) || 0;
    return {
      post_key: String(id),
      post_name: obj.name || meta.name || null,
      post_text: text.slice(0, 8000),
      likes: Number(meta.upvotes ?? obj.upvotes ?? meta.likes ?? 0) || 0,
      comments: commentCount,
      posted_at: toIso(obj.createdAt || obj.created_at || meta.createdAt),
      author: authorName(obj.user || obj.author),
      first_comment_at: toIso(meta.lastComment || meta.firstCommentAt || null),
    };
  }

  // Primary extraction path: Skool's real feed shape, confirmed via a
  // page-report capture — pageProps.postTrees[].post. Returns null (not an
  // empty array) when this key isn't present so callers know to fall back.
  function extractFromPostTrees(root) {
    var pageProps = root && root.props && root.props.pageProps;
    var trees = pageProps && pageProps.postTrees;
    if (!Array.isArray(trees) || !trees.length) return null;
    var found = [];
    var seen = new Set();
    trees.forEach(function (tree) {
      var post = tree && tree.post;
      if (!post || typeof post !== "object") return;
      var p = extractPost(post);
      if (p && !seen.has(p.post_key)) {
        seen.add(p.post_key);
        found.push(p);
      }
    });
    return found;
  }

  // Walk __NEXT_DATA__ collecting objects that look like feed posts. Used
  // when the direct postTrees path above isn't present (e.g. other Skool
  // page types, or Skool changing its data shape again in the future).
  function collectNextDataPosts(root) {
    var direct = extractFromPostTrees(root);
    if (direct) return direct;

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
        var p = extractPost(cur);
        if (p && !seen.has(p.post_key)) {
          seen.add(p.post_key);
          found.push(p);
        }
      }
      for (var k in cur) {
        if (Object.prototype.hasOwnProperty.call(cur, k)) stack.push(cur[k]);
      }
    }
    return found;
  }

  // Map one comment object to a storage row, carrying its post + parent-comment
  // linkage (for threading) and whether the owner wrote it.
  function extractComment(obj, postKeyHint, parentHint, ownerIdent) {
    var meta = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : {};
    var content = meta.content || obj.content || "";
    if (!String(content).trim()) return null;
    var id = obj.id || obj.name || meta.id || hashText(String(content));
    var postKey = postKeyHint || postRefOf(obj);
    var parentKey = parentHint || commentParentOf(obj, postKey);
    return {
      comment_key: String(id),
      post_key: postKey || null,
      parent_comment_key: parentKey || null,
      comment_text: String(content).slice(0, 4000),
      author: authorName(obj.user || obj.author),
      is_owner: commentIsOwner(obj, ownerIdent),
      likes: Number(meta.upvotes ?? obj.upvotes ?? 0) || 0,
      commented_at: toIso(obj.createdAt || obj.created_at || meta.createdAt),
    };
  }

  // Primary path: Skool's post-detail trees carry the full comment tree nested
  // under each post. We walk it so parent linkage is exact even when a comment
  // object doesn't carry its own parentId. Child comment lists appear under a
  // handful of key names; a node may be the comment itself or wrap one.
  var COMMENT_CHILD_KEYS = ["comments", "children", "replies", "commentTrees", "commentTree"];
  function extractCommentsFromTrees(root, ownerIdent) {
    var pageProps = root && root.props && root.props.pageProps;
    if (!pageProps) return null;
    var trees = pageProps.postTrees;
    if (!Array.isArray(trees)) {
      if (pageProps.postTree) trees = [pageProps.postTree];
      else if (pageProps.post) trees = [{ post: pageProps.post }];
      else return null;
    }
    var found = [];
    var seen = new Set();

    function childListsOf(node) {
      var lists = [];
      COMMENT_CHILD_KEYS.forEach(function (k) {
        if (Array.isArray(node[k]) && node[k].length) lists.push(node[k]);
        if (node.post && Array.isArray(node.post[k]) && node.post[k].length) lists.push(node.post[k]);
      });
      return lists;
    }
    // A tree child may be {comment:{...}, children:[...]}, {post:{...}}, or a
    // bare comment object. Unwrap to the comment payload.
    function commentOf(node) {
      if (!node || typeof node !== "object") return null;
      if (node.comment && typeof node.comment === "object") return node.comment;
      if (node.post && typeof node.post === "object") return node.post;
      return node;
    }

    trees.forEach(function (tree) {
      var post = commentOf(tree);
      var postKey = (post && (post.id || postRefOf(post))) || null;
      (function walk(node, parentCommentKey, depth) {
        if (!node || depth > 12) return;
        childListsOf(node).forEach(function (list) {
          list.forEach(function (childNode) {
            var c = commentOf(childNode);
            if (!c || typeof c !== "object") return;
            var row = extractComment(c, postKey, parentCommentKey, ownerIdent);
            if (row && !seen.has(row.comment_key)) {
              seen.add(row.comment_key);
              found.push(row);
            }
            // Recurse: this comment's id becomes the parent for its replies.
            walk(childNode, (row && row.comment_key) || parentCommentKey, depth + 1);
            if (c !== childNode) walk(c, (row && row.comment_key) || parentCommentKey, depth + 1);
          });
        });
      })(tree, null, 0);
    });
    return found.length ? found : null;
  }

  // Walk __NEXT_DATA__ collecting objects that look like member comments:
  // content + timestamp + a reference to a parent post/comment. Prefers the
  // nested tree extraction above; falls back to a flat heuristic walk.
  function collectNextDataComments(root) {
    var ownerIdent = detectOwnerIdent(root);
    var direct = extractCommentsFromTrees(root, ownerIdent);
    if (direct) return direct;

    var found = [];
    var seen = new Set();

    function looksLikeComment(obj) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
      var meta = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : obj;
      var hasContent = typeof meta.content === "string" || typeof obj.content === "string";
      var hasTime = obj.createdAt !== undefined || obj.created_at !== undefined ||
        (meta && meta.createdAt !== undefined);
      return hasContent && hasTime && !!parentRef(obj);
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
        var c = extractComment(cur, null, null, ownerIdent);
        if (c && !seen.has(c.comment_key)) {
          seen.add(c.comment_key);
          found.push(c);
        }
      }
      for (var k in cur) {
        if (Object.prototype.hasOwnProperty.call(cur, k)) stack.push(cur[k]);
      }
    }
    return found;
  }

  // DOM fallback: used when __NEXT_DATA__ yields nothing (e.g. after
  // client-side navigation, or posts loaded by infinite scroll that the SSR
  // snapshot never had). Anchored on permalinks via SC.extract — never on
  // class names (they're hashed) — and keyed on the STABLE slug, never postId.
  function collectDomPosts() {
    if (!SC.extract || !SC.extract.extractFeedPosts) return [];
    return SC.extract.extractFeedPosts().map(function (p) {
      var text = (p.title ? p.title + "\n\n" : "") + (p.body || "");
      return {
        post_key: p.slug, // stable across sessions; postId rotates
        post_name: p.slug,
        post_text: text.trim().slice(0, 8000),
        likes: 0,
        comments: 0,
        posted_at: null,
        author: p.author,
        first_comment_at: null,
      };
    });
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
    // DOM fallback for comments: Skool's SSR snapshot often omits comment
    // text even on a post's own page. When we're on a post detail view and
    // the data island gave nothing, read the rendered comment feed instead
    // (class-free, via SC.extract). No timestamps in the DOM, so these rows
    // power threads/participation, not latency math.
    if (!comments.length && SC.extract && SC.extract.currentDetailPost) {
      var detail = SC.extract.currentDetailPost();
      if (detail) {
        // Prefer the real Skool post id when the page data has this post;
        // otherwise the stable slug still groups the thread correctly.
        var pagePosts = data ? collectNextDataPosts(data) : [];
        var postKey = detail.slug;
        for (var pi = 0; pi < pagePosts.length; pi++) {
          if (pagePosts[pi].post_name === detail.slug) { postKey = pagePosts[pi].post_key; break; }
        }
        comments = SC.extract.extractComments(50).map(function (c) {
          return {
            comment_key: "dom-" + hashText((c.author || "") + "|" + (c.body || "")),
            post_key: postKey,
            parent_comment_key: null,
            comment_text: c.body || "",
            author: c.authorName || null,
            is_owner: false,
            likes: 0,
            commented_at: null,
          };
        }).filter(function (c) { return c.comment_text; });
        if (comments.length) debug("comment DOM fallback:", comments.length, "on", detail.slug);
      }
    }
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
    if (state.active) {
      scheduleScrape();
      scheduleReplyDrain();
    }
  }

  /* --------------------- queued-reply drainer ---------------------- */
  // Replies composed in the PWA wait in the backend. When we land on the
  // matching, admin-verified community tab, submit them from here — one at a
  // time with a randomized gap so a batch never reads as automation. Runs at
  // most once per pageview and only if a reply template has been learned.
  var replyDrainStarted = false;

  function jitter(minMs, maxMs) { return minMs + Math.floor(Math.random() * (maxMs - minMs)); }

  function submitViaPage(text, postKey, parentCommentKey) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(REPLY_TEMPLATE_KEY, function (o) {
        var tpl = o && o[REPLY_TEMPLATE_KEY];
        if (!tpl) { resolve({ ok: false, code: "no_template" }); return; }
        var id = "d" + Date.now() + Math.random().toString(36).slice(2, 6);
        var done = false;
        replyWaiters[id] = function (res) {
          if (done) return; done = true; resolve({ ok: !!res.ok, error: res.error });
        };
        window.postMessage({ __sc: "ctrl", kind: "submit", id: id, template: tpl,
          values: { text: text, postId: postKey, parentId: parentCommentKey || "" } }, "*");
        setTimeout(function () {
          if (done) return; delete replyWaiters[id]; done = true;
          resolve({ ok: false, error: "Timed out waiting for Skool." });
        }, 15000);
      });
    });
  }

  async function scheduleReplyDrain() {
    if (replyDrainStarted) return;
    replyDrainStarted = true;
    // Needs a learned template; otherwise the PWA-composed replies stay
    // pending and the user finishes them via clipboard + deep link instead.
    var cap = await new Promise(function (r) {
      chrome.storage.local.get(REPLY_TEMPLATE_KEY, function (o) { r(!!(o && o[REPLY_TEMPLATE_KEY])); });
    });
    if (!cap) return;
    var res = await sendMessage({ type: "LIST_PENDING_REPLIES", slug: state.slug });
    var replies = (res && res.replies) || [];
    for (var i = 0; i < replies.length; i++) {
      if (!state.active) break; // navigated away
      var q = replies[i];
      await sendMessage({ type: "MARK_REPLY", id: q.id, status: "submitting" });
      var out = await submitViaPage(q.reply_text, q.target_post_key, q.target_comment_key);
      await sendMessage({
        type: "MARK_REPLY", id: q.id,
        status: out.ok ? "submitted" : "failed",
        error: out.ok ? null : (out.error || "submit failed"),
      });
      debug("drained queued reply", q.id, out.ok ? "ok" : ("failed: " + out.error));
      if (i < replies.length - 1) {
        await new Promise(function (r) { setTimeout(r, jitter(45000, 90000)); });
      }
    }
  }

  /* ---------------------- reply learn / replay --------------------- */
  // The MAIN-world net-observer learns Skool's real comment-create request
  // from the owner's own manual reply and posts the redacted template here;
  // we persist it. It also performs replays on our behalf. See net-observer.js.
  var REPLY_TEMPLATE_KEY = "sc_reply_template";
  var replyWaiters = {}; // submit id -> resolver

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__sc !== "net") return;
    if (d.kind === "candidate" && d.confidence === "strong" && d.template) {
      // Only learn on communities we're actually active on (owned + verified).
      if (state.active) {
        try {
          var store = {};
          store[REPLY_TEMPLATE_KEY] = d.template;
          chrome.storage.local.set(store);
          debug("learned reply template from", d.template.url);
        } catch (e) { /* extension context gone */ }
      }
    } else if (d.kind === "submit-result" && replyWaiters[d.id]) {
      var resolve = replyWaiters[d.id];
      delete replyWaiters[d.id];
      resolve(d);
    }
  });

  // Submit a reply from the live tab by replaying the learned template via the
  // page world. Requires an active, allowlisted community and a learned
  // template; callers fall back to clipboard + deep-link when this returns a
  // no_template / not_active code.
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== "SUBMIT_ON_PAGE_REPLY") return;
    if (!state.active) {
      sendResponse({ ok: false, code: "not_active",
        error: "Copilot isn't active on this tab — open your community (admin-verified) first." });
      return;
    }
    if (!msg.postKey || !String(msg.text || "").trim()) {
      sendResponse({ ok: false, code: "bad_input", error: "Missing reply text or target post." });
      return;
    }
    chrome.storage.local.get(REPLY_TEMPLATE_KEY, function (o) {
      var tpl = o && o[REPLY_TEMPLATE_KEY];
      if (!tpl) {
        sendResponse({ ok: false, code: "no_template",
          error: "Haven't learned Skool's reply request yet — reply to one comment manually on Skool first, then this can replay it." });
        return;
      }
      var id = "r" + Date.now() + Math.random().toString(36).slice(2, 6);
      var done = false;
      replyWaiters[id] = function (res) {
        if (done) return; done = true;
        sendResponse({ ok: !!res.ok, status: res.status, error: res.error || null });
      };
      window.postMessage({
        __sc: "ctrl", kind: "submit", id: id, template: tpl,
        values: { text: msg.text, postId: msg.postKey, parentId: msg.parentCommentKey || "" },
      }, "*");
      setTimeout(function () {
        if (done) return;
        delete replyWaiters[id];
        done = true;
        sendResponse({ ok: false, error: "Timed out waiting for Skool to respond." });
      }, 15000);
    });
    return true; // async
  });

  /* ------------------ standalone reply-draft source ---------------- */
  // Backend-free: the side panel's "Draft replies" card asks what's on the
  // current Skool page (via the class-free SC.extract), so it works with no
  // Supabase account. Gated by the live admin signal OR the per-community
  // override (read straight from storage, since there may be no backend to
  // tell us the allowlist). Reads only — never posts.
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== "READ_PAGE_DRAFTS_SOURCE") return;
    if (!state.slug) {
      sendResponse({ ok: false, error: "This tab isn't on a Skool community page." });
      return;
    }
    if (!SC.extract) { sendResponse({ ok: false, error: "Reload your Skool tab and try again." }); return; }
    chrome.storage.local.get("sc_admin_override", function (o) {
      var overrides = (o && o["sc_admin_override"]) || {};
      var overridden = !!overrides[state.slug];
      if (!state.admin && !overridden) {
        sendResponse({ ok: false, code: "not_admin", slug: state.slug,
          error: "This doesn't look like a community you admin. If it's yours, tick " +
            "\"force-enable\" and reload." });
        return;
      }
      var detail = SC.extract.currentDetailPost();
      if (detail) {
        var limit = msg.limit > 0 ? msg.limit : 40;
        var comments = SC.extract.extractComments(limit);
        sendResponse({ ok: true, mode: "detail", slug: state.slug, group: detail.group,
          post: detail, comments: comments });
      } else {
        var posts = SC.extract.extractFeedPosts();
        sendResponse({ ok: true, mode: "feed", slug: state.slug, posts: posts });
      }
    });
    return true; // async (storage read)
  });


  // Normalize CSS-module-style class names (e.g. "PostCard_root__aB3dQ")
  // so a frequency count groups instances of the same component instead
  // of being fragmented by their per-build hash suffix.
  function normalizeClassName(cls) {
    return cls
      .replace(/__[a-zA-Z0-9_-]{4,10}$/, "__HASH")
      .replace(/-[a-zA-Z0-9]{5,10}$/, "-HASH");
  }

  // Recursively describe an object as "path: type(len) = short preview"
  // lines — reveals real field names and enough of each value to identify
  // it, without dumping full content. Arrays are sampled at index 0 only
  // (with their length noted) so one post's/comment's shape stands in for
  // all of them.
  var SUMMARY_MAX_DEPTH = 6;
  var SUMMARY_MAX_BREADTH = 30;
  var SUMMARY_BUDGET = 300;
  function summarizeValue(v, depth, path, lines) {
    if (lines.length >= SUMMARY_BUDGET) return;
    if (v === null) { lines.push(path + ": null"); return; }
    if (v === undefined) { lines.push(path + ": undefined"); return; }
    var t = typeof v;
    if (t === "string") {
      var preview = v.length > 50 ? v.slice(0, 50) + "…" : v;
      lines.push(path + ": string(" + v.length + ") = " + JSON.stringify(preview));
      return;
    }
    if (t === "number" || t === "boolean") { lines.push(path + ": " + t + " = " + v); return; }
    if (Array.isArray(v)) {
      lines.push(path + ": array(len=" + v.length + ")");
      if (v.length > 0 && depth < SUMMARY_MAX_DEPTH) {
        summarizeValue(v[0], depth + 1, path + "[0]", lines);
      }
      return;
    }
    if (t === "object") {
      var keys = Object.keys(v);
      lines.push(path + ": object(keys=" + keys.length + ")");
      if (depth >= SUMMARY_MAX_DEPTH) return;
      keys.slice(0, SUMMARY_MAX_BREADTH).forEach(function (k) {
        summarizeValue(v[k], depth + 1, path + "." + k, lines);
      });
      if (keys.length > SUMMARY_MAX_BREADTH) {
        lines.push(path + ": …(+" + (keys.length - SUMMARY_MAX_BREADTH) + " more keys)");
      }
      return;
    }
    lines.push(path + ": " + t);
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

    // 1b. Targeted dump of whichever pageProps key looks like the feed —
    // reveals the REAL field names for post/comment content, counts, and
    // timestamps, which is what actually drives extraction. Field-name
    // guesses go stale as Skool ships changes; this replaces guessing.
    report.feedSample = null;
    try {
      var pp = ndEl && parsed && parsed.props && parsed.props.pageProps;
      var candidateKeys = ["postTrees", "posts", "feed", "items", "results"];
      var feedKey = pp && candidateKeys.filter(function (k) {
        return Array.isArray(pp[k]) && pp[k].length > 0;
      })[0];
      if (feedKey) {
        var lines = [];
        summarizeValue(pp[feedKey][0], 0, "pageProps." + feedKey + "[0]", lines);
        report.feedSample = { key: feedKey, length: pp[feedKey].length, lines: lines };
      } else if (pp) {
        report.feedSample = "No array field named " + candidateKeys.join("/") +
          " found on pageProps with items in it.";
      }
    } catch (e) {
      report.feedSample = "error: " + String((e && e.message) || e);
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


    // 6. Comment-block sample — the section that calibrates comment
    // extraction. Finds the first two comment blocks (same walk-up the real
    // extractor uses) and dumps their innerText LINES plus child tag
    // structure. Includes real comment text, so the side panel warns to
    // skim before sharing.
    report.commentSample = [];
    try {
      var replyLeaves = Array.prototype.filter.call(
        document.querySelectorAll("*"),
        function (e) { return e.children.length === 0 && e.textContent.trim() === "Reply"; }
      ).slice(0, 2);
      replyLeaves.forEach(function (leaf) {
        var el = leaf, block = null;
        for (var w = 0; w < 6 && el; w++) {
          el = el.parentElement;
          if (el && el.querySelector('a[href^="/@"]')) { block = el; break; }
        }
        if (!block) return;
        var tagTree = [];
        (function walkTags(node, depth) {
          if (depth > 4 || tagTree.length > 60) return;
          tagTree.push("  ".repeat(depth) + node.tagName.toLowerCase() +
            (node.children.length === 0 && node.textContent.trim()
              ? ' "' + node.textContent.trim().slice(0, 40) + '"' : ""));
          Array.prototype.forEach.call(node.children, function (ch) { walkTags(ch, depth + 1); });
        })(block, 0);
        report.commentSample.push({
          innerTextLines: block.innerText.split("\n")
            .map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 25),
          tagTree: tagTree,
        });
      });
      if (!report.commentSample.length) {
        report.commentSample = "No comment blocks found (no bare Reply controls on this page).";
      }
    } catch (e) {
      report.commentSample = "error: " + String((e && e.message) || e);
    }

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
