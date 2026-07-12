/* =====================================================================
   Skool Community Copilot — shared-module smoke tests
   ---------------------------------------------------------------------
   Zero-dependency: `node test/smoke.test.js`
   Exercises the pure logic every surface relies on: classifier, health
   engine (cadence, trend, balance, latency, comment stats, score,
   improvements, digest), prompt builders, and Unicode styling.
   ===================================================================== */
"use strict";

require("../extension/shared/config.js");
require("../extension/shared/default-pillars.js");
require("../extension/shared/pillar-classifier.js");
require("../extension/shared/pillar-templates.js");
require("../extension/shared/health-engine.js");
require("../extension/shared/ai-providers.js");
require("../extension/shared/unicode-style.js");

const SC = globalThis.SC;
const DAY = 86400000;
const now = Date.now();

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("  ok  " + name);
  } else {
    failures++;
    console.error("FAIL  " + name + (detail !== undefined ? " — got: " + JSON.stringify(detail) : ""));
  }
}

/* ------------------------- classifier ---------------------------- */
console.log("pillar classifier");
check("teaching", SC.classifyPillar("Here is how to set up your funnel step by step").pillar === "teaching");
check("question", SC.classifyPillar("What do you all think? Drop a comment below!").pillar === "question");
check("win", SC.classifyPillar("Huge win: just hit $10k revenue this month!").pillar === "win");
check("unmatched stays null", SC.classifyPillar("zzz qqq").pillar === null);

/* ------------------------ synthetic feed ------------------------- */
const posts = [];
for (let i = 0; i < 20; i++) {
  posts.push({
    post_text: "Post " + i,
    likes: 5 + (i % 4), comments: 2 + (i % 3),
    posted_at: new Date(now - i * 3 * DAY).toISOString(),
    author: i % 5 === 0 ? "Alice" : "Bob " + (i % 4),
    pillar_guess: ["teaching", "question", "bts"][i % 3],
    is_question: i % 3 === 1,
    first_comment_at: i % 3 === 1
      ? new Date(now - i * 3 * DAY + 5 * 3600000).toISOString()
      : null,
  });
}
const comments = [];
for (let i = 0; i < 30; i++) {
  comments.push({
    comment_text: "Comment number " + i + " with some length to it",
    author: i % 10 === 9 ? "Rare " + i : ["Alice", "Bob", "Cara"][i % 3],
    likes: 1,
    commented_at: new Date(now - (i % 25) * DAY).toISOString(),
  });
}
const pillars = SC.DEFAULT_PILLARS;
const opts = { now: now };

/* ------------------------- health engine ------------------------- */
console.log("health engine");
const cad = SC.health.cadence(posts, opts);
check("cadence avg gap", cad.avgGapDays === 3, cad);
check("cadence last-30 count", cad.postsLast30 === 11, cad);

const trend = SC.health.engagementTrend(posts, opts);
check("trend has 8 weekly buckets", trend.points.length === 8);

const bal = SC.health.pillarBalance(posts, pillars, opts);
const overdue = SC.health.mostOverduePillar(bal);
check("overdue pillar is an unfed one", overdue && overdue.deficit >= 15, overdue);

const lat = SC.health.responseLatency(posts, opts);
check("latency avg 5h", lat.avgFirstReplyHours === 5, lat);

const cstats = SC.health.commentStats(comments, posts, opts);
check("comment count", cstats.totalComments === 30, cstats);
check("concentration detected", cstats.top3SharePct >= 70, cstats.top3SharePct);
check("comments per post computed", typeof cstats.commentsPerPost === "number", cstats);

const score = SC.health.score(posts, comments, pillars, opts);
check("score in range", score.total >= 0 && score.total <= 100, score.total);
check("five components", score.components.length === 5);
check("weights sum to 1",
  Math.abs(score.components.reduce((s, c) => s + c.weight, 0) - 1) < 1e-9);
check("label assigned", typeof score.label === "string" && score.label.length > 0);

