/* =====================================================================
   Skool Community Copilot — demo mode
   ---------------------------------------------------------------------
   Lets the PWA run end-to-end with no Supabase project and no AI key:
   SC.DemoClient implements the same query surface the app uses, backed
   by localStorage-persisted sample data, and SC.demoDraft/demoReview
   provide canned AI output when no provider key is configured.
   Requires config.js (SC.storage).
   ===================================================================== */
(function (SC) {
  "use strict";

  var DEMO_FLAG = "sc_demo_mode";
  var DEMO_DB = "sc_demo_db";
  var DAY = 86400000;

  SC.isDemo = function () {
    return SC.storage.get(DEMO_FLAG).then(function (v) { return !!v; });
  };
  SC.enableDemo = function () { return SC.storage.set(DEMO_FLAG, true); };
  SC.disableDemo = function () {
    return SC.storage.remove(DEMO_FLAG).then(function () {
      return SC.storage.remove(DEMO_DB);
    });
  };

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "d" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  /* ------------------------- seed dataset -------------------------- */

  function seed() {
    var now = Date.now();
    var communityId = uuid();
    var mk = function (extra) { return Object.assign({ id: uuid(), community_id: communityId }, extra); };

    var pillarDefs = SC.DEFAULT_PILLARS || [];
    var pillars = pillarDefs.map(function (p, i) {
      return mk({ slug: p.slug, name: p.name, description: p.description,
        target_ratio: p.target_ratio, position: i });
    });

    var postSeeds = [
      ["teaching", "How I onboard new members in 10 minutes flat", 14, 9, false],
      ["question", "What's the one tool you can't run your business without?", 11, 16, true],
      ["bts", "Behind the scenes: rebuilding our welcome course this week", 8, 4, false],
      ["teaching", "Step by step: turning one post into a week of content", 17, 7, false],
      ["question", "Poll: mornings or evenings for deep work?", 9, 21, true],
      ["win", "Member win: Sarah just landed her first $2k client 🎉", 24, 12, false],
      ["teaching", "The 3-question framework I use before publishing anything", 13, 6, false],
      ["question", "Anyone else struggle with consistency? What actually helped?", 10, 14, true],
      ["bts", "Working on something new — sneak peek inside", 12, 8, false],
      ["teaching", "How to get your first 10 engaged members (no ads)", 19, 11, false],
      ["question", "Drop a 🔥 if you shipped something this week", 15, 19, true],
      ["teaching", "Checklist: the 5 things every community post needs", 11, 5, false],
      ["bts", "Update: what I learned from last month's numbers", 7, 3, false],
      ["question", "What should our next live workshop cover?", 8, 13, true],
    ];
    var authors = ["You (owner)", "You (owner)", "You (owner)", "Alice M.", "You (owner)"];
    var posts = postSeeds.map(function (s, i) {
      var postedAt = now - (i * 2 + 1) * DAY;
      return mk({
        post_key: "demo-post-" + i,
        post_name: "demo-post-" + i + "-" + s[0],
        post_text: s[1] + "\n\nSample body text for this " + s[0] + " post.",
        pillar_guess: s[0],
        likes: s[2],
        comments: s[3],
        posted_at: new Date(postedAt).toISOString(),
        author: authors[i % authors.length],
        is_question: s[4],
        first_comment_at: s[4] ? new Date(postedAt + 3 * 3600000).toISOString() : null,
      });
    });

    var commenters = ["Alice M.", "Ben K.", "Alice M.", "Cara D.", "Ben K.",
      "Alice M.", "Dan R.", "Ben K.", "Alice M.", "Eve S."];
    var commentTexts = [
      "This is exactly what I needed this week, thank you!",
      "Question — does this work if my community is under 50 members?",
      "Saving this. The checklist alone is gold.",
      "I tried this last month and doubled my replies.",
      "Can you do a live walkthrough of this?",
      "Honestly the best breakdown I've seen on this topic.",
      "Following — same struggle here.",
      "🔥🔥🔥",
      "This changed how I think about posting cadence.",
      "Would love a template for this!",
    ];
    var comments = [];
    for (var i = 0; i < 34; i++) {
      var mParent = "demo-comment-" + i;
      comments.push(mk({
        comment_key: mParent,
        post_key: "demo-post-" + (i % posts.length),
        parent_comment_key: null,
        comment_text: commentTexts[i % commentTexts.length],
        author: commenters[i % commenters.length],
        is_owner: false,
        likes: i % 4,
        commented_at: new Date(now - (i % 26) * DAY - 5 * 3600000).toISOString(),
      }));
      // The owner has replied to roughly every third comment — a nested reply,
      // authored by the owner, timestamped just after. The rest stay open so
      // the needs-response inbox has real items to show.
      if (i % 3 === 0) {
        comments.push(mk({
          comment_key: "demo-owner-reply-" + i,
          post_key: "demo-post-" + (i % posts.length),
          parent_comment_key: mParent,
          comment_text: "Great point — appreciate you jumping in here! Let me follow up with more.",
          author: "You (owner)",
          is_owner: true,
          likes: 1,
          commented_at: new Date(now - (i % 26) * DAY - 4 * 3600000).toISOString(),
        }));
      }
    }

    return {
      communities: [{
        id: communityId,
        user_id: "demo-user",
        name: "Demo: Maker Mastermind",
        skool_url: "https://www.skool.com/demo-maker-mastermind",
        slug: "demo-maker-mastermind",
        created_at: new Date(now - 90 * DAY).toISOString(),
      }],
      pillars: pillars,
      voice_profiles: [mk({
        tone_notes: "Direct and warm. Short sentences. Talk like a person, not a brand.",
        banned_words: ["synergy", "circle back"],
        formatting_rules: "One idea per line. End every post with a question.",
      })],
      scraped_posts: posts,
      scraped_comments: comments,
      ideas: [
        mk({ source: "capture", content: "Ben asked: does this work for communities under 50 members? → turn into a post", status: "inbox", created_at: new Date(now - 2 * DAY).toISOString() }),
        mk({ source: "manual", content: "Story about the launch that flopped in 2021", status: "inbox", created_at: new Date(now - 5 * DAY).toISOString() }),
      ],
      drafts: [],
      queue: [],
    };
  }

  /* ---------------------- localStorage-backed db ------------------- */

  var dbCache = null;

  async function loadDb() {
    if (dbCache) return dbCache;
    dbCache = await SC.storage.get(DEMO_DB);
    if (!dbCache) {
      dbCache = seed();
      await SC.storage.set(DEMO_DB, dbCache);
    }
    return dbCache;
  }

  function saveDb() {
    return SC.storage.set(DEMO_DB, dbCache);
  }

  /* -------------------------- query builder ------------------------ */

  function DemoQuery(table) {
    this.table = table;
    this._filters = [];
    this._order = null;
    this._limit = null;
    this._op = "select";
    this._payload = null;
  }
  DemoQuery.prototype.select = function () { return this; };
  DemoQuery.prototype.eq = function (col, val) {
    this._filters.push([col, val]);
    return this;
  };
  DemoQuery.prototype.gte = function () { return this; };
  DemoQuery.prototype.lte = function () { return this; };
  DemoQuery.prototype.in = function () { return this; };
  DemoQuery.prototype.order = function (col, opts) {
    this._order = { col: col, asc: !(opts && opts.ascending === false) };
    return this;
  };
  DemoQuery.prototype.limit = function (n) { this._limit = n; return this; };
  DemoQuery.prototype.single = function () { return this; };
  DemoQuery.prototype.insert = function (rows) {
    this._op = "insert"; this._payload = rows; return this;
  };
  DemoQuery.prototype.upsert = function (rows) {
    this._op = "insert"; this._payload = rows; return this;
  };
  DemoQuery.prototype.update = function (vals) {
    this._op = "update"; this._payload = vals; return this;
  };
  DemoQuery.prototype.delete = function () { this._op = "delete"; return this; };

  DemoQuery.prototype._matches = function (row) {
    return this._filters.every(function (f) { return row[f[0]] === f[1]; });
  };

  DemoQuery.prototype.run = async function () {
    var db = await loadDb();
    if (!db[this.table]) db[this.table] = [];
    var rows = db[this.table];
    var self = this;

    if (this._op === "insert") {
      var list = Array.isArray(this._payload) ? this._payload : [this._payload];
      var inserted = list.map(function (r) {
        var row = Object.assign({
          id: uuid(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: r.status || (self.table === "drafts" ? "draft"
            : self.table === "queue" ? "queued"
            : self.table === "ideas" ? "inbox" : undefined),
        }, r);
        rows.push(row);
        return row;
      });
      await saveDb();
      return inserted;
    }
    if (this._op === "update") {
      var updated = [];
      rows.forEach(function (r) {
        if (self._matches(r)) {
          Object.assign(r, self._payload, { updated_at: new Date().toISOString() });
          updated.push(r);
        }
      });
      await saveDb();
      return updated;
    }
    if (this._op === "delete") {
      db[this.table] = rows.filter(function (r) { return !self._matches(r); });
      await saveDb();
      return [];
    }
    // select
    var out = rows.filter(function (r) { return self._matches(r); });
    if (this._order) {
      var o = this._order;
      out = out.slice().sort(function (a, b) {
        var av = a[o.col], bv = b[o.col];
        if (av === bv) return 0;
        var cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
        return o.asc ? cmp : -cmp;
      });
    }
    if (this._limit != null) out = out.slice(0, this._limit);
    return out;
  };
  DemoQuery.prototype.then = function (res, rej) { return this.run().then(res, rej); };

  /* ----------------------------- client ---------------------------- */

  function DemoClient() {}
  DemoClient.prototype.getUser = async function () {
    return { id: "demo-user", email: "demo@local" };
  };
  DemoClient.prototype.ensureSession = async function () {
    return { access_token: "demo", user: { id: "demo-user" } };
  };
  DemoClient.prototype.signIn = async function () { return this.ensureSession(); };
  DemoClient.prototype.signUp = async function () { return this.ensureSession(); };
  DemoClient.prototype.signOut = async function () {
    dbCache = null;
    await SC.disableDemo();
  };
  DemoClient.prototype.from = function (table) { return new DemoQuery(table); };

  SC.DemoClient = DemoClient;

  /* ----------------------- canned AI output ------------------------ */
  // Used only when demo mode is on and no provider key is configured,
  // so the generate/review buttons work out of the box. With a real
  // key, demo mode calls the real provider like normal.

  SC.demoDraft = function (pillarName, seedText) {
    var hook = seedText
      ? "You asked, so here it is: " + seedText.slice(0, 80)
      : "Nobody talks about this part of running a community.";
    return (
      "The " + pillarName + " post I should have written weeks ago\n\n" +
      hook + "\n\n" +
      "Here's the short version: 👇\n" +
      "1. Start smaller than feels comfortable.\n" +
      "2. Share the messy middle, not just the win.\n" +
      "3. Ask one specific question at the end.\n\n" +
      "(Sample draft — add your own AI key in Settings to generate real ones.)\n\n" +
      "What would you add to this list?"
    );
  };

  SC.demoPillarSuggestion = function () {
    return [
      { name: "Teaching / How-To", description: "Actionable lessons members can apply this week.", target_ratio: 30 },
      { name: "Member Wins", description: "Results and milestones — proof it works.", target_ratio: 20 },
      { name: "Engagement Question", description: "Prompts that get members talking to each other.", target_ratio: 20 },
      { name: "Accountability Challenge", description: "Weekly check-ins that keep people moving.", target_ratio: 15 },
      { name: "Personal Story", description: "The human behind the method.", target_ratio: 15 },
    ];
  };

  SC.demoThreadSummary = function (flat) {
    return "A member asked whether the approach works for small communities; another " +
      "chimed in that they'd tried something similar. One open question is aimed at " +
      "you (\"can you do a live walkthrough?\") and still needs a reply.\n\n" +
      "(Sample summary — add your AI key in Settings for real ones.)";
  };

  SC.demoReview = function (digestLines) {
    return (
      "VERDICT: This demo community is healthy — steady cadence and strong reply " +
      "volume — but the conversation leans on a few regulars.\n\n" +
      "WHAT'S WORKING:\n" +
      "- " + (digestLines && digestLines[1] ? digestLines[1] : "Consistent posting rhythm") + "\n" +
      "- Questions get first replies within hours, which trains members to post\n\n" +
      "WHERE TO IMPROVE:\n" +
      "1. Personal Story sits well under its target — members bond with the person, not the tips. Post one this week.\n" +
      "2. Alice and Ben write most comments. Name-drop two quieter members in your next post.\n" +
      "3. \"Can you do a live walkthrough of this?\" has been asked twice — that's your next workshop topic.\n\n" +
      "(Sample review — add your own AI key in Settings for a real analysis of your community.)"
    );
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
