/* =====================================================================
   Skool Prompt Forge — Content Library
   ---------------------------------------------------------------------
   Curated, Google-Gemini-specific building blocks for high-engagement
   Skool posts. Everything here is assembled by app.js into a finished
   post (Title Case heading + emoji body) kept under 500 characters.

   All Gemini features reflect the 2026 product line:
   Gems, Deep Research, Canvas, Nano Banana (image gen), Veo (video),
   Gemini Live (voice), and Google Workspace integration.
   ===================================================================== */

/* ---- Feature metadata + reusable "nuggets" (real prompts/tips) ---- */
const FEATURES = {
  "gems": {
    name: "Gems",
    emoji: "🧩",
    accents: ["🧩", "🤖", "⚙️"],
    nuggets: [
      { topic: "Your 24/7 Brand Voice Writer",
        value: "Build a Gem once and every post sounds exactly like you",
        prompt: "You are my brand voice: punchy, warm, zero jargon. Rewrite this as a Skool post: [paste]" },
      { topic: "The Cold DM Closer Gem",
        value: "Feed it your ideal client and it drafts outreach in seconds",
        prompt: "You're my outreach assistant. Write a 3-line DM to a [niche] founder who posted about [pain]." },
      { topic: "The One-Idea-To-A-Week Gem",
        value: "Drop a single idea and get 5 ready-to-post hooks back",
        prompt: "Turn this one idea into 5 Skool posts, each with a scroll-stopping hook: [idea]" },
      { topic: "The Onboarding Coach Gem",
        value: "A Gem that answers new-member questions in your tone",
        prompt: "You are our community guide. Answer like a friendly mentor: [question]" },
      { topic: "The Pre-Loaded Expert Gem",
        value: "Upload your docs once, then ask it anything forever",
        prompt: "Using the files I uploaded, explain my framework in 5 simple steps." }
    ]
  },
  "deep-research": {
    name: "Deep Research",
    emoji: "🔬",
    accents: ["🔬", "📊", "🕵️"],
    nuggets: [
      { topic: "Spy On Your Whole Niche In One Click",
        value: "One prompt returns a full competitor breakdown report",
        prompt: "Deep research the top 5 [niche] communities. Compare offers, pricing, and hooks." },
      { topic: "Validate Before You Build",
        value: "Test real demand before you spend a single dollar",
        prompt: "Deep research: is there genuine demand for a [topic] course in 2026? Cite sources." },
      { topic: "Your Personal Trend Scanner",
        value: "Surface what's about to blow up in your space",
        prompt: "Deep research emerging tools in [niche] this quarter and rank them by momentum." },
      { topic: "Web Plus Your Drive, Together",
        value: "Let it read your own files and the web in one report",
        prompt: "Using my Drive docs and the web, research where my funnel is leaking and why." }
    ]
  },
  "canvas": {
    name: "Canvas",
    emoji: "🎨",
    accents: ["🎨", "🖌️", "🪄"],
    nuggets: [
      { topic: "Build A Landing Page By Talking",
        value: "Describe your offer and get a working page draft instantly",
        prompt: "In Canvas, build a landing page for my [offer]: headline, 3 benefits, one bold CTA." },
      { topic: "Live-Edit Your Sales Copy",
        value: "Tighten the hook in real time with no rewrites",
        prompt: "In Canvas, draft my sales page, then sharpen the headline until it's punchy." },
      { topic: "Notes To Prototype In Minutes",
        value: "Turn messy notes into a clean interactive one-pager",
        prompt: "Take these notes and build a one-pager in Canvas: [paste]" },
      { topic: "A Lead Magnet While You Sip Coffee",
        value: "Design a shareable checklist you can hand out today",
        prompt: "In Canvas, create a 1-page '7-Step [topic]' checklist I can give away." }
    ]
  },
  "nano-banana": {
    name: "Nano Banana",
    emoji: "🍌",
    accents: ["🍌", "🖼️", "✨"],
    nuggets: [
      { topic: "Thumbnails That Earn The Click",
        value: "Generate scroll-stopping post images for free",
        prompt: "Create a bold thumbnail titled '[title]': high contrast, a face, big readable text." },
      { topic: "Edit Photos By Just Asking",
        value: "Swap backgrounds and objects with plain words",
        prompt: "Edit this photo: remove the background and give it a clean studio look." },
      { topic: "Five Carousel Slides From One Line",
        value: "A matching visual set from a single sentence",
        prompt: "Create 5 matching carousel slides teaching [topic] in a minimal style." },
      { topic: "On-Brand Graphics Every Time",
        value: "Same colors, same vibe, in seconds",
        prompt: "Make a graphic in [color] matching my brand vibe for a post about [topic]." }
    ]
  },
  "veo": {
    name: "Veo",
    emoji: "🎬",
    accents: ["🎬", "🎥", "🍿"],
    nuggets: [
      { topic: "Faceless Reels Without A Camera",
        value: "Text to video, with synced sound, right inside chat",
        prompt: "Veo: an 8-second clip of [scene] with upbeat music for a hook about [topic]." },
      { topic: "Animate A Still Image",
        value: "Turn one picture into smooth motion",
        prompt: "Veo: animate this image into a clean 5-second product reveal." },
      { topic: "Three-Second Hook Intros",
        value: "Generate a punchy video opener on demand",
        prompt: "Veo: a 3-second cinematic intro that says '[hook]' with bold on-screen text." }
    ]
  },
  "live": {
    name: "Gemini Live",
    emoji: "🎙️",
    accents: ["🎙️", "🗣️", "🎧"],
    nuggets: [
      { topic: "Rehearse Your Pitch Out Loud",
        value: "Talk it through and get live, spoken feedback",
        prompt: "Live: roleplay a skeptical buyer and push back on my [offer] pitch." },
      { topic: "Brainstorm While You Walk",
        value: "Hands-free idea sessions on the move",
        prompt: "Live: help me brainstorm 10 Skool post hooks about [topic]." },
      { topic: "Practise The Hard Conversation",
        value: "Run the talk before you actually have it",
        prompt: "Live: roleplay a refund request, then coach my replies afterward." }
    ]
  },
  "workspace": {
    name: "Workspace Integration",
    emoji: "📥",
    accents: ["📥", "📧", "📂"],
    nuggets: [
      { topic: "Inbox Zero By Lunch",
        value: "Summarise Gmail and draft replies in your tone",
        prompt: "Summarise my unread emails and draft 3 quick replies that sound like me." },
      { topic: "Your Drive Becomes Content",
        value: "Pull from Docs with zero copy-paste",
        prompt: "From my Drive, turn last week's call notes into a Skool recap post." },
      { topic: "Meeting Recaps On Autopilot",
        value: "Let Gemini own the follow-up",
        prompt: "Summarise this doc into action items with owners: [Drive file]" }
    ]
  },
  "general": {
    name: "Core Prompting",
    emoji: "⚡",
    accents: ["⚡", "🧠", "🎯"],
    nuggets: [
      { topic: "The Role, Goal, Format Trick",
        value: "Three lines that fix 90% of weak outputs",
        prompt: "You are a [role]. My goal is [goal]. Give it to me as [format]." },
      { topic: "Make It Plan Before It Answers",
        value: "Force Gemini to think first for sharper results",
        prompt: "Before answering, list your assumptions, then give your best response." },
      { topic: "The Make-It-Punchier Loop",
        value: "Iterate your way to crisp copy fast",
        prompt: "Rewrite this 3 ways, each punchier and shorter than the last: [paste]" },
      { topic: "Show It The Style You Want",
        value: "Feed examples and get your voice back",
        prompt: "Here are 2 posts I love: [paste]. Write one like them about [topic]." },
      { topic: "Ask For The Hidden Angles",
        value: "Get the ideas you didn't think of",
        prompt: "Give me 5 non-obvious angles to post about [topic] this week." }
    ]
  }
};

