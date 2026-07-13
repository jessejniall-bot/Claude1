/* Ember — app logic: chat, heat engine, presence, demo crowd, live mode. */
(() => {
  "use strict";

  /* ================= helpers ================= */
  const $ = s => document.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const store = {
    get(k, fb) { try { const v = localStorage.getItem("ember:" + k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
    set(k, v) { try { localStorage.setItem("ember:" + k, JSON.stringify(v)); } catch {} },
  };
  const colorFor = name => {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 78% 68%)`;
  };
  const timeStr = ts => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayKey = () => new Date().toISOString().slice(0, 10);

  /* ================= settings & state ================= */
  const urlRoom = new URLSearchParams(location.search).get("room");
  const settings = Object.assign(
    { mode: "demo", room: "campfire", sbUrl: "", sbKey: "", demoCrowd: true, sound: false },
    store.get("settings", {})
  );
  if (urlRoom) settings.room = urlRoom.replace(/[^\w-]/g, "").slice(0, 32) || settings.room;

  const me = { id: store.get("id", null) || uid(), name: "", color: "#ffb15e" };
  store.set("id", me.id);

  const present = new Map();          // id -> {id,name,color,bot,ts}
  const seen = new Set();             // message ids (dedup across buses)
  let joined = false;
  let msgsTonight = store.get(`count:${settings.room}:${dayKey()}`, 0);

  /* ================= heat engine =================
     The whole gimmick: conversation feeds the fire, silence starves it. */
  const HEAT_FLOOR = 0.05, HALF_LIFE = 75; // seconds to halve when quiet
  let heat = 0.35;
  const LEVELS = [
    [0.14, "Embers…"], [0.3, "Flickering"], [0.48, "Crackling"],
    [0.68, "Cozy Blaze"], [0.85, "Roaring"], [1.01, "BONFIRE!"],
  ];
  function stokeHeat(amt) { heat = clamp(heat + amt, HEAT_FLOOR, 1); syncHeat(); }
  function syncHeat() {
    Scene.setHeat(heat);
    const lvl = LEVELS.find(l => heat < l[0]) || LEVELS.at(-1);
    $("#heatLabel").textContent = lvl[1];
    $("#heatPill").classList.toggle("blaze", heat >= 0.68);
  }
  let lastTick = Date.now();
  setInterval(() => {
    const dt = (Date.now() - lastTick) / 1000; lastTick = Date.now();
    heat = HEAT_FLOOR + (heat - HEAT_FLOOR) * Math.pow(0.5, dt / HALF_LIFE);
    syncHeat();
    if (joined && heat < 0.13 && !embersNagged) {
      embersNagged = true;
      addSys("the fire is down to embers… say something to stoke it 🔥");
    }
    if (heat > 0.2) embersNagged = false;
  }, 500);
  let embersNagged = false;

  /* ================= chat log UI ================= */
  const log = $("#log");
  function addMsg(m) {
    const el = document.createElement("div");
    el.className = "msg" + (m.from === me.id ? " me-msg" : "");
    const who = document.createElement("span");
    who.className = "who";
    who.style.setProperty("--c", m.color || colorFor(m.name));
    who.textContent = m.name;
    const body = document.createElement("span");
    body.textContent = m.text;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = timeStr(m.ts || Date.now());
    el.append(who, body, when);
    appendToLog(el);
  }
  function addSys(text) {
    const el = document.createElement("div");
    el.className = "msg sys";
    el.textContent = text;
    appendToLog(el);
  }
  function appendToLog(el) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.appendChild(el);
    while (log.children.length > 250) log.firstChild.remove();
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }
  function bumpCount() {
    msgsTonight++;
    $("#msgCount").textContent = msgsTonight;
    store.set(`count:${settings.room}:${dayKey()}`, msgsTonight);
  }

  /* words rise with the smoke */
  const floats = $("#floats");
  function wisp(name, text, pop) {
    if (document.hidden) return;
    const a = Scene.anchor();
    const el = document.createElement("div");
    el.className = "wisp" + (pop ? " pop" : "");
    if (name) {
      const b = document.createElement("b");
      b.textContent = name + "  ";
      el.appendChild(b);
    }
    el.appendChild(document.createTextNode(text));
    el.style.left = (a.x + rand(-24, 24)) + "px";
    el.style.top = (a.y - (pop ? 130 : 92) - Math.random() * 85) + "px";
    el.style.setProperty("--dx", (rand(-46, 46) | 0) + "px");
    while (floats.children.length > 5) floats.firstChild.remove();
    floats.appendChild(el);
    setTimeout(() => el.remove(), 4400);
  }

  /* ================= presence chips around the fire ================= */
  function touchPresence(p) {
    if (!p || !p.id) return;
    const had = present.has(p.id);
    present.set(p.id, { ...present.get(p.id), ...p, ts: Date.now() });
    if (!had) renderChips();
  }
  function renderChips() {
    const a = Scene.anchor();
    const chips = $("#chips");
    chips.innerHTML = "";
    const people = [...present.values()].slice(0, 9);
    const n = people.length;
    const rx = Math.min(a.w * 0.3, 250), ry = 40;
    people.forEach((p, i) => {
      const th = Math.PI * (0.1 + 0.8 * ((i + 0.5) / n));
      const el = document.createElement("div");
      el.className = "chip" + (p.id === me.id ? " me" : "");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.setProperty("--c", p.color);
      const nm = document.createElement("span");
      nm.textContent = p.id === me.id ? p.name + " (you)" : p.name;
      el.append(dot, nm);
      el.style.left = (a.x + Math.cos(th) * rx) + "px";
      el.style.top = (a.y + 34 + Math.sin(th) * ry) + "px";
      chips.appendChild(el);
    });
    if (present.size > 9) {
      const more = document.createElement("div");
      more.className = "chip";
      more.textContent = `+${present.size - 9} more`;
      more.style.left = a.x + "px";
      more.style.top = (a.y + 96) + "px";
      chips.appendChild(more);
    }
    $("#peopleCount").textContent = present.size;
  }
  setInterval(() => {
    let changed = false;
    for (const [id, p] of present) {
      if (id !== me.id && !p.bot && Date.now() - p.ts > 16000) { present.delete(id); changed = true; }
    }
    if (changed || present.size) renderChips();
  }, 4000);
  addEventListener("resize", () => renderChips());

  /* ================= message pipeline (all sources) ================= */
  const TOSS = {
    marshmallow: { emoji: "🍡", heat: 0.07, label: "toasted a marshmallow" },
    sparks:      { emoji: "✨", heat: 0.1,  label: "threw sparks" },
    log:         { emoji: "🪵", heat: 0.22, label: "threw a log on the fire" },
  };

  function handleIncoming(m) {
    if (!m || seen.has(m.id)) return;
    seen.add(m.id);
    if (seen.size > 600) seen.delete(seen.values().next().value);
    if (m.kind === "msg") {
      addMsg(m);
      wisp(m.name, m.text);
      stokeHeat(0.15);
      bumpCount();
      touchPresence({ id: m.from, name: m.name, color: m.color, bot: m.bot });
      if (!m.bot) demo.onHumanMessage(m);
    } else if (m.kind === "toss") {
      const k = TOSS[m.toss] || TOSS.sparks;
      touchPresence({ id: m.from, name: m.name, color: m.color, bot: m.bot });
      Scene.toss(k.emoji, edgePoint(), () => {
        stokeHeat(k.heat);
        wisp(null, `${m.name} ${k.label} ${k.emoji}`, true);
      });
    } else if (m.kind === "join") {
      touchPresence({ id: m.from, name: m.name, color: m.color, bot: m.bot });
      addSys(`🪵 ${m.name} pulled up a log`);
      if (!m.bot) demo.onHumanJoin(m);
    } else if (m.kind === "hb") {
      touchPresence({ id: m.from, name: m.name, color: m.color, bot: m.bot });
    } else if (m.kind === "leave") {
      if (present.delete(m.from)) { addSys(`${m.name} wandered off into the dark`); renderChips(); }
    }
  }
  function edgePoint() {
    const a = Scene.anchor();
    return { x: Math.random() < 0.5 ? -10 : a.w + 10, y: a.h * rand(0.3, 0.55) };
  }

  /* ================= local bus (tabs on the same machine) ================= */
  let bc = null;
  try {
    bc = new BroadcastChannel("ember:" + settings.room);
    bc.onmessage = e => handleIncoming(e.data);
  } catch {}
  function broadcast(m) {
    try { bc && bc.postMessage(m); } catch {}
    live.send(m);
  }

  /* ================= live mode (Supabase free tier) ================= */
  const live = (() => {
    let client = null, channel = null, ready = false, tableOK = true;
    function loadSdk() {
      return new Promise((res, rej) => {
        if (window.supabase) return res();
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
        s.onload = res;
        s.onerror = () => rej(new Error("couldn't load the Supabase SDK (network blocked?)"));
        document.head.appendChild(s);
      });
    }
    async function connect() {
      addSys("connecting to the live fire…");
      try {
        await loadSdk();
        client = window.supabase.createClient(settings.sbUrl, settings.sbKey, { auth: { persistSession: false } });
        channel = client.channel("ember:" + settings.room, {
          config: { broadcast: { self: false }, presence: { key: me.id } },
        });
        channel.on("broadcast", { event: "ember" }, ({ payload }) => handleIncoming(payload));
        channel.on("presence", { event: "sync" }, () => {
          const state = channel.presenceState();
          for (const key of Object.keys(state)) {
            const meta = state[key][0] || {};
            touchPresence({ id: key, name: meta.name || "someone", color: meta.color });
          }
          for (const [id, p] of present) {
            if (!p.bot && id !== me.id && !state[id]) present.delete(id);
          }
          renderChips();
        });
        channel.subscribe(async status => {
          if (status === "SUBSCRIBED" && !ready) {
            ready = true;
            await channel.track({ name: me.name, color: me.color });
            addSys("🟢 live — anyone who opens this page with the same room name joins your fire");
            history();
          } else if (status === "CHANNEL_ERROR") {
            addSys("⚠️ live connection hiccup — check your Supabase URL/key in ⚙️");
          }
        });
      } catch (err) {
        addSys("⚠️ " + err.message + " — the fire still works locally");
      }
    }
    async function history() {
      try {
        const { data, error } = await client.from("ember_messages")
          .select("name,color,text,created_at").eq("room", settings.room)
          .order("created_at", { ascending: false }).limit(40);
        if (error) throw error;
        if (data && data.length) {
          addSys(`— earlier around this fire —`);
          for (const r of data.reverse()) {
            addMsg({ name: r.name, color: r.color, text: r.text, ts: new Date(r.created_at).getTime() });
          }
        }
      } catch {
        tableOK = false;
        addSys("(no history table — messages are ephemeral. run setup.sql in Supabase to keep them)");
      }
    }
    return {
      connect,
      send(m) {
        if (!ready) return;
        channel.send({ type: "broadcast", event: "ember", payload: m });
        if (m.kind === "msg" && tableOK) {
          client.from("ember_messages")
            .insert({ room: settings.room, name: m.name, color: m.color, text: m.text })
            .then(({ error }) => { if (error) tableOK = false; });
        }
      },
    };
  })();

  /* ================= demo crowd =================
     Simulated members so a solo test still feels like a gathering.
     Only the "leader" tab emits bots, so two open tabs share one crowd. */
  const demo = (() => {
    const BOTS = ["Maya", "Theo", "Priya", "Marcus", "Jordan"].map(name => ({
      id: "bot-" + name.toLowerCase(),
      name,
      color: colorFor(name + "🔥"),
    }));
    const GREET = [
      "hey {n}, welcome in 🔥", "{n}!! pull up a log 🪵", "yooo {n} made it 👀",
      "welcome {n} — marshmallows are over there 🍡",
    ];
    const AMBIENT = [
      "okay who's building something cool this week 👀",
      "just got my first Gem working end to end and honestly? so proud 😂",
      "hot take: voice prompting > typing and it's not even close",
      "the fire's looking healthy tonight 🔥",
      "someone toss a log, I'm settling in ☕",
      "what's one small win from today? mine: inbox zero (it lasted 4 minutes)",
      "Deep Research just saved me like 3 hours of googling, not even joking",
      "night crew checking in 🌙 what are we all working on",
      "petition to make this campfire a weekly thing 🙋",
      "my video render finishes while I sit by a fake fire. living in 2026 fr",
      "if the fire dies while I'm getting coffee I'm blaming all of you",
      "anyone else's prompts just hitting different tonight?",
    ];
    const REPLY = [
      "hahaha exactly", "wait that's actually smart", "ooh tell us more 👀", "+1 🔥",
      "this is why I love this group", "same tbh", "okay noted. trying that tomorrow",
      "the fire approves", "big if true", "lmaooo", "so real",
    ];
    let joinedBots = [], timers = [], leader = false;

    // cheap leader election so multiple tabs don't double the crowd
    function electLeader() {
      try {
        const k = "ember:leader:" + settings.room;
        const cur = JSON.parse(localStorage.getItem(k) || "null");
        if (!cur || Date.now() - cur.ts > 7000 || cur.id === me.id) {
          localStorage.setItem(k, JSON.stringify({ id: me.id, ts: Date.now() }));
          leader = true;
        } else leader = false;
      } catch { leader = true; }
    }
    setInterval(electLeader, 3000);

    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    function emit(m) { handleIncoming(m); broadcast(m); }
    function botSay(bot, text) {
      emit({ id: uid(), kind: "msg", from: bot.id, name: bot.name, color: bot.color, text, ts: Date.now(), bot: true });
    }
    function botJoin(bot) {
      if (joinedBots.includes(bot)) return;
      joinedBots.push(bot);
      emit({ id: uid(), kind: "join", from: bot.id, name: bot.name, color: bot.color, bot: true });
    }
    function botToss(bot) {
      emit({ id: uid(), kind: "toss", from: bot.id, name: bot.name, color: bot.color, toss: pick(Object.keys(TOSS)), bot: true });
    }
    function ambientLoop() {
      later(() => {
        if (leader && joinedBots.length) {
          Math.random() < 0.82 ? botSay(pick(joinedBots), pick(AMBIENT)) : botToss(pick(joinedBots));
        }
        ambientLoop();
      }, rand(9000, 22000));
    }
    return {
      active: () => settings.mode === "demo" && settings.demoCrowd,
      start() {
        if (!this.active()) return;
        electLeader();
        if (!leader) return; // crowd already running in another tab
        later(() => botJoin(BOTS[0]), 1100);
        later(() => botJoin(BOTS[1]), 2600);
        later(() => botJoin(BOTS[2]), 4600);
        later(() => joinedBots[0] && botSay(joinedBots[0], pick(GREET).replaceAll("{n}", me.name)), 3400);
        later(() => BOTS[3] && botJoin(BOTS[3]), rand(20000, 45000));
        ambientLoop();
      },
      onHumanMessage() {
        if (!this.active() || !leader || !joinedBots.length) return;
        if (Math.random() < 0.65) later(() => botSay(pick(joinedBots), pick(REPLY)), rand(2800, 7500));
        if (Math.random() < 0.3) later(() => botToss(pick(joinedBots)), rand(1500, 4000));
      },
      onHumanJoin(m) {
        if (!this.active() || !leader || !joinedBots.length || m.from === me.id) return;
        later(() => botSay(pick(joinedBots), pick(GREET).replaceAll("{n}", m.name)), rand(2000, 5000));
      },
    };
  })();

  /* ================= fire crackle (synthesized, no audio files) ================= */
  const sound = (() => {
    let ctx = null, noiseBuf = null, on = false, looping = false;
    function ensure() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    function crackle() {
      if (!on) { looping = false; return; }
      try {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = rand(420, 2400);
        bp.Q.value = 1.4;
        const g = ctx.createGain();
        const t0 = ctx.currentTime, dur = rand(0.015, 0.1);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(rand(0.02, 0.09) * (0.35 + heat), t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(bp).connect(g).connect(ctx.destination);
        src.start(t0, rand(0, 0.35), dur + 0.02);
      } catch {}
      setTimeout(crackle, rand(30, 90) + (1 - heat) * rand(120, 420));
    }
    return {
      set(v) {
        on = v;
        $("#soundBtn").textContent = v ? "🔊" : "🔇";
        if (v && !looping) {
          try { ensure(); ctx.resume(); looping = true; crackle(); } catch { on = false; looping = false; }
        }
      },
      get on() { return on; },
    };
  })();

  /* ================= actions ================= */
  function join(name) {
    me.name = (name || "").trim().slice(0, 24) || "Wanderer";
    me.color = colorFor(me.name);
    store.set("name", me.name);
    joined = true;
    $("#joinOverlay").classList.remove("show");
    touchPresence({ ...me });
    addSys(`🪵 you pulled up a log as ${me.name}`);
    addSys(settings.mode === "demo"
      ? "demo mode — the crowd is simulated so you can feel the vibe. ⚙️ to go live."
      : `room “${settings.room}” — share this page + room name to gather people.`);
    broadcast({ id: uid(), kind: "join", from: me.id, name: me.name, color: me.color });
    stokeHeat(0.2);
    if (settings.mode === "live" && settings.sbUrl && settings.sbKey) live.connect();
    else if (settings.mode === "live") addSys("⚠️ live mode needs a Supabase URL + anon key — open ⚙️");
    demo.start();
    setInterval(() => {
      if (joined) broadcast({ id: uid(), kind: "hb", from: me.id, name: me.name, color: me.color });
    }, 8000);
    $("#msgInput").focus();
  }

  function sendMessage(text) {
    text = text.trim().slice(0, 280);
    if (!text || !joined) return;
    const m = { id: uid(), kind: "msg", from: me.id, name: me.name, color: me.color, text, ts: Date.now() };
    seen.add(m.id);
    addMsg(m);
    wisp(me.name, text);
    stokeHeat(0.16);
    bumpCount();
    Scene.stoke(0.5);
    broadcast(m);
    demo.onHumanMessage(m);
  }

  let lastToss = 0;
  function doToss(kind, btn) {
    if (!joined || Date.now() - lastToss < 650) return;
    lastToss = Date.now();
    const k = TOSS[kind];
    const r = btn.getBoundingClientRect();
    const from = { x: r.left + r.width / 2, y: r.top };
    const m = { id: uid(), kind: "toss", from: me.id, name: me.name, color: me.color, toss: kind };
    seen.add(m.id);
    Scene.toss(k.emoji, from, () => {
      stokeHeat(k.heat);
      const extra = kind === "marshmallow" && Math.random() < 0.12 ? " …it caught fire!! 🔥" : "";
      wisp(null, `you ${k.label} ${k.emoji}${extra}`, true);
    });
    broadcast(m);
  }

  /* ================= UI wiring ================= */
  function initUI() {
    $("#roomLabel").textContent = "room: " + settings.room;
    const badge = $("#modeBadge");
    badge.textContent = settings.mode;
    badge.className = "badge " + settings.mode;
    $("#msgCount").textContent = msgsTonight;
    $("#nameInput").value = store.get("name", "");
    $("#joinFine").textContent = settings.mode === "demo"
      ? (settings.demoCrowd ? "Demo crowd is on — you won't be alone. (⚙️ to change)" : "Demo crowd is off. (⚙️ to change)")
      : `Live room: “${settings.room}”`;

    $("#joinBtn").addEventListener("click", () => join($("#nameInput").value));
    $("#nameInput").addEventListener("keydown", e => { if (e.key === "Enter") join($("#nameInput").value); });

    $("#composer").addEventListener("submit", e => {
      e.preventDefault();
      sendMessage($("#msgInput").value);
      $("#msgInput").value = "";
    });
    document.querySelectorAll(".toss").forEach(b =>
      b.addEventListener("click", () => doToss(b.dataset.kind, b))
    );

    $("#soundBtn").addEventListener("click", () => {
      sound.set(!sound.on);
      settings.sound = sound.on;
      store.set("settings", settings);
      $("#setSound").checked = sound.on;
    });

    // settings
    const so = $("#settingsOverlay");
    $("#gearBtn").addEventListener("click", () => {
      $("#setMode").value = settings.mode;
      $("#setRoom").value = settings.room;
      $("#setSbUrl").value = settings.sbUrl;
      $("#setSbKey").value = settings.sbKey;
      $("#setDemoCrowd").checked = settings.demoCrowd;
      $("#setSound").checked = settings.sound;
      $("#liveFields").classList.toggle("show", settings.mode === "live");
      so.classList.add("show");
    });
    $("#setMode").addEventListener("change", e =>
      $("#liveFields").classList.toggle("show", e.target.value === "live"));
    $("#settingsClose").addEventListener("click", () => so.classList.remove("show"));
    $("#settingsSave").addEventListener("click", () => {
      const next = {
        mode: $("#setMode").value,
        room: ($("#setRoom").value.replace(/[^\w-]/g, "") || "campfire").slice(0, 32),
        sbUrl: $("#setSbUrl").value.trim(),
        sbKey: $("#setSbKey").value.trim(),
        demoCrowd: $("#setDemoCrowd").checked,
        sound: $("#setSound").checked,
      };
      const reload = joined && (next.mode !== settings.mode || next.room !== settings.room ||
        next.sbUrl !== settings.sbUrl || next.sbKey !== settings.sbKey || next.demoCrowd !== settings.demoCrowd);
      Object.assign(settings, next);
      store.set("settings", settings);
      sound.set(settings.sound);
      so.classList.remove("show");
      if (reload) {
        const q = new URLSearchParams(location.search);
        q.set("room", settings.room);
        location.search = q.toString(); // clean restart with new config
      } else initUILabels();
    });
    function initUILabels() {
      $("#roomLabel").textContent = "room: " + settings.room;
      badge.textContent = settings.mode;
      badge.className = "badge " + settings.mode;
    }

    addEventListener("beforeunload", () => {
      if (joined) { try { bc && bc.postMessage({ id: uid(), kind: "leave", from: me.id, name: me.name }); } catch {} }
    });
  }

  /* ================= boot ================= */
  document.addEventListener("DOMContentLoaded", () => {
    Scene.init($("#cv"));
    syncHeat();
    initUI();
    if (settings.sound) sound.set(true);
    // tiny hook for automated tests / tinkering
    window.EMBER = {
      join, post: sendMessage, toss: doToss,
      setHeat(h) { heat = clamp(h, HEAT_FLOOR, 1); syncHeat(); },
      state: () => ({ heat, mode: settings.mode, room: settings.room, people: present.size }),
    };
  });
})();
