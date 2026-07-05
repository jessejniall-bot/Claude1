/* =====================================================================
   Skool Community Copilot — PWA end-to-end test (mocked backend)
   ---------------------------------------------------------------------
   Drives the real PWA through configure → sign in → add community →
   dashboard → AI deep review → generate draft, with Supabase and the
   AI provider fully mocked at the network layer. No real accounts or
   keys are touched.

   Requires Playwright + a Chromium it can launch:
     npm i playwright        (once, anywhere on NODE_PATH)
     node test/e2e.js
   Set PW_CHROMIUM to a chromium binary path to skip Playwright's own
   browser download (e.g. PW_CHROMIUM=/opt/pw-browsers/chromium).

   The script serves the repo itself on a local port — no other server
   needed. Screenshots land next to this file.
   ===================================================================== */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PORT = 8123;
const SB = "https://test.supabase.co";

/* ------------------------ tiny static server --------------------- */
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

/* --------------------------- mock data --------------------------- */
const DAY = 86400000;
const now = Date.now();

const community = {
  id: "c1", name: "Maker Mastermind",
  skool_url: "https://www.skool.com/maker-mastermind", slug: "maker-mastermind",
};

const pillars = [
  ["teaching", "Teaching / How-To", 25],
  ["story", "Personal Story", 15],
  ["question", "Engagement Question", 20],
  ["resource", "Tool or Resource Highlight", 15],
  ["win", "Win / Social Proof", 15],
  ["bts", "Behind-the-Scenes", 10],
].map((p, i) => ({
  id: "p" + i, community_id: "c1", slug: p[0], name: p[1],
  description: "", target_ratio: p[2], position: i,
}));

const posts = [];
for (let i = 0; i < 18; i++) {
  const slug = ["teaching", "question", "bts"][i % 3];
  posts.push({
    id: "sp" + i, community_id: "c1", post_key: "pk" + i,
    post_text: "Post " + i + " title\n\nSome body text about " + slug,
    pillar_guess: slug,
    likes: 3 + (i % 5), comments: 1 + (i % 4),
    posted_at: new Date(now - i * 2 * DAY).toISOString(),
    author: i % 4 === 0 ? "Alice" : "Owner",
    is_question: i % 3 === 1,
    first_comment_at: i % 3 === 1
      ? new Date(now - i * 2 * DAY + 4 * 3600000).toISOString() : null,
  });
}

const comments = [];
for (let i = 0; i < 40; i++) {
  comments.push({
    id: "sc" + i, community_id: "c1", comment_key: "ck" + i, post_key: "pk" + (i % 18),
    comment_text: "This is member comment " + i + " — really useful, thanks!",
    author: ["Alice", "Bob", "Cara", "Dan", "Eve"][i % 5],
    likes: i % 3,
    commented_at: new Date(now - (i % 28) * DAY).toISOString(),
  });
}

/* -------------------------- mock router -------------------------- */
let communityAdded = false;
let aiCalls = 0;

function json(body) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

function handleSupabase(method, url) {
  const p = url.pathname;
  if (p.startsWith("/auth/v1/token")) {
    return json({
      access_token: "fake-token", refresh_token: "fake-refresh", expires_in: 3600,
      user: { id: "u1", email: "owner@example.com" },
    });
  }
  if (p.startsWith("/auth/v1/logout")) return json({});
  if (p.startsWith("/rest/v1/")) {
    const table = p.replace("/rest/v1/", "");
    if (table === "communities") {
      if (method === "POST") { communityAdded = true; return json([community]); }
      return json(communityAdded ? [community] : []);
    }
    if (method !== "GET") return json([{ id: "new1" }]);
    if (table === "pillars") return json(pillars);
    if (table === "voice_profiles") return json([{
      id: "v1", community_id: "c1",
      tone_notes: "Direct and warm, zero corporate speak",
      banned_words: ["synergy"], formatting_rules: "Short lines.",
    }]);
    if (table === "scraped_posts") return json(posts);
    if (table === "scraped_comments") return json(comments);
    return json([]); // ideas, drafts, queue
  }
  return json({});
}