/* ---- Engagement CTAs (the reply-driver line) ---- */
const CTAS = [
  "Drop a 🔥 if you're trying this today.",
  "What would you tweak? Tell me 👇",
  "Steal it, then report back below. 👇",
  "Comment \"GEM\" and I'll send my full setup.",
  "Who's testing this this week? 🙋",
  "Tag someone who needs this. 👇",
  "Hit me with your version in the comments. 💬",
  "Save this one — you'll want it later. 🔖"
];

/* ---- Complete posts for pool-based types (tagged by feature) ---- */
const HOT_TAKES = [
  { feature: "general",
    title: "🌶️ Hot Take: Your Prompts Are Too Polite",
    body: "Most people whisper at Gemini. Stop.\n\nGive it a role, a goal, and a format — then boss it around. \"You are a [role]. Goal: [goal]. Format: [format].\"\n\nVague in = vague out. Specific in = magic out. 🎯\n\nAgree, or am I wrong? 👇" },
  { feature: "general",
    title: "🌶️ Unpopular Opinion: One Big Prompt Beats Ten Small Ones",
    body: "Everyone's chaining 12 messages. 😮‍💨\n\nGive Gemini the full context up front — role, examples, constraints, format — and it nails it in one shot.\n\nLess back-and-forth, better output. ⚡\n\nDo you go one-shot or chat it out? 👇" },
  { feature: "gems",
    title: "🌶️ Hot Take: If You're Not Using Gems, You're Doing It The Hard Way",
    body: "Re-typing the same instructions every day? 🥲\n\nBuild a Gem once — your voice, your offer, your rules baked in — and just talk to it.\n\nIt's the difference between a tool and a teammate. 🧩\n\nHow many Gems have you actually built? 👇" },
  { feature: "deep-research",
    title: "🌶️ Hot Take: Deep Research Killed The 3-Hour Google Rabbit Hole",
    body: "You don't need 40 open tabs anymore. 🔬\n\nGemini's Deep Research reads hundreds of sources and hands you a cited report while you grab coffee. ☕\n\nThe skill now is asking the right question.\n\nLast thing you researched with it? 👇" },
  { feature: "nano-banana",
    title: "🌶️ Hot Take: You Don't Need A Designer For Post Graphics",
    body: "Be honest — your Canva tabs are a graveyard. ⚰️\n\nNano Banana spins a scroll-stopping thumbnail from one sentence and edits photos by plain text.\n\nGood enough, in seconds, for free. 🍌\n\nDesigner or AI for your graphics? 👇" }
];

