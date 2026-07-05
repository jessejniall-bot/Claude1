/* =====================================================================
   Skool Community Copilot — default pillar library
   ---------------------------------------------------------------------
   Generic seed data for any community; fully editable per community.
   Keep in sync with the seed trigger in supabase/schema.sql.
   ===================================================================== */
(function (SC) {
  "use strict";

  SC.DEFAULT_PILLARS = [
    {
      slug: "teaching",
      name: "Teaching / How-To",
      description: "Actionable lessons, walkthroughs, frameworks members can apply.",
      target_ratio: 25,
      position: 0,
    },
    {
      slug: "story",
      name: "Personal Story",
      description: "First-person experiences, lessons learned, vulnerable moments.",
      target_ratio: 15,
      position: 1,
    },
    {
      slug: "question",
      name: "Engagement Question",
      description: "Open questions, polls, this-or-that prompts that drive replies.",
      target_ratio: 20,
      position: 2,
    },
    {
      slug: "resource",
      name: "Tool or Resource Highlight",
      description: "A tool, template, book, or link worth sharing, with context.",
      target_ratio: 15,
      position: 3,
    },
    {
      slug: "win",
      name: "Win / Social Proof",
      description: "Member wins, milestones, testimonials, before-and-after results.",
      target_ratio: 15,
      position: 4,
    },
    {
      slug: "bts",
      name: "Behind-the-Scenes",
      description: "What you are building or figuring out; process over polish.",
      target_ratio: 10,
      position: 5,
    },
  ];
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
