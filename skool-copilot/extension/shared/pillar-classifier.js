/* =====================================================================
   Skool Community Copilot — keyword pillar classifier
   ---------------------------------------------------------------------
   Zero-AI-cost heuristic that guesses which default pillar a scraped
   post belongs to. Deliberately simple: scores keyword hits per pillar
   and picks the best. Posts that match nothing stay unclassified so
   the balance math ignores them rather than polluting a pillar.
   ===================================================================== */
(function (SC) {
  "use strict";

  var RULES = {
    teaching: {
      weight: 1,
      words: [
        "how to", "step by step", "step-by-step", "guide", "tutorial", "framework",
        "here's how", "heres how", "lesson", "walkthrough", "checklist", "template",
        "tip:", "tips", "mistake", "avoid", "learn", "breakdown", "explained",
      ],
    },
    story: {
      weight: 1,
      words: [
        "my story", "i remember", "years ago", "when i started", "i used to",
        "i failed", "i learned", "confession", "honest", "journey", "back then",
        "i almost quit", "my first",
      ],
    },
    question: {
      weight: 1.2, // questions are short; give hits a bit more pull
      words: [
        "what do you", "which one", "would you rather", "poll", "vote",
        "this or that", "am i the only", "anyone else", "curious", "drop a",
        "comment below", "tell me", "what's your", "whats your", "how do you",
      ],
    },
    resource: {
      weight: 1,
      words: [
        "tool", "app", "resource", "free download", "swipe file", "book",
        "template", "link in", "check out", "recommend", "stack", "software",
        "plugin", "extension",
      ],
    },
    win: {
      weight: 1,
      words: [
        "win", "milestone", "just hit", "closed", "landed", "results",
        "before and after", "testimonial", "shoutout", "shout out", "celebrate",
        "proud", "first sale", "revenue", "signed",
      ],
    },
    bts: {
      weight: 1,
      words: [
        "behind the scenes", "working on", "building", "sneak peek", "wip",
        "work in progress", "experiment", "testing", "prototype", "roadmap",
        "update:", "progress report",
      ],
    },
  };

  // classifyPillar(text) -> { pillar: slug|null, score: number }
  SC.classifyPillar = function (text) {
    if (!text) return { pillar: null, score: 0 };
    var lower = String(text).toLowerCase();
    var best = null;
    var bestScore = 0;

    Object.keys(RULES).forEach(function (slug) {
      var rule = RULES[slug];
      var score = 0;
      rule.words.forEach(function (w) {
        var idx = 0;
        while ((idx = lower.indexOf(w, idx)) !== -1) {
          score += rule.weight;
          idx += w.length;
        }
      });
      // A post that *is* mostly a question leans "question" even without keywords.
      if (slug === "question" && /\?\s*$/.test(lower.trim()) && lower.length < 400) {
        score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = slug;
      }
    });

    return { pillar: bestScore > 0 ? best : null, score: bestScore };
  };

  SC.looksLikeQuestion = function (text) {
    if (!text) return false;
    var t = String(text);
    return t.indexOf("?") !== -1;
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