const POLLS = [
  { feature: "general",
    title: "🗳️ This Or That: One-Shot Prompt Or Long Conversation?",
    body: "How do you actually use Gemini? 🤔\n\n🅰️ One detailed prompt, done.\n🅱️ Chat it out, message by message.\n\nVote below — and tell me WHY you roll that way. 👇" },
  { feature: "gems",
    title: "🗳️ Quick Poll: How Many Gems Have You Built?",
    body: "Be honest. 🧩\n\n🅰️ Zero (still typing it all out 😅)\n🅱️ 1–2\n🅲 A whole squad of them\n\nDrop your letter 👇 — and what your favourite Gem does.",
    },
  { feature: "veo",
    title: "🗳️ This Or That: Veo Video Or Nano Banana Image?",
    body: "For your next Skool hook, what's pulling the click? 🎬🍌\n\n🅰️ An 8-sec Veo clip with sound\n🅱️ A bold Nano Banana thumbnail\n\nVote 👇 and tell me what you're posting about." },
  { feature: "deep-research",
    title: "🗳️ Poll: Biggest Time-Saver In Gemini?",
    body: "Pick your MVP feature 🏆\n\n🅰️ Deep Research 🔬\n🅱️ Gems 🧩\n🅲 Canvas 🎨\n🅳 Workspace inbox magic 📥\n\nVote below and defend your pick. 👇" }
];

