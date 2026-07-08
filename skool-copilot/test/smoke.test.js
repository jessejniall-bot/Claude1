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
require("../extension/shared/reply-template.js");
require("../extension/shared/voice-local.js");

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

/* --------------------- v2: reply templating ---------------------- */
console.log("reply templating");
{
  const RT = SC.replyTemplate;
  const req = {
    method: "POST", url: "https://api.skool.com/v1/comments", contentType: "application/json",
    body: { postId: "abcd1234efgh5678", parentId: "1111222233334444", content: "Yes, it works!" },
  };
  const a = RT.recognize(req.method, req.url, req.body);
  check("recognize: strong for comment POST", a && a.confidence === "strong", a);
  check("recognize: finds parent", a && a.parentIdPath && a.parentIdPath[0] === "parentId");
  const tpl = RT.makeTemplate(req, a);
  check("template: redacts text", tpl.bodyTemplate.indexOf("Yes, it works!") === -1);
  check("template: redacts ids", tpl.bodyTemplate.indexOf("abcd1234efgh5678") === -1);
  const filled = RT.fill(tpl, { text: 'He said "hi"\nok', postId: "PP", parentId: "CC" });
  const parsedBody = JSON.parse(filled.body);
  check("fill: text round-trips with escaping", parsedBody.content === 'He said "hi"\nok');
  check("fill: ids substituted", parsedBody.postId === "PP" && parsedBody.parentId === "CC");
  check("recognize: rejects upvote", RT.recognize("POST", "https://api.skool.com/v1/upvote", { postId: "abcd1234efgh5678" }) === null);
  check("recognize: rejects GET", RT.recognize("GET", "https://api.skool.com/v1/comments", { content: "a b c", postId: "abcd1234efgh5678" }) === null);
  const tpl2 = RT.makeTemplate(
    { method: "POST", url: "https://api.skool.com/posts/abcd1234efgh5678/comments", body: { comment: "hi there", post: "abcd1234efgh5678" } },
    RT.recognize("POST", "https://api.skool.com/posts/abcd1234efgh5678/comments", { comment: "hi there", post: "abcd1234efgh5678" })
  );
  check("template: templates id in URL path", tpl2.url.indexOf("{{POST_ID}}") !== -1, tpl2.url);
  check("fill: requires postId when template needs it", RT.fill(tpl2, { text: "x" }) === null);
}

/* ----------------- v2: comment reply + summary prompts ----------- */
console.log("reply + summary prompts");
{
  const rp = SC.buildCommentReplyPrompt({
    communityName: "T", voice: { tone_notes: "warm", banned_words: ["synergy"] },
    postText: "How I onboard members", comment: { author: "Ben", text: "Does this scale?" },
    thread: [{ author: "Cara", text: "same question" }],
  });
  check("reply prompt: includes comment", rp.includes("Does this scale?"));
  check("reply prompt: includes author", rp.includes("Ben"));
  check("reply prompt: includes voice", rp.includes("warm") && rp.includes("synergy"));
  check("reply prompt: includes thread context", rp.includes("same question"));
  const sp = SC.buildThreadSummaryPrompt({
    postText: "Post body",
    comments: [{ author: "Ben", text: "q1", depth: 0 }, { author: "You", text: "a1", depth: 1 }],
  });
  check("summary prompt: includes comments", sp.includes("q1") && sp.includes("a1"));
  check("summary prompt: indents replies", sp.includes("  - You"));
}

/* ------------- v2.1: standalone reply drafts (local voice) ------- */
console.log("standalone reply drafts");
{
  // sample parsing: blank-line separated blocks stay whole
  const blocks = SC.localVoice.parseSamples("Reply one line A\nline B\n\nReply two");
  check("parseSamples: blank-line blocks", blocks.length === 2 && blocks[0].includes("line B"), blocks);
  const singles = SC.localVoice.parseSamples("r1\nr2\nr3");
  check("parseSamples: single lines when no blanks", singles.length === 3);
  check("parseSamples: empty is []", SC.localVoice.parseSamples("   ").length === 0);

  const lp = SC.buildLocalReplyPrompt({
    post: { author: "Ben", title: "How I onboard", body: "steps here" },
    comments: [{ authorName: "Cara", body: "love this" }],
    voice: { styleNote: "warm, short", samples: ["Congrats! How long did that take?", "Love it — try X next."] },
    count: 3,
  });
  check("local reply prompt: includes samples", lp.includes("Congrats! How long"));
  check("local reply prompt: includes style note", lp.includes("warm, short"));
  check("local reply prompt: includes post", lp.includes("How I onboard"));
  check("local reply prompt: includes comment context", lp.includes("Cara"));
  check("local reply prompt: asks for N JSON", lp.includes("exactly 3") && lp.includes("JSON array"));

  // replyTo targets a specific comment (the comment feed feature)
  const cp = SC.buildLocalReplyPrompt({
    post: { author: "Ben", title: "How I onboard", body: "steps" },
    comments: [{ authorName: "Cara", body: "earlier note" }],
    replyTo: { authorName: "Dana Ray", body: "Does this scale past 500 members?" },
    voice: { samples: ["Love it!"] }, count: 3,
  });
  check("reply-to-comment prompt: targets the comment", cp.includes("TO THIS COMMENT from Dana Ray"));
  check("reply-to-comment prompt: includes comment text", cp.includes("Does this scale past 500"));
  check("reply-to-comment prompt: addresses first name", cp.includes("Address Dana"));
  check("reply-to-comment prompt: keeps post as context", cp.includes("The post under discussion"));

  check("parseReplyDrafts: JSON array", JSON.stringify(
    SC.parseReplyDrafts('["a","b","c","d"]', 3)) === JSON.stringify(["a", "b", "c"]));
  check("parseReplyDrafts: fenced JSON", SC.parseReplyDrafts('```json\n["x","y"]\n```', 3).length === 2);
  check("parseReplyDrafts: numbered fallback",
    SC.parseReplyDrafts("1. first\n2. second\n3. third", 3).length === 3);
  check("parseReplyDrafts: bulleted fallback",
    SC.parseReplyDrafts("- one\n- two", 5)[0] === "one");
  check("parseReplyDrafts: empty", SC.parseReplyDrafts("", 3).length === 0);
}

/* ------------------------------ done ----------------------------- */
if (failures) {
  console.error("\n" + failures + " check(s) FAILED");
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
