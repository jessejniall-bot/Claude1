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
  if (!user) return null;
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
  if (!user) return { configured: true, signedIn: false, allowed: false };
  var communities = await getCommunities();
  var community = findCommunity(communities, msg.slug);
  return {
    configured: true,
    signedIn: true,
    allowed: !!community,
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
        comment_text: (c.comment_text || "").slice(0, 4000),
        author: c.author || null,
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
