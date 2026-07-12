/* =====================================================================
   Skool Community Copilot — side-panel boot smoke test
   ---------------------------------------------------------------------
   The side panel isn't exercised by test/e2e.js (that drives the PWA),
   so runtime wiring bugs there (an undefined helper, a bad selector)
   used to ship silently. This loads the REAL sidepanel.html in headless
   Chromium with chrome.* + Supabase fetch shimmed, drives boot() through
   the full solo-mode path (health score + pillar tracker + inbox all
   render), and fails on ANY page error.

     SP=/path/with/node_modules PW_CHROMIUM=/path/to/chromium \
       node test/sidepanel.smoke.js
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require(
  (process.env.SP ? process.env.SP + "/node_modules/" : "") + "playwright");

const EXT = path.join(__dirname, "..", "extension");
const DAY = 86400000, now = Date.now();

const community = { id: "c1", name: "Test Community",
  skool_url: "https://www.skool.com/test", slug: "test" };
const pillars = [
  { id: "p0", community_id: "c1", slug: "teaching", name: "Teaching", description: "", target_ratio: 40, position: 0 },
  { id: "p1", community_id: "c1", slug: "win", name: "Wins", description: "", target_ratio: 30, position: 1 },
  { id: "p2", community_id: "c1", slug: "story", name: "Story", description: "", target_ratio: 30, position: 2 },
];
const posts = [];
for (let i = 0; i < 10; i++) posts.push({
  id: "sp" + i, community_id: "c1", post_key: "pk" + i,
  post_text: "Post <b>" + i + "</b> title\n\nbody about things",
  pillar_guess: ["teaching", "win", "story"][i % 3],
  likes: 2 + i, comments: i % 3, posted_at: new Date(now - i * 2 * DAY).toISOString(),
  author: "Member & Co", is_question: i % 3 === 1, first_comment_at: null,
});
const comments = [];
for (let i = 0; i < 12; i++) comments.push({
  id: "sc" + i, community_id: "c1", comment_key: "ck" + i, post_key: "pk" + (i % 10),
  parent_comment_key: null, comment_text: "member comment " + i, author: "Cara <x>",
  is_owner: false, likes: 0, commented_at: new Date(now - (i % 6) * DAY).toISOString(),
});
function restBody(pathname) {
  const t = pathname.replace("/rest/v1/", "").split("?")[0];
  if (t === "communities") return [community];
  if (t === "pillars") return pillars;
  if (t === "scraped_posts") return posts;
  if (t === "scraped_comments") return comments;
  if (t === "voice_profiles") return [{ id: "v1", community_id: "c1", tone_notes: "", banned_words: [], formatting_rules: "" }];
  return [];
}

// The chrome.* shim, as a source string injected before any extension script.
const CHROME_SHIM = `
  (function () {
    var store = {
      sc_supabase_config: { supabaseUrl: "https://sb.test.local", supabaseAnonKey: "anon" },
      sc_solo_mode: true,
      sc_ai_settings: { provider: "anthropic", model: "claude-opus-4-8" },
    };
    window.chrome = {
      runtime: { lastError: null,
        sendMessage: function (m, cb) { if (typeof cb === "function") cb(undefined); },
        openOptionsPage: function () {}, id: "test", getURL: function (p) { return p; } },
      storage: { local: {
        get: function (keys, cb) {
          var out = {};
          if (keys == null) out = Object.assign({}, store);
          else if (typeof keys === "string") out[keys] = store[keys];
          else if (Array.isArray(keys)) keys.forEach(function (k) { out[k] = store[k]; });
          else Object.keys(keys).forEach(function (k) { out[k] = (k in store) ? store[k] : keys[k]; });
          var r = Promise.resolve(out); if (cb) cb(out); return r;
        },
        set: function (obj, cb) { Object.assign(store, obj); var r = Promise.resolve(); if (cb) cb(); return r; },
        remove: function (k, cb) { (Array.isArray(k) ? k : [k]).forEach(function (x) { delete store[x]; }); var r = Promise.resolve(); if (cb) cb(); return r; },
      } },
      tabs: { query: function (q, cb) { cb([{ id: 1, url: "https://www.skool.com/test" }]); } },
    };
  })();
`;

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "sb.test.local") {
      if (u.pathname.startsWith("/auth/v1/"))
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(restBody(u.pathname)) });
    }
    return route.continue();
  });

  // Body only — strip the panel's own <script src> tags; we inject them in order
  // ourselves, AFTER the chrome shim (config.js reads chrome at load time).
  let html = fs.readFileSync(path.join(EXT, "sidepanel", "sidepanel.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  html = html.replace(/<script src="[^"]+"><\/script>\s*/g, "");
  await page.setContent(html, { waitUntil: "domcontentloaded" });

  await page.addScriptTag({ content: CHROME_SHIM });
  for (const rel of scripts) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, "sidepanel", rel), "utf8") });
  }

  try {
    await page.waitForSelector("#sp-health:not(.hidden)", { timeout: 8000 });
    await page.waitForSelector("#sp-pillars .pillar-line", { timeout: 8000 });
  } catch (e) {
    const note = await page.$eval("#sp-backend-note", (el) => el.textContent).catch(() => "(none)");
    errors.push("boot did not reach health card. backend-note: " + note);
  }
  const tracker = await page.$$eval("#sp-pillars .pillar-line", (n) => n.length).catch(() => 0);
  const score = await page.$eval("#sp-score", (el) => el.textContent.trim()).catch(() => "");

  await browser.close();

  if (errors.length) {
    console.error("SIDE PANEL SMOKE FAILED:\n" + errors.join("\n"));
    process.exit(1);
  }
  if (tracker < 1) { console.error("FAIL: pillar tracker rendered no lines"); process.exit(1); }
  console.log("side panel booted clean: score='" + score + "', " + tracker + " pillar lines, no page errors");
  console.log("SIDE PANEL SMOKE PASSED");
})().catch((e) => { console.error("SIDE PANEL SMOKE ERROR:", e.message); process.exit(1); });