const empty = SC.health.score([], [], pillars, opts);
check("empty community not zero (neutral floors)", empty.total > 20, empty.total);

const imps = SC.health.improvements(posts, comments, pillars, opts);
check("improvements produced", imps.length > 0);
check("participation concentration flagged",
  imps.some((i) => i.area === "Participation"), imps.map((i) => i.area));

const digest = SC.health.digest(posts, comments, pillars, opts);
check("digest starts with score", digest[0].startsWith("Health score:"), digest[0]);

/* ------------------------ prompt builders ------------------------ */
console.log("prompt builders");
const p = SC.buildDraftPrompt({
  communityName: "T", pillarName: "Win / Social Proof",
  healthDigest: digest, voice: { banned_words: ["synergy"] },
  seed: "member asked about burnout",
  style: { maxChars: 500, emoji: "none" },
});
check("draft prompt: length rule", p.includes("under 500 characters"));
check("draft prompt: emoji off", p.includes("Do not use any emojis"));
check("draft prompt: digest injected", p.includes("Health score:"));
check("draft prompt: banned words", p.includes("synergy"));
check("draft prompt: seed", p.includes("burnout"));
const p2 = SC.buildDraftPrompt({ pillarName: "X", style: { emoji: "auto" } });
check("draft prompt: emoji auto", p2.includes("emojis where they genuinely add"));

const ap = SC.buildAnalysisPrompt({
  communityName: "T", digestLines: digest, pillars: pillars,
  samplePosts: ["Post 1"], sampleComments: ["Alice: great post"],
});
check("analysis prompt: structure", ap.includes("VERDICT"));
check("analysis prompt: comments included", ap.includes("Alice: great post"));


/* ------------------------ unicode styling ------------------------ */
console.log("unicode styling");
const b = SC.uni.style("Big Win 2024!", "bold");
check("bold transforms", b !== "Big Win 2024!" && SC.uni.isStyled(b), b);
check("plain text not flagged styled", !SC.uni.isStyled("plain text"));
check("double-styling is a no-op", SC.uni.style(b, "bold") === b);
check("italic transforms", SC.uni.isStyled(SC.uni.style("hello", "italic")));
check("punctuation and emoji pass through",
  SC.uni.style("a! 🎉", "bold").endsWith("! 🎉"));

/* ---------------------- v2: needs-response ----------------------- */
console.log("needs-response inbox");
{
  const T = new Date("2026-02-05T00:00:00Z").getTime();
  const qpost = {
    post_key: "P9", post_text: "What should our next workshop be?", is_question: true,
    comments: 0, posted_at: new Date(T - 3 * DAY).toISOString(), author: "You",
  };
  const cs = [
    { comment_key: "M1", post_key: "P1", parent_comment_key: null, author: "Ben",
      is_owner: false, comment_text: "Does this work under 50 members?",
      commented_at: new Date(T - 2 * DAY).toISOString() },
    { comment_key: "O1", post_key: "P1", parent_comment_key: "M1", author: "You",
      is_owner: true, comment_text: "Yes it does!", commented_at: new Date(T - 1 * DAY).toISOString() },
    { comment_key: "M2", post_key: "P2", parent_comment_key: null, author: "Cara",
      is_owner: false, comment_text: "Saving this!", commented_at: new Date(T - 2 * DAY).toISOString() },
  ];
  const nr = SC.health.needsResponse([qpost], cs, { now: T, thresholdHours: 24 });
  const keys = nr.map((x) => x.comment_key);
  check("needsResponse: answered comment excluded", keys.indexOf("M1") === -1, keys);
  check("needsResponse: owner comment excluded", keys.indexOf("O1") === -1);
  check("needsResponse: unanswered comment surfaces", keys.indexOf("M2") !== -1);
  check("needsResponse: unanswered question post surfaces",
    nr.some((x) => x.kind === "post" && x.post_key === "P9"));
  check("needsResponse: sorted by wait desc",
    nr.length >= 2 ? nr[0].waitingHours >= nr[nr.length - 1].waitingHours : true);
  check("needsResponse: ownerNames fallback works",
    SC.health.needsResponse([], [
      { comment_key: "X", post_key: "P", author: "Owner Name", comment_text: "hi",
        commented_at: new Date(T - 2 * DAY).toISOString() },
    ], { now: T, thresholdHours: 24, ownerNames: ["Owner Name"] }).length === 0);
}

