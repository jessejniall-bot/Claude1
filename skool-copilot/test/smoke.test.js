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

/* -------------------- engagement suggestions --------------------- */
console.log("engagement suggestions");
const ep = SC.buildEngagementPrompt({
  communityName: "T",
  voice: { tone_notes: "warm", banned_words: ["synergy"] },
  posts: [
    { author: "Alice", post_text: "How do I price my first offer?", likes: 3, comments: 1 },
    { author: "Bob", post_text: "Just hit 100 members!", likes: 9, comments: 4 },
  ],
});
check("engage prompt: posts included", ep.includes("POST 2") && ep.includes("Alice"));
check("engage prompt: action vocabulary", ep.includes("detailed_reply") && ep.includes("like_only"));
check("engage prompt: voice", ep.includes("warm") && ep.includes("synergy"));

const goodJson = '```json\n[{"post":1,"action":"detailed_reply","reason":"asked a question","reply":"Hey Alice!"},' +
  '{"post":2,"action":"like_only","reason":"celebration","reply":""}]\n```';
const parsed = SC.parseEngagementSuggestions(goodJson);
check("parser: strips fences, parses", parsed && parsed.length === 2, parsed);
check("parser: fields normalized", parsed[0].action === "detailed_reply" && parsed[1].reply === "");
const wrapped = SC.parseEngagementSuggestions('Sure! Here you go: [{"post":1,"action":"skip","reason":"x","reply":""}] Hope that helps!');
check("parser: tolerates surrounding prose", wrapped && wrapped.length === 1);
check("parser: garbage returns null", SC.parseEngagementSuggestions("no json here") === null);
check("parser: empty returns null", SC.parseEngagementSuggestions("") === null);

/* ------------------------ unicode styling ------------------------ */
console.log("unicode styling");
const b = SC.uni.style("Big Win 2024!", "bold");
check("bold transforms", b !== "Big Win 2024!" && SC.uni.isStyled(b), b);
check("plain text not flagged styled", !SC.uni.isStyled("plain text"));
check("double-styling is a no-op", SC.uni.style(b, "bold") === b);
check("italic transforms", SC.uni.isStyled(SC.uni.style("hello", "italic")));
check("punctuation and emoji pass through",
  SC.uni.style("a! 🎉", "bold").endsWith("! 🎉"));

/* ------------------------------ done ----------------------------- */
if (failures) {
  console.error("\n" + failures + " check(s) FAILED");
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
