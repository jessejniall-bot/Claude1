/* =====================================================================
   Skool Community Copilot — pillar templates by community type
   ---------------------------------------------------------------------
   Curated starting pillar sets for common kinds of Skool communities.
   Applying one replaces the community's pillars (after confirmation) but
   everything stays fully editable afterwards — templates are a starting
   point, not a cage. Targets in each set sum to 100.
   ===================================================================== */
(function (SC) {
  "use strict";

  function p(slug, name, description, target) {
    return { slug: slug, name: name, description: description, target_ratio: target };
  }

  SC.PILLAR_TEMPLATES = [
    {
      id: "coaching",
      label: "Coaching / Course community",
      blurb: "Members joined to learn from you and see progress — teach, prove it works, keep them moving.",
      pillars: [
        p("teaching", "Teaching / How-To", "Actionable lessons, walkthroughs, frameworks members can apply this week.", 30),
        p("win", "Member Wins", "Student results, milestones, before-and-after — proof the method works.", 20),
        p("question", "Engagement Question", "Open questions and prompts that get members talking to each other.", 20),
        p("accountability", "Accountability / Challenge", "Weekly check-ins, challenges, goal posts that keep people in motion.", 15),
        p("story", "Personal Story", "Your own lessons, failures, and journey — the human behind the method.", 15),
      ],
    },
    {
      id: "fitness",
      label: "Fitness / Wellness",
      blurb: "Progress is visual and motivation is the product — celebrate often, challenge constantly.",
      pillars: [
        p("challenge", "Challenges / Workouts", "Weekly challenges, workout drops, and follow-along sessions.", 25),
        p("win", "Transformations & Wins", "Member progress photos, PRs, streaks — the motivation engine.", 25),
        p("teaching", "Form & Knowledge", "Technique breakdowns, nutrition basics, myth-busting.", 20),
        p("question", "Check-ins & Questions", "Daily/weekly check-ins, this-or-that, accountability prompts.", 20),
        p("story", "Real Talk", "Your own setbacks and comebacks; honest conversations about the hard parts.", 10),
      ],
    },
    {
      id: "business",
      label: "Business / Entrepreneurship",
      blurb: "Members want revenue outcomes and peer connections — mix tactics with real numbers.",
      pillars: [
        p("teaching", "Playbooks & Tactics", "Step-by-step growth tactics members can run this week.", 25),
        p("bts", "Behind the Numbers", "Your real revenue/metrics experiments — what worked, what flopped.", 20),
        p("win", "Member Wins", "Deals closed, launches shipped, first sales — celebrate publicly.", 20),
        p("question", "Hot Seats & Questions", "Ask-me-anything, hot seats, poll the room on real decisions.", 20),
        p("resource", "Tools & Resources", "The stack: tools, templates, swipe files with context on when to use them.", 15),
      ],
    },
    {
      id: "creative",
      label: "Creative / Hobby",
      blurb: "Sharing work is the point — make showing up with work-in-progress feel safe and celebrated.",
      pillars: [
        p("showcase", "Member Showcase", "Members share finished work and works-in-progress for feedback.", 30),
        p("teaching", "Techniques & Tutorials", "Skill breakdowns, process videos, tool tips.", 25),
        p("challenge", "Prompts & Challenges", "Weekly creative prompts that give everyone a reason to make something.", 20),
        p("bts", "Behind the Scenes", "Your own process, messy middles, experiments.", 15),
        p("question", "Community Questions", "Preferences, inspirations, feedback requests.", 10),
      ],
    },
    {
      id: "tech",
      label: "Tech / SaaS product",
      blurb: "Users stay for outcomes and roadmap trust — teach use cases, show momentum, close the loop.",
      pillars: [
        p("teaching", "Use Cases & How-To", "Feature walkthroughs and real workflows that get users to value.", 30),
        p("bts", "Roadmap & Changelog", "What shipped, what's next, and the why — momentum builds trust.", 20),
        p("win", "Customer Wins", "Case studies and user results worth imitating.", 20),
        p("question", "Feedback & Polls", "Feature votes, friction hunts, open feedback threads.", 20),
        p("resource", "Integrations & Resources", "Templates, integrations, and companion tools.", 10),
      ],
    },
    {
      id: "faith_lifestyle",
      label: "Faith / Lifestyle / Support",
      blurb: "Belonging is the product — encourage daily, go deep weekly, let members carry the story.",
      pillars: [
        p("encouragement", "Encouragement", "Daily/weekly encouragement, affirmations, scripture or principles.", 25),
        p("story", "Stories & Testimonies", "Member and leader stories — struggle, growth, breakthrough.", 25),
        p("teaching", "Deep Dives", "Longer teaching on the community's core practice or belief.", 20),
        p("question", "Reflection Questions", "Prompts that invite honest sharing and connection.", 20),
        p("challenge", "Practices & Challenges", "Weekly practices done together — habits, gratitude, service.", 10),
      ],
    },
  ];

  SC.pillarTemplateById = function (id) {
    for (var i = 0; i < SC.PILLAR_TEMPLATES.length; i++) {
      if (SC.PILLAR_TEMPLATES[i].id === id) return SC.PILLAR_TEMPLATES[i];
    }
    return null;
  };
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