/* ------------------------- v2: threading ------------------------- */
console.log("threading");
{
  const cs = [
    { comment_key: "C1", post_key: "P1", parent_comment_key: null, comment_text: "top",
      commented_at: "2026-02-02T01:00:00Z" },
    { comment_key: "C2", post_key: "P1", parent_comment_key: "C1", comment_text: "reply",
      commented_at: "2026-02-02T02:00:00Z" },
    { comment_key: "C3", post_key: "P1", parent_comment_key: null, comment_text: "another top",
      commented_at: "2026-02-02T03:00:00Z" },
    { comment_key: "C4", post_key: "P1", parent_comment_key: "MISSING", comment_text: "orphan",
      commented_at: "2026-02-02T04:00:00Z" },
  ];
  const roots = SC.threads.build(cs);
  check("threads: two real roots + lifted orphan", roots.length === 3, roots.map((r) => r.comment_key));
  const c1 = roots.find((r) => r.comment_key === "C1");
  check("threads: reply nested under parent", c1 && c1.replies.length === 1 && c1.replies[0].comment_key === "C2");
  check("threads: orphan lifted to top", roots.some((r) => r.comment_key === "C4"));
  const groups = SC.threads.byPost(cs, [{ post_key: "P1", post_text: "Post one", posted_at: "2026-02-02T00:00:00Z" }]);
  check("threads.byPost: groups by post", groups.length === 1 && groups[0].count === 4);
  check("threads.byPost: attaches post", groups[0].post && groups[0].post.post_key === "P1");
}

/* ----------------- thread summary prompt (kept) ------------------ */
console.log("thread summary prompt");
{
  const sp = SC.buildThreadSummaryPrompt({
    postText: "Post body",
    comments: [{ author: "Ben", text: "q1", depth: 0 }, { author: "You", text: "a1", depth: 1 }],
  });
  check("summary prompt: includes comments", sp.includes("q1") && sp.includes("a1"));
  check("summary prompt: indents replies", sp.includes("  - You"));
}

/* ---------------- v3: pillar coverage + new metrics --------------- */
console.log("pillar coverage + new metrics");
{
  const T = Date.now();
  const mk = (slug, daysAgo, comments) => ({
    post_text: "p", pillar_guess: slug, likes: 1, comments: comments == null ? 2 : comments,
    posted_at: new Date(T - daysAgo * DAY).toISOString(), author: "You",
  });
  const pillarsSet = [
    { slug: "teaching", name: "Teaching", target_ratio: 40 },
    { slug: "win", name: "Wins", target_ratio: 40 },
    { slug: "story", name: "Story", target_ratio: 20 },
  ];
  // teaching fed recently+often; win last fed 40d ago; story never.
  const cposts = [mk("teaching", 1), mk("teaching", 5), mk("teaching", 9),
    mk("win", 40), mk("teaching", 12)];
  const cov = SC.health.pillarCoverage(cposts, pillarsSet, { now: T });
  const by = Object.fromEntries(cov.map(c => [c.slug, c]));
  check("coverage: fed pillar on track-ish", by.teaching.status === "ok" || by.teaching.status === "due", by.teaching);
  check("coverage: 40d-old pillar is overdue", by.win.status === "overdue", by.win);
  check("coverage: unfed pillar is never", by.story.status === "never");
  check("coverage: daysSince computed", by.win.daysSinceLast === 40);
  check("coverage: actualPct sums to 100 over classified",
    Math.round(cov.reduce((s, c) => s + c.actualPct, 0)) === 100);

  const sil = SC.health.silentPosts(
    [mk("teaching", 2, 0), mk("win", 3, 0), mk("story", 4, 5), mk("teaching", 5, 1)],
    { now: T });
  check("silentPosts: 50% silent", sil.silentPct === 50 && sil.silent === 2, sil);

  const nv = SC.health.newVoices([
    { author: "Old Timer", comment_text: "x", commented_at: new Date(T - 90 * DAY).toISOString() },
    { author: "Old Timer", comment_text: "y", commented_at: new Date(T - 2 * DAY).toISOString() },
    { author: "Fresh Face", comment_text: "hi", commented_at: new Date(T - 3 * DAY).toISOString() },
    { author: "Owner", is_owner: true, comment_text: "o", commented_at: new Date(T - 1 * DAY).toISOString() },
  ], { now: T });
  check("newVoices: fresh counted, veteran + owner not", nv.newCommenters === 1 && nv.names[0] === "Fresh Face", nv);

  const bd = SC.health.bestDay([
    mk("teaching", 7, 9), mk("teaching", 14, 9), // same weekday, high engagement
    mk("win", 6, 0), mk("win", 13, 0),
  ]);
  check("bestDay: picks the high-engagement weekday", bd && bd.avg > 0, bd);

  const st = SC.health.streak([mk("teaching", 2), mk("teaching", 9), mk("teaching", 16)], { now: T });
  check("streak: three consecutive weeks", st.weeks === 3, st);
  check("streak: empty is 0", SC.health.streak([], { now: T }).weeks === 0);
}