const AI_REVIEW =
  "VERDICT: This community is healthy overall — steady cadence and fast replies — " +
  "but the same five members carry most conversations.\n\n" +
  "WHERE TO IMPROVE:\n1. Personal Story sits at 0% vs a 15% target — post one this week.";

const AI_DRAFT =
  "Your First Loss Is Course Material\n\n" +
  "I shipped a product nobody bought in 2021. 😅\n\n" +
  "That flop taught me more than any course: talk to buyers BEFORE you build.\n\n" +
  "What's one failure that secretly leveled you up? Drop it below 👇";

/* ------------------------------ test ----------------------------- */
(async () => {
  const server = http.createServer(serveStatic);
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 480, height: 900 },
    serviceWorkers: "block",
  });

  await ctx.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === "test.supabase.co") {
      return route.fulfill(handleSupabase(req.method(), url));
    }
    if (url.hostname === "api.anthropic.com") {
      aiCalls++;
      return route.fulfill(json({
        content: [{ type: "text", text: aiCalls === 1 ? AI_REVIEW : AI_DRAFT }],
        stop_reason: "end_turn",
      }));
    }
    return route.continue();
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto("http://127.0.0.1:" + PORT + "/pwa/");

  // configure backend
  await page.waitForSelector("#view-configure:not(.hidden)");
  await page.fill("#cfg-url", SB);
  await page.fill("#cfg-key", "fake-anon-key");
  await page.click("#cfg-save");

  // sign in
  await page.waitForSelector("#view-auth:not(.hidden)");
  await page.fill("#auth-email", "owner@example.com");
  await page.fill("#auth-password", "hunter22");
  await page.click("#auth-signin");

  // first community setup
  await page.waitForSelector("#view-setup:not(.hidden)");
  await page.fill("#setup-name", community.name);
  await page.fill("#setup-url", community.skool_url);
  await page.check("#setup-own");
  await page.click("#setup-save");

  // dashboard
  await page.waitForSelector("#view-dashboard:not(.hidden)");
  await page.waitForFunction(() => {
    const el = document.getElementById("score-total");
    return el && el.textContent !== "—" && el.textContent.trim() !== "";
  });
  const score = (await page.textContent("#score-total")).trim();
  const charts = await page.locator(".chart-slot svg").count();
  const tiles = await page.locator("#dash-stats .stat").count();
  console.log("dashboard: score=" + score + ", charts=" + charts + ", tiles=" + tiles);
  if (charts !== 2) throw new Error("expected 2 chart SVGs, got " + charts);
  if (tiles < 4) throw new Error("expected stat tiles, got " + tiles);
  await page.screenshot({ path: path.join(__dirname, "e2e-dashboard.png"), fullPage: true });

  // store AI settings through the app's own vault, then deep review
  await page.evaluate(async () => {
    await SC.vault.saveApiKey("anthropic", "sk-ant-test");
    await SC.storage.set("sc_ai_settings", { provider: "anthropic", model: "claude-opus-4-8" });
  });
  await page.click("#analyze-go");
  await page.waitForFunction(() => {
    const el = document.getElementById("analyze-output");
    return el && !el.classList.contains("hidden") && el.textContent.includes("VERDICT");
  });
  console.log("deep review rendered");

  // generate a draft
  await page.fill("#gen-seed", "a member asked how to recover from a flop launch");
  await page.click("#gen-go");
  await page.waitForSelector("#gen-result:not(.hidden)");
  const title = await page.inputValue("#gen-title");
  const styled = await page.evaluate((t) => SC.uni.isStyled(t), title);
  console.log("draft title: " + title + " (unicode bold: " + styled + ")");
  if (!styled) throw new Error("title was not unicode-bolded");
  if (aiCalls !== 2) throw new Error("expected 2 AI calls, got " + aiCalls);
  await page.screenshot({ path: path.join(__dirname, "e2e-generated.png") });

  // save the draft (mocked insert)
  await page.click("#gen-save");
  await page.waitForTimeout(300);

  await ctx.close();

  /* ---------- scenario 2: demo mode, zero backend, zero mocks ------ */
  const ctx2 = await browser.newContext({
    viewport: { width: 480, height: 900 },
    serviceWorkers: "block",
  });
  const page2 = await ctx2.newPage();
  const errors2 = [];
  page2.on("pageerror", (e) => errors2.push("pageerror: " + e.message));
  page2.on("console", (m) => { if (m.type() === "error") errors2.push("console: " + m.text()); });

  await page2.goto("http://127.0.0.1:" + PORT + "/pwa/");
  await page2.waitForSelector("#view-configure:not(.hidden)");
  await page2.click("#demo-go");
  await page2.waitForSelector("#view-dashboard:not(.hidden)");
  await page2.waitForFunction(() => {
    const el = document.getElementById("score-total");
    return el && el.textContent !== "—" && el.textContent.trim() !== "";
  });
  const demoScore = (await page2.textContent("#score-total")).trim();
  console.log("demo mode: dashboard score=" + demoScore);

  // canned review with no key configured
  await page2.click("#analyze-go");
  await page2.waitForFunction(() => {
    const el = document.getElementById("analyze-output");
    return el && !el.classList.contains("hidden") && el.textContent.includes("VERDICT");
  });

  // canned draft with no key configured, still unicode-bolded
  await page2.click("#gen-go");
  await page2.waitForSelector("#gen-result:not(.hidden)");
  const demoTitle = await page2.inputValue("#gen-title");
  const demoStyled = await page2.evaluate((t) => SC.uni.isStyled(t), demoTitle);
  if (!demoStyled) throw new Error("demo draft title not unicode-bolded");
  console.log("demo mode: canned review + draft OK");

  // draft persists into the local demo db
  await page2.click("#gen-save");
  await page2.waitForTimeout(200);
  await page2.click('#tabs a[href="#/drafts"]');
  await page2.waitForSelector(".draft-card");
  console.log("demo mode: saved draft visible in Drafts");
  await page2.screenshot({ path: path.join(__dirname, "e2e-demo.png"), fullPage: false });

  await ctx2.close();

  /* ---------- scenario 3: solo mode (no accounts, mocked backend) --- */
  const ctx3 = await browser.newContext({
    viewport: { width: 480, height: 900 },
    serviceWorkers: "block",
  });
  await ctx3.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === "test.supabase.co") {
      return route.fulfill(handleSupabase(req.method(), url));
    }
    return route.continue();
  });
  const page3 = await ctx3.newPage();
  const errors3 = [];
  page3.on("pageerror", (e) => errors3.push("pageerror: " + e.message));
  page3.on("console", (m) => { if (m.type() === "error") errors3.push("console: " + m.text()); });

  await page3.goto("http://127.0.0.1:" + PORT + "/pwa/");
  await page3.waitForSelector("#view-configure:not(.hidden)");
  await page3.fill("#cfg-url", SB);
  await page3.fill("#cfg-key", "fake-anon-key");
  await page3.click("#cfg-save");
  await page3.waitForSelector("#view-auth:not(.hidden)");
  // Skip sign-in entirely: enable solo mode (probe insert hits the mock).
  await page3.click("#solo-enable");
  await page3.waitForSelector("#view-dashboard:not(.hidden)", { timeout: 15000 });
  const brand = await page3.textContent(".brand");
  if (brand.indexOf("solo") === -1) throw new Error("solo brand marker missing: " + brand);
  console.log("solo mode: dashboard reached with no sign-in (" + brand.trim() + ")");
  await ctx3.close();

  await browser.close();
  server.close();

  const allErrors = errors.concat(errors2).concat(errors3);
  if (allErrors.length) {
    console.error("PAGE ERRORS:");
    allErrors.forEach((e) => console.error("  " + e));
    process.exit(1);
  }
  console.log("E2E PASSED — no page errors");
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});