const QUESTIONS = [
  { feature: "general",
    title: "💬 Quick Q: What's The One Prompt You Reuse Every Week?",
    body: "We've all got that ride-or-die prompt. 🫶\n\nThe one you paste into Gemini on repeat because it just works.\n\nDrop it below — let's build a swipe file together. 👇\n\nI'll start in the comments. 👇" },
  { feature: "gems",
    title: "💬 Tell Me: What Would Your Dream Gem Do?",
    body: "If you could build one Gem that ran part of your business on autopilot... 🧩\n\nWhat would it handle? Content? DMs? Onboarding?\n\nDescribe it below 👇 — odds are someone here has already built it." },
  { feature: "workspace",
    title: "💬 Honest Q: Have You Connected Gemini To Your Gmail Yet?",
    body: "Game-changer or nope? 📥\n\nGemini can summarise your inbox and draft replies in your voice — but a lot of people haven't flipped it on.\n\nYes / No / \"Wait, it does that?\" 👇" },
  { feature: "general",
    title: "💬 Drop It Below: Where Does Gemini Still Let You Down?",
    body: "No tool is perfect. 🤷\n\nWhere does Gemini still trip you up — long docs? tone? accuracy?\n\nShare your #1 frustration 👇 and let's crowdsource the fix in the comments." }
];

const WINS = [
  { feature: "general",
    title: "🎉 Small Win, Big Lesson: A Prompt Saved Me 2 Hours Today",
    body: "Swapped my messy ask for \"Role, Goal, Format\" and Gemini one-shot the whole thing. ⚡\n\nTwo hours back in my day. 🙌\n\nWhat did Gemini save YOU this week? Brag below 👇 — wins are contagious." },
  { feature: "gems",
    title: "🎉 Member Win: My Content Gem Just Wrote A Week Of Posts",
    body: "One idea in 🧩, five hooks out — all in my voice.\n\nSat down to write, stood up done. 🎉\n\nDrop your latest Gemini win below 👇 Let's celebrate the time you got back. 🙌" },
  { feature: "deep-research",
    title: "🎉 Win: Deep Research Validated My Offer Before I Built It",
    body: "Asked Gemini to check real demand + competitors. 🔬\n\nGot a cited report that saved me from building the wrong thing. 🙏\n\nWhat's a win Gemini handed you lately? Share it 👇 — proof it works helps everyone." }
];

const CHALLENGES = [
  { feature: "general",
    title: "🏆 7-Day Gemini Prompt Challenge — Who's In?",
    body: "One sharper prompt a day for 7 days. 💪\n\nDay 1: rewrite a task as \"Role, Goal, Format.\"\n\nThat's it. Small reps, big upgrade. ⚡\n\nComment \"IN\" 👇 and I'll drop tomorrow's prompt right here." },
  { feature: "gems",
    title: "🏆 Build-A-Gem Challenge: One Gem In 10 Minutes",
    body: "Your mission today: build ONE Gem. 🧩\n\nGive it your voice, your offer, and 3 rules. Then make it write a post.\n\n10 minutes, lifetime payoff. ⏱️\n\nComment \"BUILT\" when it's live 👇 — show us what it does." },
  { feature: "nano-banana",
    title: "🏆 Thumbnail Challenge: One Sentence, One Scroll-Stopper",
    body: "Today only: make a post graphic with Nano Banana. 🍌\n\nOne sentence in, one bold thumbnail out. No Canva, no designer.\n\nPost yours in the comments 👇 — we'll vote on the best one. 🏆" }
];

/* Map type -> pool for pool-based generation */
const POOLS = {
  "hot-take": HOT_TAKES,
  "poll": POLLS,
  "question": QUESTIONS,
  "win": WINS,
  "challenge": CHALLENGES
};