/* ---------------------- v3: pillar templates ---------------------- */
console.log("pillar templates");
{
  check("templates: several exist", (SC.PILLAR_TEMPLATES || []).length >= 5);
  let allOk = true, sumOk = true;
  SC.PILLAR_TEMPLATES.forEach(t => {
    if (!t.id || !t.label || !t.blurb || !Array.isArray(t.pillars) || t.pillars.length < 4) allOk = false;
    const sum = t.pillars.reduce((s, p) => s + p.target_ratio, 0);
    if (sum !== 100) sumOk = false;
    t.pillars.forEach(p => { if (!p.slug || !p.name || !p.description) allOk = false; });
  });
  check("templates: complete shapes", allOk);
  check("templates: targets sum to 100 in every set", sumOk);
  check("templates: lookup by id", SC.pillarTemplateById("coaching").pillars.length >= 4);
  check("templates: unknown id is null", SC.pillarTemplateById("nope") === null);
}

/* ------------------- v3: pillar suggestions (AI) ------------------ */
console.log("pillar suggestions");
{
  const pp = SC.buildPillarSuggestPrompt({
    communityName: "Maker Mastermind", about: "indie makers shipping products",
    recentTitles: ["How I onboard", "Win: first sale"],
  });
  check("suggest prompt: includes name + about", pp.includes("Maker Mastermind") && pp.includes("indie makers"));
  check("suggest prompt: includes titles", pp.includes("How I onboard"));
  check("suggest prompt: demands JSON", pp.includes("JSON array"));

  const parsed = SC.parsePillarSuggestions(
    '```json\n[{"name":"Teach","description":"d","target":40},' +
    '{"name":"Wins","description":"d","target":35},{"name":"Ask","description":"d","target":25}]\n```');
  check("suggest parser: parses fenced JSON", parsed && parsed.length === 3);
  check("suggest parser: sums stay 100", parsed.reduce((s, p) => s + p.target_ratio, 0) === 100);

  const skewed = SC.parsePillarSuggestions('[{"name":"A","target":30},{"name":"B","target":30}]');
  check("suggest parser: rescales to 100", skewed.reduce((s, p) => s + p.target_ratio, 0) === 100, skewed);

  const cut = SC.parsePillarSuggestions('[{"name":"Full","description":"ok","target":50},{"name":"Trunca');
  check("suggest parser: truncated object dropped", cut && cut.length === 1 && cut[0].name === "Full", cut);
  check("suggest parser: garbage is null", SC.parsePillarSuggestions("no json") === null);
}

/* ------------------------------ done ----------------------------- */
if (failures) {
  console.error("\n" + failures + " check(s) FAILED");
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
