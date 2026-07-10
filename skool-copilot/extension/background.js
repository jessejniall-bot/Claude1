/* =====================================================================
   Skool Community Copilot — MV3 service worker
   ---------------------------------------------------------------------
   The content script never talks to Supabase directly; everything is
   funneled through here so auth/session handling lives in one place.
   Responsibilities:
     - answer GET_COMMUNITY_STATE (is this slug allowlisted for the
       signed-in user, and what's its community id?)
     - receive SCRAPED_POSTS batches, classify pillars, upsert
     - receive SAVE_IDEA from the floating capture button
     - keep the community allowlist cached, refreshed hourly
   ===================================================================== */
importScripts(
  "shared/config.js",
  "shared/supabase-lite.js",
  "shared/pillar-classifier.js",
  "shared/default-pillars.js"
);

var COMMUNITIES_CACHE_KEY = "sc_communities_cache";

// Clicking the toolbar icon opens the side panel. Set the behavior on
// every service-worker start (not just install) so it survives updates
// and browser restarts; keep an onClicked fallback for Chrome versions
// where the behavior flag doesn't stick.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
}
chrome.action.onClicked.addListener(function (tab) {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(function () {});
  }
});

chrome.runtime.onInstalled.addListener(function () {
  chrome.alarms.create("refresh-communities", { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === "refresh-communities") {
    refreshCommunities().catch(function () {});
  }
});

async function refreshCommunities() {
  var client = await SC.getClient();
  if (!client) return null;
  var user = await client.getUser();
  if (!user && !(await SC.isSolo())) return null; // solo mode needs no session
  var rows = await client
    .from("communities")
    .select("id,skool_url,slug,name")
    .order("created_at");
  await SC.storage.set(COMMUNITIES_CACHE_KEY, rows || []);
  return rows || [];
}

async function getCommunities() {
  var cached = await SC.storage.get(COMMUNITIES_CACHE_KEY);
  if (cached && cached.length) return cached;
  return (await refreshCommunities()) || [];
}

function findCommunity(communities, slug) {
  slug = SC.skoolSlug(slug);
  for (var i = 0; i < communities.length; i++) {
    var c = communities[i];
    var cSlug = c.slug || SC.skoolSlug(c.skool_url);
    if (cSlug === slug) return c;
  }
  return null;
}

/* ------------------------- message handlers ------------------------ */

async function handleGetCommunityState(msg) {
  var client = await SC.getClient();
  if (!client) return { configured: false, signedIn: false, allowed: false };
  var user = await client.getUser();
  var solo = await SC.isSolo();
  if (!user && !solo) return { configured: true, signedIn: false, allowed: false };
  var communities = await getCommunities();
  var community = findCommunity(communities, msg.slug);
  // Manual admin override, set per community from the side panel for
  // when Skool's markup changes and automatic detection fails.
  var overrides = (await SC.storage.get("sc_admin_override")) || {};
  return {
    configured: true,
    signedIn: true,
    allowed: !!community,
    override: !!overrides[SC.skoolSlug(msg.slug)],
    communityId: community ? community.id : null,
    communityName: community ? community.name : null,
  };
}

async function handleScrapedPosts(msg) {
  var client = await SC.getClient();
  if (!client) return { ok: false, error: "Backend not configured" };
  var communities = await getCommunities();
  var community = findCommunity(communities, msg.slug);
  if (!community) return { ok: false, error: "Community not allowlisted" };

  var rows = (msg.posts || [])
    .filter(function (p) { return p && p.post_key; })
    .map(function (p) {
      var guess = SC.classifyPillar(p.post_text || "");
      return {
        community_id: community.id,
        post_key: String(p.post_key),
        post_name: p.post_name || null,
        post_text: (p.post_text || "").slice(0, 8000),
        pillar_guess: guess.pillar,
        likes: Number(p.likes) || 0,
        comments: Number(p.comments) || 0,
        posted_at: p.posted_at || null,
        author: p.author || null,
        is_question: SC.looksLikeQuestion(p.post_text),
        first_comment_at: p.first_comment_at || null,
      };
    });
  if (!rows.length) return { ok: true, saved: 0 };

  // The same post can arrive under two keys: Skool's hex id (page-data
  // reader) or the URL slug (DOM reader, where post_key === post_name).
  // Without reconciliation the post is stored twice and inflates every
  // health stat. Rule: the hex-keyed row wins.
  try {
    var names = [];
    rows.forEach(function (r) { if (r.post_name && names.indexOf(r.post_name) === -1) names.push(r.post_name); });
    if (names.length) {
      var existing = (await client
        .from("scraped_posts")
        .select("post_key,post_name")
        .eq("community_id", community.id)
        .in("post_name", names)) || [];
      var hexNames = {};   // names already stored under a hex key
      var slugKeys = {};   // slug-keyed rows already stored
      existing.forEach(function (r) {
        if (r.post_key === r.post_name) slugKeys[r.post_key] = true;
        else if (r.post_name) hexNames[r.post_name] = true;
      });
      // 1. Incoming slug-keyed rows lose to an existing hex row.
      rows = rows.filter(function (r) {
        return !(r.post_key === r.post_name && hexNames[r.post_name]);
      });
      // 2. Incoming hex rows retire any stale slug-keyed duplicates.
      var stale = [];
      rows.forEach(function (r) {
        if (r.post_name && r.post_key !== r.post_name && slugKeys[r.post_name]) {
          stale.push(r.post_name);
        }
      });
      if (stale.length) {
        await client.from("scraped_posts").delete()
          .eq("community_id", community.id).in("post_key", stale);
      }
    }
  } catch (e) { /* best-effort cleanup — never block the sync itself */ }
  if (!rows.length) return { ok: true, saved: 0 };

  await client
    .from("scraped_posts")
    .upsert(rows, { onConflict: "community_id,post_key" });
  return { ok: true, saved: rows.length };
}

async function handleScrapedComments(msg) {
  var client = await SC.getClient();
  if (!client) return { ok: false, error: "Backend not configured" };
  var communities = await getCommunities();
  var community = findCommunity(communities, msg.slug);
  if (!community) return { ok: false, error: "Community not allowlisted" };

  var rows = (msg.comments || [])
    .filter(function (c) { return c && c.comment_key; })
    .map(function (c) {
      return {
        community_id: community.id,
        comment_key: String(c.comment_key),
        post_key: c.post_key || null,
        parent_comment_key: c.parent_comment_key || null,
        comment_text: (c.comment_text || "").slice(0, 4000),
        author: c.author || null,
        is_owner: !!c.is_owner,
        likes: Number(c.likes) || 0,
        commented_at: c.commented_at || null,
      };
    });
  if (!rows.length) return { ok: true, saved: 0 };

  await client
    .from("scraped_comments")
    .upsert(rows, { onConflict: "community_id,comment_key" });
  return { ok: true, saved: rows.length };
}

/* ------------------------- reply queue ----------------------------- */
// The PWA composes replies but has no live Skool session, so it enqueues
// them here; the extension drains the queue when it sees the matching tab.

async function pendingRepliesForSlug(slug) {
  var client = await SC.getClient();
  if (!client) return { ok: false, error: "Backend not configured" };
  var communities = await getCommunities();
  var community = findCommunity(communities, slug);
  if (!community) return { ok: true, replies: [] };
  var rows = await client
    .from("reply_queue")
    .select("id,target_post_key,target_comment_key,reply_text,context_text,status,created_at")
    .eq("community_id", community.id)
    .eq("status", "pending")
    .order("created_at")
    .limit(50);
  return { ok: true, communityId: community.id, replies: rows || [] };
}

async function handleListPendingReplies(msg) {
  return pendingRepliesForSlug(msg.slug);
}

async function handleMarkReply(msg) {
  var client = await SC.getClient();
  if (!client) return { ok: false, error: "Backend not configured" };
  var patch = { status: msg.status };
  if (msg.status === "submitted") patch.submitted_at = new Date().toISOString();
  if (msg.error !== undefined) patch.error = msg.error ? String(msg.error).slice(0, 500) : null;
  await client.from("reply_queue").update(patch).eq("id", msg.id);
  return { ok: true };
}

async function handleSaveIdea(msg) {
  var client = await SC.getClient();
  if (!client) return { ok: false, error: "Backend not configured" };
  var communities = await getCommunities();
  var community = findCommunity(communities, msg.slug);
  if (!community) return { ok: false, error: "Community not allowlisted" };
  await client.from("ideas").insert({
    community_id: community.id,
    source: "capture",
    content: (msg.content || "").slice(0, 4000),
  });
  return { ok: true };
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  var handler = null;
  if (msg && msg.type === "GET_COMMUNITY_STATE") handler = handleGetCommunityState;
  else if (msg && msg.type === "SCRAPED_POSTS") handler = handleScrapedPosts;
  else if (msg && msg.type === "SCRAPED_COMMENTS") handler = handleScrapedComments;
  else if (msg && msg.type === "SAVE_IDEA") handler = handleSaveIdea;
  else if (msg && msg.type === "LIST_PENDING_REPLIES") handler = handleListPendingReplies;
  else if (msg && msg.type === "MARK_REPLY") handler = handleMarkReply;
  else if (msg && msg.type === "REFRESH_COMMUNITIES") {
    refreshCommunities()
      .then(function (rows) { sendResponse({ ok: true, communities: rows || [] }); })
      .catch(function (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); });
    return true;
  }
  if (!handler) return false;

  handler(msg)
    .then(sendResponse)
    .catch(function (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    });
  return true; // async response
});
