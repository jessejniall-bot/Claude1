/* =====================================================================
   Skool Prompt Forge — Generation Engine
   ---------------------------------------------------------------------
   Assembles finished Skool posts from content.js:
     • Title Case heading (first letter of every word capitalised)
     • Emoji-rich body tuned by density
     • Guaranteed under 500 characters (title + body)
     • Built-in engagement CTA to drive replies
   ===================================================================== */

const CHAR_LIMIT = 500;

/* ---------- small utilities ---------- */
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* Capitalise the first letter of every word. Preserves existing
   capitals (so "AI", "DM", "Gemini" stay intact). */
function toTitleCase(str) {
  return str.replace(/[A-Za-z0-9][^\s-]*/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1)
  );
}

/* Count characters of the full post the way it lands on Skool. */
function postLength(title, body) {
  return title.length + body.length;
}

/* Pick a CTA and add accent emojis based on chosen density. */
function flavourCTA(feature) {
  const cta = rand(CTAS);
  const density = document.getElementById("emoji-density").value;
  if (density === "light") return cta;
  const accents = (FEATURES[feature] && FEATURES[feature].accents) || ["✨"];
  if (density === "heavy") {
    return cta + " " + accents.slice(0, 2).join(" ");
  }
  return cta + " " + rand(accents);
}

/* Resolve the feature the user asked for (or pick one at random). */
function resolveFeature(requested) {
  if (requested && requested !== "any") return requested;
  const keys = Object.keys(FEATURES);
  return rand(keys);
}

/* ---------- generators per post type ---------- */

/* Prompt Drop: hand over a real, copy-pasteable Gemini prompt. */
function genPromptDrop(featureKey) {
  const f = FEATURES[featureKey];
  const n = rand(f.nuggets);
  const titleOptions = [
    `${f.emoji} Steal My ${f.name} Prompt: ${n.topic}`,
    `${f.emoji} ${n.topic} — A Free ${f.name} Prompt`,
    `🎁 Copy-Paste ${f.name} Prompt: ${n.topic}`
  ];
  const title = toTitleCase(rand(titleOptions));
  const body =
    `${n.value}. 👇\n\n` +
    `Prompt:\n"${n.prompt}"\n\n` +
    `Paste it into Gemini, swap the [brackets], and go. ${flavourCTA(featureKey)}`;
  return { title, body, type: "Prompt Drop", feature: f };
}

/* Quick Tutorial: a tiny 3-step walkthrough around one prompt. */
function genTutorial(featureKey) {
  const f = FEATURES[featureKey];
  const n = rand(f.nuggets);
  const title = toTitleCase(`${f.emoji} 3 Steps To Use ${f.name}: ${n.topic}`);
  const body =
    `${n.value} — here's the fast path: ⬇️\n\n` +
    `1️⃣ Open Gemini and pick ${f.name}.\n` +
    `2️⃣ Paste: "${n.prompt}"\n` +
    `3️⃣ Swap the [brackets] and refine once.\n\n` +
    `${flavourCTA(featureKey)}`;
  return { title, body, type: "Quick Tutorial", feature: f };
}

/* Pool-based types (hot take, poll, question, win, challenge). */
function genFromPool(typeKey, featureKey, requestedFeature) {
  const pool = POOLS[typeKey];
  let choices = pool;
  if (requestedFeature && requestedFeature !== "any") {
    const matched = pool.filter((p) => p.feature === requestedFeature);
    if (matched.length) choices = matched;
  }
  const pick = rand(choices);
  const f = FEATURES[pick.feature] || FEATURES.general;
  const labels = {
    "hot-take": "Hot Take",
    "poll": "Poll",
    "question": "Open Question",
    "win": "Win Celebration",
    "challenge": "Challenge"
  };
  return {
    title: toTitleCase(pick.title),
    body: pick.body,
    type: labels[typeKey],
    feature: f
  };
}

/* Master generator: route by requested type + feature. */
function generatePost(requestedType, requestedFeature) {
  let type = requestedType;
  if (!type || type === "any") {
    type = rand([
      "prompt-drop", "hot-take", "poll",
      "question", "tutorial", "challenge", "win"
    ]);
  }

  let post;
  if (type === "prompt-drop") {
    post = genPromptDrop(resolveFeature(requestedFeature));
  } else if (type === "tutorial") {
    post = genTutorial(resolveFeature(requestedFeature));
  } else {
    post = genFromPool(type, requestedFeature, requestedFeature);
  }

  /* Hard guarantee: under the character limit. Trim body if needed. */
  if (postLength(post.title, post.body) >= CHAR_LIMIT) {
    const room = CHAR_LIMIT - post.title.length - 2;
    if (room > 0) post.body = post.body.slice(0, room).trimEnd() + "…";
  }
  return post;
}

/* ---------- rendering ---------- */

function renderCard(post) {
  const tpl = document.getElementById("card-template");
  const node = tpl.content.cloneNode(true);
  const card = node.querySelector(".card");

  card.querySelector(".card-tag").textContent = post.type;
  card.querySelector(".card-feature").textContent =
    `${post.feature.emoji} ${post.feature.name}`;
  card.querySelector(".card-title").textContent = post.title;
  card.querySelector(".card-body").textContent = post.body;

  const total = postLength(post.title, post.body);
  const counter = card.querySelector(".char-count");
  counter.textContent = `${total} / ${CHAR_LIMIT} chars`;
  counter.classList.toggle("over", total >= CHAR_LIMIT);
  counter.classList.toggle("tight", total >= 440 && total < CHAR_LIMIT);

  /* Copy = Title line + blank line + body, ready to paste into Skool. */
  card.querySelector(".btn-copy").addEventListener("click", (e) => {
    const text = `${post.title}\n\n${post.body}`;
    navigator.clipboard.writeText(text).then(() => {
      const btn = e.currentTarget;
      const original = btn.textContent;
      btn.textContent = "✅ Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("copied");
      }, 1400);
    });
  });

  /* Reroll = replace this single card with a fresh post of same filters. */
  card.querySelector(".btn-reroll").addEventListener("click", () => {
    const type = document.getElementById("category").value;
    const feature = document.getElementById("feature").value;
    const fresh = generatePost(type, feature);
    const replacement = renderCard(fresh);
    card.replaceWith(replacement);
  });

  return card;
}

function showPosts(posts) {
  const out = document.getElementById("output");
  out.innerHTML = "";
  posts.forEach((p) => out.appendChild(renderCard(p)));
  out.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- wire up controls ---------- */

function currentFilters() {
  return {
    type: document.getElementById("category").value,
    feature: document.getElementById("feature").value
  };
}

document.getElementById("generate").addEventListener("click", () => {
  const { type, feature } = currentFilters();
  showPosts([generatePost(type, feature)]);
});

document.getElementById("batch").addEventListener("click", () => {
  const { type, feature } = currentFilters();
  const posts = [];
  const seen = new Set();
  let guard = 0;
  while (posts.length < 5 && guard < 40) {
    const p = generatePost(type, feature);
    const key = p.title + p.body;
    if (!seen.has(key)) {
      seen.add(key);
      posts.push(p);
    }
    guard++;
  }
  showPosts(posts);
});

/* Generate one on load so the page is never empty. */
window.addEventListener("DOMContentLoaded", () => {
  showPosts([generatePost("any", "any")]);
});
